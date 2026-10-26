import { Component } from 'react';
import type { ReactNode } from 'react';

export default class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="auth-state"><section className="card" role="alert"><h1>页面暂时无法加载</h1><p>请刷新页面重试。仍然失败时，请联系管理员。</p><button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>重新加载页面</button></section></main>;
    return this.props.children;
  }
}
