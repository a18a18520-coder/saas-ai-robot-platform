import { AsyncButton } from '../../components/Interaction';
import { useEffect, useState } from 'react';
import { api } from '../../api/client';

type Counts = { calls: number; input: number; output: number; total: number; incomplete: number; failed: number; fallback: number; retries: number };
type Stats = { timezone: string; totals: Counts; monthly: (Counts & { month: string })[]; operations: (Counts & { operation: string })[] };
const labels: Record<string, string> = { collection: '信息收集', answer: '回答生成', rewrite: '问题改写', compression: '会话压缩', tool_selection: '工具选择', evaluation: '评测评分', rerank: '检索重排' };
const number = (n: number) => n.toLocaleString('zh-CN');

export default function RobotTokenUsage({ robotId }: { robotId: string }) {
  const [data, setData] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setData(null);
    api<Stats>(`/api/v1/tenant/robots/${robotId}/token-usage`).then(value => { if (active) setData(value); })
      .catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [robotId, refresh]);
  const month = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date());
  const current = data?.monthly.find(row => row.month === month);
  return <section className="card rag-panel" style={{ marginBottom: 16 }} aria-label="机器人 Token 用量">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2>Token 用量</h2><AsyncButton className="btn btn-secondary" disabled={loading} onClick={() => setRefresh(n => n + 1)}>刷新统计</AsyncButton></div>
    <p className="small">按北京时间归月，包含重试、备用模型及评测产生的模型调用。仅统计接入记账后的平台直连模型；历史、Dify 工作流及建库用量暂未计入。</p>
    {loading && <p role="status">正在加载用量…</p>}
    {error && <p role="alert">用量加载失败：{error}</p>}
    {data && <>
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
        <p>累计已知 Token<br /><strong style={{ fontSize: 24 }}>{number(data.totals.total)}</strong></p>
        <p>本月已知 Token<br /><strong style={{ fontSize: 24 }}>{number(current?.total ?? 0)}</strong></p>
        <p>累计输入 / 输出<br /><strong>{number(data.totals.input)} / {number(data.totals.output)}</strong></p>
        <p>模型请求次数<br /><strong>{number(data.totals.calls)}</strong></p>
      </div>
      {!!data.totals.incomplete && <p role="status">有 {number(data.totals.incomplete)} 次请求未返回完整用量，以上为已知用量，不代表最终账单。</p>}
      <p className="small">重试 {number(data.totals.retries)} 次 · 备用模型 {number(data.totals.fallback)} 次 · 失败 {number(data.totals.failed)} 次。一次提问可能产生多次模型请求；失败请求也可能产生费用。</p>
      <div style={{ overflowX: 'auto' }}><div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data" style={{ width: '100%' }}><thead><tr><th>月份</th><th>输入 Token</th><th>输出 Token</th><th>已知总量</th><th>请求次数</th><th>用量不完整</th></tr></thead><tbody>
        {data.monthly.map(row => <tr key={row.month}><td>{row.month}</td><td>{number(row.input)}</td><td>{number(row.output)}</td><td>{number(row.total)}</td><td>{number(row.calls)}</td><td>{number(row.incomplete)}</td></tr>)}
        {!data.monthly.length && <tr><td colSpan={6}>暂无调用记录，模型产生新请求后显示统计。</td></tr>}
      </tbody></table></div></div>
      {!!data.operations.length && <details style={{ marginTop: 16 }}><summary>查看各环节累计用量</summary>{data.operations.map(row => <p key={row.operation}>{labels[row.operation] ?? row.operation}：{number(row.total)} Token · {number(row.calls)} 次请求 · {number(row.incomplete)} 次用量不完整</p>)}</details>}
    </>}
  </section>;
}
