import { existsSync, readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const artifacts = resolve(root, 'artifacts/conformance');

function run(command, args) {
  console.log(`[conformance] command=${command} ${args.join(' ')}`);
  const executable = process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command;
  const result = spawnSync(executable, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32' && command === 'pnpm',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`conformance command failed: ${command} ${args.join(' ')}`);
  }
}

function runFast() {
  run('uv', ['run', '--with', 'pytest', 'pytest', 'tests/conformance/test_manifest.py', '-q']);
  run('uv', [
    'run', '--package', 'agentlens-sdk-langgraph', 'pytest',
    'packages/sdk-langgraph/tests/test_capability_matrix.py',
    'packages/sdk-langgraph/tests/test_generate_fixtures.py',
    'packages/sdk-langgraph/tests/test_governance_conformance_fixtures.py',
    'packages/sdk-langgraph/tests/test_governance_integration_harness.py',
    'packages/sdk-langgraph/tests/test_harness_manifest.py', '-q',
  ]);
  run('uv', [
    'run', '--package', 'agentlens-sdk-maf', 'pytest',
    'packages/sdk-maf/tests/test_capability_matrix.py',
    'packages/sdk-maf/tests/test_generate_fixtures.py',
    'packages/sdk-maf/tests/test_governance_bridge.py',
    'packages/sdk-maf/tests/test_public_output_safety.py',
    'packages/sdk-maf/tests/test_harness_manifest.py', '-q',
  ]);
  run('pnpm', [
    '--filter', 'api-ts', 'exec', 'vitest', 'run',
    'tests/unit/runtimeNormalizationBoundary.test.ts',
    'tests/unit/mafArchitecture.test.ts',
    'tests/unit/crossFrameworkConformance.test.ts',
    'tests/unit/frameworkGovernance.test.ts',
    'tests/unit/governancePublicOutputScan.test.ts',
    'tests/unit/deliveryClaimDurability.test.ts',
    'tests/unit/interruptGovernancePersistence.test.ts',
    'tests/unit/nativeIdentityAmbiguity.test.ts',
  ]);
  run('pnpm', [
    '--filter', 'web', 'exec', 'vitest', 'run',
    'tests/unit/governControls.test.ts',
    'tests/unit/runtimeExplainability.test.ts',
  ]);
  console.log('[conformance] fast result=passed');
}

function runSystem(framework) {
  mkdirSync(artifacts, { recursive: true });
  const packageName = framework === 'langgraph' ? 'agentlens-sdk-langgraph' : 'agentlens-sdk-maf';
  const script = framework === 'langgraph'
    ? 'packages/sdk-langgraph/tests/run_system_harness.py'
    : 'packages/sdk-maf/tests/run_system_harness.py';
  const summary = resolve(artifacts, `${framework}.json`);
  run('uv', [
    'run', '--package', packageName, 'python', script,
    '--scenario', 'all', '--summary-path', summary,
  ]);
}

function readSummary(framework) {
  const path = resolve(artifacts, `${framework}.json`);
  if (!existsSync(path)) throw new Error(`missing ${framework} conformance summary; run pnpm conformance:system:${framework}`);
  const summary = JSON.parse(readFileSync(path, 'utf8'));
  for (const key of ['framework', 'gate', 'result', 'real_components', 'doubles', 'scenarios', 'evidence_paths', 'cleanup_result', 'rerun_command']) {
    if (!(key in summary)) throw new Error(`summary missing ${key}: ${path}`);
  }
  return summary;
}

function report() {
  const summaries = ['langgraph', 'maf'].map(readSummary);
  const result = summaries.every((summary) => summary.result === 'passed') ? 'passed' : 'failed';
  for (const summary of summaries) {
    console.log(`[conformance] framework=${summary.framework} gate=${summary.gate} result=${summary.result} cleanup=${summary.cleanup_result}`);
    for (const scenario of summary.scenarios) {
      console.log(`[conformance] scenario=${scenario.scenario} result=${scenario.result} cleanup=${scenario.cleanup}`);
    }
  }
  console.log(`[conformance] report result=${result}`);
  return result === 'passed';
}

function main(mode) {
  if (mode === 'fast') runFast();
  else if (mode === 'system:langgraph') runSystem('langgraph');
  else if (mode === 'system:maf') runSystem('maf');
  else if (mode === 'system') {
    const failures = [];
    for (const framework of ['langgraph', 'maf']) {
      try { runSystem(framework); } catch (error) {
        failures.push(error instanceof Error ? error.message : `failed ${framework}`);
      }
    }
    if (failures.length) throw new Error(failures.join('; '));
  }
  else if (mode === 'report') return report() ? 0 : 1;
  else if (mode === 'release') {
    runFast();
    const failures = [];
    for (const framework of ['langgraph', 'maf']) {
      try { runSystem(framework); } catch (error) {
        failures.push(error instanceof Error ? error.message : `failed ${framework}`);
      }
    }
    if (failures.length) throw new Error(failures.join('; '));
    return report() ? 0 : 1;
  }
  else throw new Error(`unknown conformance mode: ${mode}`);
  return 0;
}

try {
  process.exitCode = main(process.argv[2] ?? 'fast');
} catch (error) {
  console.error(`[conformance] result=failed error=${error instanceof Error ? error.message : 'unknown'}`);
  process.exitCode = 1;
}
