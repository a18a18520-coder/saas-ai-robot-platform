import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('collector_devices')
@Index(['tenantId', 'accountId', 'installationId'], { unique: true })
export class CollectorDevice {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() tenantId: string;
  @Column() accountId: string;
  @Column() installationId: string;
  @Column() name: string;
  @Column({ default: 'ACTIVE' }) status: 'ACTIVE' | 'REVOKED';
  @Column({ type: 'timestamptz', default: () => 'now()' }) createdAt: Date;
}

@Entity('collector_bindings')
@Index(['deviceId', 'localGroupId'], { unique: true })
export class CollectorBinding {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() tenantId: string;
  @Column() deviceId: string;
  @Column() localGroupId: string;
  @Column() groupId: string;
  @Column() observedName: string;
  @Column({ default: false }) enabled: boolean;
  @Column({ type: 'timestamptz', default: () => 'now()' }) updatedAt: Date;
}

@Entity('collector_messages')
@Index(['deviceId', 'sourceMessageId'], { unique: true })
@Index(['tenantId', 'createdAt'])
export class CollectorMessage {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() tenantId: string;
  @Column() accountId: string;
  @Column() deviceId: string;
  @Column() bindingId: string;
  @Column() groupId: string;
  @Column() sourceMessageId: string;
  @Column() payloadHash: string;
  @Column() senderNickname: string;
  @Column() isSelf: boolean;
  @Column() identitySource: 'visual_layout' | 'manual_review';
  @Column({ type: 'text' }) content: string;
  @Column({ type: 'jsonb' }) evidence: Record<string, unknown>;
  @Column({ type: 'timestamptz' }) capturedAt: Date;
  @Column({ type: 'varchar', nullable: true }) sentAtRaw: string | null;
  @Column({ default: 'received' }) processingStatus: string;
  @Column({ nullable: true }) collectionId?: string;
  @Column({ type: 'timestamptz', default: () => 'now()' }) createdAt: Date;
}
