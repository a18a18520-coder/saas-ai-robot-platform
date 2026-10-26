import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MASKED_SECRET, SecretsService } from '../secrets/secrets.service';
import { ModelConfig } from './model.entity';
import { ModelUsageService, UsageContext, UsageAttempt } from './model-usage.service';

// Official DeepSeek V4 can spend the entire max_tokens budget before returning text.
// Only evidence JSON tasks opt into non-thinking; other providers retain their own defaults.
export function evidenceRequestOptions(baseUrl: string, model: string, enabled = false) {
  try {
    if (enabled && new URL(baseUrl).hostname === 'api.deepseek.com' && ['deepseek-flash', 'deepseek-v4-pro'].includes(model)) return { thinking: { type: 'disabled' } };
  } catch { /* normal configuration validation reports invalid URLs */ }
  return {};
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export interface ModelAttempt { modelId: string; attempt: number; status: 'success' | 'failed'; code?: number; }
export class ModelCallError extends Error { constructor(public code: number) { super(`模型服务调用失败 (${code})`); } }
export const estimateTokens = (text: string) => Buffer.byteLength(text, 'utf8'); // conservative upper bound, includes CJK

@Injectable()
export class ModelsService {
  constructor(@InjectRepository(ModelConfig) private readonly repo: Repository<ModelConfig>, private readonly secrets: SecretsService, private readonly usage: ModelUsageService) {}
  async tenantPolicy(tenantId: string): Promise<{ primaryModelId: string; fallbackModelId: string; rerankModelId: string }> {
    const rows = await this.repo.manager.query('SELECT config FROM tenant_model_policies WHERE tenant_id=$1', [tenantId]);
    return { primaryModelId: '', fallbackModelId: '', rerankModelId: '', ...rows[0]?.config };
  }
  async saveTenantPolicy(tenantId: string, body: { primaryModelId: string; fallbackModelId?: string; rerankModelId?: string }) {
    const tenants = await this.repo.manager.query("SELECT id FROM tenants WHERE id=$1 AND status <> 'DELETED'", [tenantId]);
    if (!tenants.length) throw new NotFoundException('租户不存在');
    const config = { primaryModelId: body.primaryModelId, fallbackModelId: body.fallbackModelId ?? '', rerankModelId: body.rerankModelId ?? '' };
    if (Object.values(config).some(v => typeof v !== 'string') || !config.primaryModelId) throw new BadRequestException('请选择有效的主模型');
    if (config.primaryModelId === config.fallbackModelId) throw new BadRequestException('备用模型不能与主模型相同');
    await this.resolve(config.primaryModelId, tenantId);
    if (config.fallbackModelId) await this.resolve(config.fallbackModelId, tenantId);
    if (config.rerankModelId) await this.resolve(config.rerankModelId, tenantId, 'rerank');
    await this.repo.manager.query('INSERT INTO tenant_model_policies (tenant_id,config) VALUES ($1,$2) ON CONFLICT (tenant_id) DO UPDATE SET config=EXCLUDED.config,updated_at=now()', [tenantId, JSON.stringify(config)]);
    return config;
  }
  private safe(m: ModelConfig) { return { ...m, apiKey: m.apiKey ? MASKED_SECRET : '' }; }
  async list() { return (await this.repo.find({ order: { name: 'ASC' } })).map(m => this.safe(m)); }
  async available(tenantId: string) {
    return (await this.repo.find({ where: { isActive: true } })).filter(m => m.tenantIds.includes(tenantId)).map(m => ({ id: m.id, name: m.name, purpose: m.purpose, contextWindow: m.contextWindow, maxOutputTokens: m.maxOutputTokens, supportsTools: m.supportsTools }));
  }
  async save(body: Partial<ModelConfig>, id?: string) {
    const row = id ? await this.repo.findOne({ where: { id } }) : this.repo.create({ contextWindow: 8192, maxOutputTokens: 1024, timeoutMs: 30000, purpose: 'chat', isActive: true, tenantIds: [], supportsTools: false, apiKey: '' });
    if (!row) throw new NotFoundException('模型不存在');
    for (const key of ['name', 'model', 'baseUrl', 'purpose', 'contextWindow', 'maxOutputTokens', 'timeoutMs', 'tenantIds', 'isActive', 'supportsTools'] as const) {
      if (body[key] !== undefined) (row as any)[key] = body[key];
    }
    if (!row.name?.trim() || !row.model?.trim()) throw new BadRequestException('名称和模型标识不能为空');
    let url: URL;
    try { url = new URL(row.baseUrl); } catch { throw new BadRequestException('服务地址无效'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new BadRequestException('请输入无凭据、参数的 HTTP 服务地址');
    row.baseUrl = row.baseUrl.replace(/\/+$/, '');
    if (!['chat', 'embedding', 'rerank'].includes(row.purpose)) throw new BadRequestException('模型用途无效');
    if (!Array.isArray(row.tenantIds) || row.tenantIds.some(t => typeof t !== 'string' || !t)) throw new BadRequestException('租户授权无效');
    for (const [key, min, max] of [['contextWindow', 2048, 2000000], ['maxOutputTokens', 64, 64000], ['timeoutMs', 1000, 120000]] as const) {
      if (!Number.isInteger(row[key]) || row[key] < min || row[key] > max) throw new BadRequestException(`${key} 超出范围`);
    }
    if (row.maxOutputTokens + 512 >= row.contextWindow) throw new BadRequestException('上下文窗口不足以预留回答');
    if (typeof row.isActive !== 'boolean' || typeof row.supportsTools !== 'boolean') throw new BadRequestException('模型开关无效');
    if (body.apiKey !== undefined && body.apiKey !== MASKED_SECRET) row.apiKey = this.secrets.encrypt(body.apiKey);
    return this.safe(await this.repo.save(row));
  }
  async resolve(id: string, tenantId: string, purpose: ModelConfig['purpose'] = 'chat') {
    const model = await this.repo.findOne({ where: { id, isActive: true } });
    if (!model || !model.tenantIds.includes(tenantId) || model.purpose !== purpose) throw new BadRequestException('模型不可用或未授权给当前租户');
    return model;
  }
  async rerank<T extends { content: string }>(tenantId: string, id: string, query: string, candidates: T[], topK: number, usageContext?: UsageContext): Promise<T[]> {
    if (!candidates.length) return [];
    const model = await this.resolve(id, tenantId, 'rerank');
    const startedAt = new Date();
    let usage: unknown;
    let success = false;
    try {
    const res = await fetch(`${model.baseUrl}/rerank`, { method: 'POST', signal: AbortSignal.timeout(model.timeoutMs),
      headers: { 'Content-Type': 'application/json', ...(model.apiKey ? { Authorization: `Bearer ${this.secrets.decrypt(model.apiKey)}` } : {}) },
      body: JSON.stringify({ model: model.model, query, documents: candidates.map(c => c.content), top_n: topK }),
    });
    const data = await res.json() as { usage?: unknown; results?: Array<{ index: number; relevance_score: number }> };
    usage = data.usage;
    if (!res.ok) throw new Error(`重排服务失败 (${res.status})`);
    if (!Array.isArray(data.results)) throw new Error('重排服务返回格式无效');
    const seen = new Set<number>();
    const result = data.results.filter(r => Number.isInteger(r.index) && candidates[r.index] && !seen.has(r.index) && !!seen.add(r.index)).slice(0, topK).map(r => candidates[r.index]);
    success = true;
    return result;
    } finally {
      if (usageContext) await this.usage.record({ ...usageContext, tenantId, modelId: id, attempt: 1, fallback: false }, startedAt, success, usage);
    }
  }

  async test(id: string) {
    const model = await this.repo.findOne({ where: { id, isActive: true } });
    if (!model) throw new NotFoundException('模型不存在或已停用');
    if (model.purpose !== 'chat') throw new BadRequestException('此测试仅适用于对话模型，请通过索引/重排任务验证其他模型');
    await this.call(model, [{ role: 'user', content: 'Reply OK' }]);
    return { ok: true };
  }
  async generate(tenantId: string, primaryId: string, fallbackId: string | undefined, build: (model: ModelConfig) => Promise<ChatMessage[]>, usageContext?: UsageContext) {
    if (!primaryId) throw new BadRequestException('请先配置机器人对话模型');
    const primary = await this.resolve(primaryId, tenantId);
    const fallback = fallbackId && fallbackId !== primaryId ? await this.resolve(fallbackId, tenantId) : undefined;
    const attempts: ModelAttempt[] = [];
    const deadline = Date.now() + 180000;
    for (const model of [primary, fallback].filter(Boolean) as ModelConfig[]) {
      const messages = await build(model); // recompute for each model's context limit
      const maxAttempts = model.id === primary.id ? 4 : 1;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          if (Date.now() >= deadline) throw new ModelCallError(408);
          // Keep interactive replies bounded even when a platform model was configured
          // with a long batch timeout; retries still follow the configured 3+1 policy.
          const interactiveTimeout = Math.min(model.timeoutMs, usageContext?.operation === 'answer' || usageContext?.operation === 'grounding' ? 30000 : 15000);
          const text = await this.call(model, messages, Math.min(interactiveTimeout, deadline - Date.now()), usageContext ? { ...usageContext, tenantId, modelId: model.id, attempt, fallback: model.id !== primary.id } : undefined);
          attempts.push({ modelId: model.id, attempt, status: 'success' });
          return { text, modelId: model.id, attempts };
        } catch (e) {
          const code = e instanceof ModelCallError ? e.code : e instanceof Error && ['TimeoutError', 'AbortError'].includes(e.name) ? 408 : 503;
          attempts.push({ modelId: model.id, attempt, status: 'failed', code });
          if (attempt < maxAttempts && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, Math.min(250 * 2 ** (attempt - 1), 2000)));
        }
      }
    }
    throw new ServiceUnavailableException({ message: '主备模型均未成功，请稍后重试', attempts });
  }
  private async call(model: ModelConfig, messages: ChatMessage[], timeoutMs = model.timeoutMs, usageContext?: UsageAttempt): Promise<string> {
    const tokens = messages.reduce((n, m) => n + estimateTokens(m.content) + 16, 0);
    if (tokens + model.maxOutputTokens + 256 > model.contextWindow) throw new ModelCallError(413);
    const startedAt = new Date();
    let usage: unknown;
    let success = false;
    try {
    const response = await fetch(`${model.baseUrl}/chat/completions`, {
      method: 'POST', signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
      headers: { 'Content-Type': 'application/json', ...(model.apiKey ? { Authorization: `Bearer ${this.secrets.decrypt(model.apiKey)}` } : {}) },
      body: JSON.stringify({ model: model.model, messages, max_tokens: model.maxOutputTokens, temperature: 0.2, ...evidenceRequestOptions(model.baseUrl, model.model, usageContext?.structuredEvidence) }),
    });
    const data = await response.json() as { usage?: unknown; choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
    usage = data.usage;
    if (!response.ok) throw new ModelCallError(response.status);
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim() || data.choices?.[0]?.finish_reason === 'length') throw new ModelCallError(502);
    success = true;
    return text;
    } finally {
      if (usageContext) await this.usage.record(usageContext, startedAt, success, usage);
    }
  }
}
