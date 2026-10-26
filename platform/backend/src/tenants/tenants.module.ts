import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './tenant.entity';
import { Plan } from '../plans/plan.entity';
import { Robot } from '../robots/robot.entity';
import { Group } from '../groups/group.entity';
import { KnowledgeBase } from '../knowledge/knowledge-base.entity';
import { Channel } from '../channels/channel.entity';
import { User } from '../users/user.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { Notification } from '../notifications/notification.entity';
import { PaymentOrder } from '../payments/payment-order.entity';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { TenantProfileController } from './tenant-profile.controller';
import { TenantAccountsController } from './tenant-accounts.controller';
import { TenantAccount, LoginLog } from './tenant-account.entity';
import { AuditModule } from '../audit/audit.module';
import { PlansModule } from '../plans/plans.module';
import { AuthModule } from '../auth/auth.module';
import { ActivationEmailService } from './activation-email.service';
import { PaymentsModule } from '../payments/payments.module';
import { RolesModule } from '../roles/roles.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Tenant, Plan, Robot, Group, KnowledgeBase, Channel, User, AuditLog, Notification, PaymentOrder, TenantAccount, LoginLog]),
    PlansModule,
    AuditModule,
    AuthModule,
    PaymentsModule,
    RolesModule,
  ],
  controllers: [TenantsController, TenantProfileController, TenantAccountsController],
  providers: [TenantsService, TenantLifecycleService, ActivationEmailService],
  exports: [TenantsService, TenantLifecycleService],
})
export class TenantsModule {}
