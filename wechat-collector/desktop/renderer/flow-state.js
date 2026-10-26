'use strict';
// UI guidance only. Native identity, consent and permission guards remain authoritative.
function collectionReadiness(s) {
  const need = (reason, target) => ({ ready: false, reason, target });
  const integer = (value, min, max) => String(value).trim() !== '' && Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
  if (s.active) return need('采集中，可随时暂停；内容仅保存在本机。');
  if (s.busy) return need('正在处理，请稍候…');
  if (!s.info) return need('正在检查本地环境…');
  if (!s.info.ready) return need('本地存储未就绪，请检查环境。', 'permission-panel');
  if (s.info.platform === 'darwin' && s.info.screenPermission !== 'granted') return need('还差录屏授权。', 'permission-panel');
  if (!s.connected) return need('先在微信打开目标聊天，再连接窗口。', 'quick-connect');
  if (s.guided) return need(s.rotate ? '框选会话名、消息区和左侧入口，再确认绑定。' : '完成会话名与消息区框选，再确认绑定。', 'guided-region');
  const targets = s.rotate ? s.selected : (s.group ? [s.group] : []);
  if (!targets.length) return need(s.rotate ? '勾选本轮要采集的会话；没有会话可先添加。' : '绑定当前聊天，或主动选择已绑定会话。', s.rotate ? 'specified-panel' : 'current-panel');
  if (targets.some(g => g.sourceId !== s.sourceId)) return need('所选会话需要校验并恢复窗口连接。', 'current-panel');
  const missingEntry = s.rotate && targets.find(g => !g.regions?.entry);
  if (missingEntry) return need(`“${missingEntry.name}”还未设置轮巡入口，请重新校准。`, 'specified-panel');
  if ((s.rotate || s.scroll !== 'none') && !s.controlReady) return need(s.checkingControl ? '正在检查所选窗口的控制权限…' : '滚动或切群还需控制权限，请检查。', 'permission-panel');
  if (!integer(s.interval, s.rotate ? 10 : 2, 3600)) return need(`间隔请输入 ${s.rotate ? 10 : 2}–3600 秒的整数。`, 'interval');
  if (s.rotate && !integer(s.rotationHistory, 0, 30)) return need('首次历史请输入 0–30 屏的整数。', 'rotation-history');
  if (!s.rotate && s.scroll === 'up' && !integer(s.history, 1, 30)) return need('历史上限请输入 1–30 屏的整数。', 'current-history');
  if (!s.rotate && !integer(s.count, 0, 50)) return need('本轮次数请输入 0–50 的整数。', 'count');
  if (s.rotate ? !s.monitorConsent : !s.captureConsent) return need(s.rotate ? '确认允许切换并滚动勾选的会话。' : '确认仅采集所选会话及范围。', s.rotate ? 'monitor-consent' : 'capture-consent');
  if (!s.rotate && s.scroll !== 'none' && !s.scrollConsent) return need('确认允许将微信置于前台并滚动。', 'scroll-consent');
  return { ready: true, reason: s.rotate ? `已选 ${targets.length} 个会话 · 每次完成后等 ${s.interval} 秒` : `${s.group.name} · ${s.scroll === 'up' ? `最多 ${s.history} 屏历史` : s.scroll === 'down' ? '向下跟进' : '不滚动'}`, target: null };
}
if (typeof module !== 'undefined') module.exports = { collectionReadiness };
