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
      branch_id VARCHAR(255) NOT NULL DEFAULT 'main',
      span_id VARCHAR(64) NULL,
      level VARCHAR(50) NOT NULL,
      summary TEXT NOT NULL,
      conflicts JSONB NOT NULL DEFAULT '[]'::jsonb,
      anomalies JSONB NOT NULL DEFAULT '[]'::jsonb,
      authority_version VARCHAR(64) NULL,
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
    CREATE TABLE IF NOT EXISTS branch_executor_specs (
      id UUID PRIMARY KEY,
      mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      docker_image VARCHAR(255) NOT NULL,
      python_entrypoint VARCHAR(255) NOT NULL,
      timeout_seconds INTEGER NOT NULL DEFAULT 300,
      resource_limits JSONB NOT NULL DEFAULT '{}'::jsonb,
      env_allowlist JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
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
    CREATE TABLE IF NOT EXISTS branch_sandbox_jobs (
      id UUID PRIMARY KEY,
      branch_id VARCHAR(255) NOT NULL,
      mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      executor_id UUID NOT NULL REFERENCES branch_executor_specs(id) ON DELETE CASCADE,
      status VARCHAR(50) NOT NULL DEFAULT 'queued',
      container_id VARCHAR(255) NULL,
      exit_code INTEGER NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ NULL,
      completed_at TIMESTAMPTZ NULL,
      FOREIGN KEY (mission_id, branch_id) REFERENCES mission_replay_branches (mission_id, id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS branch_sandbox_logs (
      id UUID PRIMARY KEY,
      job_id UUID NOT NULL REFERENCES branch_sandbox_jobs(id) ON DELETE CASCADE,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      stream VARCHAR(50) NOT NULL,
      message TEXT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS interrupts (
      id UUID PRIMARY KEY,
      mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      branch_id VARCHAR(255) NOT NULL DEFAULT 'main',
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
      requested_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
      requested_admission_seq INTEGER NULL,
      decided_admission_seq INTEGER NULL,
      resumed_admission_seq INTEGER NULL,
      UNIQUE (mission_id, branch_id, interrupt_id),
      UNIQUE (mission_id, branch_id, idempotency_key)
    )
  `);

  await pool.query(`
    ALTER TABLE interrupts DROP CONSTRAINT IF EXISTS interrupts_mission_id_interrupt_id_key;
  `);
  
  await pool.query(`
    ALTER TABLE interrupts DROP CONSTRAINT IF EXISTS interrupts_mission_id_idempotency_key_key;
  `);

  await pool.query(`
    ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS branch_id VARCHAR(255) NOT NULL DEFAULT 'main';
  `);

  await pool.query(`
    ALTER TABLE interrupts ADD CONSTRAINT interrupts_branch_id_unique UNIQUE (mission_id, branch_id, interrupt_id);
  `).catch(() => {});

  await pool.query(`
    ALTER TABLE interrupts ADD CONSTRAINT interrupts_branch_id_idempotency_unique UNIQUE (mission_id, branch_id, idempotency_key);
  `).catch(() => {});

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_interrupts_pending
    ON interrupts (mission_id, status, created_at)
  `);

  // Additive LangGraph governance aggregate fields (legacy rows default non-actionable).
  for (const statement of [
    `ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS request_lifecycle VARCHAR(50) NOT NULL DEFAULT 'pending'`,
    `ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS actionability VARCHAR(50) NOT NULL DEFAULT 'observed_only'`,
    `ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS authorized_binding_id UUID NULL`,
    `ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS request_type VARCHAR(100)`,
    `ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS supported_decision_types JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS safe_prompt TEXT`,
    `ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS safe_input_schema JSONB`,
    `ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS decision_state VARCHAR(50) NOT NULL DEFAULT 'none'`,
    `ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS decision_id UUID`,
    `ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS decision_actor VARCHAR(255)`,
    `ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS decision_type VARCHAR(50)`,
    `ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS decision_value_summary JSONB NOT NULL DEFAULT '{}'::jsonb`,
    `ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS decision_audit JSONB NOT NULL DEFAULT '{}'::jsonb`,
    `ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS delivery_state VARCHAR(50) NOT NULL DEFAULT 'not_requested'`,
    `ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS delivery_id UUID`,
    `ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS runtime_outcome VARCHAR(50) NOT NULL DEFAULT 'unknown'`,
    `ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS framework VARCHAR(50)`,
    `ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS native_identity JSONB`,
    `ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS source_refs JSONB`,
    `ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS identity_ambiguous BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS requested_admission_seq INTEGER`,
    `ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS decided_admission_seq INTEGER`,
    `ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS resumed_admission_seq INTEGER`,
  ]) {
    await pool.query(statement).catch(() => {});
  }
  await pool.query(`ALTER TABLE interrupts ADD COLUMN IF NOT EXISTS requested_evidence JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`
    UPDATE interrupts
    SET requested_evidence = jsonb_build_object(
      'agent_id', agent_id,
      'interrupt_id', interrupt_id,
      'reason', reason,
      'resume_url', resume_url,
      'payload', payload
    )
    WHERE requested_evidence = '{}'::jsonb
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS langgraph_bridge_bindings (
      id UUID PRIMARY KEY,
      mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      branch_id VARCHAR(255) NOT NULL DEFAULT 'main',
      framework VARCHAR(50) NOT NULL DEFAULT 'langgraph',
      interrupt_id VARCHAR(255) NULL,
      interaction_request_id VARCHAR(255) NULL,
      control_ref_hash VARCHAR(128) NOT NULL,
      generation BIGINT NOT NULL DEFAULT 1,
      supersedes_binding_id UUID NULL,
      lifecycle_state VARCHAR(50) NOT NULL DEFAULT 'active',
      registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      lease_expires_at TIMESTAMPTZ NOT NULL,
      last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ NULL,
      consumed_at TIMESTAMPTZ NULL,
      native_identity JSONB NOT NULL DEFAULT '{}'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_langgraph_bridge_bindings_scope
    ON langgraph_bridge_bindings (mission_id, branch_id, lifecycle_state, lease_expires_at)
  `);

  // Framework-scoped successor. Keep the legacy table readable during the
  // additive migration, then copy all rows exactly once by binding id.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS framework_bridge_bindings (
      LIKE langgraph_bridge_bindings INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING STORAGE
    )
  `);
  // PostgreSQL's LIKE does not retain the source primary key. Add it before
  // the idempotent copy so existing LangGraph rows can migrate safely.
  await pool.query(`
    ALTER TABLE framework_bridge_bindings
    ADD CONSTRAINT framework_bridge_bindings_pkey PRIMARY KEY (id)
  `).catch(() => {});
  await pool.query(`
    INSERT INTO framework_bridge_bindings
    SELECT * FROM langgraph_bridge_bindings
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_framework_bridge_bindings_scope
    ON framework_bridge_bindings (framework, mission_id, branch_id, lifecycle_state, lease_expires_at)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS interrupt_delivery_attempts (
      id UUID PRIMARY KEY,
      mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      branch_id VARCHAR(255) NOT NULL DEFAULT 'main',
      interrupt_id VARCHAR(255) NOT NULL,
      decision_id UUID NOT NULL,
      external_state VARCHAR(50) NOT NULL DEFAULT 'pending',
      safe_error_class VARCHAR(100) NULL,
      receipt_correlation VARCHAR(255) NULL,
      claimed_at TIMESTAMPTZ NULL,
      claiming_binding_id UUID NULL,
      claim_deadline TIMESTAMPTZ NULL,
      receipt_state VARCHAR(50) NULL,
      accepted_at TIMESTAMPTZ NULL,
      failed_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (decision_id),
      UNIQUE (mission_id, branch_id, interrupt_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_interrupt_delivery_attempts_scope
    ON interrupt_delivery_attempts (mission_id, branch_id, interrupt_id, external_state)
  `);

  await pool.query(`
    ALTER TABLE semantic_summaries ADD COLUMN IF NOT EXISTS branch_id VARCHAR(255) NOT NULL DEFAULT 'main';
  `).catch(() => {});

  await pool.query(`
    ALTER TABLE semantic_summaries ADD COLUMN IF NOT EXISTS authority_version VARCHAR(64) NULL;
  `).catch(() => {});

  await pool.query(`
    DROP TABLE IF EXISTS mission_events, graph_snapshots, mission_state_checkpoints CASCADE;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS spans (
      id UUID PRIMARY KEY,
      mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      branch_id VARCHAR(255) NOT NULL,
      trace_id VARCHAR(64) NOT NULL,
      span_id VARCHAR(64) NOT NULL,
      parent_span_id VARCHAR(64) NULL,
      name VARCHAR(255) NOT NULL,
      start_time_unix_nano NUMERIC NOT NULL,
      end_time_unix_nano NUMERIC NULL,
      status_code VARCHAR(50) NOT NULL,
      attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
      events JSONB NOT NULL DEFAULT '[]'::jsonb,
      admission_seq INTEGER NOT NULL,
      revision_num INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT spans_mission_admission_key UNIQUE (mission_id, admission_seq),
      CONSTRAINT spans_mission_branch_span_revision_key UNIQUE (mission_id, branch_id, span_id, revision_num),
      CONSTRAINT spans_positive_admission_check CHECK (admission_seq > 0),
      CONSTRAINT spans_positive_revision_check CHECK (revision_num > 0)
    )
  `);

  // R0-A additive migration: existing mutable span rows become revision 1 and
  // receive deterministic mission-local admission cursors. Future writes append.
  await pool.query(`ALTER TABLE spans ADD COLUMN IF NOT EXISTS admission_seq INTEGER`);
  await pool.query(`ALTER TABLE spans ADD COLUMN IF NOT EXISTS revision_num INTEGER`);
  await pool.query(`
    WITH existing_max AS (
      SELECT mission_id, COALESCE(MAX(admission_seq), 0) AS max_admission
      FROM spans
      WHERE admission_seq IS NOT NULL
      GROUP BY mission_id
    ), pending AS (
      SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY mission_id ORDER BY created_at ASC, id ASC) AS offset,
        COALESCE(existing_max.max_admission, 0) AS max_admission
      FROM spans
      LEFT JOIN existing_max USING (mission_id)
      WHERE admission_seq IS NULL
    )
    UPDATE spans
    SET admission_seq = pending.max_admission + pending.offset,
        revision_num = COALESCE(spans.revision_num, 1)
    FROM pending
    WHERE spans.id = pending.id
  `);
  await pool.query(`UPDATE spans SET revision_num = 1 WHERE revision_num IS NULL`);
  await pool.query(`ALTER TABLE spans ALTER COLUMN admission_seq SET NOT NULL`);
  await pool.query(`ALTER TABLE spans ALTER COLUMN revision_num SET NOT NULL`);
  await pool.query(`ALTER TABLE spans DROP CONSTRAINT IF EXISTS spans_mission_id_branch_id_span_id_key`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spans_mission_admission_key') THEN
        ALTER TABLE spans ADD CONSTRAINT spans_mission_admission_key UNIQUE (mission_id, admission_seq);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spans_mission_branch_span_revision_key') THEN
        ALTER TABLE spans ADD CONSTRAINT spans_mission_branch_span_revision_key
          UNIQUE (mission_id, branch_id, span_id, revision_num);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spans_positive_admission_check') THEN
        ALTER TABLE spans ADD CONSTRAINT spans_positive_admission_check CHECK (admission_seq > 0);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spans_positive_revision_check') THEN
        ALTER TABLE spans ADD CONSTRAINT spans_positive_revision_check CHECK (revision_num > 0);
      END IF;
    END $$
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_spans_mission_branch ON spans (mission_id, branch_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_spans_mission_branch_admission
    ON spans (mission_id, branch_id, admission_seq);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON spans (trace_id);
  `);

  // Backfill legacy interrupt lifecycle admissions after span admissions so
  // existing evidence receives one stable mission-local cursor per action.
  await pool.query(`
    WITH admission_max AS (
      SELECT missions.id AS mission_id,
             GREATEST(
               COALESCE((SELECT MAX(admission_seq) FROM spans WHERE spans.mission_id = missions.id), 0),
               COALESCE((SELECT MAX(requested_admission_seq) FROM interrupts WHERE interrupts.mission_id = missions.id), 0),
               COALESCE((SELECT MAX(decided_admission_seq) FROM interrupts WHERE interrupts.mission_id = missions.id), 0),
               COALESCE((SELECT MAX(resumed_admission_seq) FROM interrupts WHERE interrupts.mission_id = missions.id), 0)
             ) AS max_admission
      FROM missions
    ), actions AS (
      SELECT id, mission_id, 'requested'::text AS kind, created_at AS action_at
      FROM interrupts WHERE requested_admission_seq IS NULL
      UNION ALL
      SELECT id, mission_id, 'decided'::text, decided_at
      FROM interrupts WHERE decided_at IS NOT NULL AND decided_admission_seq IS NULL
      UNION ALL
      SELECT id, mission_id, 'resumed'::text, resumed_at
      FROM interrupts WHERE resumed_at IS NOT NULL AND resumed_admission_seq IS NULL
    ), ranked AS (
      SELECT actions.*,
             COALESCE(admission_max.max_admission, 0)
               + ROW_NUMBER() OVER (
                   PARTITION BY actions.mission_id
                   ORDER BY actions.action_at ASC, actions.id ASC,
                     CASE actions.kind WHEN 'requested' THEN 0 WHEN 'decided' THEN 1 ELSE 2 END
                 ) AS admission_seq
      FROM actions
      LEFT JOIN admission_max USING (mission_id)
    ), assigned AS (
      SELECT id,
             MAX(admission_seq) FILTER (WHERE kind = 'requested') AS requested_seq,
             MAX(admission_seq) FILTER (WHERE kind = 'decided') AS decided_seq,
             MAX(admission_seq) FILTER (WHERE kind = 'resumed') AS resumed_seq
      FROM ranked
      GROUP BY id
    )
    UPDATE interrupts
    SET requested_admission_seq = COALESCE(interrupts.requested_admission_seq, assigned.requested_seq),
        decided_admission_seq = COALESCE(interrupts.decided_admission_seq, assigned.decided_seq),
        resumed_admission_seq = COALESCE(interrupts.resumed_admission_seq, assigned.resumed_seq)
    FROM assigned
    WHERE interrupts.id = assigned.id
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS evidence_admission_counters (
      mission_id UUID PRIMARY KEY REFERENCES missions(id) ON DELETE CASCADE,
      next_seq INTEGER NOT NULL,
      CONSTRAINT evidence_admission_counter_nonnegative CHECK (next_seq >= 0)
    )
  `);
  await pool.query(`
    INSERT INTO evidence_admission_counters (mission_id, next_seq)
    SELECT missions.id,
           GREATEST(
             COALESCE((SELECT MAX(admission_seq) FROM spans WHERE spans.mission_id = missions.id), 0),
             COALESCE((SELECT MAX(requested_admission_seq) FROM interrupts WHERE interrupts.mission_id = missions.id), 0),
             COALESCE((SELECT MAX(decided_admission_seq) FROM interrupts WHERE interrupts.mission_id = missions.id), 0),
             COALESCE((SELECT MAX(resumed_admission_seq) FROM interrupts WHERE interrupts.mission_id = missions.id), 0)
           )
    FROM missions
    ON CONFLICT (mission_id) DO UPDATE
    SET next_seq = GREATEST(evidence_admission_counters.next_seq, EXCLUDED.next_seq)
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
}
