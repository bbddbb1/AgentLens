import { Pool } from 'pg';

const defaultDatabaseUrl = 'postgresql://agentlens:agentlens@localhost:5432/agentlens';
const dbUrl = process.env.DATABASE_URL?.replace('postgresql+asyncpg://', 'postgresql://') ?? defaultDatabaseUrl;

export const pool = new Pool({
  connectionString: dbUrl,
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS ?? 5000),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30000),
  query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS ?? 10000),
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 10000),
});

export async function checkDatabaseHealth(): Promise<void> {
  await pool.query('SELECT 1');
}

export async function initializeDatabase(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS missions (
      id UUID PRIMARY KEY,
      objective TEXT NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'active',
      phase VARCHAR(50) NOT NULL DEFAULT 'planning',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_encrypted BOOLEAN NOT NULL DEFAULT FALSE,
      visibility VARCHAR(50) NOT NULL DEFAULT 'private',
      owner_id UUID NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      display_name VARCHAR(255) NOT NULL DEFAULT '',
      avatar_url VARCHAR(512) NULL,
      password_hash VARCHAR(255) NULL,
      public_key TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mission_agents (
      id UUID PRIMARY KEY,
      mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      agent_id VARCHAR(255) NOT NULL,
      agent_name VARCHAR(255) NULL,
      agent_role VARCHAR(100) NULL,
      agent_team VARCHAR(255) NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      UNIQUE (mission_id, agent_id)
    )
  `);

  await pool.query(`
    ALTER TABLE mission_agents
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id UUID PRIMARY KEY,
      mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      author_id UUID NULL REFERENCES users(id),
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      body TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS review_comments (
      id UUID PRIMARY KEY,
      review_id UUID NULL REFERENCES reviews(id) ON DELETE CASCADE,
      mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      author_id UUID NULL REFERENCES users(id),
      parent_id UUID NULL REFERENCES review_comments(id),
      body TEXT NOT NULL,
      target_type VARCHAR(50) NULL,
      target_id VARCHAR(255) NULL,
      target_context JSONB NOT NULL DEFAULT '{}'::jsonb,
      resolved BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS semantic_summaries (
      id UUID PRIMARY KEY,
      mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      span_id VARCHAR(64) NULL,
      level VARCHAR(50) NOT NULL,
      summary TEXT NOT NULL,
      conflicts JSONB NOT NULL DEFAULT '[]'::jsonb,
      anomalies JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mission_shares (
      id UUID PRIMARY KEY,
      mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      encrypted_key BYTEA NOT NULL,
      permission VARCHAR(50) NOT NULL DEFAULT 'viewer',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ingest_batches (
      id UUID PRIMARY KEY,
      mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      batch_id VARCHAR(255) NOT NULL,
      span_count INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (mission_id, batch_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS interrupts (
      id UUID PRIMARY KEY,
      mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      interrupt_id VARCHAR(255) NOT NULL,
      agent_id VARCHAR(255) NULL,
      span_id VARCHAR(64) NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      reason TEXT NOT NULL,
      resume_url TEXT NULL,
      resume_token_hash VARCHAR(128) NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      decision VARCHAR(50) NULL,
      decision_comment TEXT NULL,
      decision_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      idempotency_key VARCHAR(255) NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NULL,
      decided_at TIMESTAMPTZ NULL,
      resumed_at TIMESTAMPTZ NULL,
      UNIQUE (mission_id, interrupt_id),
      UNIQUE (mission_id, idempotency_key)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_interrupts_pending
    ON interrupts (mission_id, status, created_at)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mission_replay_branches (
      id VARCHAR(255) NOT NULL,
      mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      parent_branch_id VARCHAR(255) NULL,
      forked_from_sequence_num INTEGER NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'active',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (mission_id, id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mission_events (
      id UUID PRIMARY KEY,
      mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      branch_id VARCHAR(255) NOT NULL,
      sequence_num INTEGER NOT NULL,
      branch_sequence_num INTEGER NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL,
      event_type VARCHAR(100) NOT NULL,
      agent_id VARCHAR(255) NULL,
      span_id VARCHAR(64) NULL,
      trace_id VARCHAR(64) NULL,
      parent_span_id VARCHAR(64) NULL,
      idempotency_key VARCHAR(255) NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      UNIQUE (mission_id, sequence_num),
      UNIQUE (mission_id, branch_id, branch_sequence_num),
      UNIQUE (mission_id, branch_id, idempotency_key)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mission_events_branch_sequence
    ON mission_events (mission_id, branch_id, sequence_num)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mission_artifacts (
      id UUID PRIMARY KEY,
      mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      artifact_type VARCHAR(100) NOT NULL DEFAULT 'document',
      object_key TEXT NOT NULL,
      content_type VARCHAR(255) NULL,
      size_bytes BIGINT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS graph_snapshots (
      id UUID PRIMARY KEY,
      mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      sequence_num INTEGER NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL,
      nodes JSONB NOT NULL,
      edges JSONB NOT NULL,
      event_type VARCHAR(100) NULL,
      event_description TEXT NULL,
      phase VARCHAR(50) NULL,
      UNIQUE (mission_id, sequence_num)
    )
  `);
}
