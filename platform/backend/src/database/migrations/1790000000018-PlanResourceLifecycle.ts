import { MigrationInterface, QueryRunner } from 'typeorm';
export class PlanResourceLifecycle1790000000018 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`CREATE OR REPLACE FUNCTION enforce_plan_resource() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE t tenants%ROWTYPE; p plans%ROWTYPE; lim bigint; used bigint; field text; predicate text := '';
      BEGIN
        IF TG_TABLE_NAME='robots' THEN
          IF NEW.status='DELETED' THEN RETURN NEW; END IF;
          predicate := ' AND status <> ''DELETED''';
          IF TG_OP='UPDATE' AND NEW.tenant_id=OLD.tenant_id AND OLD.status <> 'DELETED' THEN RETURN NEW; END IF;
        ELSIF TG_TABLE_NAME='tenant_accounts' THEN
          IF NEW.status<>'ACTIVE' THEN RETURN NEW; END IF;
          predicate := ' AND status = ''ACTIVE''';
          IF TG_OP='UPDATE' AND NEW.tenant_id=OLD.tenant_id AND OLD.status='ACTIVE' THEN RETURN NEW; END IF;
        ELSIF TG_OP='UPDATE' AND NEW.tenant_id=OLD.tenant_id THEN RETURN NEW;
        END IF;
        SELECT * INTO t FROM tenants WHERE id::text=NEW.tenant_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='套餐限制：租户不存在'; END IF;
        IF t.pending_subscription IS NOT NULL AND (t.pending_subscription->>'start')::date <= (now() AT TIME ZONE 'Asia/Shanghai')::date THEN
          UPDATE tenants SET plan_id=pending_subscription->>'planId', cycle_start_at=(pending_subscription->>'start')::date, subscription_end=(pending_subscription->>'end')::date, ai_quota_used=0, is_trial=false, pending_subscription=NULL WHERE id=t.id RETURNING * INTO t;
        END IF;
        SELECT * INTO p FROM plans WHERE id::text=t.plan_id;
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='套餐限制：套餐不存在'; END IF;
        IF t.status NOT IN ('ACTIVE','PENDING_ACTIVATION') OR COALESCE(t.subscription_end,t.cycle_start_at+p.validity_days) <= (now() AT TIME ZONE 'Asia/Shanghai')::date THEN
          RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='套餐限制：租户已停用或套餐已到期，请续费后新增资源';
        END IF;
        field := CASE TG_TABLE_NAME WHEN 'robots' THEN 'robot_limit' WHEN 'users' THEN 'user_limit' WHEN 'knowledge_bases' THEN 'kb_limit' WHEN 'channels' THEN 'channel_limit' WHEN 'tenant_accounts' THEN 'admin_window_limit' END;
        lim := (to_jsonb(p)->>field)::bigint;
        EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id=$1 AND id<>$2', TG_TABLE_NAME) || predicate INTO used USING NEW.tenant_id,NEW.id;
        IF lim > 0 AND used >= lim THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='套餐限制：' || CASE TG_TABLE_NAME WHEN 'robots' THEN '机器人' WHEN 'users' THEN '用户' WHEN 'knowledge_bases' THEN '知识库' WHEN 'channels' THEN '渠道' ELSE '启用管理账号' END || '数量已达上限（' || lim || '），请清理资源或升级套餐'; END IF;
        RETURN NEW;
      END $$;
      DROP TRIGGER plan_resource_limit ON robots;
      CREATE TRIGGER plan_resource_limit BEFORE INSERT OR UPDATE OF tenant_id,status ON robots FOR EACH ROW EXECUTE FUNCTION enforce_plan_resource();
      CREATE TRIGGER plan_resource_limit BEFORE INSERT OR UPDATE OF tenant_id,status ON tenant_accounts FOR EACH ROW EXECUTE FUNCTION enforce_plan_resource();`);
  }
  async down(q: QueryRunner) { await q.query('DROP TRIGGER IF EXISTS plan_resource_limit ON tenant_accounts'); }
}
