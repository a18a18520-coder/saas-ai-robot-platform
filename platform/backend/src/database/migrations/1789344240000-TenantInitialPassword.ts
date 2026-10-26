import { MigrationInterface, QueryRunner } from 'typeorm';

/** 标记使用临时初始密码、必须先完成改密的租户账号。 */
export class TenantInitialPassword1789344240000 implements MigrationInterface {
  name = 'TenantInitialPassword1789344240000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenant_accounts" ADD COLUMN IF NOT EXISTS "must_change_password" boolean NOT NULL DEFAULT false`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenant_accounts" DROP COLUMN IF EXISTS "must_change_password"`,
    );
  }
}
