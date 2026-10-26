import { MigrationInterface, QueryRunner } from 'typeorm';
import { stat } from 'fs/promises';

export class PlanEnforcement1790000000016 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE tenants ADD COLUMN subscription_end date, ADD COLUMN pending_subscription jsonb;
      UPDATE tenants t SET subscription_end = t.cycle_start_at + p.validity_days FROM plans p WHERE p.id::text=t.plan_id;
      ALTER TABLE payment_orders ADD COLUMN entitlement jsonb NOT NULL DEFAULT '{}';
      ALTER TABLE ingestion_jobs ADD COLUMN size bigint NOT NULL DEFAULT 0;
      UPDATE ingestion_jobs j SET size=f.size FROM knowledge_files f WHERE f.tenant_id=j.tenant_id AND f.dataset_id=j.dataset_id AND f.source_id=j.source_id AND f.source_version=j.source_version;`);
    for (const job of await q.query('SELECT id,file_path FROM ingestion_jobs WHERE size=0')) {
      const bytes = await stat(job.file_path).then(file => file.size).catch(() => 0);
      if (bytes) await q.query('UPDATE ingestion_jobs SET size=$1 WHERE id=$2', [bytes, job.id]);
    }
    await q.query(`CREATE FUNCTION enforce_plan_resource() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE t tenants%ROWTYPE; p plans%ROWTYPE; lim bigint; used bigint; field text;
      BEGIN
        IF TG_OP='UPDATE' AND NEW.tenant_id=OLD.tenant_id THEN RETURN NEW; END IF;
        SELECT * INTO t FROM tenants WHERE id::text=NEW.tenant_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='套餐限制：租户不存在'; END IF;
        SELECT * INTO p FROM plans WHERE id::text=t.plan_id;
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='套餐限制：套餐不存在'; END IF;
        IF t.status NOT IN ('ACTIVE','PENDING_ACTIVATION') OR t.subscription_end <= CURRENT_DATE THEN
          RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='套餐限制：租户已停用或套餐已到期，请续费后新增资源';
        END IF;
        field := CASE TG_TABLE_NAME WHEN 'robots' THEN 'robot_limit' WHEN 'users' THEN 'user_limit' WHEN 'knowledge_bases' THEN 'kb_limit' WHEN 'channels' THEN 'channel_limit' WHEN 'tenant_accounts' THEN 'admin_window_limit' END;
        lim := (to_jsonb(p)->>field)::bigint;
        EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id=$1', TG_TABLE_NAME) INTO used USING NEW.tenant_id;
        IF lim > 0 AND used >= lim THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='套餐限制：' || CASE TG_TABLE_NAME WHEN 'robots' THEN '机器人' WHEN 'users' THEN '用户' WHEN 'knowledge_bases' THEN '知识库' WHEN 'channels' THEN '渠道' ELSE '管理账号' END || '数量已达上限（' || lim || '），请清理资源或升级套餐'; END IF;
        RETURN NEW;
      END $$;`);
    for (const table of ['robots', 'users', 'knowledge_bases', 'channels']) {
      await q.query(`CREATE TRIGGER plan_resource_limit BEFORE INSERT OR UPDATE OF tenant_id ON ${table} FOR EACH ROW EXECUTE FUNCTION enforce_plan_resource()`);
    }
    await q.query(`CREATE FUNCTION enforce_plan_storage() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE t tenants%ROWTYPE; lim bigint; used bigint;
      BEGIN
        SELECT * INTO t FROM tenants WHERE id::text=NEW.tenant_id FOR UPDATE;
        SELECT storage_limit_mb::bigint*1048576 INTO lim FROM plans WHERE id::text=t.plan_id;
        IF t.status <> 'ACTIVE' OR t.subscription_end <= CURRENT_DATE THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='套餐限制：套餐已到期或租户已停用，不能新增上传'; END IF;
        IF TG_TABLE_NAME='knowledge_files' AND EXISTS (SELECT 1 FROM ingestion_jobs j WHERE j.tenant_id=NEW.tenant_id AND j.dataset_id=NEW.dataset_id AND j.source_id=NEW.source_id AND j.source_version=NEW.source_version AND j.size>=NEW.size) THEN RETURN NEW; END IF;
        SELECT COALESCE(sum(size),0) INTO used FROM ingestion_jobs WHERE tenant_id=NEW.tenant_id AND (TG_TABLE_NAME<>'ingestion_jobs' OR id<>NEW.id);
        SELECT used+COALESCE(sum(f.size),0) INTO used FROM knowledge_files f WHERE f.tenant_id=NEW.tenant_id AND (TG_TABLE_NAME<>'knowledge_files' OR f.id<>NEW.id) AND NOT EXISTS (SELECT 1 FROM ingestion_jobs j WHERE j.tenant_id=f.tenant_id AND j.dataset_id=f.dataset_id AND j.source_id=f.source_id AND j.source_version=f.source_version);
        IF lim > 0 AND used+NEW.size > lim THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='套餐限制：知识文件总容量不足，请清理保留文件或升级套餐'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER plan_storage_limit BEFORE INSERT OR UPDATE OF size ON ingestion_jobs FOR EACH ROW EXECUTE FUNCTION enforce_plan_storage();
      CREATE TRIGGER plan_storage_limit BEFORE INSERT OR UPDATE OF size ON knowledge_files FOR EACH ROW EXECUTE FUNCTION enforce_plan_storage();`);
  }
  async down(q: QueryRunner) {
    for (const table of ['robots', 'users', 'knowledge_bases', 'channels']) await q.query(`DROP TRIGGER plan_resource_limit ON ${table}`);
    await q.query(`DROP FUNCTION enforce_plan_resource(); DROP TRIGGER plan_storage_limit ON ingestion_jobs; DROP TRIGGER plan_storage_limit ON knowledge_files; DROP FUNCTION enforce_plan_storage(); ALTER TABLE ingestion_jobs DROP COLUMN size; ALTER TABLE payment_orders DROP COLUMN entitlement; ALTER TABLE tenants DROP COLUMN subscription_end, DROP COLUMN pending_subscription;`);
  }
}
