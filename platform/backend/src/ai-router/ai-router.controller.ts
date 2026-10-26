import { Body, Controller, Post } from '@nestjs/common';
import { AiRouterService } from './ai-router.service';

/** 消息入口（FR-003 核心链路）：企微回调/Web 消息 → AI Router */
@Controller('api/v1/tenant/messages')
export class AiRouterController {
  constructor(private readonly router: AiRouterService) {}

  @Post()
  handle(@Body() body: {
    tenantId: string;
    channel: string;
    channelId?: string;
    channelUserId: string;
    chatId?: string;
    robotId?: string;
    conversationId?: string;
    newConversation?: boolean;
    isAtRobot: boolean;
    content: string;
    sourceMessageId?: string;
  }) {
    return this.router.handleMessage(body);
  }
}
