import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { CollectionConfig } from './collection-config';

/** 机器人（FR-002）——绑定 Dify App/Workflow/知识候选池/工具，生命周期四态 */
@Entity('robots')
export class Robot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column()
  name: string;

  @Column({ default: '客服机器人' })
  type: string;

  @Column({ nullable: true })
  description?: string;

  /** Dify App ID（平台分配的资源） */
  @Column({ name: 'dify_app_id', nullable: true })
  difyAppId?: string;

  @Column({ name: 'workflow_id', nullable: true })
  workflowId?: string;

  /** 知识候选池（平台知识库 ID 列表）——实际检索范围按权限动态过滤 */
  @Column({ name: 'kb_pool', type: 'jsonb', default: () => `'[]'` })
  kbPool: string[];

  /** 绑定工具标识列表 */
  @Column({ name: 'tool_identifiers', type: 'jsonb', default: () => `'[]'` })
  toolIdentifiers: string[];

  /** 转人工配置（FR-016） */
  @Column({ name: 'human_handoff', type: 'jsonb', default: () => `'{"enabled": true, "fallback": "抱歉，我暂时没找到答案，已通知客服为您处理，请稍候~"}'` })
  humanHandoff: { enabled: boolean; fallback: string };

  @Column({ name: 'rag_config', type: 'jsonb', default: () => "'{}'" })
  ragConfig: {
    mode?: 'qa' | 'collector'; collection?: CollectionConfig;
    rerankModelId?: string; wikiRootIds?: string[];
    primaryModelId?: string; fallbackModelId?: string; systemPrompt?: string;
    personality?: string; tone?: string; responseFormat?: string;
    topK?: number; searchMethod?: 'keyword_search' | 'semantic_search' | 'hybrid_search';
    scoreThreshold?: number; historyTurns?: number; compressionThreshold?: number;
    toolsEnabled?: boolean; strictEvidence?: boolean; answerDetail?: 'concise' | 'detailed'; answerMode?: 'grounded_summary';
  };

  @Column({ name: 'published_config', type: 'jsonb', nullable: true }) publishedConfig?: Record<string, unknown>;
  @Column({ name: 'config_history', type: 'jsonb', default: () => "'[]'" }) configHistory: Array<{ version: number; publishedAt: string; config: Record<string, unknown> }>;

  @Column({ default: 'DRAFT' })
  status: 'DRAFT' | 'PUBLISHED' | 'DISABLED' | 'DELETED';

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
