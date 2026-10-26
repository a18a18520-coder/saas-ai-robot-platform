import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from './channel.entity';
import { ChannelsController } from './channels.controller';
import { WeComService } from './wecom.service';
import { DingTalkService } from './dingtalk.service';
import { FeishuService } from './feishu.service';
import { WeComCallbackController } from './wecom-callback.controller';
import { DingTalkCallbackController } from './dingtalk-callback.controller';
import { WebChatController } from './web-chat.controller';
import { AiRouterModule } from '../ai-router/ai-router.module';
import { GroupsModule } from '../groups/groups.module';
import { GroupMember } from '../groups/group-member.entity';
import { UsersModule } from '../users/users.module';
import { FollowUp } from '../follow-ups/follow-up.entity';
import { FollowUpReplyController } from './follow-up-reply.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Channel, GroupMember, FollowUp]), AiRouterModule, GroupsModule, UsersModule],
  controllers: [ChannelsController, WeComCallbackController, DingTalkCallbackController, WebChatController, FollowUpReplyController],
  providers: [WeComService, DingTalkService, FeishuService],
  exports: [WeComService, DingTalkService, FeishuService],
})
export class ChannelsModule {}
