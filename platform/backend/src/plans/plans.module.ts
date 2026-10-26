import { Global, Module } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Plan } from './plan.entity';
import { Tenant } from '../tenants/tenant.entity';
import { PlanPriceService } from './plan-price.service';
import { PlansService } from './plans.service';
import { PlansController } from './plans.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Plan, Tenant])],
  controllers: [PlansController],
  providers: [PlanPriceService, PlansService, SubscriptionService],
  exports: [PlanPriceService, PlansService, SubscriptionService],
})
export class PlansModule {}
