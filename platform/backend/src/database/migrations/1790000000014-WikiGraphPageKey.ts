import { MigrationInterface, QueryRunner } from 'typeorm';
export class WikiGraphPageKey1790000000014 implements MigrationInterface {
  async up(q: QueryRunner) { await q.query('ALTER TABLE wiki_graph_chunks ALTER COLUMN page_id TYPE text USING page_id::text'); }
  async down(q: QueryRunner) { await q.query('ALTER TABLE wiki_graph_chunks ALTER COLUMN page_id TYPE uuid USING page_id::uuid'); }
}
