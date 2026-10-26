import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { TenantDifyResource } from './tenant-dify-resource.entity';
import { SecretsService } from '../secrets/secrets.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

/**
 * Dify 集成客户端（架构 A：ds-key 白名单检索，ADR-003）
 * 调研结论（2026-08-20）：
 *  - Dify v1.9.0+ 支持 Dataset-scoped API Key（ds- 前缀，每库 ≤10 个，读/检索正常）
 *  - 检索读路径用 ds-key（密钥即权限，天然隔离）
 *  - 知识同步写路径用平台服务账号（租户级 key，规避 ds-key 写 bug #26295）
 */
@Injectable()
export class DifyClientService {
  private readonly logger = new Logger(DifyClientService.name);
  private readonly fallbackBaseUrl: string;
  private adminTokenCache: { token: string; expiresAt: number } | null = null;

  private static readonly READ_TIMEOUT_MS = 15_000;
  private static readonly WRITE_TIMEOUT_MS = 60_000;
  private static readonly CHAT_TIMEOUT_MS = 120_000;

  constructor(
    private readonly config: ConfigService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly secrets: SecretsService,
    @InjectRepository(TenantDifyResource) private readonly resources: Repository<TenantDifyResource>,
  ) {
    this.fallbackBaseUrl = this.config.get<string>('DIFY_BASE_URL', 'http://dify.internal:3001');
  }

  /** 获取 Dify console 管理员 token（缓存 + 过期自动登录刷新） */
  async ensureAdminToken(): Promise<string> {
    if (this.adminTokenCache && Date.now() < this.adminTokenCache.expiresAt) {
      return this.adminTokenCache.token;
    }
    const email = this.config.get('DIFY_ADMIN_EMAIL', 'admin@robot-platform.local');
    const password = this.config.get('DIFY_ADMIN_PASSWORD', '');
    const baseUrl = await this.baseUrl();
    const res = await this.request(`${baseUrl}/console/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }, DifyClientService.READ_TIMEOUT_MS, '登录');
    if (!res.ok) throw new Error(`Dify 登录失败: HTTP ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { data?: { access_token?: string } };
    const token = json.data?.access_token ?? '';
    // 缓存 25 分钟（JWT 30min 过期留余量）
    this.adminTokenCache = { token, expiresAt: Date.now() + 25 * 60 * 1000 };
    this.logger.log('Dify console token 已自动刷新');
    return token;
  }

  /** T-005-1: ds-key 检索冒烟 —— 验证单知识库 ds-key 读路径可用性（架构 A1 前提） */
  async smokeTestDatasetKey(datasetId: string, dsApiKey: string): Promise<{ ok: boolean; hits?: number; error?: string }> {
    try {
      const res = await this.request(`${await this.baseUrl()}/v1/datasets/${datasetId}/retrieve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${dsApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: '__smoke_test__',
          retrieval_model: { search_method: 'semantic_search', top_k: 1 },
        }),
      }, DifyClientService.READ_TIMEOUT_MS, '知识库检索');
      if (res.status === 200) {
        const json = (await res.json()) as { records?: unknown[] };
        return { ok: true, hits: json.records?.length ?? 0 };
      }
      return { ok: false, error: `HTTP ${res.status}: ${await res.text()}` };
    } catch (e) {
      this.logger.error(`ds-key 冒烟失败: ${(e as Error).message}`);
      return { ok: false, error: (e as Error).message };
    }
  }

  /** 平台服务账号：拉取 App/Workflow 资源池（FR-022 同步资源）
   * 服务端 API 无 apps 列表端点 → 用 console API（管理员 token） */
  async listApps(apiKey?: string): Promise<Array<{ id: string; name: string; mode: string }>> {
    const token = await this.adminToken(apiKey);
    const res = await this.request(`${await this.baseUrl()}/console/api/apps?page=1&limit=100`, {
      headers: { Authorization: `Bearer ${token}` },
    }, DifyClientService.READ_TIMEOUT_MS, 'App 列表同步');
    if (!res.ok) throw new Error(`Dify listApps 失败: HTTP ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { data?: Array<{ id: string; name: string; mode: string }> };
    return json.data ?? [];
  }

  /** 创建 Dataset-scoped API Key（ds- 前缀，每库 ≤10 个） */
  async createDatasetKey(datasetId: string, adminApiKey?: string): Promise<string> {
    const token = await this.adminToken(adminApiKey);
    const res = await this.request(`${await this.baseUrl()}/console/api/datasets/${datasetId}/api-keys`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }, DifyClientService.WRITE_TIMEOUT_MS, 'ds-key 创建');
    if (!res.ok) throw new Error(`创建 ds-key 失败: HTTP ${res.status}: ${await res.text()}`);
    // Dify 1.9 返回结构: {"id":..., "type":"dataset", "token":"ds-xxx"}（token 在顶层）
    const json = (await res.json()) as { token?: string; data?: { token?: string } };
    return json.token ?? json.data?.token ?? '';
  }

  // ===== Dataset（知识库）全链路（FR-009 平台⇄Dify）=====

  /** ① 同步 Dify Dataset 列表到平台 */
  async listDatasets(adminApiKey?: string): Promise<Array<{ id: string; name: string; indexing_technique?: string; document_count?: number }>> {
    const token = await this.adminToken(adminApiKey);
    const res = await this.request(`${await this.baseUrl()}/console/api/datasets?page=1&limit=100`, {
      headers: { Authorization: `Bearer ${token}` },
    }, DifyClientService.READ_TIMEOUT_MS, '知识库列表同步');
    if (!res.ok) throw new Error(`Dify listDatasets 失败: HTTP ${res.status}`);
    const json = (await res.json()) as { data?: Array<{ id: string; name: string; indexing_technique?: string; document_count?: number }> };
    return json.data ?? [];
  }

  /** ② 平台 API 创建知识库（economy 免模型；high_quality 需配置 embedding） */
  async createDataset(adminApiKey: string, name: string, indexingTechnique: 'high_quality' | 'economy' = 'economy'): Promise<string> {
    const token = await this.adminToken(adminApiKey);
    const res = await this.request(`${await this.baseUrl()}/console/api/datasets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, indexing_technique: indexingTechnique }),
    }, DifyClientService.WRITE_TIMEOUT_MS, '知识库创建');
    if (!res.ok) throw new Error(`创建 Dataset 失败: HTTP ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { id: string };
    return json.id;
  }

  /** ③ 上传文件 → file_id */
  async uploadFile(adminApiKey: string, file: Buffer, filename: string): Promise<string> {
    const token = await this.adminToken(adminApiKey);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file)], { type: 'text/plain' }), filename);
    const res = await this.request(`${await this.baseUrl()}/console/api/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }, DifyClientService.WRITE_TIMEOUT_MS, '文件上传');
    if (!res.ok) throw new Error(`上传文件失败: HTTP ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { id: string };
    return json.id;
  }

  /** ④ 创建文档（文件→知识库，Dify 1.9 两步式） */
  async createDocument(
    adminApiKey: string,
    datasetId: string,
    fileId: string,
    name: string,
    indexingTechnique: 'high_quality' | 'economy' = 'economy',
  ): Promise<{ documentId: string; batch: string }> {
    const token = await this.adminToken(adminApiKey);
    const res = await this.request(`${await this.baseUrl()}/console/api/datasets/${datasetId}/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        indexing_technique: indexingTechnique,
        data_source: { info_list: { data_source_type: 'upload_file', file_info_list: { file_ids: [fileId] } } },
        process_rule: { mode: 'automatic' },
        doc_form: 'text_model',
      }),
    }, DifyClientService.WRITE_TIMEOUT_MS, '文档创建');
    if (!res.ok) throw new Error(`创建文档失败: HTTP ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { documents?: Array<{ id: string }>; batch?: string };
    return { documentId: json.documents?.[0]?.id ?? '', batch: json.batch ?? '' };
  }

  /** ⑤ 文档索引状态（waiting/indexing/completed/failed + word_count） */
  async getDocumentStatus(adminApiKey: string, datasetId: string): Promise<Array<{ id: string; name: string; indexing_status: string; word_count?: number }>> {
    const token = await this.adminToken(adminApiKey);
    const documents: Array<{ id: string; name: string; indexing_status: string; word_count?: number }> = [];
    for (let page = 1; ; page++) {
    const res = await this.request(`${await this.baseUrl()}/console/api/datasets/${datasetId}/documents?page=${page}&limit=100`, {
      headers: { Authorization: `Bearer ${token}` },
    }, DifyClientService.READ_TIMEOUT_MS, '文档状态查询');
    if (!res.ok) throw new Error(`查询文档失败: HTTP ${res.status}`);
    const json = (await res.json()) as { has_more?: boolean; data?: Array<{ id: string; name: string; indexing_status: string; word_count?: number }> };
    documents.push(...(json.data ?? []));
    if (!json.has_more) return documents;
    if (!json.data?.length || page >= 1000) throw new Error('文档列表分页异常，请重试');
    }
  }

  /** 文档切片（console API：按文档查 segments，返回列表 + total） */
  async getDocumentSegments(adminApiKey: string, datasetId: string, documentId: string, limit = 20, page = 1): Promise<{ list: Array<{ content: string; position?: number; word_count?: number }>; total: number; page: number; limit: number }> {
    const token = await this.adminToken(adminApiKey);
    const res = await this.request(
      `${await this.baseUrl()}/console/api/datasets/${datasetId}/documents/${documentId}/segments?page=${page}&limit=${limit}`,
      { headers: { Authorization: `Bearer ${token}` } },
      DifyClientService.READ_TIMEOUT_MS,
      '文档切片查询',
    );
    if (!res.ok) throw new Error(`查询切片失败: HTTP ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { data?: Array<{ content: string; position?: number; word_count?: number }>; total?: number };
    return { list: json.data ?? [], total: json.total ?? (json.data?.length ?? 0), page, limit };
  }

  /** 删除文档（console API，级联清理） */
  async deleteDocument(adminApiKey: string, datasetId: string, documentId: string): Promise<void> {
    const token = await this.adminToken(adminApiKey);
    const res = await this.request(`${await this.baseUrl()}/console/api/datasets/${datasetId}/documents/${documentId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }, DifyClientService.WRITE_TIMEOUT_MS, '文档删除');
    if (!res.ok) throw new Error(`删除文档失败: HTTP ${res.status}: ${await res.text()}`);
  }

  /** Called only through the tenant-resource gate. No conversation or robot prompt is sent. */
  async runEvidenceWorkflow(appId: string, query: string, allowedDocuments: string[], user: string) {
    const base = await this.baseUrl();
    const token = await this.ensureAdminToken();
    const keys = await this.request(`${base}/console/api/apps/${encodeURIComponent(appId)}/api-keys`, {
      headers: { Authorization: `Bearer ${token}` },
    }, DifyClientService.READ_TIMEOUT_MS, '读取工作流凭据');
    if (!keys.ok) throw new Error(`工作流凭据不可用 (${keys.status})`);
    const list = await keys.json() as { data?: Array<{ token: string }> };
    const key = list.data?.[0]?.token;
    if (!key) throw new Error('工作流未配置服务凭据');
    const response = await this.request(`${base}/v1/workflows/run`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: { query, allowed_documents: JSON.stringify(allowedDocuments) }, response_mode: 'blocking', user }),
    }, DifyClientService.CHAT_TIMEOUT_MS, '证据工作流');
    if (!response.ok) throw new Error(`证据工作流失败 (${response.status})`);
    const run = await response.json() as { workflow_run_id?: string; data?: { status?: string; outputs?: { evidence?: string } } };
    if (run.data?.status !== 'succeeded' || typeof run.data.outputs?.evidence !== 'string') throw new Error('证据工作流未成功完成');
    const hits: unknown = JSON.parse(run.data.outputs.evidence);
    if (!Array.isArray(hits) || hits.length > 100) throw new Error('证据工作流输出无效');
    return { runId: run.workflow_run_id, hits };
  }

  /** Stateless Agent adapter: no conversation memory or tenant personality is delegated. */
  async runEvidenceAgent(appId: string, query: string, allowedDocuments: string[], user: string) {
    const base = await this.baseUrl();
    const token = await this.ensureAdminToken();
    const keys = await this.request(`${base}/console/api/apps/${encodeURIComponent(appId)}/api-keys`, { headers: { Authorization: `Bearer ${token}` } }, DifyClientService.READ_TIMEOUT_MS, '读取 Agent 凭据');
    if (!keys.ok) throw new Error('Agent 凭据不可用');
    const key = ((await keys.json()) as { data?: Array<{token:string}> }).data?.[0]?.token;
    if (!key) throw new Error('Agent 未配置服务凭据');
    const response = await this.request(`${base}/v1/chat-messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: { allowed_documents: JSON.stringify(allowedDocuments) }, query: `只返回当前问题的授权原文证据。输出 JSON {"evidence":[{"datasetId":"知识库ID","documentId":"文档ID","segmentId":"切片ID","position":1,"content":"原文"}]}。不得生成面向客户的最终回答。允许的文档：${JSON.stringify(allowedDocuments)}。问题：${query}`, user, response_mode: 'blocking' }),
    }, DifyClientService.CHAT_TIMEOUT_MS, 'Agent 证据处理');
    if (!response.ok) throw new Error(`Agent 调用失败 (${response.status})`);
    const result = await response.json() as {answer?:string;message_id?:string};
    const parsed = JSON.parse((result.answer ?? '').replace(/^```(?:json)?\s*|\s*```$/g,''));
    if (!Array.isArray(parsed.evidence) || parsed.evidence.length > 100) throw new Error('Agent 未返回约定的证据格式');
    return { hits: parsed.evidence, runId: result.message_id };
  }

  /** ⑥ App 执行（chat-messages，服务端 API app-key）——同机器人动态知识入口 */
  async runChat(appApiKey: string, query: string, conversationId?: string): Promise<{ answer: string; conversation_id?: string }> {
    const baseUrl = await this.baseUrl();
    try {
      const res = await this.request(`${baseUrl}/v1/chat-messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${appApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: {}, query, response_mode: 'blocking', conversation_id: conversationId, user: 'platform' }),
      }, DifyClientService.CHAT_TIMEOUT_MS, '对话调用');
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        // Dify 业务错误（401 Key 无效 / 404 App 不存在等）→ 提取 message 返回可读信息
        let detail = body;
        try {
          const j = JSON.parse(body);
          if (j?.message) detail = typeof j.message === 'string' ? j.message : JSON.stringify(j.message);
        } catch { /* 非 JSON 保留原文 */ }
        throw new Error(`Dify 调用失败（HTTP ${res.status}）: ${detail.slice(0, 200)}`);
      }
      const json = (await res.json()) as { answer: string; conversation_id?: string };
      return { answer: json.answer, conversation_id: json.conversation_id };
    } catch (e) {
      // 网络不可达等 → 可读信息
      if (e instanceof Error && e.message.startsWith('Dify')) throw e;
      throw new Error(`无法连接 Dify 实例（${baseUrl}）: ${(e as Error).message}`);
    }
  }

  async pipelineNodes(datasetId: string) {
    const pipeline = await this.publishedPipeline(datasetId);
    return { data: pipeline.nodes.filter(n => n.data.type === 'datasource').map(n => ({ id: n.id, ...n.data })) };
  }
  async runFilePipeline(datasetId: string, config: { startNodeId?: string; inputs?: Record<string, unknown> }, content: Buffer, name: string) {
    if (!config.startNodeId) throw new Error('请先绑定已发布的 Dify 知识流水线数据源节点');
    const pipeline = await this.publishedPipeline(datasetId);
    if (!pipeline.nodes.some(n => n.id === config.startNodeId && n.data.type === 'datasource')) throw new Error('数据源节点不属于当前已发布流水线');
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(content)], { type: 'application/octet-stream' }), name);
    const upload = await this.request(`${await this.baseUrl()}/console/api/files/upload`, { method: 'POST', headers: { Authorization: `Bearer ${pipeline.token}` }, body: form }, 60000, '流水线文件上传');
    if (!upload.ok) throw new Error(`流水线文件上传失败 (${upload.status})`);
    const file = await upload.json() as { id: string; name: string; extension: string; mime_type: string; size: number };
    const response = await this.request(`${await this.baseUrl()}/console/api/rag/pipelines/${pipeline.id}/workflows/published/run`, {
      method: 'POST', headers: { Authorization: `Bearer ${pipeline.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: config.inputs ?? {}, datasource_type: 'local_file',
        datasource_info_list: [{ ...file, related_id: file.id, transfer_method: 'local_file' }],
        start_node_id: config.startNodeId, is_preview: false, response_mode: 'blocking' }),
    }, 120000, '知识流水线运行');
    if (!response.ok) throw new Error(`知识流水线运行失败 (${response.status})`);
    const result = await response.json() as { documents?: Array<{ id: string }>; batch?: string };
    if (!result.documents?.[0]?.id) throw new Error('流水线未返回文档标识，需要检查 Dify 版本和运行结果');
    return { documentId: result.documents[0].id, batch: result.batch ?? '' };
  }
  private async publishedPipeline(datasetId: string) {
    // Tenant ownership is checked by callers before entering this console write adapter.
    // Also reject unassigned datasets before obtaining the workspace administrator token.
    const resource = await this.resources.findOne({ where: { datasetId, status: 'ACTIVE' } });
    if (!resource) throw new Error('当前知识库未分配有效的租户资源');
    const token = await this.adminToken();
    const headers = { Authorization: `Bearer ${token}` };
    const base = await this.baseUrl();
    const dataset = await this.request(`${base}/console/api/datasets/${datasetId}`, { headers }, 15000, '读取知识库流水线');
    if (!dataset.ok) throw new Error(`知识库流水线不可用 (${dataset.status})`);
    const { pipeline_id: id } = await dataset.json() as { pipeline_id?: string };
    if (!id) throw new Error('知识库尚未绑定 Dify 流水线');
    const published = await this.request(`${base}/console/api/rag/pipelines/${id}/workflows/publish`, { headers }, 15000, '读取已发布流水线');
    if (!published.ok) throw new Error(`读取已发布流水线失败 (${published.status})`);
    const workflow = await published.json() as { graph?: { nodes?: Array<{ id: string; data: { type: string; [key: string]: unknown } }> } } | null;
    if (!workflow?.graph?.nodes?.length) throw new Error('Dify 知识流水线尚未发布');
    return { id, token, nodes: workflow.graph.nodes };
  }

  private async adminToken(explicit?: string): Promise<string> {
    return explicit || (await this.platformSettings.adminApiKey()) || this.ensureAdminToken();
  }

  /** 所有 Dify 外呼都有硬超时，避免上游无响应时管理台永久显示加载中。 */
  private async request(url: string, init: RequestInit, timeoutMs: number, operation: string): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const name = (error as Error).name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new Error(`Dify ${operation}超时（${Math.ceil(timeoutMs / 1000)} 秒）`);
      }
      throw error;
    }
  }

  async baseUrl(): Promise<string> {
    return ((await this.platformSettings.difyUrl()) || this.fallbackBaseUrl).replace(/\/$/, '');
  }
}
