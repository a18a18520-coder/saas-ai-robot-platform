import { checkInput, inputSchema, quotedValues } from '../platform-tools/tool-input';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import { Tool } from '../platform-tools/tool.entity';
import { Robot } from '../robots/robot.entity';
import { Conversation } from '../sessions/conversation.entity';
import { ModelsService } from '../models/models.service';
import { ToolExecutorService } from './tool-executor.service';
import { AnswerService } from './answer.service';
import { renderOutput, renderOutputList } from '../platform-tools/tool-output';

export type ToolFailure = { text: string; needsHandoff: true };
type State = { id: string; toolId: string; hash: string; args: Record<string, unknown>; status: 'collecting' | 'confirm' | 'sending' | 'done' | 'unknown' | 'cancelled'; expires: number; reply?: string; needsHandoff?: boolean };
type Field = { type?: string; title?: string; description?: string; required?: boolean; enum?: unknown[]; minLength?: number; maxLength?: number; minimum?: number; maximum?: number };
const fields = (tool: Tool) => (tool.requestSchema?.properties ?? tool.requestSchema ?? {}) as Record<string, Field>;
const required = (tool: Tool) => Array.isArray(tool.requestSchema?.required) ? tool.requestSchema.required as string[] : Object.keys(fields(tool)).filter(k => fields(tool)[k].required);
const fingerprint = (tool: Tool, robot: Robot) => createHash('sha256').update(JSON.stringify([tool.id, tool.url, tool.method, tool.apiKey, tool.authType, tool.description, tool.requestSchema, tool.responseWhitelist, tool.executionConfig, tool.readOnly, tool.allowedRoles, robot.ragConfig?.systemPrompt, robot.toolIdentifiers])).digest('hex');

/** Durable, conversation-scoped form state. Only the atomic confirmation winner sends HTTP. */
@Injectable()
export class ToolConversationService {
  constructor(@InjectRepository(Tool) private readonly tools: Repository<Tool>, @InjectRepository(Conversation) private readonly conversations: Repository<Conversation>, private readonly models: ModelsService, private readonly executor: ToolExecutorService, private readonly answers?: AnswerService) {}

  private async swap(conversation: Conversation, old: State | null, next: State): Promise<boolean> {
    const rows = await this.conversations.query('WITH changed AS (UPDATE conversations SET tool_state=$1::jsonb WHERE id=$2 AND tenant_id=$3 AND robot_id=$4 AND ended_at IS NULL AND tool_state IS NOT DISTINCT FROM $5::jsonb RETURNING id) SELECT id FROM changed', [JSON.stringify(next), conversation.id, conversation.tenantId, conversation.robotId, old ? JSON.stringify(old) : null]);
    return rows.length === 1;
  }

  async handle(robot: Robot, conversation: Conversation, question: string, whitelist: string[], roles: string[]): Promise<string | ToolFailure | null> {
    if (!robot.ragConfig?.toolsEnabled) return null;
    const current = await this.conversations.findOne({ where: { id: conversation.id, tenantId: robot.tenantId, robotId: robot.id, userId: conversation.userId } });
    if (!current || current.endedAt) return null;
    let old = (current.toolState ?? null) as State | null;
    const ids = (robot.toolIdentifiers ?? []).filter(id => whitelist.includes(id));
    const allowed = ids.length ? (await this.tools.find({ where: { tenantId: robot.tenantId, identifier: In(ids), isActive: true } })).filter(t => t.allowedRoles.some(r => roles.includes(r)) && ((t.readOnly && t.executionConfig?.mode === 'query') || (!t.readOnly && t.executionConfig?.mode === 'submit'))) : [];
    let tool = old ? allowed.find(t => t.id === old!.toolId) : undefined;
    const text = question.trim();
    if (old && !tool && /^确认提交\s/.test(text)) return '当前身份或机器人已无权处理该工具，请联系管理员。';
    if (old?.status === 'sending' && old.expires > Date.now()) return old.reply ?? '请求正在处理中，请稍候；不会重复提交。';
    if (old && ['sending', 'unknown'].includes(old.status)) return { text: old.reply ?? '该请求正在提交或结果尚未确认，请联系工作人员核查；不会重复提交。', needsHandoff: true };
    if (old && text === `确认提交 ${old.id}` && old.status === 'done') return old.reply ?? '该请求已处理，请勿重复提交。';
    if (old && ['collecting', 'confirm'].includes(old.status)) {
      if (!tool || fingerprint(tool, robot) !== old.hash || old.expires < Date.now()) {
        await this.swap(current, old, { ...old, status: 'cancelled', args: {} });
        return '此次操作已过期或配置、权限已变更，请重新说明需求。';
      }
      if (/^(取消|取消提交|取消操作)$/.test(text)) {
        await this.swap(current, old, { ...old, status: 'cancelled', args: {} });
        return '已取消，本次未调用接口。';
      }
      if (old.status === 'confirm' && text === `确认提交 ${old.id}`) {
        const sending: State = { ...old, status: 'sending', reply: '请求已进入提交处理；如长时间没有结果，请联系工作人员核查，勿重复提交。' };
        if (!await this.swap(current, old, sending)) return '该请求已在处理，请勿重复提交。';
        return this.execute(tool!, current, sending, robot);
      }
    }
    if (!allowed.length) return null;
    // A stale confirmation must never become a fresh API request.
    if (/^确认提交\s/.test(text)) return '确认编号无效，请核对本次待提交内容，或重新说明需求。';
    const active = old && ['collecting', 'confirm'].includes(old.status) ? old : null;
    const caseTool = allowed.find(t => t.identifier === 'legal_case_query' && t.executionConfig?.mode === 'query');
    const caseNo = text.match(/\bCAS-[A-Z0-9-]+\b/i)?.[0];
    const decision = caseTool && caseNo
      ? { text: JSON.stringify({ tool: caseTool.identifier, arguments: { keyword: caseNo }, quotes: { keyword: caseNo } }) }
      : await this.models.generate(robot.tenantId, robot.ragConfig.primaryModelId!, robot.ragConfig.fallbackModelId, async () => [
      { role: 'system', content: `你是机器人场景表单助手。机器人规则：${robot.ragConfig?.systemPrompt || robot.description || ''}\n只选择与机器人业务场景相关且在允许列表中的工具。根据客户本轮原话提取字段，不能猜测或补造信息。只输出 JSON {"tool":"标识或null","arguments":{},"quotes":{}}。缺少字段必须继续追问，不能调用接口；优先使用工具声明的缺参提问。调用后只按工具声明的返回格式组织客户可见回答，不泄露未列白名单字段。\n允许接口声明：${JSON.stringify(allowed.map(t => ({ identifier: t.identifier, purpose: t.description, mode: t.executionConfig?.mode ?? 'query', requestFormat: t.executionConfig?.requestFormat, missingParameterPrompt: t.executionConfig?.missingParameterPrompt, responseFormat: t.executionConfig?.responseFormat, schema: t.requestSchema })))}\n当前收集：${JSON.stringify(active ? { tool: tool?.identifier, arguments: active.args } : null)}` },
      { role: 'system', content: '参数只能来自当前会话；每个新增或修改字段都必须在 quotes 中提供本轮原话的连续片段，且包含字段的原始值。缺少字段允许留空，由程序继续追问；不得为了符合 Schema 编造值。正在补参时保持当前工具，话题无关返回 tool:null。业务规则不能跳过客户确认或扩大工具权限。出参声明：' + JSON.stringify(allowed.map(t => ({ identifier: t.identifier, responseSchema: t.executionConfig?.responseSchema, responseWhitelist: t.responseWhitelist, responseTemplate: t.executionConfig?.responseTemplate }))) },
      { role: 'user', content: question },
    ], { robotId: robot.id, operation: 'tool_selection' });
    let choice: { tool?: string; arguments?: Record<string, unknown>; quotes?: Record<string, string> };
    try { choice = JSON.parse(decision.text); } catch { return '未能识别本次操作，请说明需要办理的事项及相关信息。'; }
    if (!choice.tool) return null;
    tool = allowed.find(t => t.identifier === choice.tool);
    if (!tool) return '当前机器人无权调用该接口。';
    if (active && tool.id !== active.toolId) return '请先回复“取消”结束当前信息收集，再发起其他操作。';
    const args = { ...(active?.args ?? {}) };
    const changes = choice.arguments ?? {};
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return '提供的信息格式无效，请按字段重新填写。';
    for (const [key, value] of Object.entries(changes)) {
      if (args[key] === value) continue;
      const f = fields(tool)[key], quote = choice.quotes?.[key];
      if (!f) return `字段“${key}”未声明。`;
      try { checkInput(f, value, f.title || key, true); } catch (e) { return (e as Error).message + '，请重新提供。'; }
      if (typeof quote !== 'string' || !quote || !question.includes(quote) || !quotedValues(value, quote)) return `请明确提供“${f.title || key}”，系统不会代填客户信息。`;
      args[key] = value;
    }
    const missing = checkInput(inputSchema(tool.requestSchema ?? {}), args, '参数', true).map(k => k.replace(/^参数\./, ''));
    const next: State = { id: randomUUID(), toolId: tool.id, hash: fingerprint(tool, robot), args, status: missing.length ? 'collecting' : tool.executionConfig?.mode === 'submit' ? 'confirm' : 'sending', expires: Date.now() + 30 * 60 * 1000 };
    if (!await this.swap(current, old, next)) return '当前会话信息已更新，请根据最新提示继续。';
    if (missing.length) return `${tool.executionConfig?.missingParameterPrompt || `办理“${tool.name}”还需要补充信息。`}\n缺少：${missing.map(k => `${fields(tool!)[k]?.title || k}${fields(tool!)[k]?.description ? `（${fields(tool!)[k].description}）` : ''}`).join('、')}。请补充，或回复“取消”。`;
    if (next.status === 'confirm') return `请确认向“${tool.name}”提交以下信息：\n${Object.entries(args).map(([k, v]) => `${fields(tool!)[k]?.title || k}：${v}`).join('\n')}\n回复“确认提交 ${next.id}”后才会提交；也可修改信息或回复“取消”。`;
    return this.execute(tool, current, next, robot);
  }

  private async execute(tool: Tool, conversation: Conversation, state: State, robot: Robot): Promise<string | ToolFailure> {
    let needsHandoff = false;
    let reply: string, status: State['status'];
    try {
      const evidence = await this.executor.execute(tool, state.args, tool.executionConfig?.mode === 'submit' ? state.id : undefined);
      reply = `${tool.executionConfig?.successMessage || (tool.executionConfig?.mode === 'submit' ? '提交成功。' : '查询结果：')}\n${Object.entries(JSON.parse(evidence[0].content)).map(([k, v]) => `${k}：${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n')}`;
      // Formatting failures must never cause a successful submission to execute again.
      try {
        if (tool.executionConfig?.responseTemplate) reply = tool.executionConfig.responseListPath
          ? renderOutputList(tool.executionConfig.responseTemplate, JSON.parse(evidence[0].content), tool.executionConfig.responseListPath, tool.executionConfig.responseEmptyMessage)
          : renderOutput(tool.executionConfig.responseTemplate, JSON.parse(evidence[0].content));
        else if (tool.executionConfig?.responseFormat && this.answers) {
          const configured = { ...robot, ragConfig: { ...robot.ragConfig, answerMode: 'grounded_summary' as const, systemPrompt: (robot.ragConfig?.systemPrompt ?? '') + '\n本工具回答约束：' + tool.executionConfig.responseFormat } };
          const formatted = await this.answers.answer(configured, conversation, `说明“${tool.name}”本次接口返回的结果。`, evidence, [], [], true);
          if (formatted.grounded !== false && formatted.text) reply = formatted.text;
        }
      } catch { reply += '\n（格式处理未完成，以上为接口实际结果。）'; }
      status = 'done';
    } catch (error) {
      needsHandoff = true;
      const businessFailure = error instanceof Error && error.message === '接口返回业务失败';
      status = businessFailure || tool.executionConfig?.mode !== 'submit' ? 'done' : 'unknown';
      reply = businessFailure ? tool.executionConfig?.failureMessage || '接口未受理本次操作，请核对信息或联系工作人员。' : tool.executionConfig?.mode === 'submit' ? '提交结果尚未确认，请联系工作人员核查；系统不会自动重复提交。' : '接口查询失败，请稍后重新查询。';
    }
    await this.swap(conversation, state, { ...state, args: {}, status, reply, needsHandoff });
    return needsHandoff ? { text: reply, needsHandoff: true } : reply;
  }
}
