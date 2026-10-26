import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../audit/audit-log.entity';
import { Tenant } from '../tenants/tenant.entity';
import { Notification } from '../notifications/notification.entity';
import { PlatformAuditController } from './platform-audit.controller';
import { PlatformNotificationsController } from './platform-notifications.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog, Tenant, Notification])],
  controllers: [PlatformAuditController, PlatformNotificationsController],
})
export class PlatformAuditModule {}
