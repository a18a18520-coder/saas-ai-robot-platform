import { BadRequestException, Body, Controller, ForbiddenException, HttpException, HttpStatus, Logger, NotFoundException, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiRouterService } from '../ai-router/ai-router.service';
import { Channel } from './channel.entity';
import { isWebOriginAllowed, siteKeysEqual } from './web-channel.util';

/**
 * Web 聊天公开端点（嵌入网页对话窗）：
 *  - 匿名可调（访客身份由 visitorId 标识，localStorage 持久）
 *  - 通过 Web 渠道站点键、启用状态、绑定机器人与父站点域名白名单后进入 AI Router
 */
@Controller('api/v1/public/chat')
export class WebChatController {
  private readonly logger = new Logger(WebChatController.name);
  private readonly rateLimits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly router: AiRouterService,
    @InjectRepository(Channel) private readonly channels: Repository<Channel>,
  ) {}

  @Post()
  async chat(@Body() body: { channelId: string; siteKey: string; siteOrigin: string; visitorId: string; content: string; conversationId?: string; newConversation?: boolean }) {
    const { channelId, siteKey, siteOrigin, visitorId } = body ?? {};
    const content = typeof body?.content === 'string' ? body.content.trim() : '';
    if (!channelId || !siteKey || !siteOrigin || !visitorId || !content) throw new BadRequestException({ code: 40001, message: 'Web 渠道、站点来源、访客和消息内容均为必填项', data: null });
    if (visitorId.length > 128 || content.length > 2000) throw new BadRequestException({ code: 40001, message: '访客标识不能超过 128 字符，消息不能超过 2000 字符', data: null });
    const channel = await this.channels.findOne({ where: { id: channelId, type: 'web' } });
    if (!channel || !siteKeysEqual(siteKey, channel.config.site_key ?? '')) throw new NotFoundException({ code: 40401, message: 'Web 聊天渠道不存在', data: null });
    if (channel.status !== 'connected' || !channel.isActive || !channel.bindRobotId) throw new ForbiddenException({ code: 40301, message: 'Web 聊天渠道尚未启用或未绑定机器人', data: null });
    if (!isWebOriginAllowed(siteOrigin, channel.config.domains ?? '')) throw new ForbiddenException({ code: 40301, message: '当前网站不在 Web 渠道域名白名单中', data: null });
    this.consumeRateLimit(channel.id, visitorId);
    this.logger.log(`Web 聊天: 访客=${visitorId.slice(0, 8)}… 内容=${content.slice(0, 30)}`);
    const result = await this.router.handleMessage({
      tenantId: channel.tenantId,
      channel: 'web',
      channelUserId: visitorId,
      robotId: channel.bindRobotId,
      isAtRobot: true,
      content,
      ...(body.conversationId ? { conversationId: body.conversationId } : {}),
      ...(body.newConversation ? { newConversation: true } : {}),
    });
    return { code: 0, message: 'success', data: result };
  }

  private consumeRateLimit(channelId: string, visitorId: string): void {
    const key = `${channelId}:${visitorId}`;
    const now = Date.now();
    if (this.rateLimits.size >= 10_000) {
      for (const [entryKey, entry] of this.rateLimits) if (entry.resetAt <= now) this.rateLimits.delete(entryKey);
      if (this.rateLimits.size >= 10_000 && !this.rateLimits.has(key)) {
        throw new HttpException({ code: 42901, message: 'Web 聊天访问繁忙，请稍后再试', data: null }, HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    const current = this.rateLimits.get(key);
    if (!current || current.resetAt <= now) {
      this.rateLimits.set(key, { count: 1, resetAt: now + 60_000 });
      return;
    }
    if (current.count >= 30) throw new HttpException({ code: 42901, message: '消息发送过于频繁，请稍后再试', data: null }, HttpStatus.TOO_MANY_REQUESTS);
    current.count++;
  }
}
