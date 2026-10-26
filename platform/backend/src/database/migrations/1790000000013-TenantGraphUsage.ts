import { MigrationInterface, QueryRunner } from 'typeorm';
export class TenantGraphUsage1790000000013 implements MigrationInterface {
  async up(q: QueryRunner) { await q.query('ALTER TABLE robot_model_usage ALTER COLUMN "robotId" DROP NOT NULL'); }
  async down(q: QueryRunner) { await q.query('ALTER TABLE robot_model_usage ALTER COLUMN "robotId" SET NOT NULL'); }
}
