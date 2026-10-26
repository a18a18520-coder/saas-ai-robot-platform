import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { AuthPayload } from '../auth/auth.service';
import { Tenant } from '../tenants/tenant.entity';
import { TenantAccount } from '../tenants/tenant-account.entity';
import { Group } from '../groups/group.entity';
import { Robot } from '../robots/robot.entity';
import { CollectionService } from '../ai-router/collection.service';
import { CollectionRecord } from '../robots/collection-record.entity';
import { CollectorBinding, CollectorDevice, CollectorMessage } from './collector.entity';

export function collectorText(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw new BadRequestException(`${label}无效`);
  return value.trim();
}
function collectorUuid(value: unknown, label: string) {
  const id = collectorText(value, label, 36);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new BadRequestException(`${label}无效`);
  return id;
}
export function collectorPayload(body: any) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('消息格式无效');
  const sourceMessageId = collectorText(body.sourceMessageId, '消息 ID', 128);
  if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(sourceMessageId)) throw new BadRequestException('消息 ID 无效');
  const bindingId = collectorUuid(body.bindingId, '会话绑定');
  const senderNickname = collectorText(body.senderNickname, '发送人昵称', 128);
  if (typeof body.isSelf !== 'boolean' || !['visual_layout', 'manual_review'].includes(body.identitySource)) throw new BadRequestException('发送人归属未经确认');
  if (typeof body.content !== 'string' || !body.content.trim() || body.content.length > 20000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(body.content)) throw new BadRequestException('消息正文无效');
  const capturedAt = new Date(body.capturedAt);
  if (typeof body.capturedAt !== 'string' || !Number.isFinite(capturedAt.getTime()) || capturedAt.getTime() > Date.now() + 300000) throw new BadRequestException('采集时间无效');
  const e = body.evidence;
  if (!e || typeof e !== 'object' || Array.isArray(e) || typeof e.imageHash !== 'string' || !/^[a-f0-9]{64}$/.test(e.imageHash) || !Number.isFinite(e.confidence) || e.confidence < 0 || e.confidence > 100) throw new BadRequestException('原文依据无效');
  if (body.identitySource === 'visual_layout' && (e.confidence < 92 || e.layoutVersion !== 1)) throw new BadRequestException('自动识别依据不足，请人工核对');
  return { bindingId, sourceMessageId, senderNickname, isSelf: body.isSelf as boolean, identitySource: body.identitySource as CollectorMessage['identitySource'],
    content: body.content.trim(), capturedAt, sentAtRaw: body.sentAtRaw == null || body.sentAtRaw === '' ? null : collectorText(body.sentAtRaw, '时间标记', 128),
    evidence: { imageHash: e.imageHash, confidence: e.confidence, layoutVersion: e.layoutVersion === 1 ? 1 : null, identityVerified: false } };
}

@Injectable()
export class CollectorService {
  constructor(private readonly db: DataSource, private readonly collection: CollectionService) {}
  private async tenant(auth: AuthPayload) {
    if (auth?.domain !== 'tenant' || !auth.tenantId || !auth.sub || !auth.windows?.includes('messages')) throw new ForbiddenException('需要租户消息权限');
    const tenant = await this.db.getRepository(Tenant).findOne({ where: { id: auth.tenantId, status: 'ACTIVE' } });
    if (!tenant) throw new ForbiddenException('租户已停用');
    return tenant;
  }
  async profile(auth: AuthPayload) {
    const tenant = await this.tenant(auth);
    const account = await this.db.getRepository(TenantAccount).findOne({ where: { id: auth.sub, tenantId: tenant.id, status: 'ACTIVE' } });
    if (!account) throw new ForbiddenException('账号已停用');
    return { tenantId: tenant.id, tenantName: tenant.name, accountId: account.id, account: account.account, name: account.name };
  }
  private groupPermission(auth: AuthPayload) { if (!auth.windows?.includes('groups')) throw new ForbiddenException('需要群管理权限'); }
  private async device(auth: AuthPayload, id: string) {
    const device = await this.db.getRepository(CollectorDevice).findOne({ where: { id, tenantId: auth.tenantId, accountId: auth.sub, status: 'ACTIVE' } });
    if (!device) throw new ForbiddenException('设备未绑定当前账号或已撤销');
    return device;
  }
  async register(auth: AuthPayload, body: any) {
    await this.tenant(auth);
    const installationId = collectorText(body?.installationId, '设备标识', 128), name = collectorText(body?.name, '设备名称', 100);
    const repo = this.db.getRepository(CollectorDevice);
    await repo.createQueryBuilder().insert().values({ tenantId: auth.tenantId, accountId: auth.sub, installationId, name }).orIgnore().execute();
    const row = await repo.findOneOrFail({ where: { tenantId: auth.tenantId, accountId: auth.sub, installationId } });
    if (row.status !== 'ACTIVE') throw new ForbiddenException('此设备已被撤销，请联系管理员');
    return row;
  }
  async devices(auth: AuthPayload) { await this.tenant(auth); return this.db.getRepository(CollectorDevice).find({ where: { tenantId: auth.tenantId, ...(auth.role === 'TENANT_ADMIN' ? {} : { accountId: auth.sub }) }, order: { createdAt: 'DESC' }, take: 100 }); }
  async revoke(auth: AuthPayload, id: string) {
    await this.tenant(auth);
    await this.db.transaction(async m => {
      const device = await m.findOne(CollectorDevice, { where: { id, tenantId: auth.tenantId }, lock: { mode: 'pessimistic_write' } });
      if (!device || (auth.role !== 'TENANT_ADMIN' && device.accountId !== auth.sub)) throw new NotFoundException('设备不存在');
      device.status = 'REVOKED'; await m.save(device);
      await m.update(CollectorBinding, { tenantId: auth.tenantId, deviceId: id }, { enabled: false, updatedAt: new Date() });
    });
    return { revoked: true };
  }
  async groups(auth: AuthPayload) { await this.tenant(auth); this.groupPermission(auth); return this.db.getRepository(Group).find({ where: { tenantId: auth.tenantId, channel: 'wechat' }, order: { createdAt: 'DESC' }, take: 500 }); }
  async bindings(auth: AuthPayload, deviceId: string) {
    await this.tenant(auth); await this.device(auth, deviceId);
    const rows = await this.db.getRepository(CollectorBinding).find({ where: { tenantId: auth.tenantId, deviceId } });
    return Promise.all(rows.map(async row => ({ ...row, group: await this.db.getRepository(Group).findOne({ where: { id: row.groupId, tenantId: auth.tenantId } }) })));
  }
  async bind(auth: AuthPayload, deviceId: string, body: any) {
    await this.tenant(auth); this.groupPermission(auth); await this.device(auth, deviceId);
    const localGroupId = collectorText(body?.localGroupId, '本地会话标识', 128), observedName = collectorText(body?.observedName, '微信会话名');
    if (body.confirmed !== true || typeof body.enabled !== 'boolean') throw new BadRequestException('请明确确认关联群和同步范围');
    return this.db.transaction(async m => {
      const device = await m.findOne(CollectorDevice, { where: { id: deviceId, tenantId: auth.tenantId, accountId: auth.sub, status: 'ACTIVE' }, lock: { mode: 'pessimistic_write' } });
      if (!device) throw new ForbiddenException('设备已撤销');
      const old = await m.findOne(CollectorBinding, { where: { deviceId, localGroupId } });
      // Names are display evidence, never a cross-device/group identity key.
      let group = old ? await m.findOne(Group, { where: { id: old.groupId, tenantId: auth.tenantId } }) : body.groupId ? await m.findOne(Group, { where: { id: collectorUuid(body.groupId, '平台群'), tenantId: auth.tenantId, channel: 'wechat' } }) : null;
      if (old && ((body.groupId && old.groupId !== body.groupId) || observedName !== old.observedName)) throw new ConflictException('已有绑定不能改归其他群，请新建本地会话以保留原归属');
      if (!group && !old && !body.groupId && body.createNew === true) {
        group = await m.save(Group, m.create(Group, { tenantId: auth.tenantId, channel: 'wechat', chatId: `collector:${randomUUID()}`, name: observedName, status: 'PENDING', groupType: 'customer' }));
      }
      if (!group || group.channel !== 'wechat' || (body.enabled && group.status === 'DISABLED')) throw new BadRequestException('请选择本租户可用微信群，或确认新建');
      return m.save(CollectorBinding, m.create(CollectorBinding, { ...old, tenantId: auth.tenantId, deviceId, localGroupId, groupId: group.id, observedName, enabled: body.enabled, updatedAt: new Date() }));
    });
  }
  async ingest(auth: AuthPayload, deviceId: string, body: any) {
    await this.tenant(auth); await this.device(auth, deviceId);
    const input = collectorPayload(body), payloadHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const result = await this.db.transaction(async m => {
      const device = await m.findOne(CollectorDevice, { where: { id: deviceId, tenantId: auth.tenantId, accountId: auth.sub, status: 'ACTIVE' }, lock: { mode: 'pessimistic_write' } });
      if (!device) throw new ForbiddenException('设备已撤销');
      const binding = await m.findOne(CollectorBinding, { where: { id: input.bindingId, tenantId: auth.tenantId, deviceId, enabled: true } });
      if (!binding) throw new ForbiddenException('该会话未开启同步');
      const group = await m.findOne(Group, { where: { id: binding.groupId, tenantId: auth.tenantId, channel: 'wechat' } });
      if (!group || group.status === 'DISABLED') throw new ForbiddenException('群已停用或删除');
      const old = await m.findOne(CollectorMessage, { where: { deviceId, sourceMessageId: input.sourceMessageId } });
      if (old) {
        if (old.payloadHash !== payloadHash) throw new ConflictException('来源消息 ID 与已收消息冲突，未覆盖');
        return { row: old, group, inserted: false };
      }
      const row = await m.save(CollectorMessage, m.create(CollectorMessage, { ...input, tenantId: auth.tenantId, accountId: auth.sub, deviceId, groupId: group.id, payloadHash }));
      return { row, group, inserted: true };
    });
    if (result.inserted) await this.process(result.row, result.group);
    return this.receipt(result.row);
  }
  private async process(row: CollectorMessage, group: Group) {
    row.processingStatus = 'awaiting_robot';
    const draft = group.robotId && group.status === 'BOUND' ? await this.db.getRepository(Robot).findOne({ where: { id: group.robotId, tenantId: row.tenantId, status: 'PUBLISHED' } }) : null;
    const published = draft?.publishedConfig as Partial<Robot> | undefined;
    const robot = published ? { ...draft, ...published, id: draft!.id, tenantId: draft!.tenantId } as Robot : null;
    if (robot && published?.ragConfig?.mode === 'collector') {
      try {
        const result = await this.collection.ingestDesktop(robot, group, {
          tenantId: row.tenantId, channel: 'wechat', channelId: row.deviceId, chatId: group.chatId,
          // An OCR nickname does not prove a platform identity or confer its permissions.
          channelUserId: `unverified:${row.id}`, sourceMessageId: row.sourceMessageId, content: row.content, isAtRobot: false,
        }, { kind: 'desktop_ocr', deviceId: row.deviceId, accountId: row.accountId, senderNickname: row.senderNickname, isSelf: row.isSelf, identitySource: row.identitySource, identityVerified: false, sentAtRaw: row.sentAtRaw, capturedAt: row.capturedAt.toISOString() });
        row.collectionId = result.collectionId; row.processingStatus = result.collectionStatus || result.reason || 'failed';
      } catch { row.processingStatus = 'failed'; }
    }
    await this.db.getRepository(CollectorMessage).save(row);
  }
  private async receipt(row: CollectorMessage) {
    const collection = row.collectionId ? await this.db.getRepository(CollectionRecord).findOne({ where: { id: row.collectionId, tenantId: row.tenantId } }) : null;
    return { messageId: row.id, sourceMessageId: row.sourceMessageId, status: 'received', processingStatus: collection?.status || row.processingStatus, collectionId: row.collectionId || null };
  }
  async reprocess(auth: AuthPayload, id: string) {
    await this.tenant(auth);
    const row = await this.db.getRepository(CollectorMessage).findOne({ where: { id, tenantId: auth.tenantId } });
    if (!row) throw new NotFoundException('消息不存在');
    const device = await this.db.getRepository(CollectorDevice).findOne({ where: { id: row.deviceId, tenantId: auth.tenantId, status: 'ACTIVE' } });
    const binding = await this.db.getRepository(CollectorBinding).findOne({ where: { id: row.bindingId, tenantId: auth.tenantId, enabled: true } });
    const group = await this.db.getRepository(Group).findOne({ where: { id: row.groupId, tenantId: auth.tenantId, channel: 'wechat', status: 'BOUND' } });
    if (!device || !binding || !group) throw new BadRequestException('设备、同步或群绑定已停用，请先检查配置');
    // CollectionService retains its own event-key idempotency and validation rules.
    if (!row.collectionId) await this.process(row, group);
    return this.receipt(row);
  }
  async receipts(auth: AuthPayload, deviceId: string, ids: string) {
    await this.tenant(auth); await this.device(auth, deviceId);
    const list = String(ids || '').split(','); if (!list.length || list.length > 50 || list.some(id => !/^[a-zA-Z0-9:_-]{1,128}$/.test(id))) throw new BadRequestException('消息查询无效');
    const rows = await this.db.getRepository(CollectorMessage).createQueryBuilder('m').where('m."tenantId"=:tenant AND m."deviceId"=:device AND m."sourceMessageId" IN (:...ids)', { tenant: auth.tenantId, device: deviceId, ids: list }).getMany();
    return Promise.all(rows.map(row => this.receipt(row)));
  }
  async messages(auth: AuthPayload, page: string = '1') {
    await this.tenant(auth); const p = Number(page); if (!Number.isInteger(p) || p < 1 || p > 10000) throw new BadRequestException('页码无效');
    const [items, total] = await this.db.getRepository(CollectorMessage).findAndCount({ where: { tenantId: auth.tenantId }, order: { createdAt: 'DESC', id: 'DESC' }, take: 50, skip: (p - 1) * 50 });
    return { items: await Promise.all(items.map(async row => ({ ...row, ...(await this.receipt(row)), group: await this.db.getRepository(Group).findOne({ where: { id: row.groupId, tenantId: auth.tenantId } }) }))), total, page: p };
  }
}
