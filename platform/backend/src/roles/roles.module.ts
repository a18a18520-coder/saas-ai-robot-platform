import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role, RolePermission, Dept, DeptKb } from './role.entity';
import { RolesService } from './roles.service';
import { RolesController } from './roles.controller';
import { TenantAccount } from '../tenants/tenant-account.entity';
import { KnowledgeBase } from '../knowledge/knowledge-base.entity';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Role,
      RolePermission,
      Dept,
      DeptKb,
      TenantAccount,
      KnowledgeBase,
    ]),
  ],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
