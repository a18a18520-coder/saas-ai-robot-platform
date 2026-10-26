import { MigrationInterface, QueryRunner } from 'typeorm';
export class Evaluations1790000000002 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE IF NOT EXISTS evaluation_cases (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id varchar NOT NULL, robot_id varchar NOT NULL, question text NOT NULL, expected_answer text NOT NULL, expected_documents jsonb NOT NULL DEFAULT '[]', channel_user_id varchar NOT NULL, channel varchar NOT NULL DEFAULT 'web')`);
    await q.query(`CREATE TABLE IF NOT EXISTS evaluation_runs (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id varchar NOT NULL, case_id varchar NOT NULL, robot_id varchar NOT NULL, status varchar NOT NULL DEFAULT 'running', snapshot jsonb NOT NULL DEFAULT '{}', result jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now())`);
  }
  async down(q: QueryRunner) { await q.query(`DROP TABLE IF EXISTS evaluation_runs, evaluation_cases`); }
}
