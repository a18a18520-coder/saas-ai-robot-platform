import { MigrationInterface, QueryRunner } from 'typeorm';

export class CollectionValidationV31790000000023 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // Preserve historical results and their original validation version.
    await queryRunner.query('ALTER TABLE collection_records ALTER COLUMN "validationVersion" SET DEFAULT 3');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE collection_records ALTER COLUMN "validationVersion" SET DEFAULT 2');
  }
}
