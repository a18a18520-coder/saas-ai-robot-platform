import { MigrationInterface, QueryRunner } from 'typeorm';

/** 为既有租户账号补充密码有效期计算基准。 */
export class TenantSecurityPolicy1789344420000 implements MigrationInterface {
  name = 'TenantSecurityPolicy1789344420000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenant_accounts" ADD COLUMN IF NOT EXISTS "password_changed_at" timestamptz`,
    );
    await queryRunner.query(
      `UPDATE "tenant_accounts" SET "password_changed_at" = COALESCE("created_at", now()) WHERE "password_changed_at" IS NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenant_accounts" DROP COLUMN IF EXISTS "password_changed_at"`,
    );
  }
}
