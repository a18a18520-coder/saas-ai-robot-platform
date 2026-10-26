import { MigrationInterface, QueryRunner } from 'typeorm';
export class FollowUpKnowledge1790000000010 implements MigrationInterface {
  async up(q: QueryRunner) { await q.query("ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS resolution jsonb NOT NULL DEFAULT '{}'::jsonb"); }
  async down(q: QueryRunner) { await q.query('ALTER TABLE follow_ups DROP COLUMN IF EXISTS resolution'); }
}
