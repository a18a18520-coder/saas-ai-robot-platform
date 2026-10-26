import { MigrationInterface, QueryRunner } from 'typeorm';
export class RagCore1790000000000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE tools ADD COLUMN IF NOT EXISTS read_only boolean NOT NULL DEFAULT false`);
    await q.query(`CREATE TABLE IF NOT EXISTS model_configs (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), name varchar NOT NULL, base_url varchar NOT NULL,
      model varchar NOT NULL, purpose varchar NOT NULL DEFAULT 'chat', api_key text NOT NULL DEFAULT '',
      context_window integer NOT NULL DEFAULT 8192, max_output_tokens integer NOT NULL DEFAULT 1024,
      timeout_ms integer NOT NULL DEFAULT 30000, tenant_ids jsonb NOT NULL DEFAULT '[]',
      is_active boolean NOT NULL DEFAULT true, supports_tools boolean NOT NULL DEFAULT false)`);
    await q.query(`ALTER TABLE robots ADD COLUMN IF NOT EXISTS published_config jsonb, ADD COLUMN IF NOT EXISTS config_history jsonb NOT NULL DEFAULT '[]'`);
    await q.query(`ALTER TABLE robots ADD COLUMN IF NOT EXISTS rag_config jsonb NOT NULL DEFAULT '{}'`);
    await q.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel varchar NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS ended_at timestamptz, ADD COLUMN IF NOT EXISTS summary text NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS summary_through_id varchar`);
    await q.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'`);
    await q.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS knowledge_clearance integer NOT NULL DEFAULT 1`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_conversation_scope ON conversations (tenant_id, robot_id, user_id, channel, updated_at)`);
  }
  async down(q: QueryRunner) {
    await q.query(`DROP INDEX IF EXISTS idx_conversation_scope`);
    await q.query(`ALTER TABLE users DROP COLUMN IF EXISTS knowledge_clearance`);
    await q.query(`ALTER TABLE messages DROP COLUMN IF EXISTS metadata`);
    await q.query(`ALTER TABLE conversations DROP COLUMN IF EXISTS channel, DROP COLUMN IF EXISTS ended_at, DROP COLUMN IF EXISTS summary, DROP COLUMN IF EXISTS summary_through_id`);
    await q.query(`ALTER TABLE robots DROP COLUMN IF EXISTS rag_config`);
    await q.query(`DROP TABLE IF EXISTS model_configs`);
  }
}
