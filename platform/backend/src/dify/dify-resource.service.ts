import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DifyClientService } from './dify-client.service';
import { TenantDifyResource } from './tenant-dify-resource.entity';
import { Robot } from '../robots/robot.entity';
import { ConfigService } from '@nestjs/config';
import { MASKED_SECRET, SecretsService } from '../secrets/secrets.service';
import type { Evidence } from '../ai-router/answer.service';

type Segment = { id: string; document_id: string; position: number; content: string; enabled: boolean; status: string };

/** Dify 资源分配（FR-022 平台侧，已落库）：
 * 资源池(App/Workflow) → 按租户分配 → 自动创建 ds-key → 租户侧可见
 */
@Injectable()
export class DifyResourceService {
  private readonly logger = new Logger(DifyResourceService.name);
  private static readonly RETRIEVAL_TIMEOUT_MS = 15_000;

  constructor(
    private readonly difyClient: DifyClientService,
    private readonly config: ConfigService,
    private readonly secrets: SecretsService,
    @InjectRepository(TenantDifyResource) private readonly repo: Repository<TenantDifyResource>,
  ) {}

  async listRobots(tenantId: string) {
    if (!tenantId) throw new BadRequestException('请选择租户');
    return this.repo.manager.find(Robot, { where: { tenantId }, select: { id: true, name: true, difyAppId: true, workflowId: true, status: true } });
  }

  /** 分配资源：租户 + 资源 → 落库 + ds-key 自动创建（密钥即权限）
   * ds-key 基于 Dataset ID 创建（App 场景需传其绑定的 datasetId） */
  async assignToTenant(params: {
    tenantId: string;
    resourceId: string;
    resourceType: 'app' | 'workflow';
    resourceName?: string;
    datasetId?: string;
    bindRobotId?: string;
  }): Promise<TenantDifyResource> {
    const existing = await this.repo.findOne({ where: { tenantId: params.tenantId, resourceId: params.resourceId } });
    if (params.bindRobotId) {
      const robot = await this.repo.manager.findOne(Robot, { where: { id: params.bindRobotId, tenantId: params.tenantId } });
      if (!robot) throw new BadRequestException('机器人不属于所选租户');
      if (!(params.datasetId ?? existing?.datasetId)) throw new BadRequestException('证据工作流必须配置知识库 ID');
    }
    if (existing?.bindRobotId && existing.bindRobotId !== params.bindRobotId) throw new BadRequestException('该资源仍绑定原机器人，请为新机器人分配独立流程');

    let dsKey: string | undefined = existing?.dsKey ? this.secrets.decrypt(existing.dsKey) : undefined;
    // App/Dataset 场景创建 ds-key（基于 datasetId；Workflow 检索走 App 内元数据过滤兜底 A2）
    if (params.resourceType === 'app' && params.datasetId && !dsKey) {
      // 不传 adminKey → ensureAdminToken 自动刷新（token 25min 缓存）
      dsKey = await this.difyClient.createDatasetKey(params.datasetId);
    }

    const row = this.repo.create({
      ...existing,
      tenantId: params.tenantId,
      resourceId: params.resourceId,
      resourceType: params.resourceType,
      resourceName: params.resourceName,
      datasetId: params.datasetId ?? existing?.datasetId,
      dsKey: this.secrets.encrypt(dsKey),
      bindRobotId: params.bindRobotId,
    });
    const saved = params.bindRobotId ? await this.repo.manager.transaction(async manager => {
      const result = await manager.save(TenantDifyResource, row);
      const robot = await manager.findOne(Robot, { where: { id: params.bindRobotId, tenantId: params.tenantId }, lock: { mode: 'pessimistic_write' } });
      if (!robot) throw new BadRequestException('机器人不存在');
      robot.workflowId = params.resourceType === 'workflow' ? params.resourceId : '';
      robot.difyAppId = params.resourceId;
      if (robot.publishedConfig) robot.publishedConfig = { ...robot.publishedConfig, workflowId: robot.workflowId, difyAppId: params.resourceId };
      await manager.save(Robot, robot);
      return result;
    }) : await this.repo.save(row);
    this.logger.log(`租户 ${params.tenantId} 资源 ${params.resourceId} 分配完成${dsKey ? '（ds-key 已创建）' : ''}`);
    return this.redact(saved);
  }

  /** 租户已分配资源列表（租户侧机器人配置下拉数据源） */
  async listByTenant(tenantId: string, includeSecrets = false): Promise<TenantDifyResource[]> {
    const rows = await this.repo.find({ where: { tenantId, status: 'ACTIVE' }, order: { createdAt: 'ASC' } });
    return Promise.all(rows.map((row) => this.protect(row, includeSecrets)));
  }

  /** 全平台分配总览（平台侧 Dify 资源管理页） */
  async listAll(tenantId?: string): Promise<TenantDifyResource[]> {
    const rows = await this.repo.find({ where: tenantId ? { tenantId } : {}, order: { createdAt: 'DESC' } });
    return Promise.all(rows.map((row) => this.protect(row, false)));
  }

  /** 解除分配：检查机器人绑定（有绑定先解绑）→ 移除 */
  async unassign(tenantId: string, resourceId: string): Promise<{ ok: boolean }> {
    const row = await this.repo.findOne({ where: { tenantId, resourceId } });
    if (!row) throw new NotFoundException('40401: 分配记录不存在');
    if (row.bindRobotId) {
      throw new Error('42201: 该资源已绑定机器人，请先解绑机器人');
    }
    await this.repo.delete(row.id);
    this.logger.log(`租户 ${tenantId} 解除资源 ${resourceId}`);
    return { ok: true };
  }

  async retrieveByWorkflow(tenantId: string, robotId: string, appId: string, query: string, documents: Array<{ datasetId: string; documentId: string }>) {
    const resource = await this.repo.findOne({ where: { tenantId, resourceId: appId, resourceType: 'workflow', status: 'ACTIVE', bindRobotId: robotId } });
    if (!resource?.datasetId || !documents.some(d => d.datasetId === resource.datasetId)) throw new Error('当前机器人无证据工作流授权');
    const allowed = documents.filter(d => d.datasetId === resource.datasetId);
    const result = await this.difyClient.runEvidenceWorkflow(appId, query, allowed.map(d => d.documentId), `${tenantId}:${robotId}`);
    const hits: Evidence[] = result.hits.filter((h: any) => h && typeof h.content === 'string' && h.content.trim() && typeof h.segmentId === 'string' && h.segmentId && allowed.some(d => d.datasetId === h.datasetId && d.documentId === h.documentId)) as Evidence[];
    return { hits, runId: result.runId };
  }

  async retrieveByAgent(tenantId: string, robotId: string, appId: string, query: string, documents: Array<{datasetId: string; documentId: string}>) {
    const resource = await this.repo.findOne({where:{tenantId,resourceId:appId,resourceType:'app',status:'ACTIVE',bindRobotId:robotId}});
    if (!resource?.datasetId) throw new Error('当前机器人无 Agent 证据授权');
    const allowed = documents.filter(d=>d.datasetId===resource.datasetId);
    if (!allowed.length) return {hits: [] as Evidence[],runId:undefined};
    const result = await this.difyClient.runEvidenceAgent(appId,query,allowed.map(d=>d.documentId),`${tenantId}:${robotId}`);
    // Agent-generated content is never evidence: read the actual indexed segment by ID.
    const whitelist = (await this.listByTenant(tenantId,true)).filter(r=>r.datasetId===resource.datasetId && r.dsKey);
    const key = whitelist[0]?.dsKey;
    if (!key) throw new Error('Agent 原文校验凭据不可用');
    const base = await this.difyClient.baseUrl();
    const hits: Evidence[]=[];
    for (const candidate of result.hits) {
      if (!allowed.some(d=>d.datasetId===candidate.datasetId && d.documentId===candidate.documentId) || typeof candidate.segmentId !== 'string') continue;
      const res = await fetch(`${base}/v1/datasets/${encodeURIComponent(candidate.datasetId)}/documents/${encodeURIComponent(candidate.documentId)}/segments/${encodeURIComponent(candidate.segmentId)}`,{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000)});
      if (!res.ok) throw new Error('Agent 引用切片无法校验');
      const body = await res.json() as {data?: Segment}; const segment=body.data;
      if (!segment || segment.id!==candidate.segmentId || !segment.enabled || segment.status!=='completed') continue;
      hits.push({datasetId:candidate.datasetId,documentId:candidate.documentId,segmentId:segment.id,position:segment.position,content:segment.content,documentName:'Agent 定位的授权原文',score:1});
    }
    return {hits,runId:result.runId};
  }

  /** Errors remain errors; the caller must never interpret service failure as a knowledge miss. */
  async retrieveByWhitelist(
    whitelist: Array<{ datasetId: string; dsKey: string }>, query: string, topK = 5,
    options: { searchMethod?: string; scoreThreshold?: number; queries?: string[] } = {},
  ): Promise<Evidence[]> {
    const baseUrl = await this.difyClient.baseUrl();
    const results = await Promise.all(whitelist.map(async item => {
      // Preserve the published embedding provider and hybrid weights for each dataset.
      const settingsResponse = await fetch(`${baseUrl}/v1/datasets/${item.datasetId}`, {
        headers: { Authorization: `Bearer ${item.dsKey}` },
        signal: AbortSignal.timeout(DifyResourceService.RETRIEVAL_TIMEOUT_MS),
      });
      if (!settingsResponse.ok) throw new Error(`知识库检索配置读取失败 (${settingsResponse.status})`);
      const settings = await settingsResponse.json() as { retrieval_model_dict?: Record<string, unknown>; retrieval_model?: Record<string, unknown> };
      const published = settings.retrieval_model_dict ?? settings.retrieval_model ?? {};
      const queries = [...new Set([query, ...(options.queries ?? []).filter(q => typeof q === 'string' && q.trim())])].slice(0, 3);
      return Promise.all(queries.map(async searchQuery => {
      const res = await fetch(`${baseUrl}/v1/datasets/${item.datasetId}/retrieve`, {
        method: 'POST', headers: { Authorization: `Bearer ${item.dsKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(DifyResourceService.RETRIEVAL_TIMEOUT_MS),
        body: JSON.stringify({ query: searchQuery, retrieval_model: {
          reranking_enable: false,
          ...published,
          search_method: options.searchMethod ?? published.search_method ?? 'keyword_search', top_k: topK,
          ...(options.scoreThreshold !== undefined ? { score_threshold_enabled: true, score_threshold: options.scoreThreshold } : {}),
        } }),
      });
      if (!res.ok) throw new Error(`知识检索服务失败 (${res.status})`);
      const json = await res.json() as { records?: Array<{ segment?: Partial<Segment> & { document?: { id?: string; name?: string } }; score?: number }> };
      return (json.records ?? []).filter(r => r.segment?.id && r.segment.enabled !== false && (!r.segment.status || r.segment.status === 'completed')).map(r => ({ datasetId: item.datasetId,
        documentId: r.segment?.document_id ?? r.segment?.document?.id ?? '',
        segmentId: r.segment?.id ?? '', documentName: r.segment?.document?.name ?? '',
        content: r.segment?.content ?? '', score: r.score ?? 0, position: r.segment?.position,
      }));
      }));
    }));
    // Fuse rankings, never compare raw scores across queries/datasets. A segment votes once per list.
    const fused = new Map<string, Evidence & { rank: number }>();
    for (const rows of results.flat()) {
      const seen = new Set<string>();
      rows.forEach((row, index) => {
        const key = `${row.datasetId}:${row.documentId}:${row.segmentId}`;
        if (seen.has(key)) return;
        seen.add(key);
        const previous = fused.get(key);
        fused.set(key, { ...(previous ?? row), rank: (previous?.rank ?? 0) + 1 / (60 + index + 1) });
      });
    }
    return [...fused.values()].sort((a, b) => b.rank - a.rank).slice(0, topK).map(({ rank, ...row }) => row);
  }

  /** Only call after document/clearance checks. Read adjacent original sentences from the same document. */
  async expandSentenceContext(whitelist: Array<{ datasetId: string; dsKey: string }>, hits: Evidence[]): Promise<Evidence[]> {
    const baseUrl = await this.difyClient.baseUrl();
    const cache = new Map<string, Promise<{ data: Segment[]; total: number }>>();
    return Promise.all(hits.map(async hit => {
      const credential = whitelist.find(w => w.datasetId === hit.datasetId);
      if (!credential || !Number.isInteger(hit.position) || hit.position! < 1 || hit.content.length >= 1000) return hit;
      const getPage = (page: number) => {
        const path = `/v1/datasets/${hit.datasetId}/documents/${hit.documentId}/segments?limit=100&page=${page}`;
        if (!cache.has(path)) cache.set(path, (async () => {
          const response = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${credential.dsKey}` }, signal: AbortSignal.timeout(DifyResourceService.RETRIEVAL_TIMEOUT_MS) });
          if (!response.ok) throw new Error(`切片上下文读取失败 (${response.status})`);
          const result = await response.json() as { data: Segment[]; total: number };
          if (!Array.isArray(result.data) || !Number.isInteger(result.total)) throw new Error('切片上下文格式无效');
          return result;
        })());
        return cache.get(path)!;
      };
      // Position can have gaps after edits/deletions. Locate by ID, using ordered pages rather than treating position as offset.
      let page = Math.floor((hit.position! - 1) / 100) + 1;
      let result = await getPage(page);
      let low = 1, high = Math.max(1, Math.ceil(result.total / 100));
      let index = result.data.findIndex(s => s.id === hit.segmentId);
      while (index < 0 && low <= high) {
        if (result.data.length && result.data[0].position <= hit.position! && result.data.at(-1)!.position >= hit.position!) throw new Error('命中切片已变更，请重试检索');
        if (page <= high && result.data.length && result.data.at(-1)!.position < hit.position!) low = page + 1;
        else high = Math.min(high, page - 1);
        if (low > high) throw new Error('命中切片已变更，请重试检索');
        page = Math.floor((low + high) / 2);
        result = await getPage(page);
        index = result.data.findIndex(s => s.id === hit.segmentId);
      }
      if (index < 0) throw new Error('命中切片已变更，请重试检索');
      const before = index < 8 && page > 1 ? (await getPage(page - 1)).data : [];
      const after = index + 8 >= result.data.length && page < Math.ceil(result.total / 100) ? (await getPage(page + 1)).data : [];
      const all = [...before, ...result.data, ...after];
      index += before.length;
      const valid = (s: Segment) => s.document_id === hit.documentId && s.enabled === true && s.status === 'completed';
      if (!valid(all[index]) || all[index].content !== hit.content) throw new Error('命中切片已变更，请重试检索');
      const selected = [all[index]];
      let length = hit.content.length;
      // Stop at unavailable segments; never bridge a disabled sentence into a continuous quote.
      for (const direction of [-1, 1]) {
        for (let offset = 1; offset <= 8; offset++) {
          const adjacent = all[index + direction * offset];
          if (!adjacent || !valid(adjacent) || length + adjacent.content.length > 1400) break;
          direction < 0 ? selected.unshift(adjacent) : selected.push(adjacent);
          length += adjacent.content.length + 1;
        }
      }
      return { ...hit, content: selected.map(s => s.content).join('\n'), contextSegmentIds: selected.map(s => s.id), contextSegments: selected.map(s => ({ id: s.id, content: s.content })) };
    }));
  }

  /** Supplemental literal recall over explicitly authorized documents, using the same Dify sentence IDs. */
  async retrieveLiteralSentences(whitelist: Array<{ datasetId: string; dsKey: string }>, documents: Array<{ datasetId: string; documentId: string; documentName: string }>, keywords: string[]): Promise<Evidence[]> {
    const baseUrl = await this.difyClient.baseUrl();
    const jobs = documents.flatMap(document => keywords.slice(0, 4).map(keyword => ({ document, keyword })));
    const results: Evidence[][] = new Array(jobs.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
      while (next < jobs.length) {
        const index = next++;
        const { document, keyword } = jobs[index];
        const credential = whitelist.find(w => w.datasetId === document.datasetId);
        if (!credential) { results[index] = []; continue; }
        const params = new URLSearchParams({ keyword, limit: '8', page: '1', status: 'completed' });
        const response = await fetch(`${baseUrl}/v1/datasets/${document.datasetId}/documents/${document.documentId}/segments?${params}`, {
          headers: { Authorization: `Bearer ${credential.dsKey}` }, signal: AbortSignal.timeout(DifyResourceService.RETRIEVAL_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`原文检索失败 (${response.status})`);
        const body = await response.json() as { data: Segment[] };
        if (!Array.isArray(body.data)) throw new Error('原文检索格式无效');
        results[index] = body.data.filter(s => s.document_id === document.documentId && s.enabled && s.status === 'completed' && s.content.toLowerCase().includes(keyword.toLowerCase())).map(s => ({
          ...document, segmentId: s.id, position: s.position, content: s.content, score: 0,
        }));
      }
    }));
    // Round robin across keywords/documents prevents one frequent word from monopolizing candidates.
    const dedup = new Map<string, Evidence>();
    for (let rank = 0; rank < 8; rank++) for (const rows of results) {
      const hit = rows[rank];
      if (hit) dedup.set(`${hit.datasetId}:${hit.documentId}:${hit.segmentId}`, hit);
    }
    return [...dedup.values()].slice(0, 20);
  }

  private async protect(row: TenantDifyResource, includeSecret: boolean): Promise<TenantDifyResource> {
    if (row.dsKey && !this.secrets.isEncrypted(row.dsKey)) {
      row.dsKey = this.secrets.encrypt(row.dsKey);
      await this.repo.save(row);
    }
    if (includeSecret) return { ...row, dsKey: this.secrets.decrypt(row.dsKey) } as TenantDifyResource;
    return this.redact(row);
  }

  private redact(row: TenantDifyResource): TenantDifyResource {
    return { ...row, dsKey: row.dsKey ? MASKED_SECRET : undefined } as TenantDifyResource;
  }
}
