import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
/** 知识文件（租户侧上传记录：文件名/密级/同步状态） */
@Entity('knowledge_files')
export class KnowledgeFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'dataset_id' })
  datasetId: string;

  @Column({ name: 'dify_document_id', nullable: true })
  difyDocumentId?: string;

  @Column()
  name: string;

  /** 密级：1 普通 / 2 内部 / 3 机密（FR-009 参与动态知识权限） */
  @Column({ name: 'sec_level', default: 1 })
  secLevel: 1 | 2 | 3;

  /** 文件大小（字节，上传时记录） */
  @Column({ type: 'int', default: 0 })
  size: number;

  @Column({ name: 'sync_status', default: 'waiting' })
  syncStatus: string;

  @Column({ name: 'source_id', nullable: true }) sourceId?: string;
  @Column({ name: 'source_version', nullable: true }) sourceVersion?: string;
  @Column({ name: 'is_active', default: true }) isActive: boolean;

  /** 添加人 */
  @Column({ name: 'created_by', nullable: true })
  createdBy?: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}

