import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantDifyResource } from './tenant-dify-resource.entity';
import { DifyClientService } from './dify-client.service';
import { DifyResourceService } from './dify-resource.service';
import { DifyController } from './dify.controller';
import { TenantDifyController } from './tenant-dify.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([TenantDifyResource])],
  controllers: [DifyController, TenantDifyController],
  providers: [DifyClientService, DifyResourceService],
  exports: [DifyClientService, DifyResourceService],
})
export class DifyModule {}
