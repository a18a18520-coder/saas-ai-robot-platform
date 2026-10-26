import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
@Entity('ingestion_jobs')
export class IngestionJob {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'tenant_id' }) tenantId: string;
  @Column({ name: 'dataset_id' }) datasetId: string;
  @Column({ name: 'source_id' }) sourceId: string;
  @Column({ name: 'source_version' }) sourceVersion: string;
  @Column() name: string;
  @Column({ type: 'bigint', default: 0 }) size: number;
  @Column({ name: 'file_path' }) filePath: string;
  @Column({ name: 'sec_level', default: 1 }) secLevel: number;
  @Column({ default: 'queued' }) status: string;
  @Column({ type: 'text', default: '' }) error: string;
  @Column({ name: 'document_id', nullable: true }) documentId?: string;
  @Column({ name: 'pipeline_config', type: 'jsonb', default: () => "'{}'" }) pipelineConfig: { startNodeId?: string; inputs?: Record<string, unknown>; version?: string };
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' }) createdAt: Date;
  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' }) updatedAt: Date;
}
