import { MigrationInterface, QueryRunner } from 'typeorm';

export class CollectorSync1790000000024 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE collector_devices (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenantId" varchar NOT NULL, "accountId" varchar NOT NULL,
      "installationId" varchar NOT NULL, name varchar NOT NULL, status varchar NOT NULL DEFAULT 'ACTIVE',
      "createdAt" timestamptz NOT NULL DEFAULT now(), UNIQUE ("tenantId", "accountId", "installationId")
    )`);
    await q.query(`CREATE TABLE collector_bindings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenantId" varchar NOT NULL, "deviceId" varchar NOT NULL,
      "localGroupId" varchar NOT NULL, "groupId" varchar NOT NULL, "observedName" varchar NOT NULL,
      enabled boolean NOT NULL DEFAULT false, "updatedAt" timestamptz NOT NULL DEFAULT now(), UNIQUE ("deviceId", "localGroupId")
    )`);
    await q.query(`CREATE TABLE collector_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenantId" varchar NOT NULL, "accountId" varchar NOT NULL,
      "deviceId" varchar NOT NULL, "bindingId" varchar NOT NULL, "groupId" varchar NOT NULL,
      "sourceMessageId" varchar NOT NULL, "payloadHash" varchar NOT NULL, "senderNickname" varchar NOT NULL,
      "isSelf" boolean NOT NULL, "identitySource" varchar NOT NULL, content text NOT NULL, evidence jsonb NOT NULL,
      "capturedAt" timestamptz NOT NULL, "sentAtRaw" varchar, "processingStatus" varchar NOT NULL DEFAULT 'received',
      "collectionId" varchar, "createdAt" timestamptz NOT NULL DEFAULT now(), UNIQUE ("deviceId", "sourceMessageId")
    )`);
    await q.query('CREATE INDEX collector_tenant_time ON collector_messages ("tenantId", "createdAt" DESC)');
    await q.query('ALTER TABLE collection_records ADD COLUMN "sourceMetadata" jsonb');
  }
  async down(q: QueryRunner) {
    await q.query('ALTER TABLE collection_records DROP COLUMN "sourceMetadata"');
    await q.query('DROP TABLE collector_messages, collector_bindings, collector_devices');
  }
}
