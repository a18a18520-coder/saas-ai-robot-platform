import { useFeedback, usePageTab, TabBar, TabPanel, Feedback, confirmAction, AsyncButton, ModalFrame } from '../components/Interaction';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { fmtDateTime } from '../api/datetime';

type Permission =
  | 'dashboard'
  | 'notifications'
  | 'tenants'
  | 'plans'
  | 'payments'
  | 'dify'
  | 'audit'
  | 'stats'
  | 'tools'
  | 'filter'
  | 'settings';

interface Role {
  id: string;
  code: string;
  name: string;
  description?: string;
  permissions: Permission[];
  isSuperAdmin: boolean;
  isBuiltin: boolean;
  createdAt: string;
}

interface Account {
  id: string;
  name: string;
  account: string;
  roleId: string;
  roleName: string;
  permissions: Permission[];
  isSuperAdmin: boolean;
  status: 'ACTIVE' | 'DISABLED';
  isBuiltin: boolean;
  lastLoginAt?: string;
  createdAt: string;
}

interface LoginLog {
  id: string;
  account: string;
  ip: string;
  result: '成功' | '失败';
  createdAt: string;
}

const PERMISSIONS: Array<{
  key: Permission;
  label: string;
  description: string;
}> = [
  { key: 'dashboard', label: '平台工作台', description: '查看全局运营概览' },
  {
    key: 'notifications',
    label: '通知中心',
    description: '查看并处理平台通知',
  },
  { key: 'tenants', label: '租户管理', description: '开通、停用与维护租户' },
  { key: 'plans', label: '套餐管理', description: '维护套餐与资源配额' },
  { key: 'payments', label: '支付核销', description: '查看订单与核销对公转账' },
  { key: 'dify', label: 'Dify 资源', description: '同步并分配 AI 资源' },
  { key: 'audit', label: '平台审计', description: '查询操作与 AI 调用记录' },
  { key: 'stats', label: '平台统计', description: '查看租户、收入与调用趋势' },
  { key: 'tools', label: '工具管理', description: '维护租户外部接口工具' },
  { key: 'filter', label: '内容名单', description: '维护全局黑白名单' },
  { key: 'settings', label: '平台设置', description: '修改平台连接与全局策略' },
];

const emptyAccount = () => ({
  name: '',
  account: '',
  password: '',
  roleId: '',
  status: 'ACTIVE' as Account['status'],
});

const emptyRole = () => ({
  name: '',
  description: '',
  permissions: ['dashboard'] as Permission[],
});

/** 平台账号与角色：固定超管、角色权限矩阵、账号生命周期。 */
export default function PlatformAccounts() {
  const [tab, setTab] = usePageTab('accounts', ["accounts","roles","logins"] as const);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loginLogs, setLoginLogs] = useState<LoginLog[]>([]);
  const [message, setMessage] = useFeedback();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accountModal, setAccountModal] = useState(false);
  const [roleModal, setRoleModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [accountForm, setAccountForm] = useState(emptyAccount());
  const [roleForm, setRoleForm] = useState(emptyRole());

  async function load() {
    setLoading(true);
    try {
      const [accountRows, roleRows, logRows] = await Promise.all([
        api<Account[]>('/api/v1/admin/platform/accounts'),
        api<Role[]>('/api/v1/admin/platform/roles'),
        api<LoginLog[]>('/api/v1/admin/platform/login-logs'),
      ]);
      setAccounts(accountRows);
      setRoles(roleRows);
      setLoginLogs(logRows);
    } catch (error) {
      setMessage(`❌ ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const activeCount = accounts.filter(
    (item) => item.status === 'ACTIVE',
  ).length;
  const customRoleCount = roles.filter((item) => !item.isBuiltin).length;
  const assignableRoles = roles.filter((item) => !item.isSuperAdmin);
  const roleUsage = useMemo(
    () =>
      new Map(
        roles.map((role) => [
          role.id,
          accounts.filter((account) => account.roleId === role.id).length,
        ]),
      ),
    [accounts, roles],
  );

  function openCreateAccount() {
    setEditingAccount(null);
    setAccountForm({
      ...emptyAccount(),
      roleId:
        roles.find((role) => role.code === 'PLATFORM_OPERATOR')?.id ??
        assignableRoles[0]?.id ??
        '',
    });
    setAccountModal(true);
    setMessage('');
  }

  function openEditAccount(account: Account) {
    setEditingAccount(account);
    setAccountForm({
      name: account.name,
      account: account.account,
      password: '',
      roleId: account.roleId,
      status: account.status,
    });
    setAccountModal(true);
    setMessage('');
  }

  async function saveAccount() {
    if (
      !accountForm.name.trim() ||
      !accountForm.account.trim() ||
      !accountForm.roleId ||
      (!editingAccount && !accountForm.password)
    ) {
      setMessage('❌ 姓名、账号、角色和初始密码必填');
      return;
    }
    setSaving(true);
    try {
      if (editingAccount) {
        const body: Record<string, unknown> = {
          name: accountForm.name.trim(),
          roleId: accountForm.roleId,
          status: accountForm.status,
        };
        if (accountForm.password) body.password = accountForm.password;
        if (editingAccount.isBuiltin) {
          delete body.name;
          delete body.roleId;
          delete body.status;
        }
        await api(`/api/v1/admin/platform/accounts/${editingAccount.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        setMessage(`✅ 已更新账号「${editingAccount.account}」`);
      } else {
        await api('/api/v1/admin/platform/accounts', {
          method: 'POST',
          body: JSON.stringify({
            name: accountForm.name.trim(),
            account: accountForm.account.trim(),
            password: accountForm.password,
            roleId: accountForm.roleId,
          }),
        });
        setMessage(`✅ 平台账号「${accountForm.account.trim()}」已创建`);
      }
      setAccountModal(false);
      await load();
    } catch (error) {
      setMessage(`❌ ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function toggleAccount(account: Account) {
    const status = account.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    if (
      !(await confirmAction(`${status === 'DISABLED' ? '禁用' : '启用'}账号「${account.account}」？`, { confirmText: status === 'DISABLED' ? '启用账号' : '禁用账号' }))
    )
      return;
    try {
      await api(`/api/v1/admin/platform/accounts/${account.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setMessage(`✅ 账号已${status === 'ACTIVE' ? '启用' : '禁用'}`);
      await load();
    } catch (error) {
      setMessage(`❌ ${(error as Error).message}`);
    }
  }

  async function removeAccount(account: Account) {
    if (!(await confirmAction(`确认删除平台账号「${account.account}」？`, { confirmText: '确认删除' }))) return;
    try {
      await api(`/api/v1/admin/platform/accounts/${account.id}`, {
        method: 'DELETE',
      });
      setMessage('✅ 平台账号已删除');
      await load();
    } catch (error) {
      setMessage(`❌ ${(error as Error).message}`);
    }
  }

  function openCreateRole() {
    setEditingRole(null);
    setRoleForm(emptyRole());
    setRoleModal(true);
    setMessage('');
  }

  function openEditRole(role: Role) {
    setEditingRole(role);
    setRoleForm({
      name: role.name,
      description: role.description ?? '',
      permissions: [...role.permissions],
    });
    setRoleModal(true);
    setMessage('');
  }

  function togglePermission(permission: Permission) {
    setRoleForm((current) => ({
      ...current,
      permissions: current.permissions.includes(permission)
        ? current.permissions.filter((item) => item !== permission)
        : [...current.permissions, permission],
    }));
  }

  async function saveRole() {
    if (!roleForm.name.trim()) {
      setMessage('❌ 角色名称必填');
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: roleForm.name.trim(),
        description: roleForm.description.trim(),
        permissions: roleForm.permissions,
      };
      if (editingRole) {
        await api(`/api/v1/admin/platform/roles/${editingRole.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        setMessage(`✅ 角色「${body.name}」已更新`);
      } else {
        await api('/api/v1/admin/platform/roles', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        setMessage(`✅ 角色「${body.name}」已创建`);
      }
      setRoleModal(false);
      await load();
    } catch (error) {
      setMessage(`❌ ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function removeRole(role: Role) {
    if (!(await confirmAction(`确认删除角色「${role.name}」？`, { confirmText: '确认删除' }))) return;
    try {
      await api(`/api/v1/admin/platform/roles/${role.id}`, {
        method: 'DELETE',
      });
      setMessage('✅ 平台角色已删除');
      await load();
    } catch (error) {
      setMessage(`❌ ${(error as Error).message}`);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>平台账号与角色</h1>
          <div className="desc">管理平台操作人员、工作职责与管理窗口权限</div>
        </div>
        <AsyncButton
          className="btn btn-primary"
          onClick={tab === 'accounts' ? openCreateAccount : openCreateRole}
        >
          + {tab === 'accounts' ? '新增平台账号' : '新建角色'}
        </AsyncButton>
      </div>

      {message && (
        <Feedback message={message} />
      )}

      <div className="identity-summary" aria-label="账号权限概览">
        <div>
          <strong>{accounts.length}</strong>
          <span>平台账号</span>
        </div>
        <div>
          <strong>{activeCount}</strong>
          <span>正在启用</span>
        </div>
        <div>
          <strong>{roles.length}</strong>
          <span>角色总数</span>
        </div>
        <div>
          <strong>{customRoleCount}</strong>
          <span>自定义角色</span>
        </div>
      </div>

      <TabBar items={[["accounts","账号管理"],["roles","角色权限"],["logins","登录记录"]] as const} value={tab} onChange={setTab} />

      <TabPanel id="accounts" active={tab}><div className="card table-wrap">
            <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
              <thead>
                <tr>
                  <th>操作人员</th>
                  <th>登录账号</th>
                  <th>角色</th>
                  <th>状态</th>
                  <th>最近登录</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td className="cell-strong">
                      {account.name}
                      {account.isBuiltin && (
                        <span
                          className="badge badge-info"
                          style={{ marginLeft: 8 }}
                        >
                          固定账号
                        </span>
                      )}
                    </td>
                    <td className="mono">{account.account}</td>
                    <td>{account.roleName}</td>
                    <td>
                      <span
                        className={`badge ${account.status === 'ACTIVE' ? 'badge-success' : 'badge-neutral'}`}
                      >
                        {account.status === 'ACTIVE' ? '启用' : '已禁用'}
                      </span>
                    </td>
                    <td className="cell-muted">
                      {account.lastLoginAt
                        ? fmtDateTime(account.lastLoginAt)
                        : '尚未登录'}
                    </td>
                    <td className="cell-muted">
                      {fmtDateTime(account.createdAt)}
                    </td>
                    <td className="cell-actions">
                      {!account.isBuiltin ? (
                        <>
                          <AsyncButton
                            className="link header-link-button"
                            onClick={() => openEditAccount(account)}
                          >
                            编辑
                          </AsyncButton>
                          <AsyncButton
                            className="link header-link-button"
                            onClick={() => toggleAccount(account)}
                          >
                            {account.status === 'ACTIVE' ? '禁用' : '启用'}
                          </AsyncButton>
                          <AsyncButton
                            className="link danger header-link-button"
                            onClick={() => removeAccount(account)}
                          >
                            删除
                          </AsyncButton>
                        </>
                      ) : (
                        <span className="cell-muted">部署配置维护</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && accounts.length === 0 && (
                  <tr>
                    <td colSpan={7} className="identity-empty">
                      暂无平台账号
                    </td>
                  </tr>
                )}
                {loading && (
                  <tr>
                    <td colSpan={7} className="identity-empty">
                      正在加载账号…
                    </td>
                  </tr>
                )}
              </tbody>
            </table></div>
          </div></TabPanel><TabPanel id="roles" active={tab}><div className="card table-wrap">
          <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
            <thead>
              <tr>
                <th>角色</th>
                <th>用途</th>
                <th>管理窗口</th>
                <th>账号数</th>
                <th>类型</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id}>
                  <td className="cell-strong">{role.name}</td>
                  <td className="cell-muted">{role.description ?? '—'}</td>
                  <td>
                    <div className="permission-tags">
                      {(role.isSuperAdmin
                        ? PERMISSIONS.map((item) => item.key)
                        : role.permissions
                      ).map((permission) => (
                        <span className="badge badge-neutral" key={permission}>
                          {PERMISSIONS.find((item) => item.key === permission)
                            ?.label ?? permission}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>{roleUsage.get(role.id) ?? 0}</td>
                  <td>
                    <span
                      className={`badge ${role.isBuiltin ? 'badge-info' : 'badge-neutral'}`}
                    >
                      {role.isBuiltin ? '内置' : '自定义'}
                    </span>
                  </td>
                  <td className="cell-actions">
                    <AsyncButton
                      className="link header-link-button"
                      onClick={() => openEditRole(role)}
                    >
                      {role.isBuiltin ? '查看' : '编辑'}
                    </AsyncButton>
                    {!role.isBuiltin && (
                      <AsyncButton
                        className="link danger header-link-button"
                        onClick={() => removeRole(role)}
                      >
                        删除
                      </AsyncButton>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && roles.length === 0 && (
                <tr>
                  <td colSpan={6} className="identity-empty">
                    暂无平台角色
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={6} className="identity-empty">
                    正在加载角色…
                  </td>
                </tr>
              )}
            </tbody>
          </table></div>
        </div></TabPanel><TabPanel id="logins" active={tab}><div className="card table-wrap">
            <div className="card-head" style={{ marginBottom: 12 }}>
              <div>
                <div className="card-title">平台登录记录</div>
                <div className="card-sub">
                  最近 30 次登录结果，用于账号异常排查
                </div>
              </div>
            </div>
            <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>账号</th>
                  <th>IP</th>
                  <th>结果</th>
                </tr>
              </thead>
              <tbody>
                {loginLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="cell-muted">{fmtDateTime(log.createdAt)}</td>
                    <td className="mono">{log.account || '—'}</td>
                    <td className="mono">{log.ip}</td>
                    <td>
                      <span
                        className={`badge ${log.result === '成功' ? 'badge-success' : 'badge-error'}`}
                      >
                        {log.result}
                      </span>
                    </td>
                  </tr>
                ))}
                {loginLogs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="identity-empty">
                      暂无平台登录记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table></div>
          </div></TabPanel>

      {accountModal && (
        <ModalFrame title={editingAccount ? '编辑平台账号' : '新增平台账号'} onClose={() => { setAccountModal(false); }}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-dialog-title"
          >
            <div className="m-head">
              <h3 id="account-dialog-title">
                {editingAccount
                  ? editingAccount.isBuiltin
                    ? '重置固定账号密码'
                    : '编辑平台账号'
                  : '新增平台账号'}
              </h3>
              <AsyncButton closeDialog
                className="x"
                aria-label="关闭"
                onClick={() => setAccountModal(false)}
              >
                ×
              </AsyncButton>
            </div>
            <div className="m-body">
              <div className="form-item">
                <label>姓名</label>
                <input
                  className="input"
                  disabled={editingAccount?.isBuiltin}
                  value={accountForm.name}
                  onChange={(event) =>
                    setAccountForm({ ...accountForm, name: event.target.value })
                  }
                />
              </div>
              <div className="form-item">
                <label>登录账号</label>
                <input
                  className="input"
                  disabled={Boolean(editingAccount)}
                  autoComplete="username"
                  value={accountForm.account}
                  onChange={(event) =>
                    setAccountForm({
                      ...accountForm,
                      account: event.target.value,
                    })
                  }
                  placeholder="name@example.com"
                />
              </div>
              <div className="form-item">
                <label>
                  {editingAccount ? '新密码（留空保持不变）' : '初始密码'}
                </label>
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={accountForm.password}
                  onChange={(event) =>
                    setAccountForm({
                      ...accountForm,
                      password: event.target.value,
                    })
                  }
                  placeholder="至少 10 位，包含字母和数字"
                />
              </div>
              <div className="form-row">
                <div className="form-item">
                  <label>角色</label>
                  <select
                    className="select"
                    disabled={editingAccount?.isBuiltin}
                    value={accountForm.roleId}
                    onChange={(event) =>
                      setAccountForm({
                        ...accountForm,
                        roleId: event.target.value,
                      })
                    }
                  >
                    {assignableRoles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-item">
                  <label>状态</label>
                  <select
                    className="select"
                    disabled={editingAccount?.isBuiltin}
                    value={accountForm.status}
                    onChange={(event) =>
                      setAccountForm({
                        ...accountForm,
                        status: event.target.value as Account['status'],
                      })
                    }
                  >
                    <option value="ACTIVE">启用</option>
                    <option value="DISABLED">禁用</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="m-foot">
              <AsyncButton closeDialog
                className="btn btn-secondary"
                onClick={() => setAccountModal(false)}
              >
                取消
              </AsyncButton>
              <AsyncButton
                className="btn btn-primary"
                disabled={saving}
                onClick={saveAccount}
              >
                {saving ? '保存中…' : '保存账号'}
              </AsyncButton>
            </div>
          </div>
        </ModalFrame>
      )}

      {roleModal && (
        <ModalFrame title={editingRole ? '编辑角色权限' : '新建角色'} drawer onClose={() => { setRoleModal(false); }}>
          <div
            className="modal wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="role-dialog-title"
          >
            <div className="m-head">
              <h3 id="role-dialog-title">
                {editingRole
                  ? `${editingRole.isBuiltin ? '查看' : '编辑'}角色「${editingRole.name}」`
                  : '新建平台角色'}
              </h3>
              <AsyncButton closeDialog
                className="x"
                aria-label="关闭"
                onClick={() => setRoleModal(false)}
              >
                ×
              </AsyncButton>
            </div>
            <div className="m-body">
              {editingRole?.isBuiltin && (
                <div className="ai-warning info" style={{ marginBottom: 16 }}>
                  内置角色由系统维护，用于保证基础运营和审计边界，不可修改或删除。
                </div>
              )}
              <div className="form-item">
                <label>角色名称</label>
                <input
                  className="input"
                  disabled={editingRole?.isBuiltin}
                  value={roleForm.name}
                  onChange={(event) =>
                    setRoleForm({ ...roleForm, name: event.target.value })
                  }
                />
              </div>
              <div className="form-item">
                <label>职责说明</label>
                <textarea
                  className="input"
                  disabled={editingRole?.isBuiltin}
                  rows={2}
                  value={roleForm.description}
                  onChange={(event) =>
                    setRoleForm({
                      ...roleForm,
                      description: event.target.value,
                    })
                  }
                />
              </div>
              <div className="form-item">
                <label>管理窗口</label>
                <div className="f-desc">后端接口与前端菜单同时按此权限校验</div>
                <div className="permission-grid">
                  {PERMISSIONS.map((permission) => (
                    <label
                      className={`permission-option ${roleForm.permissions.includes(permission.key) || editingRole?.isSuperAdmin ? 'selected' : ''}`}
                      key={permission.key}
                    >
                      <input
                        type="checkbox"
                        disabled={editingRole?.isBuiltin}
                        checked={
                          editingRole?.isSuperAdmin ||
                          roleForm.permissions.includes(permission.key)
                        }
                        onChange={() => togglePermission(permission.key)}
                      />
                      <span>
                        <strong>{permission.label}</strong>
                        <small>{permission.description}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="m-foot">
              <AsyncButton
                className="btn btn-secondary"
                onClick={() => setRoleModal(false)}
              >
                {editingRole?.isBuiltin ? '关闭' : '取消'}
              </AsyncButton>
              {!editingRole?.isBuiltin && (
                <AsyncButton
                  className="btn btn-primary"
                  disabled={saving}
                  onClick={saveRole}
                >
                  {saving ? '保存中…' : '保存角色'}
                </AsyncButton>
              )}
            </div>
          </div>
        </ModalFrame>
      )}
    </>
  );
}
