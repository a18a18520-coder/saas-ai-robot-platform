import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { Plan } from '../plans/plan.entity';
import { Robot } from '../robots/robot.entity';
import { Group } from '../groups/group.entity';
import { User } from '../users/user.entity';
import { Conversation, Message } from '../sessions/conversation.entity';
import { KnowledgeBase } from '../knowledge/knowledge-base.entity';
import { FollowUp } from '../follow-ups/follow-up.entity';
import { Channel } from '../channels/channel.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { PaymentOrder } from '../payments/payment-order.entity';
import { StatsController } from './stats.controller';
import { PlatformStatsController } from './platform-stats.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Tenant, Plan, Robot, Group, User, Conversation, Message, KnowledgeBase, FollowUp, Channel, AuditLog, PaymentOrder]),
  ],
  controllers: [StatsController, PlatformStatsController],
})
export class StatsModule {}
