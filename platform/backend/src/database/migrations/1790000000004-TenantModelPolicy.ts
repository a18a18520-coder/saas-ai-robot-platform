import { MigrationInterface, QueryRunner } from 'typeorm';
export class TenantModelPolicy1790000000004 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE tenant_model_policies (tenant_id uuid PRIMARY KEY REFERENCES tenants(id), config jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`INSERT INTO tenant_model_policies (tenant_id, config)
      SELECT DISTINCT ON (tenant_id) tenant_id::uuid, jsonb_build_object('primaryModelId',rag_config->>'primaryModelId','fallbackModelId',COALESCE(rag_config->>'fallbackModelId',''),'rerankModelId',COALESCE(rag_config->>'rerankModelId',''))
      FROM robots WHERE status <> 'DELETED' AND COALESCE(rag_config->>'primaryModelId','') <> '' ORDER BY tenant_id, created_at, id`);
  }
  async down(q: QueryRunner): Promise<void> { await q.query('DROP TABLE tenant_model_policies'); }
}
