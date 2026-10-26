import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { CollectionConfig, CollectionItem, CollectionValidationIssue, COLLECTION_VALIDATION_VERSION } from './collection-config';

@Entity('collection_records')
@Index(['tenantId', 'robotId', 'createdAt'])
@Index(['tenantId', 'robotId', 'eventKey'], { unique: true })
export class CollectionRecord {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() tenantId: string;
  @Column() robotId: string;
  @Column() groupId: string;
  @Column() channel: string;
  @Column({ default: '' }) channelId: string;
  @Column() chatId: string;
  @Column() channelUserId: string;
  @Column() sourceMessageId: string;
  @Column() eventKey: string;
  @Column({ type: 'text' }) sourceContent: string;
  @Column({ type: 'jsonb', nullable: true }) sourceMetadata?: Record<string, unknown> | null;
  @Column({ type: 'jsonb' }) configSnapshot: CollectionConfig;
  @Column({ default: 'processing' }) status: 'processing' | 'collected' | 'needs_review' | 'ignored' | 'failed' | 'blocked';
  @Column({ type: 'jsonb', default: () => "'[]'" }) items: CollectionItem[];
  @Column({ type: 'jsonb', default: () => "'[]'" }) validationErrors: CollectionValidationIssue[];
  @Column({ default: COLLECTION_VALIDATION_VERSION }) validationVersion: number;
  @Column({ type: 'text', default: '' }) reason: string;
  @Column({ default: '' }) modelId: string;
  @Column({ type: 'timestamptz', default: () => 'now()' }) createdAt: Date;
  @Column({ type: 'timestamptz', default: () => 'now()' }) updatedAt: Date;
}
