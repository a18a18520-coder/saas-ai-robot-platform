import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Like, MoreThanOrEqual, Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';
import { randomBytes } from 'crypto';

/** 审计服务（FR-015）：全链路写入 + 租户/平台查询 */
@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>) {}

  /** AI 调用审计埋点（AI Router 调用） */
  async log(params: {
    tenantId: string;
    robotId?: string;
    userId?: string;
    channelUserId?: string;
    question: string;
    datasetHits?: unknown[];
    toolCalls?: unknown[];
    result: string;
    answer?: string;
    durationMs?: number;
    stages?: Array<{ name: string; durationMs: number; result: string }>;
  }): Promise<AuditLog> {
    return this.repo.save(this.repo.create({
      ...params,
      traceId: randomBytes(6).toString('hex'),
      durationMs: params.durationMs ?? 0,
    }));
  }

  /** 租户侧查询（筛选：结果类型/时间） */
  async listTenant(tenantId: string, opts?: { result?: string; keyword?: string; robotId?: string; hours?: number; limit?: number }): Promise<AuditLog[]> {
    const where: Record<string, unknown> = { tenantId };
    if (opts?.result) where.result = opts.result;
    if (opts?.robotId) where.robotId = opts.robotId;
    if (opts?.keyword) where.question = ILike(`%${opts.keyword}%`);
    if (opts?.hours) where.createdAt = MoreThanOrEqual(new Date(Date.now() - opts.hours * 3600 * 1000));
    return this.repo.find({ where, order: { createdAt: 'DESC' }, take: opts?.limit ?? 50 });
  }

  /** 操作日志独立查询，避免仅有“操作日志”权限的账号读取 AI 审计内容。 */
  async listTenantOperations(tenantId: string, limit = 100): Promise<AuditLog[]> {
    return this.repo.find({
      where: { tenantId, question: Like('[%') },
      order: { createdAt: 'DESC' },
      take: Math.min(200, Math.max(1, limit)),
    });
  }

  /** 平台侧全租户查询（FR-021） */
  async listAll(tenantId?: string, result?: string, limit = 100): Promise<AuditLog[]> {
    const where: Record<string, unknown> = {};
    if (tenantId) where.tenantId = tenantId;
    if (result) where.result = result;
    return this.repo.find({ where, order: { createdAt: 'DESC' }, take: limit });
  }
}
