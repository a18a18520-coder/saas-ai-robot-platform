import { MigrationInterface, QueryRunner } from 'typeorm';
export class WikiIngestion1790000000001 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS pipeline_config jsonb NOT NULL DEFAULT '{}'`);
    await q.query(`ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS source_id varchar, ADD COLUMN IF NOT EXISTS source_version varchar, ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true`);
    await q.query(`UPDATE knowledge_files SET source_id = dify_document_id WHERE source_id IS NULL`);
    await q.query(`CREATE TABLE IF NOT EXISTS wiki_pages (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id varchar NOT NULL, parent_id varchar, title varchar NOT NULL, content text NOT NULL DEFAULT '', kind varchar NOT NULL DEFAULT 'page', status varchar NOT NULL DEFAULT 'draft', dataset_id varchar NOT NULL DEFAULT '', sec_level integer NOT NULL DEFAULT 1, revision integer NOT NULL DEFAULT 0, published_revision integer, updated_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE TABLE IF NOT EXISTS wiki_versions (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id varchar NOT NULL, page_id varchar NOT NULL, revision integer NOT NULL, title varchar NOT NULL, content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(page_id, revision))`);
    await q.query(`CREATE TABLE IF NOT EXISTS ingestion_jobs (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id varchar NOT NULL, dataset_id varchar NOT NULL, source_id varchar NOT NULL, source_version varchar NOT NULL, name varchar NOT NULL, file_path varchar NOT NULL, sec_level integer NOT NULL DEFAULT 1, status varchar NOT NULL DEFAULT 'queued', error text NOT NULL DEFAULT '', document_id varchar, pipeline_config jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id, dataset_id, source_id, source_version))`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_wiki_tenant_parent ON wiki_pages(tenant_id, parent_id)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_ingestion_status ON ingestion_jobs(status, created_at)`);
  }
  async down(q: QueryRunner) {
    await q.query(`DROP TABLE IF EXISTS ingestion_jobs, wiki_versions, wiki_pages`);
    await q.query(`ALTER TABLE knowledge_files DROP COLUMN IF EXISTS source_id, DROP COLUMN IF EXISTS source_version, DROP COLUMN IF EXISTS is_active`);
    await q.query(`ALTER TABLE knowledge_bases DROP COLUMN IF EXISTS pipeline_config`);
  }
}
