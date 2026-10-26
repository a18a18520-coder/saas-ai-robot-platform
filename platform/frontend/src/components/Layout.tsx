import { AsyncButton } from './Interaction';
import { NavLink, Outlet, Link, useNavigate } from 'react-router-dom';
import { logoutSession } from '../api/client';
import { getAccessPayload } from '../auth/token-store';
import { canAccessPlatformPath } from '../auth/platform-access';

const NAV = [
  {
    group: '平台总览',
    items: [
      { to: '/dashboard', label: '平台工作台', icon: '▦' },
      { to: '/notifications', label: '通知中心', icon: '🔔' },
    ],
  },
  {
    group: '租户运营',
    items: [
      { to: '/tenants', label: '租户管理', icon: '🏢' },
      { to: '/plans', label: '套餐管理', icon: '💳' },
      { to: '/payments', label: '支付核销', icon: '💸' },
    ],
  },
  {
    group: 'AI 资源',
    items: [{ to: '/dify', label: 'Dify 资源管理', icon: '🤖' }, { to: '/models', label: '模型管理', icon: '◇' }],
  },
  {
    group: '平台数据',
    items: [
      { to: '/audit', label: '平台审计', icon: '📋' },
      { to: '/stats', label: '平台统计', icon: '📊' },
      { to: '/tools', label: '工具管理', icon: '🧩' },
    ],
  },
  {
    group: '系统',
    items: [
      { to: '/filter', label: '内容黑白名单', icon: '🛡' },
      { to: '/accounts', label: '平台账号与角色', icon: '👥' },
      { to: '/settings', label: '平台设置', icon: '⚙' },
    ],
  },
];

export default function Layout() {
  const navigate = useNavigate();
  const session = getAccessPayload('platform');

  async function logout() {
    await logoutSession('platform');
    navigate('/login', { replace: true });
  }

  return (
    <div className="layout platform-layout">
      <aside className="sidebar">
        <div className="logo">
          <span>🧭</span> 平台管理
        </div>
        <nav>
          {NAV.map((g) => ({
            ...g,
            items: session
              ? g.items.filter((item) =>
                  canAccessPlatformPath(item.to, session),
                )
              : [],
          }))
            .filter((group) => group.items.length > 0)
            .map((g) => (
              <div key={g.group}>
                <div className="nav-group">{g.group}</div>
                {g.items.map((it) => (
                  <NavLink
                    key={it.to}
                    to={it.to} title={it.label} aria-label={it.label}
                    className={({ isActive }) =>
                      'nav-item' + (isActive ? ' active' : '')
                    }
                  >
                    <span>{it.icon}</span>
                    <span className="nav-label">{it.label}</span>
                  </NavLink>
                ))}
              </div>
            ))}
        </nav>
        <div className="user">
          <span>👤</span>
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--text-primary)',
              }}
            >
              {session?.name ?? '平台管理员'}
            </div>
            <div className="small muted">
              {session?.roleName ??
                (session?.role === 'SUPER_ADMIN' ? '超级管理员' : '平台账号')}
            </div>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="header">
          <div style={{ fontSize: 14 }}>平台管理控制台</div>
          <div className="flex gap-3">
            {session && canAccessPlatformPath('/notifications', session) && (
              <Link to="/notifications" className="link small" title="通知中心">
                🔔
              </Link>
            )}
            <AsyncButton
              type="button"
              className="link small header-link-button"
              onClick={logout}
            >
              退出登录
            </AsyncButton>
          </div>
        </header>
        <div className="page">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
