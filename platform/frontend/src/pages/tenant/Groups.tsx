import { useFeedback, PageData, Feedback, confirmAction, AsyncButton, ModalFrame } from '../../components/Interaction';
import { useEffect, useState } from 'react';
import { api, CURRENT_TENANT_ID } from '../../api/client';
import type { Group, Robot } from '../../api/types';

const TID = CURRENT_TENANT_ID;

export default function Groups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [robots, setRobots] = useState<Robot[]>([]);
  const [msg, setMsg] = useFeedback();
  const [bindGroup, setBindGroup] = useState<Group | null>(null);
  const [bindRobot, setBindRobot] = useState('');
  const [bindRole, setBindRole] = useState('客服');
  const [membersGroup, setMembersGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Array<{ id: string; channelUserId: string; source: string; groupRoleOverride?: string | null; name?: string; identity?: string; phoneMasked?: string; role?: string }>>([]);
  const [rolesMap, setRolesMap] = useState<Record<string, string>>({});
  // 成员弹窗内筛选（groups.html：搜索/身份）
  const [memberKeyword, setMemberKeyword] = useState('');
  const [memberIdentity, setMemberIdentity] = useState('');
  // 编辑群弹窗（groups.html 行内「编辑」）
  const [editGroup, setEditGroup] = useState<Group | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<'internal' | 'customer'>('internal');
  // 筛选（groups.html：搜索群名/chat_id + 群类型 + 状态 + 机器人）
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [robotFilter, setRobotFilter] = useState('');

  async function openMembers(g: Group) {
    setMembersGroup(g);
    setMemberKeyword(''); setMemberIdentity('');
    const list = await api<Array<{ id: string; channelUserId: string; source: string; groupRoleOverride?: string | null; name?: string; identity?: string; phoneMasked?: string; role?: string }>>(`/api/v1/tenant/groups/${g.id}/members`);
    setMembers(list);
    setRolesMap(Object.fromEntries(list.map((m) => [m.id, m.groupRoleOverride ?? '跟随默认'])));
  }

  async function saveRole(memberId: string, role: string) {
    if (!membersGroup) return;
    await api(`/api/v1/tenant/groups/${membersGroup.id}/members/${members.find((m) => m.id === memberId)?.channelUserId}/role`, {
      method: 'PUT', body: JSON.stringify({ role: role === '跟随默认' ? null : role }),
    });
    setMsg('✅ 群内角色已保存（BR-007: 群内角色 > 全局角色）');
    openMembers(membersGroup);
  }

  const [pageLoad, setPageLoad] = useState({ loading: true, ready: false, error: '' });
  async function load() {
    setPageLoad(old => ({ ...old, loading: true, error: '' }));
    try {
    setGroups(await api<Group[]>(`/api/v1/tenant/groups?tenantId=${TID}`));
    setRobots(await api<Robot[]>(`/api/v1/tenant/robots?tenantId=${TID}`));

      setPageLoad({ loading: false, ready: true, error: '' });
    } catch (cause) { setPageLoad(old => ({ ...old, loading: false, error: (cause as Error).message })); }
  }
  useEffect(() => {
    load().catch(() => {});
    const timer = window.setInterval(() => load().catch(() => {}), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const robotName = (rid?: string) => (rid ? (robots.find((r) => r.id === rid)?.name ?? rid.slice(0, 8)) : '');
  const filtered = groups.filter((g) =>
    (!keyword || (g.name ?? '').includes(keyword) || g.chatId.toLowerCase().includes(keyword.toLowerCase())) &&
    (!typeFilter || g.groupType === typeFilter) &&
    (!statusFilter || g.status === statusFilter) &&
    (!robotFilter || g.robotId === robotFilter));

  async function bind(id: string, robotId: string, handoffRole: string) {
    try {
      await api(`/api/v1/tenant/groups/${id}/bind`, { method: 'POST', body: JSON.stringify({ robotId, handoffRole }) });
      setMsg(`✅ 已绑定机器人「${robots.find((r) => r.id === robotId)?.name}」（转人工: ${handoffRole}）`);
      setBindGroup(null); load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  function openBind(g: Group) {
    setBindGroup(g);
    setBindRobot(g.robotId ?? robots[0]?.id ?? '');
  }

  async function saveEdit() {
    if (!editGroup) return;
    try {
      await api(`/api/v1/tenant/groups/${editGroup.id}`, { method: 'PATCH', body: JSON.stringify({ name: editName.trim() || undefined, groupType: editType }) });
      setMsg(`✅ 群资料已更新（写审计）`);
      setEditGroup(null); load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  async function setStatus(g: Group, status: 'BOUND' | 'DISABLED') {
    try {
      await api(`/api/v1/tenant/groups/${g.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setMsg(status === 'DISABLED' ? `✅ 已禁用群「${g.name ?? g.chatId}」（消息不再消费）` : `✅ 已启用群「${g.name ?? g.chatId}」`);
      load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  async function removeGroup(g: Group) {
    if (!(await confirmAction(`确认删除群「${g.name ?? g.chatId}」？成员记录将级联删除，不可恢复`, { confirmText: '确认删除' }))) return;
    try {
      await api(`/api/v1/tenant/groups/${g.id}`, { method: 'DELETE' });
      setMsg(`✅ 已删除群「${g.name ?? g.chatId}」`); load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  return (
    <><PageData state={pageLoad} onRetry={load}>
      <div className="page-header">
        <div>
          <h1>群管理</h1>
          <div className="desc">企业群首次 @机器人自动登记 → 绑定机器人 → 后续消息进入处理</div>
        </div>
        <AsyncButton className="btn btn-secondary" onClick={() => load().catch((e) => setMsg('❌ ' + (e as Error).message))}>刷新群列表</AsyncButton>
      </div>

      {msg && <Feedback message={msg} />}

      {/* 机制说明（groups.html ai-warning） */}
      <div className="ai-warning" style={{ marginBottom: 16 }}>
        <span className="ic">⚠</span>
        <div><b>群机制：</b>钉钉群首次 @机器人、企微入群事件会自动登记群与发送人；新群先进入“待确认”，绑定机器人后才处理问答。群内未 @机器人 的消息零消费（BR-005）。</div>
      </div>

      {/* 筛选卡（groups.html） */}
      <div className="flex gap-3" style={{ marginBottom: 12 }}>
        <input className="input" style={{ width: 200 }} placeholder="搜索群名称 / chat_id…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        <select className="select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">全部群类型</option>
          <option value="internal">内部群</option>
          <option value="customer">客户群</option>
        </select>
        <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">全部状态</option>
          <option value="PENDING">待确认</option>
          <option value="BOUND">已绑定</option>
          <option value="DISABLED">已禁用</option>
        </select>
        <select className="select" value={robotFilter} onChange={(e) => setRobotFilter(e.target.value)}>
          <option value="">全部机器人</option>
          {robots.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <span className="small muted" style={{ alignSelf: 'center' }}>{filtered.length} / {groups.length} 个群</span>
      </div>

      <div className="card">
        <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
          <thead><tr><th>群名称</th><th>chat_id</th><th>群类型</th><th>归属机器人</th><th>群成员</th><th>转人工</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {filtered.map((g) => (
              <tr key={g.id}>
                <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{g.name ?? '未命名群'}</td>
                <td className="muted small" style={{ fontFamily: 'monospace' }}>{g.chatId}</td>
                <td><span className="badge badge-info">{g.groupType === 'customer' ? '客户群' : '内部群'}</span></td>
                <td className="muted">{g.robotId ? robotName(g.robotId) : '未指定'}</td>
                <td><AsyncButton className="link" onClick={() => openMembers(g)}>查看成员 →</AsyncButton></td>
                <td className="muted">{g.handoffRole ?? '客服'}</td>
                <td><span className={`badge ${g.status === 'BOUND' ? 'badge-success' : g.status === 'DISABLED' ? 'badge-neutral' : 'badge-warning'}`}>{g.status === 'BOUND' ? '已绑定' : g.status === 'DISABLED' ? '已禁用' : '待确认'}</span></td>
                <td className="cell-actions" style={{ whiteSpace: 'nowrap' }}>
                  {g.status !== 'DISABLED' && <AsyncButton className="link" onClick={() => openBind(g)}>{g.status === 'PENDING' ? '绑定机器人 →' : '机器人与转人工'}</AsyncButton>}
                  <AsyncButton className="link" style={{ marginLeft: 10 }} onClick={() => { setEditGroup(g); setEditName(g.name ?? ''); setEditType(g.groupType); }}>编辑</AsyncButton>
                  {g.status === 'BOUND'
                    ? <AsyncButton className="link" style={{ marginLeft: 10 }} onClick={() => setStatus(g, 'DISABLED')}>禁用</AsyncButton>
                    : g.status === 'DISABLED'
                      ? <AsyncButton className="link" style={{ marginLeft: 10 }} onClick={() => setStatus(g, 'BOUND')}>启用</AsyncButton>
                      : null}
                  <AsyncButton className="link danger" style={{ marginLeft: 10 }} onClick={() => removeGroup(g)}>删除</AsyncButton>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 32 }}>{groups.length ? '无匹配群' : '暂无群。将机器人拉入已连接的企业群后，系统会通过渠道回调自动登记。'}</td></tr>}
          </tbody>
        </table></div>
        <div className="small muted mt-4">未绑定群消息不处理 · 未@机器人零消费（BR-005）· 独立单聊走机器人直接访问（非群）</div>
      </div>

      {/* 群成员弹窗（成员查看 + 群内角色覆盖 BR-007） */}
      {membersGroup && (
        <ModalFrame title="群成员 —" onClose={() => { setMembersGroup(null); }} drawer>
          <div className="card" style={{ width: 560, maxWidth: '94vw', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div className="card-title">群成员 — {membersGroup.name ?? membersGroup.chatId}（{members.length} 人）</div>
              <AsyncButton closeDialog style={{ cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)' }} onClick={() => setMembersGroup(null)}>✕</AsyncButton>
            </div>
            <div className="small muted" style={{ marginBottom: 12 }}>
              群消息自动登记成员 · 群内角色覆盖优先于全局角色。钉钉转人工时，将通知与群的转人工角色匹配的已登记客服；未找到时转后台待跟进。
            </div>
            {/* 弹窗内筛选（groups.html：搜索/身份） */}
            <div className="flex gap-3" style={{ marginBottom: 10 }}>
              <input className="input" style={{ width: 160, height: 30, fontSize: 12 }} placeholder="搜索成员/渠道ID…" value={memberKeyword} onChange={(e) => setMemberKeyword(e.target.value)} />
              <select className="select" style={{ height: 30, fontSize: 12 }} value={memberIdentity} onChange={(e) => setMemberIdentity(e.target.value)}>
                <option value="">全部身份</option>
                {['游客', '员工', '用户', '客服', '运营', '管理员'].map((i) => <option key={i}>{i}</option>)}
              </select>
            </div>
            <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
              <thead><tr><th>成员</th><th>来源</th><th>渠道ID</th><th>平台用户</th><th>身份</th><th>默认角色</th><th>群内角色</th></tr></thead>
              <tbody>
                {members.filter((m) =>
                  (!memberKeyword || (m.name ?? '').includes(memberKeyword) || m.channelUserId.includes(memberKeyword)) &&
                  (!memberIdentity || m.identity === memberIdentity)).map((m) => (
                  <tr key={m.id}>
                    <td className="small" style={{ fontWeight: 500 }}>{m.name ?? '未实名'}</td>
                    <td className="muted small">{{ wx_customer: '微信客户', wecom: '企微成员', dingtalk: '钉钉成员', feishu: '飞书成员' }[m.source] ?? m.source}</td>
                    <td className="muted small" style={{ fontFamily: 'monospace' }}>{m.channelUserId.slice(0, 14)}</td>
                    <td className="muted small">{m.phoneMasked ?? '—'}</td>
                    <td><span className="badge badge-neutral">{m.identity ?? '游客'}</span></td>
                    <td className="muted small">{m.role ?? '—'}</td>
                    <td>
                      <select className="select" style={{ height: 26, fontSize: 12 }} value={rolesMap[m.id] ?? '跟随默认'}
                        onChange={(e) => saveRole(m.id, e.target.value)}>
                        <option>跟随默认</option><option>员工</option><option>用户</option><option>客服</option><option>运营</option><option>管理员</option>
                      </select>
                    </td>
                  </tr>
                ))}
                {members.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 24 }}>暂无成员（群内发消息后自动登记）</td></tr>
                )}
              </tbody>
            </table></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              <span className="small muted">需要手机号/身份管理？</span>
              <a className="link" href="/t/users">到用户管理查看 →</a>
            </div>
          </div>
        </ModalFrame>
      )}

      {/* 编辑群弹窗（groups.html 行内「编辑」） */}
      {editGroup && (
        <ModalFrame title="编辑群 —" onClose={() => { setEditGroup(null); }}>
          <div className="card" style={{ width: 420, maxWidth: '94vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="card-title">编辑群 — {editGroup.chatId}</div>
              <AsyncButton closeDialog style={{ cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)' }} onClick={() => setEditGroup(null)}>✕</AsyncButton>
            </div>
            <div className="small" style={{ marginBottom: 6, color: 'var(--text-primary)', fontWeight: 500 }}>群名称</div>
            <input className="input" style={{ width: '100%', marginBottom: 14 }} placeholder="如 玩家1群" value={editName} onChange={(e) => setEditName(e.target.value)} />
            <div className="small" style={{ marginBottom: 6, color: 'var(--text-primary)', fontWeight: 500 }}>群类型</div>
            <select className="select" style={{ width: '100%', marginBottom: 14 }} value={editType} onChange={(e) => setEditType(e.target.value as 'internal' | 'customer')}>
              <option value="internal">内部群（员工）</option>
              <option value="customer">客户群（外部用户）</option>
            </select>
            <div className="small muted" style={{ marginBottom: 14 }}>群类型影响默认身份推断与知识权限边界（内部群按部门矩阵）</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <AsyncButton closeDialog className="btn btn-secondary" onClick={() => setEditGroup(null)}>取消</AsyncButton>
              <AsyncButton className="btn btn-primary" onClick={saveEdit}>保存</AsyncButton>
            </div>
          </div>
        </ModalFrame>
      )}

      {/* 绑定机器人弹窗（选择） */}
      {bindGroup && (
        <ModalFrame title="绑定机器人 —" onClose={() => { setBindGroup(null); }}>
          <div className="card" style={{ width: 440, maxWidth: '94vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="card-title">绑定机器人 — {bindGroup.chatId}</div>
              <AsyncButton closeDialog style={{ cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)' }} onClick={() => setBindGroup(null)}>✕</AsyncButton>
            </div>
            <div className="small" style={{ marginBottom: 6, color: 'var(--text-primary)', fontWeight: 500 }}>选择机器人（一群一机器人）</div>
            <select className="select" style={{ width: '100%', marginBottom: 14 }} value={bindRobot} onChange={(e) => setBindRobot(e.target.value)}>
              {robots.map((r) => <option key={r.id} value={r.id}>{r.name}（{r.type}·{r.status === 'PUBLISHED' ? '已发布' : r.status}）</option>)}
            </select>
            <div className="small" style={{ marginBottom: 6, color: 'var(--text-primary)', fontWeight: 500 }}>转人工客服角色</div>
            <select className="select" style={{ width: '100%', marginBottom: 14 }} value={bindRole} onChange={(e) => setBindRole(e.target.value)}>
              <option>客服</option><option>运营</option><option>按排班</option><option>不转人工</option>
            </select>
            <div className="small muted" style={{ marginBottom: 16 }}>绑定后该群消息进入对应机器人处理链路（仅 @机器人 消费）</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <AsyncButton closeDialog className="btn btn-secondary" onClick={() => setBindGroup(null)}>取消</AsyncButton>
              <AsyncButton className="btn btn-primary" onClick={() => bind(bindGroup.id, bindRobot, bindRole)}>确认绑定</AsyncButton>
            </div>
          </div>
        </ModalFrame>
      )}
    </PageData></>
  );
}
