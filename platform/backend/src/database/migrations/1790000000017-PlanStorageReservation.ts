import { MigrationInterface, QueryRunner } from 'typeorm';
import { stat } from 'fs/promises';
export class PlanStorageReservation1790000000017 implements MigrationInterface {
  async up(q: QueryRunner) {
    // Existing installations may already have the first enforcement migration.
    await q.query('DROP TRIGGER IF EXISTS plan_storage_limit ON ingestion_jobs');
    for (const job of await q.query('SELECT id,file_path FROM ingestion_jobs WHERE size=0')) {
      const bytes = await stat(job.file_path).then(file => file.size).catch(() => 0);
      if (bytes) await q.query('UPDATE ingestion_jobs SET size=$1 WHERE id=$2', [bytes, job.id]);
    }
    await q.query(`CREATE OR REPLACE FUNCTION enforce_plan_storage() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE t tenants%ROWTYPE; lim bigint; used bigint;
      BEGIN
        SELECT * INTO t FROM tenants WHERE id::text=NEW.tenant_id FOR UPDATE;
        SELECT storage_limit_mb::bigint*1048576 INTO lim FROM plans WHERE id::text=t.plan_id;
        IF TG_TABLE_NAME='knowledge_files' AND EXISTS (SELECT 1 FROM ingestion_jobs j WHERE j.tenant_id=NEW.tenant_id AND j.dataset_id=NEW.dataset_id AND j.source_id=NEW.source_id AND j.source_version=NEW.source_version AND j.size>=NEW.size) THEN RETURN NEW; END IF;
        IF t.id IS NULL OR lim IS NULL OR t.status <> 'ACTIVE' OR t.subscription_end IS NULL OR t.subscription_end <= (now() AT TIME ZONE 'Asia/Shanghai')::date THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='套餐限制：套餐已到期或租户已停用，不能新增上传'; END IF;
        SELECT COALESCE(sum(size),0) INTO used FROM ingestion_jobs WHERE tenant_id=NEW.tenant_id AND (TG_TABLE_NAME<>'ingestion_jobs' OR id<>NEW.id);
        SELECT used+COALESCE(sum(f.size),0) INTO used FROM knowledge_files f WHERE f.tenant_id=NEW.tenant_id AND (TG_TABLE_NAME<>'knowledge_files' OR f.id<>NEW.id) AND NOT EXISTS (SELECT 1 FROM ingestion_jobs j WHERE j.tenant_id=f.tenant_id AND j.dataset_id=f.dataset_id AND j.source_id=f.source_id AND j.source_version=f.source_version);
        IF lim > 0 AND used+NEW.size > lim THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='套餐限制：知识文件总容量不足，请清理保留文件或升级套餐'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER plan_storage_limit BEFORE INSERT OR UPDATE OF size ON ingestion_jobs FOR EACH ROW EXECUTE FUNCTION enforce_plan_storage();
      DROP TRIGGER IF EXISTS plan_storage_limit ON knowledge_files;
      CREATE TRIGGER plan_storage_limit BEFORE INSERT OR UPDATE OF size ON knowledge_files FOR EACH ROW EXECUTE FUNCTION enforce_plan_storage();`);
  }
  async down(q: QueryRunner) { await q.query('DROP TRIGGER IF EXISTS plan_storage_limit ON knowledge_files'); }
}
