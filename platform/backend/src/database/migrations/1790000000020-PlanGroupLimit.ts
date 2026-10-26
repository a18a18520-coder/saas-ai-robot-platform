import { MigrationInterface, QueryRunner } from 'typeorm';
/** The legacy admin_window_limit field represents managed groups, not admin accounts. */
export class PlanGroupLimit1790000000020 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`DROP TRIGGER IF EXISTS plan_resource_limit ON tenant_accounts;
      CREATE FUNCTION enforce_plan_groups() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE t tenants%ROWTYPE; lim integer; used integer;
      BEGIN
        IF NEW.status <> 'BOUND' THEN RETURN NEW; END IF;
        IF TG_OP='UPDATE' AND OLD.status='BOUND' AND OLD.tenant_id=NEW.tenant_id THEN RETURN NEW; END IF;
        SELECT * INTO t FROM tenants WHERE id::text=NEW.tenant_id FOR UPDATE;
        IF t.pending_subscription IS NOT NULL AND (t.pending_subscription->>'start')::date <= (now() AT TIME ZONE 'Asia/Shanghai')::date THEN
          UPDATE tenants SET plan_id=pending_subscription->>'planId',cycle_start_at=(pending_subscription->>'start')::date,subscription_end=(pending_subscription->>'end')::date,ai_quota_used=0,is_trial=false,pending_subscription=NULL WHERE id=t.id RETURNING * INTO t;
        END IF;
        SELECT admin_window_limit INTO lim FROM plans WHERE id::text=t.plan_id;
        IF t.id IS NULL OR lim IS NULL OR t.status<>'ACTIVE' OR t.subscription_end IS NULL OR t.subscription_end <= (now() AT TIME ZONE 'Asia/Shanghai')::date THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='套餐限制：套餐已到期或租户已停用，不能启用群'; END IF;
        SELECT count(*) INTO used FROM groups WHERE tenant_id=NEW.tenant_id AND status='BOUND' AND id<>NEW.id;
        IF lim>0 AND used>=lim THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='套餐限制：可管理群数量已达上限（' || lim || '），请停用其他群或升级套餐'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER plan_group_limit BEFORE INSERT OR UPDATE OF tenant_id,status ON groups FOR EACH ROW EXECUTE FUNCTION enforce_plan_groups();
      COMMENT ON COLUMN plans.admin_window_limit IS '可管理群上限：已绑定且启用的群计数，0不限；兼容历史字段名';`);
  }
  async down(q: QueryRunner) { await q.query('DROP TRIGGER plan_group_limit ON groups; DROP FUNCTION enforce_plan_groups()'); }
}
