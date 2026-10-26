import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** 租户 × Dify 资源分配（FR-022 落库）——分配=授权（ds-key 密钥即权限） */
@Entity('tenant_dify_resources')
@Unique(['tenantId', 'resourceId'])
export class TenantDifyResource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  /** Dify App/Workflow ID */
  @Column({ name: 'resource_id' })
  resourceId: string;

  @Column({ name: 'resource_type', default: 'app' })
  resourceType: 'app' | 'workflow';

  /** Dify 资源名称（同步时冗余，便于列表展示） */
  @Column({ name: 'resource_name', nullable: true })
  resourceName?: string;

  /** 关联的 Dify Dataset ID（App 场景；ds-key 与白名单检索基于此） */
  @Column({ name: 'dataset_id', nullable: true })
  datasetId?: string;

  /** Dataset-scoped API Key（AES-256-GCM 密文；密钥即权限，检索隔离） */
  @Column({ name: 'ds_key', nullable: true })
  dsKey?: string;

  @Column({ name: 'bind_robot_id', nullable: true })
  bindRobotId?: string;

  @Column({ default: 'ACTIVE' })
  status: 'ACTIVE' | 'DISABLED' | 'UNASSIGNED';

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
