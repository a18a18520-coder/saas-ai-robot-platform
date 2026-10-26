import { Body, Controller, Get, Logger, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { WeComService } from './wecom.service';
import { AiRouterService } from '../ai-router/ai-router.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Channel } from './channel.entity';
import { GroupRegistrationService } from '../groups/group-registration.service';
import { SecretsService } from '../secrets/secrets.service';
import { channelSecretFields } from './channel-secrets';

/**
 * 企业微信回调端点（真实渠道入口）：
 *  GET  /callback/wecom — URL 验证（echostr 解密回显）
 *  POST /callback/wecom — 消息回调（验签→解密→AI Router→真实回复）
 */
@Controller('callback/wecom')
export class WeComCallbackController {
  private readonly logger = new Logger(WeComCallbackController.name);

  constructor(
    private readonly wecom: WeComService,
    private readonly router: AiRouterService,
    @InjectRepository(Channel) private readonly channels: Repository<Channel>,
    private readonly groupRegistration: GroupRegistrationService,
    private readonly secrets: SecretsService,
  ) {}

  /** URL 验证（企微后台配置回调时调用，仅携带 signature/timestamp/nonce/echostr，无租户标识 → 遍历凭据匹配） */
  @Get()
  async verify(
    @Query('msg_signature') signature: string,
    @Query('timestamp') timestamp: string,
    @Query('nonce') nonce: string,
    @Query('echostr') echostr: string,
    @Res() res: Response,
  ) {
    try {
      const channels = await this.channels.find({ where: { type: 'wecom', status: 'connected' } });
      for (const ch of channels) {
        const config = this.secrets.decryptRecord(ch.config, channelSecretFields(ch.type));
        const token = config.token ?? '';
        if (!this.wecom.verifySignature(signature, token, timestamp, nonce, echostr)) continue;
        const plain = this.wecom.decryptMsg(config.aes_key ?? '', echostr);
        return res.send(plain);
      }
      return res.status(403).send('signature mismatch');
    } catch (e) {
      this.logger.error(`企微回调 URL 验证失败: ${(e as Error).message}`);
      return res.status(500).send('callback verification failed');
    }
  }

  /** 消息回调（XML encrypt 包裹） */
  @Post()
  async receive(@Body() body: string, @Query('msg_signature') signature: string, @Query('timestamp') timestamp: string, @Query('nonce') nonce: string, @Res() res: Response) {
    try {
      // 1) 解析外层 XML 取 encrypt + 租户（回调按渠道路由：从 encrypt 解密后定位）
      const encryptMatch = body.match(/<Encrypt><!\[CDATA\[(.*?)\]\]><\/Encrypt>/s);
      if (!encryptMatch) return res.status(400).send('bad request');

      // 2) 遍历启用中的企微渠道找到匹配的（支持同类型多渠道：按 token 区分应用）
      const channels = await this.channels.find({ where: { type: 'wecom', status: 'connected' } });
      let matched: { channelId: string; tenantId: string; xml: string } | null = null;
      for (const ch of channels) {
        const config = this.secrets.decryptRecord(ch.config, channelSecretFields(ch.type));
        const token = config.token ?? '';
        if (this.wecom.verifySignature(signature, token, timestamp, nonce, encryptMatch[1])) {
          const xml = this.wecom.decryptMsg(config.aes_key ?? '', encryptMatch[1]);
          matched = { channelId: ch.id, tenantId: ch.tenantId, xml };
          break;
        }
      }
      if (!matched) return res.status(403).send('signature mismatch');

      // 3) 解析消息 XML（群聊 text 消息）
      const msgType = matched.xml.match(/<MsgType><!\[CDATA\[(.*?)\]\]><\/MsgType>/)?.[1];
      const xml = matched.xml;

      // 3s 内返回 200（异步处理）
      res.status(200).send('ok');
      this.logger.log(`企微回调: 类型=${msgType} 租户=${matched.tenantId.slice(0, 8)}`);

      const event = xml.match(/<Event><!\[CDATA\[(.*?)\]\]><\/Event>/)?.[1];
      const eventChatId = xml.match(/<ChatId><!\[CDATA\[(.*?)\]\]><\/ChatId>/)?.[1];
      const chatName = xml.match(/<ChatName><!\[CDATA\[(.*?)\]\]><\/ChatName>/)?.[1];
      if (msgType === 'event' && event === 'enter_chat' && eventChatId) {
        await this.groupRegistration.register({ tenantId: matched.tenantId, channel: 'wecom', chatId: eventChatId, name: chatName });
      }

      // 4) 仅处理群聊文本消息（@机器人）
      if (msgType === 'text' && matched.xml.includes('<FromUserName>')) {
        const chatId = xml.match(/<ChatId><!\[CDATA\[(.*?)\]\]><\/ChatId>/)?.[1];
        const fromUser = xml.match(/<FromUserName><!\[CDATA\[(.*?)\]\]><\/FromUserName>/)?.[1];
        const content = xml.match(/<Content><!\[CDATA\[(.*?)\]\]><\/Content>/)?.[1] ?? '';
        const isAt = xml.includes('<AtUserList>') || xml.includes('@');
        if (chatId && fromUser) {
          await this.groupRegistration.register({ tenantId: matched.tenantId, channel: 'wecom', chatId, name: chatName });
          const result = (await this.router.handleMessage({
            tenantId: matched.tenantId,
            channel: 'wecom',
            channelId: matched.channelId,
            sourceMessageId: xml.match(/<MsgId>(?:<!\[CDATA\[)?([^<\]]+)(?:\]\]>)?<\/MsgId>/)?.[1],
            channelUserId: fromUser,
            chatId,
            isAtRobot: isAt,
            content,
          })) as { processed?: boolean; answer?: string };
          // 5) 真实回复到群（AI Router 处理后，按收到消息的渠道路由凭据）
          if (result.processed && result.answer) {
            await this.wecom.sendToGroup(matched.channelId, matched.tenantId, chatId, result.answer).catch((e) => this.logger.warn(`回复失败: ${e.message}`));
          }
        }
      }
    } catch (e) {
      this.logger.error(`企微回调处理失败: ${(e as Error).message}`);
      // 已返回 200 时避免重复响应
    }
  }
}
