import { spawnSync } from 'node:child_process';

const testDatabaseUrl = process.env.AGENTLENS_TEST_DATABASE_URL;
const databaseUrl = process.env.DATABASE_URL;
if (!testDatabaseUrl || !databaseUrl) {
  process.stderr.write(
    'R0 adversarial proof requires both DATABASE_URL and AGENTLENS_TEST_DATABASE_URL; PostgreSQL tests may not skip.\n',
  );
  process.exit(2);
}

const env = {
  ...process.env,
  TMPDIR: process.env.TMPDIR ?? '/tmp',
  TMP: process.env.TMP ?? '/tmp',
  TEMP: process.env.TEMP ?? '/tmp',
};

const gates = [
  ['--filter', 'api-ts', 'test', '--', '--run',
    'tests/integration/evidenceFramePersistence.test.ts',
    'tests/unit/canonicalRuntimeMeaning.test.ts',
    'tests/unit/runtimeContractFreeze.test.ts',
    'tests/unit/runtimeArchitectureFreeze.test.ts',
    'tests/unit/explanationProjection.test.ts',
    'tests/unit/causalNarrativeTruthfulness.test.ts',
    'tests/unit/governanceStateAuthority.test.ts',
    'tests/unit/governanceRemediation.test.ts'],
  ['conformance:fast'],
];

for (const args of gates) {
  const result = spawnSync('pnpm', args, { cwd: process.cwd(), env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
