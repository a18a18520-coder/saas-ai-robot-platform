import { Tool } from '../platform-tools/tool.entity';
import { ToolExecutorService } from './tool-executor.service';
import { ToolConversationService } from './tool-conversation.service';
import { KnowledgeFile } from '../knowledge/tenant-knowledge.controller';
import { AnswerService } from './answer.service';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentFilterModule } from '../content-filter/content-filter.module';
import { AiRouterService } from './ai-router.service';
import { AiRouterController } from './ai-router.controller';
import { Robot } from '../robots/robot.entity';
import { Group } from '../groups/group.entity';
import { GroupMember } from '../groups/group-member.entity';
import { Conversation, Message } from '../sessions/conversation.entity';
import { Tenant } from '../tenants/tenant.entity';
import { Plan } from '../plans/plan.entity';
import { Notification } from '../notifications/notification.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { UsersModule } from '../users/users.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { FollowUpsModule } from '../follow-ups/follow-ups.module';
import { AiQuotaService } from './ai-quota.service';
import { CollectionRecord } from '../robots/collection-record.entity';
import { CollectionService } from './collection.service';
import { CollectionController } from './collection.controller';

@Module({
  imports: [
    ContentFilterModule,
    TypeOrmModule.forFeature([CollectionRecord, Tool, KnowledgeFile, Robot, Group, GroupMember, Conversation, Message, Tenant, Plan, Notification, AuditLog]),
    UsersModule,
    PermissionsModule,
    FollowUpsModule,
  ],
  controllers: [AiRouterController, CollectionController],
  providers: [AiRouterService, AiQuotaService, AnswerService, ToolExecutorService, ToolConversationService, CollectionService],
  exports: [AiRouterService, CollectionService],
})
export class AiRouterModule {}
