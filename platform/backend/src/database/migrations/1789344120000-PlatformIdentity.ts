import { MigrationInterface, QueryRunner } from 'typeorm';

/** 平台管理账号与可配置角色，替代仅支持单个环境变量账号的旧认证方式。 */
export class PlatformIdentity1789344120000 implements MigrationInterface {
  name = 'PlatformIdentity1789344120000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "platform_roles" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "code" varchar NOT NULL UNIQUE,
      "name" varchar NOT NULL UNIQUE,
      "description" varchar,
      "permissions" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "is_super_admin" boolean NOT NULL DEFAULT false,
      "is_builtin" boolean NOT NULL DEFAULT false,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "platform_accounts" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" varchar NOT NULL,
      "account" varchar NOT NULL UNIQUE,
      "password_hash" varchar NOT NULL,
      "role_id" uuid NOT NULL,
      "status" varchar NOT NULL DEFAULT 'ACTIVE',
      "is_builtin" boolean NOT NULL DEFAULT false,
      "last_login_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_platform_account_role" FOREIGN KEY ("role_id")
        REFERENCES "platform_roles"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_platform_account_role" ON "platform_accounts" ("role_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_platform_builtin_account" ON "platform_accounts" ("is_builtin") WHERE "is_builtin" = true`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "platform_accounts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "platform_roles"`);
  }
}
