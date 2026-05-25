#!/usr/bin/env node

const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: true,
    ...options,
  });
}

function main() {
  // Step 1: Ensure Docker services (PostgreSQL, Redis) are running
  console.log('[run-dev] Starting Docker services...');
  const dockerResult = run('node', ['scripts/ensure-docker.js']);
  if (dockerResult.status !== 0) {
    console.error('[run-dev] Docker check failed. Is Docker running?');
    console.error('[run-dev] Continuing anyway — use pnpm dev:skip-docker to skip this check.');
  }

  // Step 2: Run turbo dev (starts api-ts + web + protocol build in parallel)
  console.log('[run-dev] Starting dev servers via Turbo...');
  const turbo = spawn('pnpm', ['exec', 'turbo', 'dev'], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: true,
  });

  turbo.on('close', (code) => {
    process.exit(code ?? 0);
  });

  process.on('SIGINT', () => {
    turbo.kill('SIGINT');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    turbo.kill('SIGTERM');
    process.exit(0);
  });
}

main();
