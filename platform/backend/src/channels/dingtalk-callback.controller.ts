import { Body, Controller, Headers, Logger, Param, Post, Query, Res } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { timingSafeEqual } from 'crypto';
import { Response } from 'express';
import { Repository } from 'typeorm';
import { Channel } from './channel.entity';
import { DingTalkService } from './dingtalk.service';
import { SecretsService } from '../secrets/secrets.service';
import { channelSecretFields } from './channel-secrets';
import { dingTalkConnectionMode } from './dingtalk-channel.util';

/**
 * 钉钉 HTTP 模式机器人消息入口。
 * 回调 URL 按渠道 ID + 随机令牌精确路由，不接受未启用或 Stream 模式的渠道。
 */
@Controller('callback/dingtalk')
export class DingTalkCallbackController {
  private readonly logger = new Logger(DingTalkCallbackController.name);

  constructor(
    @InjectRepository(Channel) private readonly channels: Repository<Channel>,
    private readonly dingtalk: DingTalkService,
    private readonly secrets: SecretsService,
  ) {}

  @Post(':channelId')
  async receive(
    @Param('channelId') channelId: string,
    @Query('token') token: string,
    @Headers('timestamp') timestamp: string | undefined,
    @Headers('sign') signature: string | undefined,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    const channel = await this.channels.findOne({
      where: { id: channelId, type: 'dingtalk', status: 'connected', isActive: true },
    });
    if (!channel) return res.status(404).json({ code: 40401, message: '钉钉 HTTP 渠道不存在或未启用' });

    const config = this.secrets.decryptRecord(channel.config, channelSecretFields(channel.type));
    if (dingTalkConnectionMode(config) !== 'http') {
      return res.status(409).json({ code: 40901, message: '该渠道当前使用 Stream 模式' });
    }
    if (!this.safeEqual(token ?? '', config.callback_token ?? '')) {
      return res.status(403).json({ code: 40301, message: '回调令牌校验失败' });
    }
    // 部分钉钉 HTTP 应用会附带 timestamp/sign；出现任一字段时必须成对且验签通过。
    if ((timestamp || signature) && !this.dingtalk.verifyHttpSignature(timestamp ?? '', signature ?? '', config.app_secret ?? '')) {
      return res.status(403).json({ code: 40302, message: '钉钉回调签名校验失败' });
    }

    try {
      const result = await this.dingtalk.handleHttpMessage(channel.id, channel.tenantId, body);
      // 无 sessionWebhook/OpenAPI 回复通道时，按钉钉文本消息格式同步回包。
      if (result.processed && result.answer && !result.replied) {
        return res.status(200).json({ msgtype: 'text', text: { content: result.answer } });
      }
      return res.status(200).json({ success: true });
    } catch (error) {
      this.logger.error(`钉钉 HTTP 回调处理失败: ${(error as Error).message}`);
      return res.status(500).json({ code: 50001, message: '回调处理失败' });
    }
  }

  private safeEqual(actual: string, expected: string): boolean {
    if (!actual || !expected) return false;
    const left = Buffer.from(actual);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
