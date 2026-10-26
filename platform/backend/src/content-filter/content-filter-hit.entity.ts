import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 内容过滤命中流水（FR-023）。 */
@Entity('content_filter_hits')
export class ContentFilterHit {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'tenant_id', nullable: true }) tenantId?: string;
  @Column({ name: 'robot_id', nullable: true }) robotId?: string;
  @Column() direction: 'input' | 'output';
  @Column() word: string;
  @Column({ name: 'list_type' }) listType: 'black' | 'white';
  @Column() action: 'REPLACE' | 'REJECT' | 'ALERT' | 'EXEMPT';
  @Column({ type: 'text' }) content: string;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' }) createdAt: Date;
}
