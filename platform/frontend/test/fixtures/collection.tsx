import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { CollectionSettings } from '../../src/pages/tenant/RobotCollection';
import type { Robot } from '../../src/api/types';
import '../../src/index.css';
import '../../src/interaction.css';

function Fixture() {
  const [rag, setRag] = useState<NonNullable<Robot['ragConfig']>>({ mode: 'collector', collection: {
    trigger: 'all', prompt: '只收集明确的金额。', constraints: '不猜测，不四舍五入，不补值。', keywords: [],
    fields: [{ key: 'amount', label: '金额（元）', type: 'number', required: true, description: '将万元转换为元。', rules: { sourceLabel: '金额', sourceUnit: '万元', multiplier: 10000, minimum: 0, maximum: 50000 } }],
  } });
  return <main style={{ maxWidth: 1000, margin: '24px auto', padding: '0 20px' }}>
    <h1>结构化字段验收</h1><p>隔离测试界面 · 合成模型响应 · 不连接生产 API、数据库或真实群聊</p>
    <p>样例消息：金额：1.2万元。合成模型固定返回 12000；将数值上限改成 10000，可验证越界拦截。</p>
    <CollectionSettings robotId="fixture" rag={rag} onChange={setRag} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><Fixture /></BrowserRouter>);
