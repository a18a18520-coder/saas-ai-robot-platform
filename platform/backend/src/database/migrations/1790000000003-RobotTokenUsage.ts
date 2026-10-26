import { MigrationInterface, QueryRunner } from 'typeorm';
export class RobotTokenUsage1790000000003 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE robot_model_usage (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "tenantId" varchar NOT NULL, "robotId" uuid NOT NULL, "modelId" uuid NOT NULL,
      operation varchar(40) NOT NULL, attempt integer NOT NULL, fallback boolean NOT NULL, "startedAt" timestamptz NOT NULL,
      success boolean NOT NULL, "inputTokens" bigint, "outputTokens" bigint, "totalTokens" bigint, incomplete boolean NOT NULL
    )`);
    await q.query('CREATE INDEX idx_robot_model_usage_scope ON robot_model_usage ("tenantId","robotId","startedAt")');
  }
  async down(q: QueryRunner): Promise<void> { await q.query('DROP TABLE robot_model_usage'); }
}
