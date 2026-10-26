import { MigrationInterface, QueryRunner } from 'typeorm';
export class FollowUpDelivery1790000000015 implements MigrationInterface {
  async up(q: QueryRunner) { await q.query("ALTER TABLE follow_ups ADD COLUMN delivery jsonb NOT NULL DEFAULT '{}'::jsonb"); }
  async down(q: QueryRunner) { await q.query('ALTER TABLE follow_ups DROP COLUMN delivery'); }
}
