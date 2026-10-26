import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CollectionService } from './collection.service';

@Controller('api/v1/tenant/robots')
export class CollectionController {
  constructor(private readonly collection: CollectionService) {}
  @Get(':id/collections')
  list(@Query('tenantId') tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Query('page') page?: string, @Query('status') status?: string) {
    return this.collection.list(tenantId, id, page, status);
  }
  @Post(':id/collection-preview')
  preview(@Query('tenantId') tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: { config?: unknown; content: string }) {
    return this.collection.preview(tenantId, id, body.config, body.content);
  }
  @Post(':id/collections/:recordId/retry')
  retry(@Query('tenantId') tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Param('recordId', ParseUUIDPipe) recordId: string) {
    return this.collection.retry(tenantId, id, recordId);
  }
}
