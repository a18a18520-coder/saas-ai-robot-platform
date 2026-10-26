import { MigrationInterface, QueryRunner } from 'typeorm';
export class AutoWiki1790000000005 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE wiki_generation_jobs (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id varchar NOT NULL, dataset_id varchar NOT NULL, document_id varchar NOT NULL, name varchar NOT NULL, status varchar NOT NULL DEFAULT 'queued', page_id varchar, error text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,dataset_id,document_id))`);
  }
  async down(q: QueryRunner) { await q.query('DROP TABLE wiki_generation_jobs'); }
}
