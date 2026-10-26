import { Controller, Get, Query } from '@nestjs/common';
import { DifyResourceService } from './dify-resource.service';

/** 租户只读查看平台已分配给自己的 Dify 资源。 */
@Controller('api/v1/tenant/dify')
export class TenantDifyController {
  constructor(private readonly resources: DifyResourceService) {}

  @Get('resources')
  list(@Query('tenantId') tenantId: string) {
    return this.resources.listByTenant(tenantId);
  }
}
