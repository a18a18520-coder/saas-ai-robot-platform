import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FollowUp } from './follow-up.entity';
import { Notification } from '../notifications/notification.entity';
import { FollowUpsService } from './follow-ups.service';
import { FollowUpsController } from './follow-ups.controller';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { KnowledgeBase } from '../knowledge/knowledge-base.entity';
import { IngestionJob } from '../knowledge/ingestion.entity';
import { Robot } from '../robots/robot.entity';

@Module({
  imports: [KnowledgeModule, TypeOrmModule.forFeature([FollowUp, Notification, KnowledgeBase, IngestionJob, Robot])],
  controllers: [FollowUpsController],
  providers: [FollowUpsService],
  exports: [FollowUpsService],
})
export class FollowUpsModule {}
