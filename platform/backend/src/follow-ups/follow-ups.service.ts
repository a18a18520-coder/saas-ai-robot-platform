import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { createHash } from 'node:crypto';
import { KnowledgeBase } from '../knowledge/knowledge-base.entity';
import { IngestionJob } from '../knowledge/ingestion.entity';
import { IngestionService } from '../knowledge/ingestion.service';
import { Robot } from '../robots/robot.entity';
import { AuditService } from '../audit/audit.service';
import { FollowUp } from './follow-up.entity';
import { Notification } from '../notifications/notification.entity';

/** 待跟进队列（FR-016）：AI 未命中 → 入队 → 运营跟进关闭 */
@Injectable()
export class FollowUpsService {
  private readonly logger = new Logger(FollowUpsService.name);

  constructor(
    @InjectRepository(FollowUp) private readonly repo: Repository<FollowUp>,
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    @InjectRepository(KnowledgeBase) private readonly kbs: Repository<KnowledgeBase>,
    @InjectRepository(IngestionJob) private readonly jobs: Repository<IngestionJob>,
    @InjectRepository(Robot) private readonly robots: Repository<Robot>,
    private readonly ingestion: IngestionService,
    private readonly audit: AuditService,
  ) {}

  /** 入队（AI Router 未命中时调用），并生成转人工通知 */
  async enqueue(params: {
    tenantId: string;
    robotId?: string;
    channel: string;
    chatId?: string;
    channelUserId: string;
    question: string;
    delivery?: FollowUp['delivery'];
  }): Promise<FollowUp> {
    const item = await this.repo.save(this.repo.create({ ...params, status: 'pending' }));
    this.logger.log(`待跟进入队: 租户=${params.tenantId.slice(0, 8)}… 渠道=${params.channel} 问题=${params.question.slice(0, 30)}`);
    // 转人工通知（通知中心 5 类型之一，真实生成）
    await this.notifications.save(this.notifications.create({
      tenantId: params.tenantId,
      type: 'handoff',
      title: '转人工新事件',
      content: `「${params.question.slice(0, 40)}」未命中知识库，已入待跟进队列`,
      link: '/t/follow-ups',
    })).catch((e) => this.logger.warn(`转人工通知失败: ${(e as Error).message}`));
    return item;
  }

  /** 列表（按状态筛选） */
  async list(tenantId: string, status?: string, limit = 100) {
    const where: Record<string, unknown> = { tenantId };
    if (status && ['pending', 'followed', 'closed'].includes(status)) where.status = status;
    const items = await this.repo.find({ where, order: { createdAt: 'DESC' }, take: limit });
    const ids = items.flatMap(item => item.resolution?.jobId ? [item.resolution.jobId] : []);
    const jobs = ids.length ? await this.jobs.find({ where: { tenantId, id: In(ids) } }) : [];
    return items.map(item => { const job = jobs.find(j => j.id === item.resolution?.jobId); return { ...item, knowledge: job ? { status: job.status, error: job.error, documentId: job.documentId } : undefined }; });
  }

  async targets(tenantId: string, id: string) {
    const item = await this.repo.findOne({ where: { tenantId, id } });
    if (!item) throw new NotFoundException('待跟进记录不存在');
    const robot = item.robotId ? await this.robots.findOne({ where: { tenantId, id: item.robotId } }) : null;
    const pool = (robot?.publishedConfig?.kbPool ?? robot?.kbPool ?? []) as string[];
    if (!pool.length) return [];
    return (await this.kbs.find({ where: { tenantId, datasetId: In(pool) } })).map(kb => ({ id: kb.datasetId, name: kb.name, ready: !!kb.pipelineConfig?.startNodeId }));
  }

  async answer(tenantId: string, id: string, actorId: string, body: { answer: string; note?: string; saveToKnowledge: boolean; datasetId?: string; secLevel?: number }) {
    if (typeof body.answer !== 'string' || !body.answer.trim() || body.answer.length > 20000) throw new BadRequestException('人工回答需为 1–20000 字');
    if (typeof body.saveToKnowledge !== 'boolean') throw new BadRequestException('请选择是否存入知识库');
    if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 2000)) throw new BadRequestException('备注最多 2000 字');
    if (body.saveToKnowledge && (![1, 2, 3].includes(body.secLevel ?? 1) || !(await this.targets(tenantId, id)).some(kb => kb.id === body.datasetId && kb.ready))) throw new BadRequestException('请选择此机器人关联且已配置切片流水线的知识库');
    const saved = await this.repo.manager.transaction(async manager => {
      const item = await manager.findOne(FollowUp, { where: { id, tenantId }, lock: { mode: 'pessimistic_write' } });
      if (!item) throw new NotFoundException('待跟进记录不存在');
      if (['sending', 'uncertain'].includes(item.delivery?.state ?? '')) throw new BadRequestException('群回复正在发送或结果待核对，暂不能修改回答');
      if (item.resolution?.datasetId && body.saveToKnowledge && item.resolution.datasetId !== body.datasetId) throw new BadRequestException('该问答已绑定知识库，请在原知识库中更新，避免多库遗留旧答案');
      const previous = item.resolution?.jobId ? await this.jobs.findOne({ where: { tenantId, id: item.resolution.jobId } }) : null;
      const answer = body.answer.trim();
      let jobId = item.resolution?.jobId;
      let importRevision = item.resolution?.importRevision ?? 0;
      let importedHash = item.resolution?.importedHash;
      if (body.saveToKnowledge) {
        const content = Buffer.from('# 人工确认问答\n\n## 问题\n' + item.question + '\n\n## 回答\n' + answer + '\n');
        const hash = createHash('sha256').update(content).update(String(body.secLevel ?? 1)).digest('hex');
        if (hash !== importedHash) importRevision++;
        const version = importRevision + '-' + hash;
        if (previous && ['queued', 'running', 'indexing', 'uncertain'].includes(previous.status) && previous.sourceVersion !== version) throw new BadRequestException('上一版本入库尚未完成，请先处理入库任务再修订');
        const job = await this.ingestion.enqueue(tenantId, body.datasetId!, '人工问答-' + item.id + '.md', content, body.secLevel ?? 1, item.id, version, manager);
        jobId = job.id;
        importedHash = hash;
      }
      item.resolution = { ...item.resolution, answer, answeredBy: actorId, answeredAt: new Date().toISOString(), saveToKnowledge: body.saveToKnowledge, ...(body.saveToKnowledge ? { datasetId: body.datasetId, jobId, secLevel: body.secLevel ?? 1, importRevision, importedHash } : {}) };
      item.note = body.note?.trim() ?? item.note;
      item.status = 'followed';
      item.updatedAt = new Date();
      return manager.save(FollowUp, item);
    });
    await this.audit.log({ tenantId, robotId: saved.robotId, question: '[待跟进] 人工回答 ' + id, result: body.saveToKnowledge ? '人工回答已提交入库' : '人工回答已保存', answer: '处理账号：' + actorId + (body.saveToKnowledge ? '；知识库：' + body.datasetId : '') }).catch(() => undefined);
    return saved;
  }

  /** 关闭（标记已跟进处理） */
  async close(id: string, tenantId: string, note?: string): Promise<FollowUp | null> {
    const item = await this.repo.findOne({ where: { id, tenantId } });
    if (!item) return null;
    await this.repo.update({ id, tenantId }, { status: 'closed', updatedAt: new Date(), ...(note ? { note } : {}) });
    return this.repo.findOne({ where: { id, tenantId } });
  }
}
