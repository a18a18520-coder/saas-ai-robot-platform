import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { WikiGraphService } from '../wiki/wiki-graph.service';
import { ToolConversationService } from './tool-conversation.service';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThan, Repository } from 'typeorm';
import { WikiPage } from '../wiki/wiki.entity';
import { retrieveWikiChapter } from './wiki-chapter-retrieval';
import { requestsSources } from './answer-style';
import { fuseRecallLists, retrievalKeywords } from './retrieval-keywords';
import { KnowledgeFile } from '../knowledge/tenant-knowledge.controller';
import { AnswerService, Evidence } from './answer.service';
import { Robot } from '../robots/robot.entity';
import { Group } from '../groups/group.entity';
import { GroupMember } from '../groups/group-member.entity';
import { Conversation, Message } from '../sessions/conversation.entity';
import { IdentityService } from '../users/identity.service';
import { PermissionService } from '../permissions/permission.service';
import { DifyResourceService } from '../dify/dify-resource.service';
import { AuditService } from '../audit/audit.service';
import { FollowUpsService } from '../follow-ups/follow-ups.service';
import { ContentFilterService } from '../content-filter/content-filter.service';
import { AiQuotaService } from './ai-quota.service';
import { Tenant } from '../tenants/tenant.entity';
import { CollectionService } from './collection.service';

/**
 * AI Router（FR-003 核心）——同机器人动态知识：
 *  消息 → @触发过滤 → 身份解析 → 权限计算 → 候选池∩白名单 → ds-key 并发检索
 *  → 合并 top-k → 切片二次校验 → 回复（未命中转人工钩子）→ 会话写入
 */
@Injectable()
export class AiRouterService {
  private readonly logger = new Logger(AiRouterService.name);

  constructor(
    @InjectRepository(Robot) private readonly robots: Repository<Robot>,
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    @InjectRepository(Conversation) private readonly convs: Repository<Conversation>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(GroupMember) private readonly groupMembers: Repository<GroupMember>,
    private readonly identity: IdentityService,
    private readonly permission: PermissionService,
    private readonly dify: DifyResourceService,
    private readonly audit: AuditService,
    private readonly followUps: FollowUpsService,
    private readonly contentFilter: ContentFilterService,
    private readonly quota: AiQuotaService,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly answers: AnswerService,
    @InjectRepository(KnowledgeFile) private readonly files: Repository<KnowledgeFile>,
    @Inject(ToolConversationService) private readonly toolFlows?: ToolConversationService,
    @Optional() private readonly wikiGraph?: WikiGraphService,
    @Optional() private readonly collection?: CollectionService,
  ) {}

  /** 消息处理主链路（企微回调/Web 消息 → 这里） */
  async handleMessage(params: {
    tenantId: string;
    channel: string;
    channelId?: string;
    channelUserId: string;
    chatId?: string;
    isAtRobot: boolean;
    content: string;
    sourceMessageId?: string;
    conversationId?: string;
    newConversation?: boolean;
    robotId?: string; // 独立单聊：显式指定机器人（非群）
  }, evaluation?: { systemPrompt?: string; capture: (contexts: string[]) => void }) {
    // 租户停用时在任何身份/会话/过滤命中写入前拦截，渠道不回复且数据保持不变。
    const activeTenant = await this.tenants.findOne({ where: { id: params.tenantId, status: 'ACTIVE' } });
    if (!activeTenant) return { processed: false, blocked: true, reason: 'tenant_inactive' };

    // 1) 客服模式维持 @ 触发；已发布的收集模式独立处理普通群消息。
    //    单聊（robotId 直访）跳过群检查——独立机器人用户直接访问
    let group = null;
    if (params.chatId) {
      group = await this.groups.findOne({ where: { tenantId: params.tenantId, channel: params.channel, chatId: params.chatId } });
      if (!group) return { processed: false, reason: 'group_not_bound' };
      if (group.robotId) {
        const draft = await this.robots.findOne({ where: { id: group.robotId, tenantId: params.tenantId } });
        const published = draft ? { ...draft, ...draft.publishedConfig, id: draft.id, tenantId: draft.tenantId } as Robot : null;
        // Inspect the published snapshot only. Editing a draft never changes live triggers.
        if (published?.ragConfig?.mode === 'collector') {
          if (group.status !== 'BOUND') return { processed: false, reason: 'group_not_bound' };
          if (draft!.status !== 'PUBLISHED') return { processed: false, reason: 'robot_not_published' };
          if (params.robotId && params.robotId !== group.robotId) return { processed: false, reason: 'robot_group_mismatch' };
          if (evaluation || !this.collection) return { processed: false, reason: 'collection_unavailable' };
          return { ...await this.collection.ingest(published, group, params), answer: undefined };
        }
      }
      if (!params.isAtRobot) return { processed: false, reason: 'not_at_robot' };
    }

    const inputFilter = await this.contentFilter.filter(params.content, {
      tenantId: params.tenantId, robotId: params.robotId, direction: 'input',
    });
    if (inputFilter.action === 'REJECTED') {
      return { processed: true, blocked: true, answer: '您的消息包含不允许发送的内容，请调整后重试。' };
    }
    const input = inputFilter.text;

    // 链路明细埋点（对齐原型 audit-detail.html：身份→权限→检索→判定）
    const t0 = Date.now();
    const stages: Array<{ name: string; durationMs: number; result: string }> = [];

    // 2) 身份解析（手机号主键/合并）
    const identityResult = await this.identity.resolve({
      tenantId: params.tenantId,
      channel: params.channel,
      channelUserId: params.channelUserId,
      content: input,
    });
    const { user } = identityResult;
    stages.push({ name: '身份解析', durationMs: Date.now() - t0, result: `来源=${identityResult.source} 可信度=${identityResult.confidence}` });

    // 2a) 群成员自动登记 + 群内角色（BR-007：群内角色 > 全局角色）
    let groupRole: string | undefined;
    if (params.chatId && group) {
      let member = await this.groupMembers.findOne({ where: { groupId: group.id, channelUserId: params.channelUserId } });
      if (!member && ['wecom', 'dingtalk', 'feishu'].includes(params.channel)) {
        member = await this.groupMembers.save(this.groupMembers.create({
          groupId: group.id,
          channelUserId: params.channelUserId,
          userId: user.id,
          source: params.channel as 'wecom' | 'dingtalk' | 'feishu',
        }));
      }
      groupRole = member?.groupRoleOverride ?? undefined;
    }

    // 2b) 收到有效 @ 消息就建立会话并记录用户原文。新群尚未绑定机器人时也要
    //     在会话管理中可见，否则首条钉钉消息会因 group_not_bound 提前结束而丢失。
    const conversation = await this.recordInboundMessage({
      tenantId: params.tenantId,
      channel: params.channel,
      channelUserId: params.channelUserId,
      chatId: params.chatId,
      groupId: group?.id,
      robotId: params.robotId ?? group?.robotId ?? undefined,
      userId: user.id,
      content: input,
      conversationId: params.conversationId,
      newConversation: evaluation ? true : params.newConversation,
    });
    if (evaluation) {
      conversation.endedAt = new Date();
      conversation.contextRef = 'Ragas 内部评测（未向渠道发送）';
      await this.convs.update(conversation.id, { endedAt: conversation.endedAt, contextRef: conversation.contextRef });
    }

    // 软删拦截（用户管理删除=DISABLED：留存会话证据，但不执行 AI）
    if (user.status === 'DISABLED') {
      const answer = '该账号已被停用，如有疑问请联系管理员';
      await this.reply(conversation, answer);
      return { processed: true, answer, blocked: true };
    }

    // 待确认/未绑定群不进入权限、额度和 Dify 链路，但会话与用户消息已留存。
    if (group && group.status !== 'BOUND') return { processed: false, reason: 'group_not_bound', conversationId: conversation.id };

    // 3) 权限计算（角色∩部门∩密级，群内角色优先）
    const t1 = Date.now();
    const perm = await this.permission.compute({ tenantId: params.tenantId, user, groupRole });
    stages.push({ name: '权限计算', durationMs: Date.now() - t1, result: `角色=${(perm.roles ?? []).join(',') || '游客'}` });

    // 4) 机器人：优先 robotId（独立单聊）→ 否则群归属
    let robot = null;
    if (params.robotId) {
      robot = await this.robots.findOne({ where: { id: params.robotId, tenantId: params.tenantId } });
    } else if (params.chatId && group?.robotId) {
      robot = await this.robots.findOne({ where: { id: group.robotId, tenantId: params.tenantId } });
    } else {
      return { processed: false, reason: 'no_robot_target' };
    }
    if (!robot || robot.status !== 'PUBLISHED') return { processed: false, reason: 'robot_not_published' };
    if (robot.publishedConfig) robot = { ...robot, ...robot.publishedConfig, id: robot.id, tenantId: robot.tenantId };
    if (robot.ragConfig?.mode === 'collector') return { processed: false, reason: 'collection_requires_bound_group' };
    if (evaluation?.systemPrompt !== undefined) robot.ragConfig = { ...robot.ragConfig, systemPrompt: evaluation.systemPrompt };
    await this.answers.applyTenantModels(robot);
    const enqueueHandoff = async () => {
      if (!robot.humanHandoff?.enabled || evaluation) return undefined;
      const ticket = await this.followUps.enqueue({ tenantId: params.tenantId, robotId: robot.id, channel: params.channel, chatId: params.chatId, channelUserId: params.channelUserId, question: input, delivery: { channelId: params.channelId, conversationId: conversation.id } });
      return ticket.id;
    };

    // 5) 候选池 ∩ 白名单（FR-010 三维交集）
    const candidateKbs = robot.kbPool;
    const whitelistKbs = candidateKbs.filter((kb) => perm.kbWhitelist.includes(kb));
    if (whitelistKbs.length === 0 && !robot.ragConfig?.toolsEnabled) {
      const answer = '权限不足：当前身份无可检索知识库（游客默认最小权限）';
      await this.reply(conversation, answer);
      return { processed: true, answer };
    }

    // 6) 在任何 Dify 外呼前原子预留一次套餐额度，避免并发超卖。
    const quota = await this.quota.consume(params.tenantId);
    if (!quota.allowed) {
      if (quota.reason === 'tenant_inactive') return { processed: false, blocked: true, reason: quota.reason };
      const answer = quota.reason === 'subscription_expired' ? '服务套餐已到期，请联系管理员续费后继续使用。' : '本周期 AI 调用额度已用尽，请联系管理员升级套餐或续费下个周期。';
      await this.audit.log({
        tenantId: params.tenantId,
        robotId: robot.id,
        userId: user.id,
        channelUserId: params.channelUserId,
        question: input,
        result: '额度拒绝',
        answer,
        durationMs: Date.now() - t0,
        stages: [...stages, { name: '套餐额度', durationMs: 0, result: `${quota.used}/${quota.limit} 拒绝` }],
      }).catch(() => undefined);
      await this.reply(conversation, answer);
      return { processed: true, blocked: true, reason: quota.reason, answer };
    }

    if (this.toolFlows && robot.ragConfig?.toolsEnabled && !evaluation) {
      let toolReply: string | { text: string; needsHandoff: true } | null;
      try { toolReply = await this.toolFlows.handle(robot, conversation, input, perm.toolWhitelist ?? [], perm.roles); }
      catch { toolReply = { text: '工具处理暂时未完成，请稍后重试；如已确认提交，请先联系工作人员核查结果。', needsHandoff: true }; }
      if (toolReply !== null) {
        const filtered = await this.contentFilter.filter(typeof toolReply === 'string' ? toolReply : toolReply.text, { tenantId: params.tenantId, robotId: robot.id, direction: 'output' });
        const answer = filtered.action === 'REJECTED' ? '该回复未通过内容检查，请联系工作人员。' : filtered.text;
        await this.reply(conversation, answer);
        await this.audit.log({ tenantId: params.tenantId, robotId: robot.id, userId: user.id, channelUserId: params.channelUserId, question: input, result: typeof toolReply === 'string' ? '工具调用' : '工具失败', answer, durationMs: Date.now() - t0, stages: [...stages, { name: '工具场景', durationMs: 0, result: '按当前会话收集、确认及执行；仅处理机器人绑定且用户授权的接口' }] });
        return { processed: true, answer, handoffId: typeof toolReply === 'string' ? undefined : await enqueueHandoff(), reason: typeof toolReply === 'string' ? 'tool_flow' : 'tool_failed', conversationId: conversation.id };
      }
    }
    // Tool routing already ran above. Evaluations never perform external actions.
    const answerRobot = this.toolFlows || evaluation ? { ...robot, ragConfig: { ...robot.ragConfig, toolsEnabled: false } } : robot;

    // 7) ds-key 白名单并发检索（架构 A1：密钥即权限）
    const assigned = await this.dify.listByTenant(params.tenantId, true);
    const retrieveList = assigned
      .filter((r) => whitelistKbs.some((kb) => r.datasetId === kb))
      .map((r) => ({ datasetId: r.datasetId!, dsKey: r.dsKey ?? '' }))
      .filter((r) => r.dsKey);

    // 8) 二次校验（BR：切片来源 ∈ 白名单——ds-key 已天然保证，双保险）
    const documents = retrieveList.length ? await this.files.find({ where: { tenantId: params.tenantId, datasetId: In(retrieveList.map(r => r.datasetId)) } }) : [];
    // Unknown document provenance is denied; filenames or dataset membership cannot establish clearance.
    const pages = documents.some(d => d.sourceId) ? await this.files.manager.find(WikiPage, { where: { tenantId: params.tenantId } }) : [];
    const wikiAllowed = (sourceId?: string) => {
      let page = pages.find(p => p.id === sourceId);
      if (!page) return true; // normal uploaded file, still guarded by document provenance below
      if (page.status === 'archived') return false;
      const roots = robot.ragConfig?.wikiRootIds;
      if (!roots?.length) return true;
      const seen = new Set<string>();
      while (page && !seen.has(page.id)) {
        if (roots.includes(page.id)) return true;
        seen.add(page.id); page = pages.find(p => p.id === page!.parentId);
      }
      return false;
    };
    const authorizedDocuments = documents.filter(d => retrieveList.some(r => r.datasetId === d.datasetId) && d.difyDocumentId && d.secLevel <= (user.knowledgeClearance ?? 1) && d.isActive !== false && d.syncStatus !== 'revoked' && wikiAllowed(d.sourceId));

    let hits: Evidence[] = [];
    const t2 = Date.now();
    const retrievalQuery = await this.answers.rewrite(robot, conversation, input);
    stages.push({ name: '查询改写', durationMs: 0, result: retrievalQuery });
    let chapterHits: Evidence[] | null = null;
    if (retrieveList.length) {
      try {
        chapterHits = await retrieveWikiChapter(this.files, params.tenantId, retrieveList.map(r => r.datasetId), user.knowledgeClearance ?? 1, robot.ragConfig?.wikiRootIds, retrievalQuery);
        const queries = await this.answers.expandQueries(robot, retrievalQuery);
        stages.push({ name: '检索表达扩展', durationMs: 0, result: JSON.stringify(queries) });
        if (robot.workflowId && authorizedDocuments.length) {
          const runs = await Promise.all(queries.map(query => this.dify.retrieveByWorkflow(params.tenantId, robot.id, robot.workflowId, query, authorizedDocuments.map(d => ({ datasetId: d.datasetId, documentId: d.difyDocumentId! })))));
          hits = fuseRecallLists(runs.map(run => run.hits));
          stages.push({ name: 'Dify 证据工作流', durationMs: Date.now() - t2, result: JSON.stringify({ appId: robot.workflowId, runIds: runs.map(r => r.runId), evidence: hits.length, memory: '平台当前会话', prompt: '平台机器人' }) });
        } else if (robot.difyAppId && assigned.some(r => r.resourceId === robot.difyAppId && r.resourceType === 'app' && r.bindRobotId === robot.id && r.datasetId)) {
          const run = await this.dify.retrieveByAgent(params.tenantId, robot.id, robot.difyAppId, retrievalQuery, authorizedDocuments.map(d => ({datasetId:d.datasetId,documentId:d.difyDocumentId!})));
          hits = run.hits;
          stages.push({name:'Dify Agent 证据处理',durationMs:Date.now()-t2,result:JSON.stringify({runId:run.runId,evidence:hits.length})});
        } else if (!robot.workflowId) {
          hits = await this.dify.retrieveByWhitelist(retrieveList, retrievalQuery, Math.min(20, (robot.ragConfig?.topK ?? 5) * 2), {
            searchMethod: robot.ragConfig?.searchMethod, scoreThreshold: robot.ragConfig?.scoreThreshold, queries,
          });
        }
        // Whole-chapter context is a permission-checked supplement, never a bypass of the workflow or answer model.
        if (chapterHits !== null) hits = chapterHits;

      } catch {
        const answer = '知识检索服务暂时不可用，请稍后重试。';
        await this.reply(conversation, answer);
        await this.audit.log({ tenantId: params.tenantId, robotId: robot.id, question: input, answer, result: '检索服务失败', stages });
        return { processed: true, answer, handoffId: await enqueueHandoff(), reason: 'retrieval_failed', conversationId: conversation.id };
      }
    }
    stages.push({ name: '知识检索', durationMs: Date.now() - t2, result: `ds-key ${retrieveList.length} 个 · 命中 ${hits.length} 切片` });
    if (chapterHits !== null) stages.push({ name: 'Wiki 章节定位', durationMs: 0, result: chapterHits.length ? '使用已发布且已入库的对应章节原文' : '授权范围内未找到唯一章节，请指定文档名称或先发布入库' });

    let safeHits: Evidence[] = hits.filter(h => authorizedDocuments.some(d => d.datasetId === h.datasetId && d.difyDocumentId === h.documentId))
      .map(h => { const d = documents.find(d => d.difyDocumentId === h.documentId)!; return { ...h, sourceId: d.sourceId, sourceVersion: d.sourceVersion }; });
    try {
      if (chapterHits === null) {
        const started = Date.now();
        const keywords = retrievalKeywords(retrievalQuery);
        const literal = await this.dify.retrieveLiteralSentences(retrieveList, authorizedDocuments.map(d => ({ datasetId: d.datasetId, documentId: d.difyDocumentId!, documentName: d.name })), keywords);
        safeHits = fuseRecallLists([safeHits, literal]).map(h => {
          const document = authorizedDocuments.find(d => d.datasetId === h.datasetId && d.difyDocumentId === h.documentId)!;
          return { ...h, sourceId: document.sourceId, sourceVersion: document.sourceVersion };
        });
        stages.push({ name: '原文补充召回', durationMs: Date.now() - started, result: `关键词 ${JSON.stringify(keywords)} · ${literal.length} 条 · 仅授权文档、启用且完成索引的句子` });
        if (this.wikiGraph) {
          const graphHits = await this.wikiGraph.retrieve(params.tenantId, retrievalQuery, authorizedDocuments.filter(d => d.syncStatus === 'completed'), user.knowledgeClearance ?? 1);
          safeHits = fuseRecallLists([safeHits, graphHits]);
          stages.push({ name: 'Wiki 图谱召回', durationMs: 0, result: `最多两跳，返回 ${graphHits.length} 条已授权版本的原文证据` });
        }
        stages.push({ name: '授权召回候选', durationMs: 0, result: JSON.stringify(safeHits.map(h => ({ documentId: h.documentId, segmentId: h.segmentId, score: h.score }))) });
        safeHits = await this.dify.expandSentenceContext(retrieveList, safeHits);
        stages.push({ name: '句子上下文', durationMs: Date.now() - started, result: `同文档相邻原文，${safeHits.reduce((n, h) => n + (h.contextSegmentIds?.length ?? 1), 0)} 个切片引用；不修改索引内容` });
        safeHits = await this.answers.rerank(robot, retrievalQuery, safeHits);
        stages.push({ name: '最终排序', durationMs: Date.now() - started, result: `${robot.ragConfig?.rerankModelId ? `重排模型 ${robot.ragConfig.rerankModelId}` : 'Dify 排序＋原文召回 RRF 融合（未配置独立重排模型）'} · Top ${robot.ragConfig?.topK ?? 5} · 保留 ${safeHits.length} 条` });
      }
    }
    catch {
      const answer = '知识检索或重排服务暂不可用，请稍后重试。';
      await this.reply(conversation, answer);
      return { processed: true, answer, reason: 'rerank_failed', conversationId: conversation.id };
    }
    let generated: Awaited<ReturnType<AnswerService['answer']>> | undefined;
    if (safeHits.length || (!this.toolFlows && !evaluation && robot.ragConfig?.toolsEnabled)) {
      try {
        generated = await this.answers.answer(answerRobot, conversation, input, safeHits, perm.toolWhitelist ?? [], perm.roles);
        stages.push({ name: '机器人回答', durationMs: 0, result: JSON.stringify({ mode: robot.ragConfig?.answerMode ?? 'legacy', modelId: generated.modelId, grounded: generated.grounded, compressed: generated.compressed, conversationId: conversation.id, citationCount: generated.citations.length }) });
      }
      catch (error) {
        const details = typeof (error as any)?.getResponse === 'function' ? (error as any).getResponse() : undefined;
        const message = error instanceof Error ? error.message : '';
        const validationReason = /^(回答|归纳回答|原文|完整章节|可用证据|提示词或问题|身份问题)/.test(message) ? message.slice(0, 240) : undefined;
        stages.push({ name: '生成错误', durationMs: 0, result: JSON.stringify({ type: error instanceof Error ? error.name : 'unknown', reason: validationReason, attempts: details?.attempts ?? [] }) });
        const answer = '回答生成暂未成功，请稍后重试或联系管理员检查模型与上下文配置。';
        await this.reply(conversation, answer);
        await this.audit.log({ tenantId: params.tenantId, robotId: robot.id, question: input, answer, result: '生成失败', stages });
        return { processed: true, answer, handoffId: await enqueueHandoff(), reason: 'generation_failed', conversationId: conversation.id };
      }
    }

    // 9) 回复（命中→摘要；未命中→转人工：入队 + 兜底话术，FR-016）
    const miss = !generated || generated.grounded === false;
    stages.push({ name: '判定', durationMs: Date.now() - t0, result: miss ? '未命中转人工（兜底话术）' : `知识命中（${safeHits.length} 切片）` });
    let answer = miss
      ? (generated?.grounded === false ? generated.text : chapterHits !== null ? '授权知识中未找到唯一的对应章节。请补充文档名称，并确认该章节已发布入库。' : robot.humanHandoff.fallback)
      : generated!.text;
    if (!miss && robot.ragConfig?.answerMode === 'grounded_summary' && !requestsSources(input)) {
      // Keep the full citation metadata in the session, but show customers only the conclusion.
      answer = answer.replace(/\[\d+\]/g, '');
    } else if (!miss && generated?.citations.length) {
      answer += '\n\n来源：\n' + generated.citations.map(c => `[${c.number}] ${c.title}`).join('\n');
    }
    const outputFilter = await this.contentFilter.filter(answer, {
      tenantId: params.tenantId, robotId: robot.id, direction: 'output',
    });
    answer = outputFilter.action === 'REJECTED'
      ? '该回复未能通过内容安全检查，请联系管理员或稍后重试。'
      : outputFilter.text;

    await this.appendMessage(conversation, 'assistant', answer, { citations: generated?.citations ?? [], attempts: generated?.attempts ?? [], compressed: generated?.compressed ?? false });

    // 9b) 未命中 → 待跟进队列（运营人工跟进闭环）
    let handoffId: string | undefined;
    if (miss && robot.humanHandoff.enabled && !evaluation) {
      const ticket = await this.followUps.enqueue({
        tenantId: params.tenantId,
        robotId: robot.id,
        channel: params.channel,
        chatId: params.chatId,
        channelUserId: params.channelUserId,
        question: input,
        delivery: { channelId: params.channelId, conversationId: conversation.id },
      }).catch((e) => this.logger.warn(`待跟进入队失败: ${(e as Error).message}`));
      handoffId = ticket ? ticket.id : undefined;
    }

    // 审计埋点（FR-015 全链路）
    await this.audit.log({
      tenantId: params.tenantId,
      robotId: robot.id,
      userId: user.id,
      channelUserId: params.channelUserId,
      question: input,
      datasetHits: safeHits.map((h) => ({ datasetId: h.datasetId, documentId: h.documentId, segmentId: h.segmentId, contextSegmentIds: h.contextSegmentIds, documentName: h.documentName, content: h.content, score: h.score })),
      result: miss ? '证据不足' : '知识命中',
      answer,
      durationMs: Date.now() - t0,
      stages,
    });

    evaluation?.capture(generated?.contexts ?? safeHits.map(h => h.content));
    return { processed: true, answer, handoffId, hits: safeHits.length, roles: perm.roles, conversationId: conversation.id, citations: generated?.citations ?? [], attempts: generated?.attempts ?? [] };
  }

  /** 会话写入（五层模型：tenant/robot/group/user/conversation，群内按 user 隔离） */
  private async recordInboundMessage(params: {
    tenantId: string;
    channel: string;
    channelUserId: string;
    chatId?: string;
    groupId?: string;
    robotId?: string;
    userId: string;
    content: string;
    conversationId?: string;
    newConversation?: boolean;
  }): Promise<Conversation> {
    const scope = { tenantId: params.tenantId, robotId: params.robotId ?? 'pending', userId: params.userId,
      channel: params.channel, groupId: params.groupId ?? params.chatId ?? IsNull(), endedAt: IsNull() };
    let conv: Conversation | null = null;
    if (params.conversationId && !params.newConversation) {
      conv = await this.convs.findOne({ where: { ...scope, id: params.conversationId } });
      if (!conv) throw new BadRequestException('会话不存在、已结束或不属于当前身份和机器人');
    } else if (!params.newConversation && params.channel !== 'web') {
      // IM channels resume only the same robot/user/channel scope with a 30-minute idle boundary.
      conv = await this.convs.findOne({ where: { ...scope, updatedAt: MoreThan(new Date(Date.now() - 30 * 60 * 1000)) }, order: { updatedAt: 'DESC' } });
    }
    if (!conv) conv = await this.convs.save(this.convs.create({
      tenantId: params.tenantId, robotId: params.robotId ?? 'pending', userId: params.userId,
      channel: params.channel, groupId: params.groupId ?? params.chatId,
    }));
    await this.appendMessage(conv, 'user', params.content);
    return conv;
  }

  private async reply(conv: Conversation, content: string, hits?: unknown[]) {
    await this.appendMessage(conv, 'assistant', content);
    return { conv, hits };
  }

  private async appendMessage(conv: Conversation, role: Message['role'], content: string, metadata: Record<string, unknown> = {}): Promise<void> {
    await this.messages.save(this.messages.create({ conversationId: conv.id, role, content, metadata }));
    // updated_at 不是 TypeORM UpdateDateColumn，因此每条新消息都显式刷新会话活跃时间。
    conv.updatedAt = new Date();
    await this.convs.save(conv);
  }
}
