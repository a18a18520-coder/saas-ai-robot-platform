import { MigrationInterface, QueryRunner } from 'typeorm';

export class CollectionRecords1790000000021 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE collection_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenantId" varchar NOT NULL,
      "robotId" varchar NOT NULL, "groupId" varchar NOT NULL, channel varchar NOT NULL,
      "channelId" varchar NOT NULL DEFAULT '', "chatId" varchar NOT NULL,
      "channelUserId" varchar NOT NULL, "sourceMessageId" varchar NOT NULL, "eventKey" varchar NOT NULL,
      "sourceContent" text NOT NULL, "configSnapshot" jsonb NOT NULL,
      status varchar NOT NULL DEFAULT 'processing', items jsonb NOT NULL DEFAULT '[]',
      reason text NOT NULL DEFAULT '', "modelId" varchar NOT NULL DEFAULT '',
      "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT collection_event_unique UNIQUE ("tenantId", "robotId", "eventKey")
    )`);
    await q.query('CREATE INDEX collection_robot_time ON collection_records ("tenantId", "robotId", "createdAt" DESC)');
  }
  async down(q: QueryRunner) { await q.query('DROP TABLE collection_records'); }
}
