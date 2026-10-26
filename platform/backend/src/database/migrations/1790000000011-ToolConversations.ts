import { MigrationInterface, QueryRunner } from 'typeorm';
export class ToolConversations1790000000011 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query("ALTER TABLE tools ADD COLUMN IF NOT EXISTS execution_config jsonb NOT NULL DEFAULT '{}'::jsonb");
    await q.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS tool_state jsonb');
  }
  async down(q: QueryRunner) {
    await q.query('ALTER TABLE conversations DROP COLUMN IF EXISTS tool_state');
    await q.query('ALTER TABLE tools DROP COLUMN IF EXISTS execution_config');
  }
}
