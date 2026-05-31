import { pool } from '../../db/postgres.js';
import { publishMissionEvent } from '../../realtime/events.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { missionStore } from '../missionStore.js';
import { normalizeOtlpJson } from '../../routes/missions.js';
import { once } from 'node:events';

export class SandboxJobRunner {
  private isRunning = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly maxConcurrentJobs = 5;
  private currentJobs = 0;
  private activeJobs = new Map<string, { missionId: string, branchId: string, outputDir: string }>();

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    // Initial cleanup
    await this.reconcileStaleJobs();
    
    this.checkInterval = setInterval(() => this.pollJobs(), 2000);
  }

  async stop() {
    this.isRunning = false;
    if (this.checkInterval) clearInterval(this.checkInterval);
  }

  /**
   * Handle an interrupt decision by writing it to the local decision bridge
   * for any active sandbox jobs matching this mission and branch.
   */
  async onDecisionMade(missionId: string, branchId: string, interrupt: any) {
    for (const [jobId, info] of this.activeJobs.entries()) {
      if (info.missionId === missionId && info.branchId === branchId) {
        const decisionFile = path.join(info.outputDir, 'decisions.jsonl');
        try {
          await fs.appendFile(decisionFile, JSON.stringify(interrupt) + '\n');
          console.info(`[SandboxJobRunner] Wrote decision to bridge for job ${jobId}: ${interrupt.decision}`);
        } catch (err) {
          console.error(`[SandboxJobRunner] Failed to write decision to bridge: ${err}`);
        }
      }
    }
  }

  private async reconcileStaleJobs() {
    const client = await pool.connect();
    try {
      await client.query(`
        UPDATE branch_sandbox_jobs
        SET status = 'abandoned', updated_at = NOW()
        WHERE status IN ('starting', 'running')
      `);
    } finally {
      client.release();
    }
  }

  private async pollJobs() {
    if (this.currentJobs >= this.maxConcurrentJobs) return;
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`
        SELECT j.*, e.docker_image, e.python_entrypoint, e.timeout_seconds, e.resource_limits, e.env_allowlist
        FROM branch_sandbox_jobs j
        JOIN branch_executor_specs e ON j.executor_id = e.id
        WHERE j.status = 'queued'
        ORDER BY j.created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      
      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        return;
      }
      
      const job = result.rows[0];
      await client.query(`
        UPDATE branch_sandbox_jobs 
        SET status = 'starting', updated_at = NOW(), started_at = NOW()
        WHERE id = $1
      `, [job.id]);
      
      await client.query('COMMIT');
      
      this.currentJobs++;
      this.activeJobs.set(job.id, { 
        missionId: job.mission_id, 
        branchId: job.branch_id, 
        outputDir: path.join(os.tmpdir(), `agentlens-sandbox-${job.id}`, 'output') 
      });

      this.runJob(job).catch(console.error).finally(() => {
        this.currentJobs--;
        this.activeJobs.delete(job.id);
      });
      
    } catch (err) {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }

  private async runJob(job: any) {
    const workDir = path.join(os.tmpdir(), `agentlens-sandbox-${job.id}`);
    const contextDir = path.join(workDir, 'context');
    const outputDir = path.join(workDir, 'output');
    
    try {
      await fs.mkdir(contextDir, { recursive: true });
      await fs.mkdir(outputDir, { recursive: true });
      
      const branchRes = await pool.query(
        `SELECT parent_branch_id, forked_from_sequence_num, metadata FROM mission_replay_branches WHERE mission_id = $1 AND id = $2`,
        [job.mission_id, job.branch_id]
      );
      const branchInfo = branchRes.rows[0];
      
      const branchContext = {
        mission_id: job.mission_id,
        branch_id: job.branch_id,
        source_branch_id: branchInfo?.parent_branch_id || 'main',
        forked_from_sequence_num: branchInfo?.forked_from_sequence_num || 0,
        tool_policy: 'mock',
        injections: branchInfo?.metadata?.injections || [],
      };
      
      await fs.writeFile(path.join(contextDir, 'context.json'), JSON.stringify(branchContext));
      
      await pool.query(`UPDATE branch_sandbox_jobs SET status = 'running', updated_at = NOW() WHERE id = $1`, [job.id]);
      await publishMissionEvent(job.mission_id, 'branch.sandbox.started', { job_id: job.id });
      
      const containerName = `al-branch-${job.id}`;
      await pool.query(`UPDATE branch_sandbox_jobs SET container_id = $1 WHERE id = $2`, [containerName, job.id]);

      const limits = job.resource_limits || {};
      const cpuLimit = limits.cpu || '1.0';
      const memLimit = limits.memory || '1g';
      const pidsLimit = limits.pids || 256;
      
      const currentDir = process.cwd();
      const workspaceRoot = path.resolve(currentDir, '../../');
      
      // Ensure we can find the packages in the workspace
      const pythonPath = [
        '/app',
        '/app/examples',
        '/app/packages/sdk-core',
        '/app/packages/otel-semconv',
        '/app/packages/sdk-langgraph',
      ].join(':');

      const tailPromise = this.tailJsonl(job, path.join(outputDir, 'telemetry.jsonl'));

      let exitCode = 0;
      let timeouted = false;
      const timeoutSeconds = job.timeout_seconds || 300;
      
      const child = spawn('docker', [
        'run',
        '--rm',
        '--name', containerName,
        '--network', 'none',
        '--cpus', cpuLimit,
        '--memory', memLimit,
        '--pids-limit', String(pidsLimit),
        '--label', `mission_id=${job.mission_id}`,
        '--label', `branch_id=${job.branch_id}`,
        '--label', `job_id=${job.id}`,
        '-e', 'AGENTLENS_SANDBOX_MODE=1',
        '-e', `AGENTLENS_BRANCH_ID=${job.branch_id}`,
        '-e', `AGENTLENS_MISSION_ID=${job.mission_id}`,
        '-e', 'AGENTLENS_SANDBOX_OUTPUT_DIR=/agentlens/output',
        '-e', `PYTHONPATH=${pythonPath}`,
        '-v', `${workspaceRoot}:/app:ro`,
        '-v', `${contextDir}:/agentlens/context:ro`,
        '-v', `${outputDir}:/agentlens/output:rw`,
        '--workdir', '/app',
        job.docker_image,
        'python', '-m', 'agentlens_sdk.branch_worker',
        '--context', '/agentlens/context/context.json',
        '--entrypoint', job.python_entrypoint
      ]);

      child.stdout.on('data', (data) => {
        this.logToDb(job.id, 'stdout', data.toString());
      });

      child.stderr.on('data', (data) => {
        this.logToDb(job.id, 'stderr', data.toString());
      });

      const timeoutTimer = setTimeout(() => {
        timeouted = true;
        child.kill('SIGTERM');
        // Force kill after 5 more seconds if it doesn't respond
        setTimeout(() => child.kill('SIGKILL'), 5000);
      }, timeoutSeconds * 1000);

      try {
        const [code] = await once(child, 'exit');
        exitCode = code || 0;
      } catch (err: any) {
        exitCode = 1;
        await this.logToDb(job.id, 'stderr', err.message || String(err));
      } finally {
        clearTimeout(timeoutTimer);
      }

      const finalStatus = timeouted ? 'timeout' : (exitCode === 0 ? 'completed' : 'failed');
      
      await pool.query(`
        UPDATE branch_sandbox_jobs 
        SET status = $1, exit_code = $2, updated_at = NOW(), completed_at = NOW() 
        WHERE id = $3
      `, [finalStatus, exitCode, job.id]);
      
      await publishMissionEvent(job.mission_id, `branch.sandbox.${finalStatus}`, { job_id: job.id, exit_code: exitCode });

      await tailPromise;

    } catch (err) {
      await pool.query(`
        UPDATE branch_sandbox_jobs 
        SET status = 'failed', updated_at = NOW(), completed_at = NOW() 
        WHERE id = $1
      `, [job.id]);
      await publishMissionEvent(job.mission_id, 'branch.sandbox.failed', { job_id: job.id });
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async tailJsonl(job: any, filepath: string) {
    let pos = 0;
    const maxTries = 100;
    let tries = 0;
    
    while (tries < maxTries) {
      try {
        const stat = await fs.stat(filepath);
        if (stat.size > pos) {
          const file = await fs.open(filepath, 'r');
          const buffer = Buffer.alloc(stat.size - pos);
          await file.read(buffer, 0, stat.size - pos, pos);
          await file.close();
          
          pos = stat.size;
          const lines = buffer.toString('utf-8').split('\n').filter(l => l.trim());
          for (const line of lines) {
            try {
              const batch = JSON.parse(line);
              const normalized = normalizeOtlpJson(batch);
              await missionStore.ingestSpans(
                job.mission_id,
                normalized.spans,
                normalized.resource_attributes,
                job.branch_id,
                normalized.batch_id
              );
            } catch (e) {
              console.error('Failed to ingest batch:', e);
            }
          }
        }
      } catch (e) {
        // Ignore missing file or other read errors during startup/shutdown
      }
      
      const jobRes = await pool.query(`SELECT status FROM branch_sandbox_jobs WHERE id = $1`, [job.id]);
      if (jobRes.rowCount !== null && jobRes.rowCount > 0) {
        const status = jobRes.rows[0].status;
        if (status !== 'starting' && status !== 'running') {
          // One final check for data before breaking
          try {
            const stat = await fs.stat(filepath);
            if (stat.size <= pos) break;
            // If there's more data, don't break yet, loop one more time
          } catch (e) {
            break;
          }
        }
      }
      
      await new Promise(r => setTimeout(r, 500));
      tries++;
    }
  }

  private async logToDb(jobId: string, stream: string, message: string) {
    if (!message) return;
    const lines = message.split('\n').slice(0, 100);
    for (const line of lines) {
      if (!line.trim()) continue;
      await pool.query(
        `INSERT INTO branch_sandbox_logs (id, job_id, timestamp, stream, message) VALUES ($1, $2, NOW(), $3, $4)`,
        [randomUUID(), jobId, stream, line.slice(0, 1000)]
      ).catch(() => {});
    }
  }
}

export const sandboxRunner = new SandboxJobRunner();
