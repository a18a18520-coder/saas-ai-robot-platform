import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 知识库（本地管控）：可见性设置——所有部门 or 指定部门 */
@Entity('knowledge_bases')
export class KnowledgeBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  /** Dify Dataset ID */
  @Column({ name: 'dataset_id', unique: true })
  datasetId: string;

  @Column()
  name: string;

  /** all 所有部门可见 / restricted 仅指定部门 */
  @Column({ default: 'all' })
  visibility: 'all' | 'restricted';

  /** restricted 时的部门 ID 白名单 */
  @Column({ name: 'dept_ids', type: 'jsonb', default: () => `'[]'` })
  deptIds: string[];

  @Column({ name: 'pipeline_config', type: 'jsonb', default: () => "'{}'" })
  pipelineConfig: { autoWiki?: boolean; startNodeId?: string; inputs?: Record<string, unknown>; version?: string };

  /** 添加人 */
  @Column({ name: 'created_by', nullable: true })
  createdBy?: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
