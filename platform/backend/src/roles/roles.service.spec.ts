import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { RolesService } from './roles.service';
import { TENANT_ADMIN_WINDOWS } from '../tenants/tenant-account.defaults';

const repository = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  count: jest.fn(),
  create: jest.fn((value) => value),
  save: jest.fn(async (value) => value),
  delete: jest.fn(),
});

describe('RolesService — 租户管理账号与角色权限', () => {
  const roles = repository();
  const permissions = repository();
  const departments = repository();
  const departmentKbs = repository();
  const accounts = repository();
  const knowledgeBases = repository();
  let service: RolesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RolesService(
      roles as any,
      permissions as any,
      departments as any,
      departmentKbs as any,
      accounts as any,
      knowledgeBases as any,
    );
  });

  it('按账号绑定的角色实时返回后台功能权限', async () => {
    const account = {
      id: 'account-1',
      tenantId: 'tenant-1',
      roleId: 'role-service',
      role: 'TENANT_OPS',
      status: 'ACTIVE',
    };
    accounts.findOne.mockResolvedValue(account);
    roles.findOne.mockResolvedValue({
      id: 'role-service',
      tenantId: 'tenant-1',
      name: '客服主管',
      status: 'ACTIVE',
      isBuiltin: false,
    });
    permissions.find.mockResolvedValue([
      { roleId: 'role-service', resourceType: 'window', resourceId: 'users' },
      {
        roleId: 'role-service',
        resourceType: 'window',
        resourceId: 'messages',
      },
      { roleId: 'role-service', resourceType: 'window', resourceId: 'unknown' },
    ]);

    await expect(
      service.accountAccess('account-1', 'tenant-1'),
    ).resolves.toMatchObject({
      account,
      roleId: 'role-service',
      roleName: '客服主管',
      authority: 'TENANT_OP',
      windows: ['users', 'messages'],
    });
  });

  it('拒绝分配其他租户的角色', async () => {
    roles.findOne.mockResolvedValue(null);

    await expect(
      service.roleAssignment('tenant-1', 'foreign-role'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(roles.findOne).toHaveBeenCalledWith({
      where: { id: 'foreign-role', tenantId: 'tenant-1' },
    });
  });

  it('内置管理员始终保留全部后台功能权限', async () => {
    roles.findOne.mockResolvedValue({
      id: 'role-admin',
      tenantId: 'tenant-1',
      name: '管理员',
      isBuiltin: true,
      status: 'ACTIVE',
    });

    await expect(
      service.setRolePerms('tenant-1', 'role-admin', 'window', ['users']),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(permissions.delete).not.toHaveBeenCalled();

    await service.setRolePerms('tenant-1', 'role-admin', 'window', [
      ...TENANT_ADMIN_WINDOWS,
    ]);
    expect(permissions.delete).toHaveBeenCalledWith({
      roleId: 'role-admin',
      resourceType: 'window',
    });
  });

  it('有管理账号绑定的自定义角色不可删除', async () => {
    roles.findOne.mockResolvedValue({
      id: 'role-custom',
      tenantId: 'tenant-1',
      name: '自定义角色',
      isBuiltin: false,
      status: 'ACTIVE',
    });
    accounts.count.mockResolvedValue(1);

    await expect(
      service.removeRole('tenant-1', 'role-custom'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(roles.delete).not.toHaveBeenCalled();
  });

  it('保存知识权限时把旧本地知识库 ID 转为 datasetId', async () => {
    roles.findOne.mockResolvedValue({
      id: 'role-user',
      tenantId: 'tenant-1',
      name: '用户',
      isBuiltin: true,
      status: 'ACTIVE',
    });
    knowledgeBases.find.mockResolvedValue([
      {
        id: 'local-kb-1',
        tenantId: 'tenant-1',
        datasetId: 'dataset-1',
      },
    ]);

    await service.setRolePerms('tenant-1', 'role-user', 'kb', [
      'local-kb-1',
    ]);

    expect(permissions.create).toHaveBeenCalledWith({
      roleId: 'role-user',
      resourceType: 'kb',
      resourceId: 'dataset-1',
    });
  });

  it('全部门知识库不因部门矩阵为空被误过滤', async () => {
    knowledgeBases.find.mockResolvedValue([
      {
        id: 'local-public',
        tenantId: 'tenant-1',
        datasetId: 'dataset-public',
        visibility: 'all',
        deptIds: [],
      },
      {
        id: 'local-private',
        tenantId: 'tenant-1',
        datasetId: 'dataset-private',
        visibility: 'restricted',
        deptIds: ['dept-1'],
      },
    ]);
    departments.findOne.mockResolvedValue({
      id: 'dept-1',
      tenantId: 'tenant-1',
    });
    departmentKbs.find.mockResolvedValue([]);

    await expect(
      service.filterKnowledgeForDepartment('tenant-1', 'dept-1', [
        'dataset-public',
        'dataset-private',
      ]),
    ).resolves.toEqual(['dataset-public', 'dataset-private']);

    await expect(
      service.filterKnowledgeForDepartment('tenant-1', undefined, [
        'dataset-public',
        'dataset-private',
      ]),
    ).resolves.toEqual(['dataset-public']);
  });
});
