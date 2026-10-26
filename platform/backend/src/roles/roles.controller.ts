import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RolesService } from './roles.service';

/** 角色权限管理（FR-008/FR-010）：角色 + 部门双视图 */
@Controller('api/v1/tenant/roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  // ===== 角色 =====
  @Get()
  list(@Query('tenantId') tenantId: string) {
    return this.roles.listRoles(tenantId);
  }

  @Post()
  create(
    @Body() body: { tenantId: string; name: string; copyFromId?: string },
  ) {
    return this.roles.createRole(body.tenantId, body.name, body.copyFromId);
  }

  @Get(':id/permissions')
  perms(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    return this.roles.getRolePerms(tenantId, id);
  }

  @Put(':id/permissions/:type')
  setPerms(
    @Param('id') id: string,
    @Param('type') type: 'window' | 'kb' | 'tool' | 'robot',
    @Query('tenantId') tenantId: string,
    @Body() body: { resourceIds: string[] },
  ) {
    return this.roles.setRolePerms(tenantId, id, type, body.resourceIds ?? []);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    return this.roles.removeRole(tenantId, id);
  }

  // ===== 部门 =====
  @Get('depts')
  listDepts(@Query('tenantId') tenantId: string) {
    return this.roles.listDepts(tenantId);
  }

  @Post('depts')
  createDept(@Body() body: { tenantId: string; name: string }) {
    return this.roles.createDept(body.tenantId, body.name);
  }

  @Get('depts/:id/kbs')
  deptKbs(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    return this.roles.getDeptKbs(tenantId, id);
  }

  @Put('depts/:id/kbs')
  setDeptKbs(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string,
    @Body() body: { knowledgeIds: string[] },
  ) {
    return this.roles.setDeptKbs(tenantId, id, body.knowledgeIds ?? []);
  }

  @Delete('depts/:id')
  removeDept(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    return this.roles.removeDept(tenantId, id);
  }
}
