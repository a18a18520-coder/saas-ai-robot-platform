import { MigrationInterface, QueryRunner } from 'typeorm';

/** 将租户管理账号绑定到角色，并初始化角色对应的后台功能权限。 */
export class TenantAccountRoleLink1789344300000 implements MigrationInterface {
  name = 'TenantAccountRoleLink1789344300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenant_accounts" ADD COLUMN IF NOT EXISTS "role_id" uuid`,
    );

    await queryRunner.query(`
      INSERT INTO "roles" ("tenant_id", "name", "is_builtin", "status")
      SELECT tenant."id"::text, definition."name", true, 'ACTIVE'
      FROM "tenants" tenant
      CROSS JOIN (VALUES ('游客'), ('用户'), ('客服'), ('运营'), ('管理员')) AS definition("name")
      WHERE NOT EXISTS (
        SELECT 1 FROM "roles" role
        WHERE role."tenant_id" = tenant."id"::text
          AND role."name" = definition."name"
      )
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "resource_type", "resource_id")
      SELECT role."id"::text, 'window', definition."permission"
      FROM "roles" role
      JOIN (VALUES
        ('用户', 'dashboard'), ('用户', 'notifications'),
        ('客服', 'dashboard'), ('客服', 'notifications'), ('客服', 'groups'),
        ('客服', 'messages'), ('客服', 'follow-ups'), ('客服', 'sessions'), ('客服', 'users'),
        ('运营', 'dashboard'), ('运营', 'notifications'), ('运营', 'robots'),
        ('运营', 'channels'), ('运营', 'groups'), ('运营', 'messages'),
        ('运营', 'broadcast'), ('运营', 'follow-ups'), ('运营', 'sessions'),
        ('运营', 'users'), ('运营', 'knowledge'), ('运营', 'tools'),
        ('运营', 'audit'), ('运营', 'logs'),
        ('管理员', 'dashboard'), ('管理员', 'notifications'), ('管理员', 'robots'),
        ('管理员', 'channels'), ('管理员', 'groups'), ('管理员', 'messages'),
        ('管理员', 'broadcast'), ('管理员', 'follow-ups'), ('管理员', 'sessions'),
        ('管理员', 'users'), ('管理员', 'roles'), ('管理员', 'knowledge'),
        ('管理员', 'tools'), ('管理员', 'audit'), ('管理员', 'logs'), ('管理员', 'settings')
      ) AS definition("role_name", "permission")
        ON definition."role_name" = role."name"
      WHERE NOT EXISTS (
        SELECT 1 FROM "role_permissions" permission
        WHERE permission."role_id" = role."id"::text
          AND permission."resource_type" = 'window'
          AND permission."resource_id" = definition."permission"
      )
    `);

    await queryRunner.query(`
      UPDATE "tenant_accounts" account
      SET "role_id" = role."id"
      FROM "roles" role
      WHERE account."role_id" IS NULL
        AND role."tenant_id" = account."tenant_id"
        AND role."name" = CASE
          WHEN account."role" = 'TENANT_ADMIN' THEN '管理员'
          ELSE '运营'
        END
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tenant_account_role" ON "tenant_accounts" ("role_id")`,
    );
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_tenant_account_role'
            AND conrelid = 'tenant_accounts'::regclass
        ) THEN
          ALTER TABLE "tenant_accounts"
          ADD CONSTRAINT "FK_tenant_account_role"
          FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT;
        END IF;
      END $$
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenant_accounts" DROP CONSTRAINT IF EXISTS "FK_tenant_account_role"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tenant_account_role"`);
    await queryRunner.query(
      `ALTER TABLE "tenant_accounts" DROP COLUMN IF EXISTS "role_id"`,
    );
    await queryRunner.query(
      `DELETE FROM "role_permissions" WHERE "resource_type" = 'window'`,
    );
  }
}
