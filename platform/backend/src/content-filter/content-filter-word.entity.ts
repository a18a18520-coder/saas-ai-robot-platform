import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 内容黑白名单词条（FR-023）——平台级敏感词过滤 */
@Entity('content_filter_words')
export class ContentFilterWord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  word: string;

  /** black 黑名单 / white 白名单（豁免） */
  @Column()
  listType: 'black' | 'white';

  @Column({ default: '自定义' })
  category: string;

  /** 拦截动作：REPLACE 替换为*** / REJECT 拒绝回复 / ALERT 仅告警 */
  @Column({ name: 'action', default: 'REPLACE' })
  action: 'REPLACE' | 'REJECT' | 'ALERT';

  /** 作用域：global 或 tenantId */
  @Column({ default: 'global' })
  scope: string;

  /** 白名单豁免说明 */
  @Column({ name: 'note', nullable: true })
  note?: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'hit_count', type: 'int', default: 0 })
  hitCount: number;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
