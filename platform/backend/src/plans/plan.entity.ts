import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 套餐档位（FR-020 平台侧）——30 天周期计价 + 资源限制 */
@Entity('plans')
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  /** 价格（元/周期）——补价公式基准 */
  @Column({ type: 'int' })
  price: number;

  /** 有效天数（价格对应的周期，默认 30 天包月） */
  @Column({ name: 'validity_days', type: 'int', default: 30 })
  validityDays: number;

  @Column({ name: 'robot_limit', type: 'int', default: 0 }) // 0 = 不限
  robotLimit: number;

  @Column({ name: 'user_limit', type: 'int', default: 0 })
  userLimit: number;

  @Column({ name: 'kb_limit', type: 'int', default: 0 })
  kbLimit: number;

  /** AI 调用额度（次/月，包月档位计量） */
  @Column({ name: 'ai_quota', type: 'int', default: 0 })
  aiQuota: number;

  /** 知识库单文件大小上限 MB（保留兼容，不再配置） */
  @Column({ name: 'file_size_limit_mb', type: 'int', default: 0 })
  fileSizeLimitMb: number;

  /** 知识库总容量 MB（0 = 不限，随套餐档位） */
  @Column({ name: 'storage_limit_mb', type: 'int', default: 0 })
  storageLimitMb: number;

  @Column({ name: 'channel_limit', type: 'int', default: 0 })
  channelLimit: number;

  @Column({ name: 'admin_window_limit', type: 'int', default: 0 })
  adminWindowLimit: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  /** 是否主推（平台套餐列表标记） */
  @Column({ name: 'is_featured', default: false })
  isFeatured: boolean;
}
