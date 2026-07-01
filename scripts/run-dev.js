#!/usr/bin/env node

const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const DEV_PORTS = [3000, 8001];
const FORCE_CLEAN_FLAG = '--force-clean';
const PORT_CLEAR_TIMEOUT_MS = 10000;
const PORT_CLEAR_POLL_MS = 250;

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
    ...options,
  });
}

function readPortListeners() {
  if (process.platform !== 'win32') {
    console.error('[run-dev] Explicit dev port checks are only implemented for Windows in this workspace.');
    process.exit(1);
  }

  const script = `
$ports = @(3000, 8001)
$listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in $ports } |
  Sort-Object LocalPort, OwningProcess

$results = foreach ($listener in $listeners) {
  $proc = $null
  if ($listener.OwningProcess) {
    $proc = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $listener.OwningProcess) -ErrorAction SilentlyContinue
  }

  [PSCustomObject]@{
    port = $listener.LocalPort
    pid = $listener.OwningProcess
    processName = if ($proc) { $proc.Name } else { $null }
    commandLine = if ($proc) { $proc.CommandLine } else { $null }
  }
}

$results | ConvertTo-Json -Compress
`;

  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: false,
  });

  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    if (stderr) {
      console.error(stderr);
    }
    console.error('[run-dev] Failed to inspect dev ports.');
    process.exit(result.status ?? 1);
  }

  const stdout = (result.stdout || '').trim();
  if (!stdout) {
    return [];
  }

  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function readWorkspaceDevProcesses() {
  if (process.platform !== 'win32') {
    return [];
  }

  const escapedRoot = projectRoot.replace(/\\/g, '\\\\');
  const script = `
$currentPid = ${process.pid}
$parentPid = ${process.ppid}
$root = '${escapedRoot}'
$pattern = '(turbo\\s+dev|next\\s+dev|tsx\\s+watch|scripts[\\\\/]run-dev\\.js)'

$results = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -and
    $_.ProcessId -ne $currentPid -and
    $_.ProcessId -ne $parentPid -and
    $_.CommandLine -like "*$root*" -and
    $_.CommandLine -match $pattern
  } |
  Select-Object @{Name='pid';Expression={$_.ProcessId}}, @{Name='parentPid';Expression={$_.ParentProcessId}}, @{Name='name';Expression={$_.Name}}, @{Name='commandLine';Expression={$_.CommandLine}}

$results | ConvertTo-Json -Compress
`;

  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: false,
  });

  if (result.status !== 0) {
    return [];
  }

  const stdout = (result.stdout || '').trim();
  if (!stdout) {
    return [];
  }

  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function killPortListeners(listeners) {
  if (listeners.length === 0) {
    console.log('[run-dev] No existing listeners found on ports 3000 or 8001.');
    return;
  }

  const unique = new Map();
  for (const listener of listeners) {
    const key = `${listener.port}:${listener.pid ?? 'unknown'}`;
    if (!unique.has(key)) {
      unique.set(key, listener);
    }
  }

  for (const listener of unique.values()) {
    const details = [
      `port ${listener.port}`,
      listener.pid ? `PID ${listener.pid}` : 'PID unknown',
      listener.processName ? `process ${listener.processName}` : null,
    ].filter(Boolean).join(', ');
    console.log(`[run-dev] Force cleaning ${details}`);

    if (!listener.pid) {
      continue;
    }

    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Stop-Process -Id ${listener.pid} -Force -ErrorAction Stop`,
    ], {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: false,
    });

    if (result.status !== 0) {
      console.error(`[run-dev] Failed to stop PID ${listener.pid} on port ${listener.port}.`);
      process.exit(result.status ?? 1);
    }
  }
}

function killWorkspaceDevProcesses(processes) {
  if (processes.length === 0) {
    return;
  }

  const seen = new Set();
  for (const proc of processes) {
    if (!proc.pid || seen.has(proc.pid)) {
      continue;
    }
    seen.add(proc.pid);
    console.log(`[run-dev] Stopping stale workspace dev process PID ${proc.pid}, process ${proc.name ?? 'unknown'}`);
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Stop-Process -Id ${proc.pid} -Force -ErrorAction SilentlyContinue`,
    ], {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: false,
    });

    if (result.status !== 0) {
      console.error(`[run-dev] Failed to stop stale process PID ${proc.pid}.`);
      process.exit(result.status ?? 1);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPortsToClear(timeoutMs = PORT_CLEAR_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const remaining = readPortListeners();
    if (remaining.length === 0) {
      return;
    }
    await sleep(PORT_CLEAR_POLL_MS);
  }

  const remaining = readPortListeners();
  if (remaining.length === 0) {
    return;
  }

  console.error('[run-dev] Timed out waiting for dev ports to clear after force clean.');
  for (const listener of remaining) {
    console.error(`[run-dev] Still occupied: port ${listener.port}, PID ${listener.pid ?? 'unknown'}, process ${listener.processName ?? 'unknown'}`);
  }
  process.exit(1);
}

function failForOccupiedPorts(listeners) {
  if (listeners.length === 0) {
    return;
  }

  console.error('[run-dev] Dev ports are already in use. Refusing to start a new session.');
  for (const listener of listeners) {
    console.error(`[run-dev] Occupied port: ${listener.port}`);
    console.error(`[run-dev] PID: ${listener.pid ?? 'unknown'}`);
    if (listener.processName) {
      console.error(`[run-dev] Process: ${listener.processName}`);
    }
    if (listener.commandLine) {
      console.error(`[run-dev] Command: ${listener.commandLine}`);
    }
  }
  console.error('[run-dev] Recovery: pnpm dev -- --force-clean');
  process.exit(1);
}

function startTurbo() {
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

async function main() {
  const forceClean = process.argv.includes(FORCE_CLEAN_FLAG);
  const listeners = readPortListeners();
  const workspaceDevProcesses = readWorkspaceDevProcesses();

  if (forceClean) {
    killWorkspaceDevProcesses(workspaceDevProcesses);
    killPortListeners(listeners);
    await waitForPortsToClear();
  } else {
    failForOccupiedPorts(listeners);
  }

  console.log('[run-dev] Starting Docker services...');
  const dockerResult = run('node', ['scripts/ensure-docker.js']);
  if (dockerResult.status !== 0) {
    console.error('[run-dev] Docker check failed. Is Docker running?');
    console.error('[run-dev] Continuing anyway - use pnpm dev:skip-docker to skip this check.');
  }

  startTurbo();
}

main();
