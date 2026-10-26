import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentOrder } from './payment-order.entity';
import { Tenant } from '../tenants/tenant.entity';
import { Plan } from '../plans/plan.entity';
import { Notification } from '../notifications/notification.entity';
import { PaymentsController } from './payments.controller';
import { AdminPaymentsController } from './admin-payments.controller';
import { AuditModule } from '../audit/audit.module';
import { PaymentGatewayService } from './payment-gateway.service';
import { PaymentSettlementService } from './payment-settlement.service';
import { PaymentCallbackController } from './payment-callback.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentOrder, Tenant, Plan, Notification]), AuditModule],
  controllers: [PaymentsController, AdminPaymentsController, PaymentCallbackController],
  providers: [PaymentGatewayService, PaymentSettlementService],
  exports: [PaymentGatewayService],
})
export class PaymentsModule {}
