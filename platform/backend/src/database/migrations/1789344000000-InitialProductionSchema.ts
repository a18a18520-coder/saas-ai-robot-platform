import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Production schema baseline. CREATE IF NOT EXISTS lets an existing synchronized
 * installation adopt migrations without deleting data, while a clean database can
 * be provisioned with DB_SYNC disabled.
 */
export class InitialProductionSchema1789344000000 implements MigrationInterface {
  name = 'InitialProductionSchema1789344000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const statements = [
      `CREATE TABLE IF NOT EXISTS "plans" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "name" varchar NOT NULL UNIQUE, "price" integer NOT NULL,
        "validity_days" integer NOT NULL DEFAULT 30, "robot_limit" integer NOT NULL DEFAULT 0,
        "user_limit" integer NOT NULL DEFAULT 0, "kb_limit" integer NOT NULL DEFAULT 0,
        "ai_quota" integer NOT NULL DEFAULT 0, "file_size_limit_mb" integer NOT NULL DEFAULT 0,
        "storage_limit_mb" integer NOT NULL DEFAULT 0, "channel_limit" integer NOT NULL DEFAULT 0,
        "admin_window_limit" integer NOT NULL DEFAULT 0, "is_active" boolean NOT NULL DEFAULT true,
        "is_featured" boolean NOT NULL DEFAULT false
      )`,
      `CREATE TABLE IF NOT EXISTS "tenants" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "name" varchar NOT NULL UNIQUE, "plan_id" varchar NOT NULL,
        "status" varchar NOT NULL DEFAULT 'ACTIVE', "cycle_start_at" date NOT NULL, "admin_email" varchar NOT NULL,
        "admin_account_id" varchar, "ai_quota_used" integer NOT NULL DEFAULT 0, "is_trial" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(), "disabled_reason" varchar, "deleted_at" timestamptz,
        "config" jsonb NOT NULL DEFAULT '{}'::jsonb
      )`,
      `CREATE TABLE IF NOT EXISTS "tenant_dify_resources" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" varchar NOT NULL, "resource_id" varchar NOT NULL,
        "resource_type" varchar NOT NULL DEFAULT 'app', "resource_name" varchar, "dataset_id" varchar, "ds_key" varchar,
        "bind_robot_id" varchar, "status" varchar NOT NULL DEFAULT 'ACTIVE', "created_at" timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS "tools" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" varchar NOT NULL, "name" varchar NOT NULL,
        "description" varchar, "identifier" varchar NOT NULL, "method" varchar NOT NULL DEFAULT 'POST', "url" varchar NOT NULL,
        "auth_type" varchar NOT NULL DEFAULT 'API_KEY', "api_key" varchar, "request_schema" jsonb, "response_whitelist" jsonb,
        "allowed_roles" jsonb NOT NULL DEFAULT '["\u5ba2\u670d","\u8fd0\u8425"]'::jsonb, "is_active" boolean NOT NULL DEFAULT true,
        "call_count" integer NOT NULL DEFAULT 0, "success_count" integer NOT NULL DEFAULT 0, "last_called_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS "content_filter_words" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "word" varchar NOT NULL, "listType" varchar NOT NULL,
        "category" varchar NOT NULL DEFAULT '\u81ea\u5b9a\u4e49', "action" varchar NOT NULL DEFAULT 'REPLACE', "scope" varchar NOT NULL DEFAULT 'global',
        "note" varchar, "is_active" boolean NOT NULL DEFAULT true, "hit_count" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS "content_filter_hits" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" varchar, "robot_id" varchar, "direction" varchar NOT NULL,
        "word" varchar NOT NULL, "list_type" varchar NOT NULL, "action" varchar NOT NULL, "content" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS "robots" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" varchar NOT NULL, "name" varchar NOT NULL,
        "type" varchar NOT NULL DEFAULT '\u5ba2\u670d\u673a\u5668\u4eba', "description" varchar, "dify_app_id" varchar, "workflow_id" varchar,
        "kb_pool" jsonb NOT NULL DEFAULT '[]'::jsonb, "tool_identifiers" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "human_handoff" jsonb NOT NULL DEFAULT '{"enabled":true,"fallback":"\u62b1\u6b49\uff0c\u6211\u6682\u65f6\u6ca1\u627e\u5230\u7b54\u6848\uff0c\u5df2\u901a\u77e5\u5ba2\u670d\u4e3a\u60a8\u5904\u7406\uff0c\u8bf7\u7a0d\u5019~"}'::jsonb,
        "status" varchar NOT NULL DEFAULT 'DRAFT', "created_at" timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS "groups" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" varchar NOT NULL, "chat_id" varchar NOT NULL,
        "name" varchar, "group_type" varchar NOT NULL DEFAULT 'internal', "robot_id" varchar,
        "status" varchar NOT NULL DEFAULT 'PENDING', "handoff_role" varchar, "channel" varchar NOT NULL DEFAULT 'wecom',
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS "group_members" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "group_id" varchar NOT NULL, "channel_user_id" varchar NOT NULL,
        "source" varchar NOT NULL DEFAULT 'wecom', "user_id" varchar, "group_role_override" varchar,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" varchar NOT NULL, "phone_hash" varchar, "phone_masked" varchar,
        "name" varchar, "identity" varchar NOT NULL DEFAULT '\u6e38\u5ba2', "role" varchar, "department" varchar,
        "status" varchar NOT NULL DEFAULT 'ACTIVE', "merged_into_id" varchar, "created_at" timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS "user_identities" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" varchar NOT NULL, "user_id" varchar NOT NULL,
        "channel" varchar NOT NULL, "channel_user_id" varchar NOT NULL, "confidence" varchar NOT NULL DEFAULT '\u4f4e',
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS "conversations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" varchar NOT NULL, "robot_id" varchar NOT NULL,
        "group_id" varchar, "user_id" varchar NOT NULL, "context_ref" varchar,
        "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS "messages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "conversation_id" varchar NOT NULL, "role" varchar NOT NULL DEFAULT 'user',
        "content" text NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS "audit_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" varchar NOT NULL, "robot_id" varchar, "user_id" varchar,
        "channel_user_id" varchar, "question" text NOT NULL, "dataset_hits" jsonb, "tool_calls" jsonb,
        "result" varchar NOT NULL DEFAULT '\u77e5\u8bc6\u547d\u4e2d', "answer" text, "trace_id" varchar,
        "duration_ms" integer NOT NULL DEFAULT 0, "stages" jsonb, "created_at" timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS "broadcast_records" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" varchar NOT NULL, "robot_ids" jsonb NOT NULL,
        "group_ids" jsonb NOT NULL, "content" text NOT NULL, "images" jsonb, "status" varchar NOT NULL DEFAULT 'PENDING',
        "results" jsonb, "operator" varchar, "created_at" timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS "roles" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" varchar NOT NULL, "name" varchar NOT NULL,
        "is_builtin" boolean NOT NULL DEFAULT false, "status" varchar NOT NULL DEFAULT 'ACTIVE',
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS "role_permissions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "role_id" varchar NOT NULL, "resource_type" varchar NOT NULL, "resource_id" varchar NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS "depts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" varchar NOT NULL, "name" varchar NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS "dept_kbs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "dept_id" varchar NOT NULL, "knowledge_id" varchar NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS "notifications" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" varchar NOT NULL, "type" varchar NOT NULL DEFAULT 'system',
        "title" varchar NOT NULL, "content" text NOT NULL, "is_read" boolean NOT NULL DEFAULT false, "link" varchar,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS "knowledge_files" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" varchar NOT NULL, "dataset_id" varchar NOT NULL,
        "dify_document_id" varchar, "name" varchar NOT NULL, "sec_level" integer NOT NULL DEFAULT 1,
        "size" integer NOT NULL DEFAULT 0, "sync_status" varchar NOT NULL DEFAULT 'waiting', "created_by" varchar,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS "knowledge_bases" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" varchar NOT NULL, "dataset_id" varchar NOT NULL UNIQUE,
        "name" varchar NOT NULL, "visibility" varchar NOT NULL DEFAULT 'all', "dept_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_by" varchar, "created_at" timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS "channels" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" varchar NOT NULL, "type" varchar NOT NULL,
        "name" varchar NOT NULL, "config" jsonb NOT NULL, "status" varchar NOT NULL DEFAULT 'disconnected',
        "bind_robot_id" varchar, "is_active" boolean NOT NULL DEFAULT true, "created_at" timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS "follow_ups" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" varchar NOT NULL, "robot_id" varchar,
        "channel" varchar NOT NULL DEFAULT 'web', "chat_id" varchar, "channel_user_id" varchar NOT NULL,
        "question" text NOT NULL, "status" varchar NOT NULL DEFAULT 'pending', "note" text,
        "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS "platform_settings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "dify_url" varchar NOT NULL DEFAULT 'http://localhost:5001',
        "dify_api_key" varchar, "service_account_key" varchar, "new_tenant_trial_days" integer NOT NULL DEFAULT 14,
        "quota_threshold" integer NOT NULL DEFAULT 80, "audit_retention_days" integer NOT NULL DEFAULT 180,
        "session_retention_days" integer NOT NULL DEFAULT 90, "updated_at" timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS "payment_orders" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" varchar NOT NULL, "plan_id" varchar NOT NULL,
        "plan_name" varchar NOT NULL, "amount" integer NOT NULL, "pay_type" varchar NOT NULL DEFAULT 'WECHAT',
        "status" varchar NOT NULL DEFAULT 'PENDING', "qr_content" varchar, "merchant_order_no" varchar,
        "gateway_transaction_id" varchar, "bank_info" jsonb, "remark" varchar,
        "created_at" timestamptz NOT NULL DEFAULT now(), "paid_at" timestamptz
      )`,
      `CREATE TABLE IF NOT EXISTS "tenant_accounts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" varchar NOT NULL, "name" varchar NOT NULL,
        "account" varchar NOT NULL UNIQUE, "password_hash" varchar NOT NULL, "role" varchar NOT NULL DEFAULT 'TENANT_OPS',
        "windows" jsonb NOT NULL DEFAULT '[]'::jsonb, "status" varchar NOT NULL DEFAULT 'ACTIVE',
        "last_login_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS "login_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" varchar, "account" varchar NOT NULL,
        "domain" varchar NOT NULL DEFAULT 'tenant', "ip" varchar NOT NULL DEFAULT '0.0.0.0',
        "result" varchar NOT NULL DEFAULT '\u5931\u8d25', "created_at" timestamptz NOT NULL DEFAULT now()
      )`,
    ];

    for (const statement of statements) await queryRunner.query(statement);

    const indexes = [
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tenant_dify_resource" ON "tenant_dify_resources" ("tenant_id", "resource_id")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tenant_tool_identifier" ON "tools" ("tenant_id", "identifier")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tenant_channel_chat" ON "groups" ("tenant_id", "channel", "chat_id")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_group_member_identity" ON "group_members" ("group_id", "channel_user_id")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tenant_phone_hash" ON "users" ("tenant_id", "phone_hash")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tenant_channel_user" ON "user_identities" ("tenant_id", "channel", "channel_user_id")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_payment_merchant_order" ON "payment_orders" ("merchant_order_no")`,
      `CREATE INDEX IF NOT EXISTS "IDX_audit_tenant_created" ON "audit_logs" ("tenant_id", "created_at")`,
      `CREATE INDEX IF NOT EXISTS "IDX_message_conversation_created" ON "messages" ("conversation_id", "created_at")`,
      `CREATE INDEX IF NOT EXISTS "IDX_notification_tenant_read" ON "notifications" ("tenant_id", "is_read")`,
    ];
    for (const statement of indexes) await queryRunner.query(statement);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      'login_logs', 'tenant_accounts', 'payment_orders', 'platform_settings', 'follow_ups', 'channels', 'knowledge_bases',
      'knowledge_files', 'notifications', 'dept_kbs', 'depts', 'role_permissions', 'roles', 'broadcast_records', 'audit_logs',
      'messages', 'conversations', 'user_identities', 'users', 'group_members', 'groups', 'robots', 'content_filter_hits',
      'content_filter_words', 'tools', 'tenant_dify_resources', 'tenants', 'plans',
    ];
    for (const table of tables) await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
  }
}
