import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DWClient, DWClientDownStream, TOPIC_ROBOT } from 'dingtalk-stream';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Channel } from './channel.entity';
import { AiRouterService } from '../ai-router/ai-router.service';
import { GroupRegistrationService } from '../groups/group-registration.service';
import { GroupMember } from '../groups/group-member.entity';
import { IdentityService } from '../users/identity.service';
import { SecretsService } from '../secrets/secrets.service';
import { channelSecretFields } from './channel-secrets';
import { createHmac, timingSafeEqual } from 'crypto';
import { dingTalkConnectionMode } from './dingtalk-channel.util';
import { EventEmitter } from 'events';
import { Group } from '../groups/group.entity';
import { User } from '../users/user.entity';
import { FollowUp } from '../follow-ups/follow-up.entity';

interface DingTalkRobotPayload {
  msgId?: string;
  msgtype?: string;
  msgType?: string;
  text?: { content?: string };
  conversationId?: string;
  conversationTitle?: string;
  conversationType?: string | number;
  senderStaffId?: string;
  senderId?: string;
  senderNick?: string;
  sessionWebhook?: string;
}

export interface DingTalkMessageResult {
  processed: boolean;
  answer?: string;
  replied?: boolean;
  reason?: string;
}

/**
 * 钉钉 Stream / HTTP 双模式对接（真实）：
 *  - Stream 长连接（WebSocket 订阅，无需公网回调）— 渠道 connect 时启动 / disconnect 时停止
 *  - 机器人消息回调：TOPIC_ROBOT → 解析 → AI Router → 群消息真实回复
 *  - 发送：新版 API（oauth2/accessToken + robot/groupMessages/send）
 */
@Injectable()
export class DingTalkService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DingTalkService.name);
  private clients = new Map<string, DWClient>();
  private tokenCache: Record<string, { token: string; expiresAt: number }> = {};
  private recentMessages = new Map<string, number>();
  private restoreTimer?: ReturnType<typeof setInterval>;
  private restoring = false;
  private lastRestoreCheck = 0;
  private readonly starting = new Map<string, Promise<void>>();
  private shuttingDown = false;

  constructor(
    @InjectRepository(Channel) private readonly channels: Repository<Channel>,
    private readonly router: AiRouterService,
    private readonly groupRegistration: GroupRegistrationService,
    @InjectRepository(GroupMember) private readonly groupMembers: Repository<GroupMember>,
    private readonly identity: IdentityService,
    private readonly secrets: SecretsService,
  ) {}

  /** 服务重启后恢复数据库中已启用的 Stream 长连接。 */
  onModuleInit(): void {
    if (process.env.CHANNEL_AUTO_CONNECT === 'false') return;
    void this.restoreConnections().catch((error) => {
      this.logger.error(`恢复钉钉渠道失败: ${(error as Error).message}`);
    });
    this.restoreTimer = setInterval(() => {
      void this.restoreConnections().catch(error => this.logger.warn(`重试钉钉连接失败: ${(error as Error).message}`));
    }, 30000);
    this.restoreTimer.unref();
  }

  /** 读取渠道凭据（来自渠道接入配置，不造数据） */
  private async getConfig(channelId: string, tenantId: string) {
    const channel = await this.channels.findOne({ where: { id: channelId, type: 'dingtalk', tenantId } });
    if (!channel) throw new Error('40401: 钉钉渠道不存在');
    const c = this.secrets.decryptRecord(channel.config, channelSecretFields(channel.type));
    const missing = ['app_key', 'app_secret', 'robot_code'].filter((f) => !c[f]);
    if (missing.length) throw new Error(`42201: 钉钉渠道缺少配置: ${missing.join(', ')}`);
    return { channel, config: c, clientId: c.app_key!, clientSecret: c.app_secret!, robotCode: c.robot_code! };
  }

  /** 启动 Stream 长连接（渠道 connect 时调用） */
  async start(channelId: string, tenantId: string): Promise<void> {
    const pending = this.starting.get(channelId);
    if (pending) return pending;
    const task = this.startStream(channelId, tenantId);
    this.starting.set(channelId, task);
    try { await task; }
    finally { if (this.starting.get(channelId) === task) this.starting.delete(channelId); }
  }

  private async startStream(channelId: string, tenantId: string): Promise<void> {
    if (this.shuttingDown) return;
    const { channel, config, clientId, clientSecret } = await this.getConfig(channelId, tenantId);
    if (this.shuttingDown) return;
    if (dingTalkConnectionMode(config) === 'http') {
      this.logger.log(`钉钉渠道「${channel.name}」 HTTP 回调已启用`);
      return;
    }
    if (this.isConnected(channelId)) return;
    // 清理失效实例，允许用户重新连接。
    await this.stop(channelId);
    const client = new DWClient({ clientId, clientSecret, keepAlive: true });
    // One reconnect owner: the service recovery loop. SDK retries otherwise race stop/start.
    client.config.autoReconnect = false;
    // 机器人消息在钉钉 Stream 协议中属于 CALLBACK，不是 EVENT。
    // registerAllEventListener 只会订阅 EVENT/*，长连接虽能成功，但永远收不到机器人消息。
    client.registerCallbackListener(TOPIC_ROBOT, (msg) => {
      this.logger.log(`收到钉钉机器人回调: 渠道=${channelId.slice(0, 8)}…`);
      // Stream 回调必须在厂商超时窗口内确认；模型检索/生成在后台继续，不能阻塞 ACK。
      try { client.socketCallBackResponse(msg.headers.messageId, { status: 'SUCCESS' }); }
      catch (e) { this.logger.warn(`钉钉回调确认失败: ${(e as Error).message}`); }
      void this.handleRobotMessage(channelId, tenantId, msg)
        .catch((e) => this.logger.error(`钉钉消息处理失败: ${(e as Error).message}`));
    });
    this.clients.set(channelId, client);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([client.connect(), new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Stream 连接超时')), 20_000);
      })]);
      // SDK 会吞掉连接异常并安排重试，Promise resolve 并不代表在线。
      if (!client.connected) throw new Error('连接未建立，请检查钉钉应用凭据和网络');
    } catch (e) {
      this.disconnectSafely(client);
      if (this.clients.get(channelId) === client) this.clients.delete(channelId);
      throw new Error(`42201: 钉钉 Stream 连接失败: ${(e as Error).message}`);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    this.logger.log(`钉钉渠道「${channel.name}」Stream 已连接`);
  }

  isConnected(channelId: string): boolean {
    return this.clients.get(channelId)?.connected === true;
  }

  /** 停止（渠道 disconnect 时调用） */
  async stop(channelId: string): Promise<void> {
    const client = this.clients.get(channelId);
    if (client) {
      this.disconnectSafely(client);
      this.clients.delete(channelId);
      this.logger.log('钉钉 Stream 已断开');
    }
    delete this.tokenCache[channelId];
  }

  /** 凭据变更或渠道删除时同时清理长连接和 access_token 缓存。 */
  async invalidate(channelId: string): Promise<void> {
    await this.stop(channelId);
  }

  /** Stream SDK 入口：解开 data 包装后进入通用消息链路。 */
  private async handleRobotMessage(channelId: string, tenantId: string, msg: DWClientDownStream): Promise<void> {
    let payload: unknown;
    try {
      payload = JSON.parse(msg.data);
    } catch {
      this.logger.warn('钉钉机器人回调已忽略：消息体不是有效 JSON');
      return;
    }
    await this.handleIncomingMessage(channelId, tenantId, payload);
  }

  /** HTTP 回调入口，与 Stream 共用群/用户/会话/AI 路由逻辑。 */
  async handleHttpMessage(channelId: string, tenantId: string, payload: unknown): Promise<DingTalkMessageResult> {
    return this.handleIncomingMessage(channelId, tenantId, payload);
  }

  /** 钉钉 HTTP 模式可选签名：HMAC-SHA256(timestamp + "\\n" + AppSecret, AppSecret)。 */
  verifyHttpSignature(timestamp: string, signature: string, secret: string): boolean {
    const sentAt = Number(timestamp);
    if (!Number.isFinite(sentAt) || !signature || !secret || Math.abs(Date.now() - sentAt) > 60 * 60 * 1000) return false;
    const expected = createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64');
    let actual = signature;
    try { actual = decodeURIComponent(signature); } catch { /* 按原值校验 */ }
    const left = Buffer.from(actual);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  /** 机器人消息处理：解析 → AI Router → sessionWebhook/OpenAPI 真实回复。 */
  private async handleIncomingMessage(channelId: string, tenantId: string, rawPayload: unknown): Promise<DingTalkMessageResult> {
    let payload = rawPayload;
    if (payload && typeof payload === 'object' && 'data' in payload) {
      const nested = (payload as { data?: unknown }).data;
      if (typeof nested === 'string') {
        try { payload = JSON.parse(nested); } catch { payload = nested; }
      } else if (nested) {
        payload = nested;
      }
    }
    if (!payload || typeof payload !== 'object') {
      this.logger.warn('钉钉机器人回调已忽略：消息体结构无效');
      return { processed: false, reason: 'invalid_payload' };
    }
    const m = payload as DingTalkRobotPayload;
    const messageType = m.msgtype ?? m.msgType;
    if (messageType !== 'text') return { processed: false, reason: 'unsupported_message_type' };
    if (m.msgId && this.isDuplicateMessage(channelId, m.msgId)) {
      this.logger.log(`忽略钉钉重复消息: ${m.msgId}`);
      return { processed: false, reason: 'duplicate' };
    }
    try {
    // conversationType: 1=单聊，2=群聊；群聊需后续在群管理中绑定，单聊使用渠道绑定机器人。
    const conversationType = String(m.conversationType ?? '');
    if (!['1', '2'].includes(conversationType)) {
      this.logger.warn(`钉钉机器人回调已忽略：未知会话类型 ${conversationType || '空'}`);
      return { processed: false, reason: 'invalid_conversation_type' };
    }
    const content = m.text?.content?.trim() ?? '';
    const chatId = m.conversationId ?? '';
    // 企业内成员通常有 senderStaffId，外联人等场景可能只提供 senderId。
    const fromUser = m.senderStaffId || m.senderId || '';
    if (!chatId || !fromUser || !content) {
      this.logger.warn(`钉钉机器人回调已忽略：缺少${!chatId ? '会话ID ' : ''}${!fromUser ? '用户ID ' : ''}${!content ? '文本内容' : ''}`.trim());
      return { processed: false, reason: 'missing_fields' };
    }
    const groupChat = conversationType === '2';
    let robotId: string | undefined;
    if (groupChat) {
      const group = await this.groupRegistration.register({
        tenantId,
        channel: 'dingtalk',
        chatId,
        name: m.conversationTitle || `钉钉群 ${chatId.slice(0, 8)}`,
      });
      // 群处于 PENDING、尚未绑定机器人时 AI Router 会按设计提前结束；因此必须在路由前
      // 独立落库发送人及群成员，否则租户端永远看不到首位钉钉成员。
      const resolved = await this.identity.resolve({
        tenantId,
        channel: 'dingtalk',
        channelUserId: fromUser,
        content,
        displayName: m.senderNick,
      });
      let member = await this.groupMembers.findOne({ where: { groupId: group.id, channelUserId: fromUser } });
      if (!member) {
        member = this.groupMembers.create({ groupId: group.id, channelUserId: fromUser, userId: resolved.user.id, source: 'dingtalk' });
      } else {
        member.userId = resolved.user.id;
        member.source = 'dingtalk';
      }
      await this.groupMembers.save(member);
    } else {
      // 即使渠道尚未绑定机器人，单聊发送人也应先进入租户用户目录。
      await this.identity.resolve({
        tenantId,
        channel: 'dingtalk',
        channelUserId: fromUser,
        content,
        displayName: m.senderNick,
      });
      robotId = (await this.getConfig(channelId, tenantId)).channel.bindRobotId;
      if (!robotId) {
        this.logger.warn('钉钉单聊未处理：渠道尚未绑定机器人');
        return { processed: false, reason: 'no_robot_target' };
      }
    }
    this.logger.log(`钉钉${groupChat ? '群' : '单聊'}消息: 会话=${chatId.slice(0, 8)}… 用户=${fromUser} 内容=${content.slice(0, 30)}`);

    const result = (await this.router.handleMessage({
      tenantId,
      channel: 'dingtalk',
      channelId,
      channelUserId: fromUser,
      chatId: groupChat ? chatId : undefined,
      robotId,
      // TOPIC_ROBOT 群消息本身即由 @机器人 触发，正文不保证保留 @ 文本。
      isAtRobot: true,
      sourceMessageId: m.msgId,
      content,
    })) as { processed?: boolean; answer?: string; handoffId?: string };
    let mentions: string[] = [];
    if (result.handoffId && groupChat) {
      const group = await this.groupMembers.manager.findOne(Group, { where: { tenantId, chatId, channel: 'dingtalk', status: 'BOUND' } });
      if (group) {
        const members = await this.groupMembers.find({ where: { groupId: group.id, source: 'dingtalk' } });
        for (const member of members) {
          if (!member.userId || member.channelUserId === fromUser) continue;
          const user = await this.groupMembers.manager.findOne(User, { where: { id: member.userId, tenantId, status: 'ACTIVE' } });
          if (user && (member.groupRoleOverride || user.role || user.identity) === (group.handoffRole || '客服')) mentions.push(member.channelUserId);
        }
      }
      mentions = [...new Set(mentions)].slice(0, 20);
      result.answer = mentions.length ? '该问题需要人工处理，请群内客服协助。已建立待跟进工单。' : '该问题需要人工处理，当前未找到可通知的群内客服，已转入后台待跟进工单。';
      await this.groupMembers.manager.query("UPDATE follow_ups SET delivery=delivery || $3::jsonb WHERE id=$1 AND tenant_id=$2", [result.handoffId, tenantId, JSON.stringify({ channelId, mentionUserIds: mentions, handoff: mentions.length ? '客服通知待发送' : '无群内客服，后台待跟进' })]);
    }
    let replied = false;
    if (result.processed && result.answer) {
      this.logger.log(`钉钉回答已生成，开始发送: 渠道=${channelId} 消息=${m.msgId ?? 'unknown'} 字符数=${result.answer.length}`);
      // Prefer the callback's short-lived session webhook. If it is expired or
      // rejected, fall back to the authenticated OpenAPI route so one bad webhook
      // does not turn a successful knowledge answer into a silent drop.
      if (m.sessionWebhook) replied = await this.sendSessionReply(m.sessionWebhook, result.answer, mentions).catch((e) => {
        this.logger.warn(`钉钉回复失败: ${(e as Error).message}`);
        return false;
      });
      const mentioned = replied && mentions.length > 0;
      if (!replied) replied = await (groupChat
        ? this.sendToGroup(channelId, tenantId, chatId, result.answer)
        : this.sendToUser(channelId, tenantId, fromUser, result.answer)).catch((e) => {
          this.logger.warn(`钉钉 OpenAPI 回复失败: ${(e as Error).message}`);
          return false;
        });
      this.logger.log(`钉钉发送结果: 渠道=${channelId} 消息=${m.msgId ?? 'unknown'} API返回成功=${replied}`);
      if (result.handoffId && groupChat) await this.groupMembers.manager.query(
        "UPDATE follow_ups SET delivery=delivery || $3::jsonb WHERE id=$1 AND tenant_id=$2",
        [result.handoffId, tenantId, JSON.stringify({ handoff: mentioned ? '已请求通知群内客服；后台工单待处理' : '已进入后台待跟进；请核对群内客服通知' })],
      );
    }
    return { processed: Boolean(result.processed), answer: result.answer, replied };
    } catch (error) {
      // 业务处理失败时释放去重标记，允许钉钉的合法重试再次处理。
      if (m.msgId) this.recentMessages.delete(`${channelId}:${m.msgId}`);
      throw error;
    }
  }

  private isDuplicateMessage(channelId: string, messageId: string): boolean {
    const now = Date.now();
    for (const [key, expiresAt] of this.recentMessages) {
      if (expiresAt <= now) this.recentMessages.delete(key);
    }
    const key = `${channelId}:${messageId}`;
    if (this.recentMessages.has(key)) return true;
    this.recentMessages.set(key, now + 10 * 60 * 1000);
    return false;
  }

  /** 新版 access_token（api.dingtalk.com/v1.0 域，按渠道 ID 隔离缓存） */
  async getAccessToken(channelId: string, tenantId: string): Promise<string> {
    const cached = this.tokenCache?.[channelId];
    if (cached && Date.now() < cached.expiresAt) return cached.token;
    const ch = await this.channels.findOne({ where: { id: channelId, type: 'dingtalk', tenantId } });
    if (!ch) throw new Error('42201: 钉钉渠道未接入或未启用（渠道接入页配置）');
    const c = this.secrets.decryptRecord(ch.config, channelSecretFields(ch.type));
    const res = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appKey: c.app_key, appSecret: c.app_secret }),
    });
    const json = (await res.json()) as { accessToken?: string; expireIn?: number; code?: string; message?: string };
    if (!json.accessToken) throw new Error(`钉钉 gettoken 失败: ${json.code ?? ''} ${json.message ?? ''}`);
    this.tokenCache = { ...this.tokenCache, [channelId]: { token: json.accessToken, expiresAt: Date.now() + (json.expireIn ?? 7200) * 1000 - 60 * 1000 } };
    return json.accessToken;
  }

  /** 实际请求钉钉 OAuth 接口验证 AppKey/AppSecret。 */
  async testConnection(channelId: string, tenantId: string): Promise<void> {
    await this.getConfig(channelId, tenantId);
    await this.getAccessToken(channelId, tenantId);
  }

  /** 发送群消息（新版 API：robot/groupMessages/send，按渠道 ID 路由凭据） */
  async sendToGroup(channelId: string, tenantId: string, chatId: string, content: string): Promise<boolean> {
    const { robotCode } = await this.getConfig(channelId, tenantId);
    const token = await this.getAccessToken(channelId, tenantId);
    const res = await fetch('https://api.dingtalk.com/v1.0/robot/groupMessages/send', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': token },
      body: JSON.stringify({
        robotCode,
        openConversationId: chatId,
        msgKey: 'sampleText',
        msgParam: JSON.stringify({ content }),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    if (!res.ok || json.code) {
      this.logger.warn(`钉钉发送失败 ${chatId}: ${json.code ?? res.status} ${json.message ?? ''}`);
      return false;
    }
    return true;
  }

  /** 发送单聊消息（HTTP 回调无 sessionWebhook 时的 OpenAPI 降级通道）。 */
  async sendToUser(channelId: string, tenantId: string, userId: string, content: string): Promise<boolean> {
    const { robotCode } = await this.getConfig(channelId, tenantId);
    const token = await this.getAccessToken(channelId, tenantId);
    const res = await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': token },
      body: JSON.stringify({
        robotCode,
        userIds: [userId],
        msgKey: 'sampleText',
        msgParam: JSON.stringify({ content }),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    if (!res.ok || json.code) {
      this.logger.warn(`钉钉单聊发送失败 ${userId}: ${json.code ?? res.status} ${json.message ?? ''}`);
      return false;
    }
    return true;
  }

  private async restoreConnections(): Promise<void> {
    if (this.restoring || this.shuttingDown) return;
    this.restoring = true;
    try {
    const now = Date.now();
    const resumed = this.lastRestoreCheck > 0 && now - this.lastRestoreCheck > 90_000;
    this.lastRestoreCheck = now;
    if (resumed) {
      this.logger.warn('连接检查中断超过90秒，重新建立钉钉连接以恢复消息接收');
      for (const channelId of [...this.clients.keys()]) await this.stop(channelId);
    }
    const channels = await this.channels.find({ where: { type: 'dingtalk', status: 'connected', isActive: true } }) ?? [];
    for (const channel of channels) {
      if (this.shuttingDown) break;
      await this.start(channel.id, channel.tenantId).catch((error) => {
        this.logger.error(`恢复钉钉渠道「${channel.name}」失败: ${(error as Error).message}`);
        // 保留用户的启用意图；实时状态由 isConnected 判断，网络恢复后继续重连。
        // 临时 TLS/DNS 故障不能变成永久停用。
      });
    }
    } finally { this.restoring = false; }
  }

  private async sendSessionReply(webhook: string, content: string, atUserIds: string[] = []): Promise<boolean> {
    const url = new URL(webhook);
    if (url.protocol !== 'https:' || !['oapi.dingtalk.com', 'api.dingtalk.com'].includes(url.hostname)) {
      throw new Error('钉钉会话回复地址无效');
    }
    const response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: atUserIds.length ? `${atUserIds.map(id => '@' + id).join(' ')}\n${content}` : content }, ...(atUserIds.length ? { at: { atUserIds, isAtAll: false } } : {}) }),
    });
    const result = await response.json().catch(() => null) as { errcode?: number; code?: string } | null;
    // Session webhook may legitimately return an empty 2xx body; only explicit
    // DingTalk business error fields make delivery fail.
    const delivered = response.ok && (!result || (result.errcode === undefined || result.errcode === 0) && !result.code);
    if (!delivered) this.logger.warn(`钉钉会话回复失败: HTTP ${response.status}, code=${result?.errcode ?? result?.code ?? 'invalid_response'}`);
    return delivered;
  }

  onModuleDestroy(): void {
    this.shuttingDown = true;
    if (this.restoreTimer) clearInterval(this.restoreTimer);
    for (const [, client] of this.clients) this.disconnectSafely(client);
    this.clients.clear();
    this.tokenCache = {};
    this.recentMessages.clear();
  }

  private disconnectSafely(client: DWClient): void {
    // dingtalk-stream 2.1.6-beta.1 cleanup removes all socket listeners before terminate().
    // ws emits an asynchronous error when a CONNECTING socket is terminated. Restore a
    // listener on that retired socket only; never swallow process-wide uncaught errors.
    const socket = (client as unknown as { socket?: EventEmitter }).socket;
    try { client.disconnect(); }
    finally {
      if (socket && socket.listenerCount('error') === 0) socket.on('error', () => {
        this.logger.debug('已关闭的钉钉连接结束握手');
      });
    }
  }
}
