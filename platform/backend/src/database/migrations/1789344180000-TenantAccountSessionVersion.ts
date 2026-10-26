import { MigrationInterface, QueryRunner } from 'typeorm';

/** 凭据版本用于在密码重置后阻止旧 Refresh Token 续期。 */
export class TenantAccountSessionVersion1789344180000 implements MigrationInterface {
  name = 'TenantAccountSessionVersion1789344180000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenant_accounts" ADD COLUMN IF NOT EXISTS "session_version" integer NOT NULL DEFAULT 0`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenant_accounts" DROP COLUMN IF EXISTS "session_version"`,
    );
  }
}
