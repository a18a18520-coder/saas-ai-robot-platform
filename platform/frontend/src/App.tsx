import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import TenantLayout from './components/TenantLayout';
import { restoreSession } from './api/client';
import { canAccessTenantPath, firstTenantPath, getTenantSession } from './auth/tenant-session';
import { getAccessPayload } from './auth/token-store';
import type { AuthDomain } from './auth/token-store';
import {
  canAccessPlatformPath,
  firstPlatformPath,
} from './auth/platform-access';

const Evaluations = lazy(() => import('./pages/tenant/Evaluations'));
const Wiki = lazy(() => import('./pages/tenant/Wiki'));
const Models = lazy(() => import('./pages/Models'));
const PlatformLogin = lazy(() => import('./pages/PlatformLogin'));
const TenantLogin = lazy(() => import('./pages/TenantLogin'));
const TenantActivate = lazy(() => import('./pages/TenantActivate'));
const TenantInitialPassword = lazy(
  () => import('./pages/TenantInitialPassword'),
);
const PlatformNotifications = lazy(
  () => import('./pages/PlatformNotifications'),
);
const PlatformPayments = lazy(() => import('./pages/PlatformPayments'));
const PlatformDashboard = lazy(() => import('./pages/PlatformDashboard'));
const Tenants = lazy(() => import('./pages/Tenants'));
const TenantDetail = lazy(() => import('./pages/TenantDetail'));
const Plans = lazy(() => import('./pages/Plans'));
const DifyResources = lazy(() => import('./pages/DifyResources'));
const PlatformAudit = lazy(() => import('./pages/PlatformAudit'));
const PlatformTools = lazy(() => import('./pages/PlatformTools'));
const ContentFilter = lazy(() => import('./pages/ContentFilter'));
const PlatformStats = lazy(() => import('./pages/PlatformStats'));
const PlatformSettings = lazy(() => import('./pages/PlatformSettings'));
const PlatformAccounts = lazy(() => import('./pages/PlatformAccounts'));
const TenantDashboard = lazy(() => import('./pages/tenant/TenantDashboard'));
const Robots = lazy(() => import('./pages/tenant/Robots'));
const Groups = lazy(() => import('./pages/tenant/Groups'));
const Messages = lazy(() => import('./pages/tenant/Messages'));
const Collector = lazy(() => import('./pages/tenant/Collector'));
const Sessions = lazy(() => import('./pages/tenant/Sessions'));
const Audit = lazy(() => import('./pages/tenant/Audit'));
const Broadcast = lazy(() => import('./pages/tenant/Broadcast'));
const Notifications = lazy(() => import('./pages/tenant/Notifications'));
const Roles = lazy(() => import('./pages/tenant/Roles'));
const KnowledgeList = lazy(() => import('./pages/tenant/KnowledgeList'));
const KnowledgeDetail = lazy(() => import('./pages/tenant/KnowledgeDetail'));
const RobotConfig = lazy(() => import('./pages/tenant/RobotConfig'));
const Channels = lazy(() => import('./pages/tenant/Channels'));
const FollowUps = lazy(() => import('./pages/tenant/FollowUps'));
const Users = lazy(() => import('./pages/tenant/Users'));
const Settings = lazy(() => import('./pages/tenant/Settings'));
const Tools = lazy(() => import('./pages/tenant/Tools'));
const Logs = lazy(() => import('./pages/tenant/Logs'));

function AuthLoading() {
  return (
    <div className="auth-state">
      <div className="card">
        <h1>正在恢复登录状态</h1>
        <p className="muted">请稍候…</p>
      </div>
    </div>
  );
}

function AuthUnavailable({ message, retry }: { message: string; retry: () => void }) {
  return <main className="auth-state"><section className="card" role="alert"><h1>暂时无法连接服务</h1><p>{message}</p><button type="button" className="btn btn-primary" onClick={retry}>重新连接</button></section></main>;
}

function useRestoreSession(domain: AuthDomain, hasSession: boolean) {
  const [checking, setChecking] = useState(!hasSession);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!checking) return;
    let active = true;
    restoreSession(domain).catch(() => {
      if (active) setError('无法连接登录服务。请确认后端服务和数据库已启动，然后重试。');
    }).finally(() => {
      if (active) setChecking(false);
    });
    return () => {
      active = false;
    };
  }, [checking, domain]);
  return { checking, error, retry: () => { setError(''); setChecking(true); } };
}

function ProtectedPlatformLayout() {
  const location = useLocation();
  const payload = getAccessPayload('platform');
  const valid =
    payload?.role === 'SUPER_ADMIN' || payload?.role === 'PLATFORM_OP';
  const { checking, error, retry } = useRestoreSession('platform', valid);
  if (checking) return <AuthLoading />;
  if (error) return <AuthUnavailable message={error} retry={retry} />;
  const restored = getAccessPayload('platform');
  if (
    !restored ||
    (restored.role !== 'SUPER_ADMIN' && restored.role !== 'PLATFORM_OP')
  ) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (
    location.pathname !== '/' &&
    !canAccessPlatformPath(location.pathname, restored)
  ) {
    const fallback = firstPlatformPath(restored);
    return fallback ? (
      <Navigate to={fallback} replace />
    ) : (
      <div className="auth-state">
        <div className="card">
          <h1>暂无可用的平台功能</h1>
          <p className="muted">
            当前账号已启用，但所属角色还未授予任何管理窗口。
          </p>
        </div>
      </div>
    );
  }
  return <Layout />;
}

function PlatformIndex() {
  const payload = getAccessPayload('platform');
  const path = payload ? firstPlatformPath(payload) : null;
  return path ? (
    <Navigate to={path} replace />
  ) : (
    <Navigate to="/login" replace />
  );
}

function ProtectedTenantLayout() {
  const location = useLocation();
  const session = getTenantSession();
  const { checking, error, retry } = useRestoreSession('tenant', !!session);
  if (checking) return <AuthLoading />;
  if (error) return <AuthUnavailable message={error} retry={retry} />;
  const restored = getTenantSession();
  if (!restored)
    return (
      <Navigate
        to="/tenant-login"
        replace
        state={{ from: location.pathname }}
      />
    );
  if (restored.mustChangePassword) {
    return <Navigate to="/tenant-initial-password" replace />;
  }
  if (!canAccessTenantPath(location.pathname, restored)) {
    const fallback = firstTenantPath(restored);
    return fallback ? <Navigate to={fallback} replace /> : (
      <div className="auth-state">
        <div className="card">
          <h1>无权访问此功能</h1>
          <p className="muted">
            当前账号尚未被授予任何管理后台功能，请联系租户管理员调整角色权限。
          </p>
        </div>
      </div>
    );
  }
  return <TenantLayout />;
}

function TenantIndex() {
  const path = firstTenantPath();
  return path ? <Navigate to={path} replace /> : <Navigate to="/tenant-login" replace />;
}

function ProtectedInitialPassword() {
  const session = getTenantSession();
  const { checking, error, retry } = useRestoreSession('tenant', !!session);
  if (checking) return <AuthLoading />;
  if (error) return <AuthUnavailable message={error} retry={retry} />;
  const restored = getTenantSession();
  if (!restored) return <Navigate to="/tenant-login" replace />;
  if (!restored.mustChangePassword) {
    return <Navigate to="/t/dashboard" replace />;
  }
  return <TenantInitialPassword />;
}

export default function App() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <Routes>
        <Route path="/login" element={<PlatformLogin />} />
        <Route path="/tenant-login" element={<TenantLogin />} />
        <Route path="/tenant-activate" element={<TenantActivate />} />
        <Route
          path="/tenant-initial-password"
          element={<ProtectedInitialPassword />}
        />
        <Route path="/" element={<ProtectedPlatformLayout />}>
          <Route index element={<PlatformIndex />} />
          <Route path="dashboard" element={<PlatformDashboard />} />
          <Route path="tenants" element={<Tenants />} />
          <Route path="tenants/:id" element={<TenantDetail />} />
          <Route path="plans" element={<Plans />} />
          <Route path="models" element={<Models />} />
          <Route path="dify" element={<DifyResources />} />
          <Route path="audit" element={<PlatformAudit />} />
          <Route path="notifications" element={<PlatformNotifications />} />
          <Route path="payments" element={<PlatformPayments />} />
          <Route path="tools" element={<PlatformTools />} />
          <Route path="filter" element={<ContentFilter />} />
          <Route path="stats" element={<PlatformStats />} />
          <Route path="settings" element={<PlatformSettings />} />
          <Route path="accounts" element={<PlatformAccounts />} />
        </Route>
        <Route path="/t" element={<ProtectedTenantLayout />}>
          <Route index element={<TenantIndex />} />
          <Route path="dashboard" element={<TenantDashboard />} />
          <Route path="robots" element={<Robots />} />
          <Route path="groups" element={<Groups />} />
          <Route path="messages" element={<Messages />} />
          <Route path="collector" element={<Collector />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="audit" element={<Audit />} />
          <Route path="broadcast" element={<Broadcast />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="roles" element={<Roles />} />
          <Route path="evaluations" element={<Evaluations />} />
          <Route path="wiki" element={<Wiki />} />
          <Route path="knowledge" element={<KnowledgeList />} />
          <Route path="knowledge/:id" element={<KnowledgeDetail />} />
          <Route path="robots/:id" element={<RobotConfig />} />
          <Route path="channels" element={<Channels />} />
          <Route path="follow-ups" element={<FollowUps />} />
          <Route path="users" element={<Users />} />
          <Route path="settings" element={<Settings />} />
          <Route path="tools" element={<Tools />} />
          <Route path="logs" element={<Logs />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
