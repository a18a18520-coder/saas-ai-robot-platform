import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tool } from './tool.entity';
import { PlatformToolsController } from './platform-tools.controller';
import { TenantToolsController } from './tenant-tools.controller';
import { PlatformToolsService } from './platform-tools.service';
import { ToolExecutorService } from '../ai-router/tool-executor.service';

@Module({
  imports: [TypeOrmModule.forFeature([Tool])],
  controllers: [PlatformToolsController, TenantToolsController],
  providers: [PlatformToolsService, ToolExecutorService],
})
export class PlatformToolsModule {}
