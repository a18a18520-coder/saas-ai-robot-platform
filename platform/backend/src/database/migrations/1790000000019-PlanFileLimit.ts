import { MigrationInterface, QueryRunner } from 'typeorm';
export class PlanFileLimit1790000000019 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`CREATE FUNCTION enforce_plan_file_size() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE lim bigint;
      BEGIN
        SELECT p.file_size_limit_mb::bigint*1048576 INTO lim FROM plans p JOIN tenants t ON p.id::text=t.plan_id WHERE t.id::text=NEW.tenant_id;
        IF NEW.size<0 OR (lim>0 AND NEW.size>lim) THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='套餐限制：单文件大小超过当前套餐上限'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER plan_single_file_limit BEFORE INSERT OR UPDATE OF size ON ingestion_jobs FOR EACH ROW EXECUTE FUNCTION enforce_plan_file_size();`);
  }
  async down(q: QueryRunner) { await q.query('DROP TRIGGER plan_single_file_limit ON ingestion_jobs; DROP FUNCTION enforce_plan_file_size()'); }
}
