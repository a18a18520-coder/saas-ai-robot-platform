import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 通知中心（FR-027）：额度预警/群发失败人工介入/转人工待跟进/系统公告 */
@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  /** quota 额度预警 / broadcast_failed 群发失败人工介入 / handoff 转人工 / system 公告 */
  @Column({ default: 'system' })
  type: string;

  @Column()
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'is_read', default: false })
  isRead: boolean;

  @Column({ name: 'link', nullable: true })
  link?: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
