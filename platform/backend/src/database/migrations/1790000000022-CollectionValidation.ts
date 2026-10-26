import { MigrationInterface, QueryRunner } from 'typeorm';

export class CollectionValidation1790000000022 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE collection_records ADD COLUMN "validationErrors" jsonb NOT NULL DEFAULT '[]', ADD COLUMN "validationVersion" integer NOT NULL DEFAULT 1`);
    // Old results were not value-grounded. Keep every value, but do not certify them
    // under the stronger contract merely because the application was upgraded.
    await queryRunner.query(`UPDATE collection_records SET status='needs_review', reason='旧版校验结果，尚未经过严格字段校验。' || reason WHERE status='collected'`);
    await queryRunner.query(`ALTER TABLE collection_records ALTER COLUMN "validationVersion" SET DEFAULT 2`);
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    // Review states intentionally remain conservative after a schema rollback.
    await queryRunner.query(`ALTER TABLE collection_records DROP COLUMN "validationErrors", DROP COLUMN "validationVersion"`);
  }
}
