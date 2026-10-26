import { IngestionJob } from './ingestion.entity';
import { IngestionService } from './ingestion.service';
import { PipelineController } from './pipeline.controller';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeFile, TenantKnowledgeController } from './tenant-knowledge.controller';
import { KnowledgeBase } from './knowledge-base.entity';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { Dept } from '../roles/role.entity';

@Module({
  imports: [TypeOrmModule.forFeature([KnowledgeFile, KnowledgeBase, Dept, IngestionJob])],
  controllers: [TenantKnowledgeController, KnowledgeBaseController, PipelineController],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class KnowledgeModule {}
