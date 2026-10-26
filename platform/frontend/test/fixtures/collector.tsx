import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import Collector from '../../src/pages/tenant/Collector';
import { InteractionHost } from '../../src/components/Interaction';
import '../../src/index.css';
import '../../src/interaction.css';
createRoot(document.getElementById('root')!).render(<BrowserRouter><main style={{ maxWidth: 1100, margin: '24px auto', padding: 20 }}><p>合成界面验收 · 不连接真实租户、微信或模型</p><Collector /></main><InteractionHost /></BrowserRouter>);
