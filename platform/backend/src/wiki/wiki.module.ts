import { WikiGraphService } from './wiki-graph.service';
import { WikiGenerationService } from './wiki-generation.service';
import { Body, Controller, Get, Global, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WikiPage, WikiVersion } from './wiki.entity';
import { WikiService } from './wiki.service';
import { WikiImportService } from './wiki-import.service';
import { KnowledgeModule } from '../knowledge/knowledge.module';
@Controller('api/v1/tenant/wiki')
class WikiController {
  constructor(private readonly wiki: WikiService, private readonly importer: WikiImportService, private readonly generation: WikiGenerationService, private readonly graph: WikiGraphService) {}
  @Post('import-document') importDocument(@Query('tenantId') t: string, @Body() b: { datasetId: string; documentId: string }) { return this.importer.importDocument(t, b.datasetId, b.documentId); }
  @Get('generation-jobs') jobs(@Query('tenantId') t: string, @Query('datasetId') d: string) { return this.generation.list(t, d); }
  @Post('generation-jobs/:id/retry') retry(@Query('tenantId') t: string, @Param('id') id: string) { return this.generation.retry(t, id); }
  @Get() list(@Query('tenantId') t: string) { return this.wiki.list(t); }
  @Post() create(@Query('tenantId') t: string, @Body() b: Partial<WikiPage>) { return this.wiki.save(t, b); }
  @Patch(':id') save(@Query('tenantId') t: string, @Param('id') id: string, @Body() b: Partial<WikiPage>) { return this.wiki.save(t, b, id); }
  @Get(':id/graph') graphStatus(@Query('tenantId') t: string, @Param('id') id: string) { return this.graph.list(t, id); }
  @Post(':id/graph/retry') graphRetry(@Query('tenantId') t: string, @Param('id') id: string) { return this.graph.retry(t, id); }
  @Get(':id/versions') versions(@Query('tenantId') t: string, @Param('id') id: string) { return this.wiki.history(t, id); }
  @Post(':id/restore') restore(@Query('tenantId') t: string, @Param('id') id: string, @Body() b: { version: number; revision: number }) { return this.wiki.restore(t, id, b.version, b.revision); }
  @Post(':id/publish') publish(@Query('tenantId') t: string, @Param('id') id: string, @Body() b: { revision: number }) { return this.wiki.publish(t, id, b.revision); }
  @Post(':id/archive') archive(@Query('tenantId') t: string, @Param('id') id: string) { return this.wiki.archive(t, id); }
}
@Global()
@Module({ imports: [KnowledgeModule, TypeOrmModule.forFeature([WikiPage, WikiVersion])], controllers: [WikiController], providers: [WikiService, WikiImportService, WikiGenerationService, WikiGraphService], exports: [WikiGraphService] })
export class WikiModule {}
