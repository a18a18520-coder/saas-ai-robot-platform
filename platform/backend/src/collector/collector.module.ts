import { Module } from '@nestjs/common';
import { AiRouterModule } from '../ai-router/ai-router.module';
import { CollectorController } from './collector.controller';
import { CollectorService } from './collector.service';
@Module({ imports: [AiRouterModule], controllers: [CollectorController], providers: [CollectorService] })
export class CollectorModule {}
