import { AsyncButton } from './Interaction';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link, useNavigate } from 'react-router-dom';
import { api, logoutSession } from '../api/client';
import { canAccessTenantPath, getTenantSession } from '../auth/tenant-session';

const NAV = [
  { group: '总览', items: [{ to: '/t/dashboard', label: '工作台', icon: '▦' }] },
  {
    group: '运营管理',
    items: [
      { to: '/t/robots', label: '机器人管理', icon: '🤖' },
      { to: '/t/channels', label: '渠道接入', icon: '🔌' },
      { to: '/t/broadcast', label: '消息发送', icon: '📢' },
      { to: '/t/groups', label: '群管理', icon: '👥' },
      { to: '/t/messages', label: '消息测试', icon: '📨' },
      { to: '/t/collector', label: '微信采集', icon: '▤' },
      { to: '/t/follow-ups', label: '待跟进', icon: '📥' },
      { to: '/t/sessions', label: '会话管理', icon: '💬' },
    ],
  },
  {
    group: '用户与权限',
    items: [
      { to: '/t/users', label: '用户管理', icon: '👤' },
      { to: '/t/roles', label: '角色权限', icon: '🔐' },
    ],
  },
  {
    group: 'AI 与数据',
    items: [
      { to: '/t/evaluations', label: '回答评测', icon: '✓' },
      { to: '/t/wiki', label: 'Wiki 工作台', icon: '▤' },
      { to: '/t/knowledge', label: '知识库', icon: '📚' },
      { to: '/t/tools', label: '外部接口', icon: '🧩' },
      { to: '/t/audit', label: '审计中心', icon: '📋' },
    ],
  },
  {
    group: '系统',
    items: [
      { to: '/t/settings', label: '租户管理', icon: '🏢' },
      { to: '/t/logs', label: '操作日志', icon: '📝' },
    ],
  },
];

export default function TenantLayout() {
  const navigate = useNavigate();
  const session = getTenantSession();
  const tenantId = session?.tenantId;
  const canReadNotifications = canAccessTenantPath('/t/notifications', session);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (tenantId && canReadNotifications) api<{ count: number }>(`/api/v1/tenant/notifications/unread-count?tenantId=${tenantId}`).then((d) => { if (active) setUnread(d.count); }).catch(() => {});
      else setUnread(0);
    };
    refresh();
    window.addEventListener('tenant-notifications-changed', refresh);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('tenant-notifications-changed', refresh); window.removeEventListener('focus', refresh); };
  }, [tenantId, canReadNotifications]);

  async function logout() {
    await logoutSession('tenant');
    navigate('/tenant-login', { replace: true });
  }
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="logo"><span>🤖</span> AI 机器人平台</div>
        <nav>
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="nav-group">{g.group}</div>
              {g.items.filter((it) => canAccessTenantPath(it.to, session)).map((it) => (
                <NavLink key={it.to} to={it.to} title={it.label} aria-label={it.label} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
                  <span>{it.icon}</span><span className="nav-label">{it.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="user">
          <span>👤</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{session?.roleName ?? (session?.role === 'TENANT_OP' ? '租户运营' : '租户管理员')}</div>
            <div className="small muted">租户 {session?.tenantId.slice(0, 8) ?? '—'}</div>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="header">
          <div style={{ fontSize: 14 }}>租户管理后台</div>
          <div className="flex gap-3">
            {canReadNotifications && (
              <Link to="/t/notifications" className="link small" style={{ position: 'relative' }}>
                🔔 通知{unread > 0 && <span style={{ position: 'absolute', top: -6, right: -12, background: 'var(--error)', color: '#fff', borderRadius: 999, fontSize: 10, padding: '1px 5px' }}>{unread}</span>}
              </Link>
            )}
            <Link to="/login" className="link small">平台管理入口</Link>
            <AsyncButton type="button" className="link small header-link-button" onClick={logout}>退出登录</AsyncButton>
          </div>
        </header>
        <div className="page">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
