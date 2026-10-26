import { MigrationInterface, QueryRunner } from 'typeorm';

/** 为消息发送增加可恢复的轮询间隔、轮次和逐轮结果。 */
export class BroadcastPolling1789344360000 implements MigrationInterface {
  name = 'BroadcastPolling1789344360000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "broadcast_records" ADD COLUMN IF NOT EXISTS "poll_interval_minutes" integer NOT NULL DEFAULT 5`);
    await queryRunner.query(`ALTER TABLE "broadcast_records" ADD COLUMN IF NOT EXISTS "poll_count" integer NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE "broadcast_records" ADD COLUMN IF NOT EXISTS "completed_polls" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "broadcast_records" ADD COLUMN IF NOT EXISTS "next_poll_at" timestamptz`);
    await queryRunner.query(`ALTER TABLE "broadcast_records" ADD COLUMN IF NOT EXISTS "last_sent_at" timestamptz`);
    await queryRunner.query(`ALTER TABLE "broadcast_records" ADD COLUMN IF NOT EXISTS "round_results" jsonb`);
    await queryRunner.query(`ALTER TABLE "broadcast_records" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now()`);
    await queryRunner.query(`UPDATE "broadcast_records" SET "completed_polls" = 1, "last_sent_at" = "created_at", "updated_at" = "created_at" WHERE "status" IN ('SUCCESS', 'PARTIAL', 'FAILED') AND "completed_polls" = 0`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_broadcast_due" ON "broadcast_records" ("status", "next_poll_at")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_broadcast_due"`);
    await queryRunner.query(`ALTER TABLE "broadcast_records" DROP COLUMN IF EXISTS "updated_at"`);
    await queryRunner.query(`ALTER TABLE "broadcast_records" DROP COLUMN IF EXISTS "round_results"`);
    await queryRunner.query(`ALTER TABLE "broadcast_records" DROP COLUMN IF EXISTS "last_sent_at"`);
    await queryRunner.query(`ALTER TABLE "broadcast_records" DROP COLUMN IF EXISTS "next_poll_at"`);
    await queryRunner.query(`ALTER TABLE "broadcast_records" DROP COLUMN IF EXISTS "completed_polls"`);
    await queryRunner.query(`ALTER TABLE "broadcast_records" DROP COLUMN IF EXISTS "poll_count"`);
    await queryRunner.query(`ALTER TABLE "broadcast_records" DROP COLUMN IF EXISTS "poll_interval_minutes"`);
  }
}
