import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as lark from '@larksuiteoapi/node-sdk';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Channel } from './channel.entity';
import { AiRouterService } from '../ai-router/ai-router.service';
import { GroupRegistrationService } from '../groups/group-registration.service';
import { SecretsService } from '../secrets/secrets.service';
import { channelSecretFields } from './channel-secrets';

/**
 * 飞书对接（真实，长连接模式）：
 *  - WSClient 长连接（WebSocket 事件订阅，无需公网回调）— 渠道 connect 时启动 / disconnect 时停止
 *  - 事件 im.message.receive_v1：群聊文本 → @判定 → AI Router → 真实回复
 *  - 发送：im.v1.message.create（tenant_access_token 由 SDK 自动管理）
 */
@Injectable()
export class FeishuService implements OnModuleDestroy {
  private readonly logger = new Logger(FeishuService.name);
  private clients = new Map<string, { ws: lark.WSClient; client: lark.Client }>();
  private tokenCache: Record<string, { token: string; expiresAt: number }> = {};

  constructor(
    @InjectRepository(Channel) private readonly channels: Repository<Channel>,
    private readonly router: AiRouterService,
    private readonly groupRegistration: GroupRegistrationService,
    private readonly secrets: SecretsService,
  ) {}

  /** 读取渠道凭据（来自渠道接入配置，不造数据） */
  private async getConfig(channelId: string, tenantId: string) {
    const channel = await this.channels.findOne({ where: { id: channelId, type: 'feishu', tenantId } });
    if (!channel) throw new Error('40401: 飞书渠道不存在');
    const c = this.secrets.decryptRecord(channel.config, channelSecretFields(channel.type));
    const missing = ['app_id', 'app_secret'].filter((f) => !c[f]);
    if (missing.length) throw new Error(`42201: 飞书渠道缺少配置: ${missing.join(', ')}`);
    return { channel, appId: c.app_id!, appSecret: c.app_secret! };
  }

  /** 真实获取 tenant_access_token，供凭据检测与通讯录同步复用。 */
  async getAccessToken(channelId: string, tenantId: string): Promise<string> {
    const cached = this.tokenCache[channelId];
    if (cached && Date.now() < cached.expiresAt) return cached.token;
    const { appId, appSecret } = await this.getConfig(channelId, tenantId);
    const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const result = await response.json() as { code?: number; msg?: string; tenant_access_token?: string; expire?: number };
    if (!response.ok || result.code !== 0 || !result.tenant_access_token) throw new Error(`飞书 gettoken 失败: ${result.code ?? response.status} ${result.msg ?? ''}`);
    this.tokenCache[channelId] = { token: result.tenant_access_token, expiresAt: Date.now() + Math.max(60, (result.expire ?? 7200) - 60) * 1000 };
    return result.tenant_access_token;
  }

  /** 实际请求飞书鉴权接口验证 App ID/App Secret。 */
  async testConnection(channelId: string, tenantId: string): Promise<void> {
    await this.getAccessToken(channelId, tenantId);
  }

  /** 启动飞书长连接（渠道 connect 时调用） */
  async start(channelId: string, tenantId: string): Promise<void> {
    const { channel, appId, appSecret } = await this.getConfig(channelId, tenantId);
    if (this.clients.has(channelId)) return;

    const client = new lark.Client({ appId, appSecret });
    const ws = new lark.WSClient({ appId, appSecret });
    const dispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': (data) => this.handleMessage(channelId, tenantId, client, data),
    });
    this.clients.set(channelId, { ws, client });
    try {
      await ws.start({ eventDispatcher: dispatcher });
    } catch (e) {
      this.clients.delete(channelId);
      throw new Error(`42201: 飞书长连接启动失败: ${(e as Error).message}`);
    }
    this.logger.log(`飞书渠道「${channel.name}」长连接已启动`);
  }

  /** 停止（渠道 disconnect 时调用） */
  async stop(channelId: string): Promise<void> {
    const entry = this.clients.get(channelId);
    if (!entry) return;
    entry.ws.close();
    this.clients.delete(channelId);
    this.logger.log('飞书长连接已断开');
  }

  /** 消息事件处理：群聊文本 → AI Router → 回复 */
  private async handleMessage(
    channelId: string,
    tenantId: string,
    client: lark.Client,
    data: {
      message?: {
        message_id?: string;
        chat_id?: string;
        chat_type?: string;
        message_type?: string;
        content?: string;
        mentions?: Array<{ key: string; name: string }>;
      };
      sender?: { sender_id?: { open_id?: string } };
    },
  ): Promise<void> {
    const msg = data.message;
    if (!msg || msg.message_type !== 'text') return;
    // 仅处理群聊文本（chat_type: p2p=单聊 group=群聊）
    if (msg.chat_type !== 'group') return;
    const chatId = msg.chat_id ?? '';
    const fromUser = data.sender?.sender_id?.open_id ?? '';
    let content = '';
    try {
      content = (JSON.parse(msg.content ?? '{}') as { text?: string }).text ?? '';
    } catch {
      return;
    }
    if (!chatId || !fromUser || !content) return;
    await this.groupRegistration.register({ tenantId, channel: 'feishu', chatId });
    this.logger.log(`飞书群消息: 群=${chatId.slice(0, 8)}… 用户=${fromUser.slice(0, 8)}… 内容=${content.slice(0, 30)}`);

    const result = (await this.router.handleMessage({
      tenantId,
      channel: 'feishu',
      channelId,
      sourceMessageId: msg.message_id,
      channelUserId: fromUser,
      chatId,
      isAtRobot: (msg.mentions?.length ?? 0) > 0,
      content,
    })) as { processed?: boolean; answer?: string };
    if (result.processed && result.answer) {
      await this.sendToGroup(client, chatId, result.answer).catch((e) => this.logger.warn(`飞书回复失败: ${(e as Error).message}`));
    }
  }

  /** 外部发送（消息群发等场景）：需该渠道长连接已启动 */
  async sendExternal(channelId: string, chatId: string, content: string): Promise<boolean> {
    const entry = this.clients.get(channelId);
    if (!entry) {
      this.logger.warn(`飞书发送失败: 渠道长连接未启动（先启用渠道）`);
      return false;
    }
    try {
      await this.sendToGroup(entry.client, chatId, content);
      return true;
    } catch (e) {
      this.logger.warn(`飞书发送失败: ${(e as Error).message}`);
      return false;
    }
  }

  /** 发送文本消息到群（im.v1.message.create） */
  private async sendToGroup(client: lark.Client, chatId: string, content: string): Promise<void> {
    await client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text: content }),
      },
    });
  }

  onModuleDestroy(): void {
    for (const [, entry] of this.clients) {
      entry.ws.close();
    }
    this.clients.clear();
  }
}
