import { Global, Module } from '@nestjs/common';
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModelConfig } from './model.entity';
import { ModelsService } from './models.service';
import { ModelUsageService, RobotUsageController } from './model-usage.service';
@Controller('api/v1/admin/models')
class ModelsController {
  constructor(private readonly models: ModelsService) {}
  @Get() list() { return this.models.list(); }
  @Post() create(@Body() body: Partial<ModelConfig>) { return this.models.save(body); }
  @Patch(':id') update(@Param('id') id: string, @Body() body: Partial<ModelConfig>) { return this.models.save(body, id); }
  @Post(':id/test') test(@Param('id') id: string) { return this.models.test(id); }
}
@Controller('api/v1/tenant/models')
class TenantModelsController {
  constructor(private readonly models: ModelsService) {}
  @Get() list(@Query('tenantId') tenantId: string) { return this.models.available(tenantId); }
  @Get('policy') policy(@Query('tenantId') tenantId: string) { return this.models.tenantPolicy(tenantId); }
}
@Controller('api/v1/admin/models/tenants')
export class TenantModelPoliciesController {
  constructor(private readonly models: ModelsService) {}
  @Get(':id') policy(@Param('id') id: string) { return this.models.tenantPolicy(id); }
  @Patch(':id') update(@Param('id') id: string, @Body() body: { primaryModelId: string; fallbackModelId?: string; rerankModelId?: string }) { return this.models.saveTenantPolicy(id, body); }
}
@Global()
@Module({ imports: [TypeOrmModule.forFeature([ModelConfig])], controllers: [ModelsController, TenantModelsController, RobotUsageController, TenantModelPoliciesController], providers: [ModelsService, ModelUsageService], exports: [ModelsService] })
export class ModelsModule {}
