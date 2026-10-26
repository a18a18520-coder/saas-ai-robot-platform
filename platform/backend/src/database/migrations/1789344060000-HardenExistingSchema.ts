import { MigrationInterface, QueryRunner } from 'typeorm';

/** Upgrade installations previously managed by synchronize=true to the current tenant-safe schema. */
export class HardenExistingSchema1789344060000 implements MigrationInterface {
  name = 'HardenExistingSchema1789344060000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payment_orders" ADD COLUMN IF NOT EXISTS "merchant_order_no" varchar`);
    await queryRunner.query(`ALTER TABLE "payment_orders" ADD COLUMN IF NOT EXISTS "gateway_transaction_id" varchar`);
    await queryRunner.query(`ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "admin_account_id" varchar`);
    await queryRunner.query(`ALTER TABLE "tenant_accounts" ADD COLUMN IF NOT EXISTS "windows" jsonb NOT NULL DEFAULT '[]'::jsonb`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tenant_id" varchar`);
    await queryRunner.query(`ALTER TABLE "user_identities" ADD COLUMN IF NOT EXISTS "tenant_id" varchar`);

    // Remove legacy global uniqueness after creating tenant-scoped replacements.
    await this.dropSingleColumnUnique(queryRunner, 'groups', 'chat_id');
    await this.dropSingleColumnUnique(queryRunner, 'users', 'phone_hash');
    await this.dropSingleColumnUnique(queryRunner, 'user_identities', 'channel_user_id');
    await this.dropSingleColumnUnique(queryRunner, 'tools', 'identifier');

    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tenant_channel_chat" ON "groups" ("tenant_id", "channel", "chat_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tenant_phone_hash" ON "users" ("tenant_id", "phone_hash")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tenant_channel_user" ON "user_identities" ("tenant_id", "channel", "channel_user_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tenant_tool_identifier" ON "tools" ("tenant_id", "identifier")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_payment_merchant_order" ON "payment_orders" ("merchant_order_no")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_tenant_created" ON "audit_logs" ("tenant_id", "created_at")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_message_conversation_created" ON "messages" ("conversation_id", "created_at")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_notification_tenant_read" ON "notifications" ("tenant_id", "is_read")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notification_tenant_read"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_message_conversation_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_tenant_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_payment_merchant_order"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_tenant_channel_user"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_tenant_tool_identifier"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_tenant_phone_hash"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_tenant_channel_chat"`);
  }

  private async dropSingleColumnUnique(queryRunner: QueryRunner, table: string, column: string): Promise<void> {
    const rows = await queryRunner.query(
      `SELECT c.conname
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = current_schema() AND t.relname = $1 AND c.contype = 'u'
         AND pg_get_constraintdef(c.oid) = $2`,
      [table, `UNIQUE (${column})`],
    ) as Array<{ conname: string }>;
    for (const row of rows) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT "${row.conname.replace(/"/g, '""')}"`);
    }
  }
}
