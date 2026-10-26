import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformAccount, PlatformRole } from './platform-identity.entity';
import { PlatformIdentityController } from './platform-identity.controller';
import { PlatformIdentityService } from './platform-identity.service';
import { AuditModule } from '../audit/audit.module';
import { LoginLog } from '../tenants/tenant-account.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlatformAccount, PlatformRole, LoginLog]),
    AuditModule,
  ],
  controllers: [PlatformIdentityController],
  providers: [PlatformIdentityService],
  exports: [PlatformIdentityService],
})
export class PlatformIdentityModule {}
