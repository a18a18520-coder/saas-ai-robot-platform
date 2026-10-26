import { inputSchema, validateInputSchema } from './tool-input';
import { createHash } from 'crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { ToolExecutorService } from '../ai-router/tool-executor.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tool } from './tool.entity';
import { MASKED_SECRET, SecretsService } from '../secrets/secrets.service';
import { validateOutputSchema } from './tool-output';

/** 工具管理（FR-025 平台侧）——全租户工具 + 为租户新增 + 生命周期 */
@Injectable()
export class PlatformToolsService {
  constructor(
    @InjectRepository(Tool) private readonly repo: Repository<Tool>,
    private readonly secrets: SecretsService,
    @Optional() private readonly executor?: ToolExecutorService,
  ) {}

  /** 全租户工具列表（按租户筛选） */
  async list(tenantId?: string): Promise<Tool[]> {
    const rows = await this.repo.find({ where: tenantId ? { tenantId } : {}, order: { createdAt: 'DESC' } });
    return Promise.all(rows.map((row) => this.protectAndRedact(row)));
  }

  /** 平台侧为租户新增工具（自动归属租户，租户侧外部接口即时可见） */
  async createForTenant(data: Partial<Tool>): Promise<Tool> {
    this.validateExecution(data);
    const tool = this.repo.create({ ...data, apiKey: this.secrets.encrypt(data.apiKey) });
    return this.redact(await this.repo.save(tool));
  }

  /** 工具配置更新（传值 schema / 输出白名单 / 认证 / 角色 —— 对齐 tool-config 原型） */
  async update(id: string, data: Partial<Tool>, tenantId?: string): Promise<Tool> {
    return this.repo.manager.transaction(async manager => {
    const repo = manager.getRepository(Tool);
    const tool = await repo.findOne({ where: tenantId ? { id, tenantId } : { id }, lock: { mode: 'pessimistic_write' } });
    if (!tool) throw new NotFoundException('40401: 工具不存在');
    if (data.configRevision !== undefined && data.configRevision !== this.revision(tool)) throw new ConflictException('工具配置已被其他操作更新。请保留当前修改内容，关闭后重新打开配置再保存。');
    // 仅允许更新配置字段（标识/归属不可改，避免引用失效）
    const allowed = ['name', 'description', 'method', 'url', 'authType', 'apiKey', 'requestSchema', 'responseWhitelist', 'allowedRoles', 'isActive', 'readOnly', 'executionConfig'] as const;
    for (const k of allowed) {
      if (k === 'apiKey') {
        if (data.apiKey !== undefined && data.apiKey !== MASKED_SECRET) tool.apiKey = this.secrets.encrypt(data.apiKey);
      } else if (k === 'executionConfig' && data.executionConfig) {
        tool.executionConfig = { ...tool.executionConfig, ...data.executionConfig };
      } else if (k in data) {
        (tool as unknown as Record<string, unknown>)[k] = data[k];
      }
    }
    this.validateExecution(tool);
    return this.redact(await repo.save(tool));
    });
  }

  private validateExecution(tool: Partial<Tool>) {
    const rule = tool.executionConfig;
    if (rule?.responseSchema) {
      validateOutputSchema(rule.responseSchema);
      if (rule.responseSchema.type !== 'object' || Object.keys(rule.responseSchema.properties as object).some(k => !tool.responseWhitelist?.includes(k))) throw new BadRequestException('出参需为对象，所有顶层字段须列入返回白名单');
    }
    if (rule?.responseTemplate !== undefined) {
      if (typeof rule.responseTemplate !== 'string' || rule.responseTemplate.length > 4000) throw new BadRequestException('回答模板最多 4000 字');
      if (rule.responseListPath && (typeof rule.responseListPath !== 'string' || !tool.responseWhitelist?.includes(rule.responseListPath.split('.')[0]) || rule.responseListPath.split('.').some(k => ['__proto__', 'constructor', 'prototype'].includes(k)))) throw new BadRequestException('列表路径须在返回白名单中');
      for (const match of rule.responseTemplate.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) if (!(rule.responseListPath && match[1].startsWith('item.')) && !tool.responseWhitelist?.includes(match[1].split('.')[0])) throw new BadRequestException('回答模板只能引用返回白名单字段');
    }
    if (!rule?.mode) return; // Existing drafts stay disabled until explicitly configured.
    if (!['query', 'submit'].includes(rule.mode)) throw new BadRequestException('工具类型无效');
    if (!tool.description?.trim()) throw new BadRequestException('请声明接口用途及适用场景');
    if (rule.mode === 'query' && !tool.readOnly) throw new BadRequestException('查询工具须声明为只读');
    if (rule.mode === 'submit' && tool.readOnly) throw new BadRequestException('提交工具不能标记为只读');
    if (!(rule.mode === 'submit' ? ['POST', 'PUT'] : ['GET', 'POST']).includes(tool.method ?? 'POST')) throw new BadRequestException('查询支持 GET/POST，提交支持 POST/PUT');
    try { const url = new URL(tool.url ?? ''); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error(); } catch { throw new BadRequestException('接口地址须为 HTTP/HTTPS，凭据请单独配置'); }
    if (!Array.isArray(tool.responseWhitelist) || !tool.responseWhitelist.length || tool.responseWhitelist.some(k => typeof k !== 'string' || !k || ['__proto__', 'constructor', 'prototype'].includes(k))) throw new BadRequestException('请配置有效的返回字段白名单');
    if (rule.mode === 'submit' && (!rule.successField || rule.successValue === undefined)) throw new BadRequestException('提交接口必须声明业务成功字段及对应值');
    for (const key of ['requestFormat', 'responseFormat', 'missingParameterPrompt'] as const) if (rule[key] !== undefined && (typeof rule[key] !== 'string' || rule[key].length > 2000)) throw new BadRequestException('工具格式约束最多 2000 字');
    if (rule.successField && (!tool.responseWhitelist.includes(rule.successField) || !['string', 'number', 'boolean'].includes(typeof rule.successValue))) throw new BadRequestException('成功字段须在返回白名单中，成功值须为字符串、数字或布尔值');
    try { validateInputSchema(inputSchema(tool.requestSchema ?? {})); } catch (e) { throw new BadRequestException('入参声明无效：' + (e as Error).message); }
  }

  async findOne(id: string, tenantId?: string): Promise<Tool> {
    return this.protectAndRedact(await this.findStored(id, tenantId));
  }

  async test(id: string, args: Record<string, unknown>, tenantId?: string) {
    const tool = await this.findStored(id, tenantId);
    this.validateExecution(tool);
    if (!this.executor) throw new BadRequestException('工具执行服务未就绪');
    if (!tool.executionConfig?.mode) throw new BadRequestException('请先配置工具调用方式');
    try {
      const validationOnly = tool.executionConfig?.mode === 'submit';
      const results = await this.executor.execute(tool, args, undefined, validationOnly);
      return { ok: true, validationOnly, message: validationOnly ? '参数与配置校验通过，未向提交接口发送请求。请通过机器人会话确认后联调。' : '已实际请求保存的查询接口，以下为返回的白名单字段。', data: results[0] ? JSON.parse(results[0].content) : null };
    } catch { throw new BadRequestException('接口测试未通过，请检查已保存的参数、认证、返回字段及业务成功规则。'); }
  }

  /** 工具生命周期（禁用/删除 + 正反向验证在 controller 校验） */
  async setActive(id: string, isActive: boolean, tenantId?: string): Promise<Tool> {
    const tool = await this.findStored(id, tenantId);
    await this.repo.update({ id: tool.id, tenantId: tool.tenantId }, { isActive });
    return this.redact(await this.findStored(id, tenantId));
  }

  async remove(id: string, tenantId?: string): Promise<{ cascade: string }> {
    const tool = await this.findStored(id, tenantId);
    await this.repo.delete(id);
    return { cascade: '机器人绑定/角色授权已清理（Tool Gateway 引用随工具删除失效）' };
  }

  /** Internal gateway access only; never expose this return value from a controller. */
  async credential(id: string): Promise<string | undefined> {
    const tool = await this.repo.findOne({ where: { id } });
    if (!tool) throw new NotFoundException('40401: 工具不存在');
    return this.secrets.decrypt(tool.apiKey);
  }

  private async protectAndRedact(tool: Tool): Promise<Tool> {
    if (tool.apiKey && !this.secrets.isEncrypted(tool.apiKey)) {
      const previous = tool.apiKey;
      tool.apiKey = this.secrets.encrypt(previous);
      await this.repo.update({ id: tool.id, apiKey: previous }, { apiKey: tool.apiKey });
    }
    return this.redact(tool);
  }

  private async findStored(id: string, tenantId?: string): Promise<Tool> {
    const tool = await this.repo.findOne({ where: tenantId ? { id, tenantId } : { id } });
    if (!tool) throw new NotFoundException('40401: 工具不存在');
    return tool;
  }

  private revision(tool: Tool): string {
    const keys = ['name', 'description', 'method', 'url', 'authType', 'apiKey', 'requestSchema', 'responseWhitelist', 'allowedRoles', 'isActive', 'readOnly', 'executionConfig'] as const;
    const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
    return createHash('sha256').update(JSON.stringify(keys.map(k => canonical(tool[k] ?? null)))).digest('hex');
  }

  private redact(tool: Tool): Tool {
    return { ...tool, configRevision: this.revision(tool), apiKey: tool.apiKey ? MASKED_SECRET : undefined } as Tool;
  }
}
