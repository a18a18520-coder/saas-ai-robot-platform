import { MigrationInterface, QueryRunner } from 'typeorm';
export class WikiGraph1790000000012 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE wiki_graph_chunks (
      tenant_id text NOT NULL, page_id uuid NOT NULL, revision integer NOT NULL, chunk_index integer NOT NULL,
      status text NOT NULL DEFAULT 'queued', edges jsonb NOT NULL DEFAULT '[]', error text NOT NULL DEFAULT '',
      updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,page_id,revision,chunk_index))`);
  }
  async down(q: QueryRunner) { await q.query('DROP TABLE wiki_graph_chunks'); }
}
