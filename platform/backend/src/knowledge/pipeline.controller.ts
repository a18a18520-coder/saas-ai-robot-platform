import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KnowledgeBase } from './knowledge-base.entity';
import { IngestionService } from './ingestion.service';
import { DifyClientService } from '../dify/dify-client.service';
@Controller('api/v1/tenant/knowledge')
export class PipelineController {
  constructor(@InjectRepository(KnowledgeBase) private readonly kbs: Repository<KnowledgeBase>, private readonly ingestion: IngestionService, private readonly dify: DifyClientService) {}
  private async kb(tenantId: string, datasetId: string) { const kb = await this.kbs.findOne({ where: { tenantId, datasetId } }); if (!kb) throw new NotFoundException('知识库不存在'); return kb; }
  @Get(':id/pipeline') async config(@Query('tenantId') t: string, @Param('id') id: string) { return (await this.kb(t, id)).pipelineConfig; }
  @Get(':id/pipeline/nodes') async nodes(@Query('tenantId') t: string, @Param('id') id: string) { await this.kb(t, id); return this.dify.pipelineNodes(id); }
  @Put(':id/pipeline') async save(@Query('tenantId') t: string, @Param('id') id: string, @Body() config: KnowledgeBase['pipelineConfig']) {
    const kb = await this.kb(t, id);
    if (typeof config.startNodeId !== 'string' || !config.startNodeId.trim() || config.startNodeId.length > 100) throw new BadRequestException('请输入有效的数据源节点标识');
    if (config.inputs && (typeof config.inputs !== 'object' || Array.isArray(config.inputs))) throw new BadRequestException('流水线输入需为对象');
    if (JSON.stringify(config.inputs ?? {}).length > 20000) throw new BadRequestException('输入配置过长');
    if (config.autoWiki !== undefined && typeof config.autoWiki !== 'boolean') throw new BadRequestException('自动生成 Wiki 设置无效');
    kb.pipelineConfig = { autoWiki: config.autoWiki ?? kb.pipelineConfig.autoWiki ?? false, startNodeId: config.startNodeId, inputs: config.inputs ?? {}, version: new Date().toISOString() };
    await this.kbs.save(kb); return kb.pipelineConfig;
  }
  @Get(':id/jobs') async jobs(@Query('tenantId') t: string, @Param('id') id: string) { await this.kb(t, id); return this.ingestion.list(t, id); }
  @Post(':id/jobs/:jobId/retry') async retry(@Query('tenantId') t: string, @Param('id') id: string, @Param('jobId') jobId: string) { await this.kb(t, id); return this.ingestion.retry(t, jobId); }
}
