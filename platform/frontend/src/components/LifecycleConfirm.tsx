import { ModalFrame, AsyncButton } from './Interaction';
import { useState } from 'react';

/** 展示实际影响；不可恢复的删除要求核对对象名称。 */
export default function LifecycleConfirm(props: {
  title: string;
  description: string;
  impacts: string[];
  onConfirm: () => unknown;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [action, name] = props.title.split(' — ');
  const destructive = /删除|禁用|停用/.test(action);
  const requiresName = action.includes('删除') && !!name;
  return <ModalFrame title={props.title} onClose={props.onCancel} dirty={false} initialFocus="cancel">
    <div className="modal"><header className="m-head"><h2>{props.title}</h2></header>
      <div className="m-body"><p>{props.description}</p><ul>{props.impacts.map(impact => <li key={impact}>{impact.replace(/（正反向验证）/g, '')}</li>)}</ul>
        {requiresName && <label>输入「{name}」以确认<input className="input" style={{ width: '100%', marginTop: 8 }} value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" /></label>}
      </div>
      <footer className="m-foot"><AsyncButton closeDialog className="btn btn-secondary" onClick={props.onCancel}>取消</AsyncButton><AsyncButton className={`btn ${destructive ? 'btn-danger' : 'btn-primary'}`} disabled={requiresName && typed !== name} onClick={props.onConfirm}>{action}</AsyncButton></footer>
    </div>
  </ModalFrame>;
}
