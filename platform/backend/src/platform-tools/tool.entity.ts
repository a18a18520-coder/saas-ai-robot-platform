import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** 工具（FR-012/025）——Tool Gateway 统一管控，平台侧可为租户新增（FR-025） */
@Entity('tools')
@Unique(['tenantId', 'identifier'])
export class Tool {
  /** API-only optimistic concurrency token, not a database column. */
  configRevision?: string;
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 归属租户（平台侧新增时指定） */
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column()
  name: string;

  /** 用途描述（列表「用途」列，如 查询订单状态/金额） */
  @Column({ nullable: true })
  description?: string;

  /** 供 Dify 引用的标识，如 order_query */
  @Column()
  identifier: string;

  @Column({ default: 'POST' })
  method: string;

  @Column()
  url: string;

  @Column({ name: 'auth_type', default: 'API_KEY' })
  authType: 'API_KEY' | 'OAUTH2' | 'NONE';

  /** 认证凭据（AES-256-GCM 版本化密文；API 仅返回掩码） */
  @Column({ name: 'api_key', nullable: true })
  apiKey?: string;

  /** 请求参数 JSON Schema（传值配置：{key: {type, required, desc}}，Tool Gateway 白名单校验用） */
  @Column({ name: 'request_schema', type: 'jsonb', nullable: true })
  requestSchema?: Record<string, unknown>;

  /** 返回字段白名单（防 Dify 侧数据泄露） */
  @Column({ name: 'response_whitelist', type: 'jsonb', nullable: true })
  responseWhitelist?: string[];

  /** 访问角色白名单 */
  @Column({ name: 'allowed_roles', type: 'jsonb', default: () => `'["客服","运营"]'` })
  allowedRoles: string[];

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'read_only', default: false }) readOnly: boolean;

  @Column({ name: 'execution_config', type: 'jsonb', default: () => `'{}'` })
  executionConfig: { responseListPath?: string; responseEmptyMessage?: string; authHeader?: 'X-User-Id'; mode?: 'query' | 'submit'; successField?: string; successValue?: string | number | boolean; successMessage?: string; failureMessage?: string; requestFormat?: string; responseFormat?: string; missingParameterPrompt?: string; responseSchema?: Record<string, unknown>; responseTemplate?: string };

  /** 调用统计（工具执行链路接入后自动累计） */
  @Column({ name: 'call_count', type: 'int', default: 0 })
  callCount: number;

  @Column({ name: 'success_count', type: 'int', default: 0 })
  successCount: number;

  @Column({ name: 'last_called_at', type: 'timestamptz', nullable: true })
  lastCalledAt?: Date;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
