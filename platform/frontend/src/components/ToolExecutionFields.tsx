import { useState } from 'react';

function SuccessValue({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  const [text, setText] = useState(value === undefined ? '' : JSON.stringify(value));
  return <input className="input" placeholder={'如 0、true 或 "ok"'} value={text} onChange={e => {
    setText(e.target.value);
    let parsed: unknown; try { parsed = JSON.parse(e.target.value); } catch { parsed = e.target.value; }
    onChange(e.target.value === '' ? undefined : parsed);
  }} />;
}
export function executionText(config?: unknown, _readOnly?: boolean) {
  return JSON.stringify(config ?? {});
}
export default function ToolExecutionFields({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const config = JSON.parse(value || '{}');
  const update = (key: string, next: unknown) => onChange(JSON.stringify({ ...config, [key]: next }));
  return <section>
    <div className="form-item"><label>机器人调用方式<select className="select" value={config.mode ?? ''} onChange={e => update('mode', e.target.value || undefined)}>
      <option value="">暂不允许自动调用</option><option value="query">查询数据（只读）</option><option value="submit">收集信息并提交（客户确认后）</option>
    </select></label></div>
    {config.mode && <>
      <p className="small">在机器人提示词中声明适用场景，并绑定此工具。缺少参数会在当前会话追问；提交接口须先向客户展示信息并确认。</p>
      <div className="form-row">
        <div className="form-item"><label>业务成功字段{config.mode === 'submit' ? ' *' : ''}<input className="input" placeholder="如 code（须在返回白名单内）" value={config.successField ?? ''} onChange={e => update('successField', e.target.value)} /></label></div>
        <div className="form-item"><label>成功时的值{config.mode === 'submit' ? ' *' : ''}<SuccessValue value={config.successValue} onChange={v => update('successValue', v)} /></label></div>
      </div>
      <div className="form-item"><label>成功后的说明<input className="input" placeholder="如 工单已创建，请保留返回的编号。" value={config.successMessage ?? ''} onChange={e => update('successMessage', e.target.value)} /></label></div>
      <div className="form-item"><label>业务失败后的处理说明<input className="input" placeholder="如 请核对订单号，或联系人工客服。" value={config.failureMessage ?? ''} onChange={e => update('failureMessage', e.target.value)} /></label></div>
      <div className="form-item"><label>请求参数传值格式<textarea className="input" rows={2} placeholder="如 JSON：order_id、issue；GET 查询使用 query 参数。" value={config.requestFormat ?? ''} onChange={e => update('requestFormat', e.target.value)} /></label></div>
      <div className="form-item"><label>缺少参数时的追问方式<textarea className="input" rows={2} placeholder="如 一次只追问一个字段，先询问订单号。" value={config.missingParameterPrompt ?? ''} onChange={e => update('missingParameterPrompt', e.target.value)} /></label></div>
      <div className="form-item"><label>接口返回后的回答格式<textarea className="input" rows={2} placeholder="如 先给状态，再给编号；金额保留两位小数。" value={config.responseFormat ?? ''} onChange={e => update('responseFormat', e.target.value)} /></label></div>
      <div className="form-item"><label>固定回答模板（填写后优先使用）<textarea className="input" rows={4} placeholder={'订单状态：{{status}}\n订单编号：{{order_id}}'} value={config.responseTemplate ?? ''} onChange={e => update('responseTemplate', e.target.value)} /></label><p className="small">用双花括号引用返回白名单字段，直接填入接口实际值，不由模型编造。留空时按上方回答格式组合机器人表达设置。</p></div>
      <div className="form-item"><label>出参结构与必填校验（JSON Schema）<textarea className="input" rows={6} defaultValue={config.responseSchema ? JSON.stringify(config.responseSchema, null, 2) : ''} placeholder={'{"type":"object","properties":{"status":{"type":"string"}},"required":["status"]}'} onChange={e => {
        try { const schema = e.target.value.trim() ? JSON.parse(e.target.value) : undefined; e.target.setCustomValidity(''); update('responseSchema', schema); } catch { e.target.setCustomValidity('请填写有效 JSON'); update('responseSchema', { type: 'invalid', raw: e.target.value }); }
      }} /></label><p className="small">返回类型或必填字段不符时停止正常回答。对象、数组及其子字段均可声明；顶层字段必须加入返回白名单。</p></div>
      <p className="small">将实际返回的白名单字段一起反馈给客户。提交超时不会自动重试，需核查外部系统后处理。</p>
    </>}
  </section>;
}
