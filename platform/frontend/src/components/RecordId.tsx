import { useFeedback, AsyncButton, notify } from './Interaction';
import { useRef } from 'react';

/** 完整显示业务标识；复制失败时仍可手动选择。 */
export default function RecordId({ label, value }: { label: string; value: string }) {
  const [message, setMessage] = useFeedback();
  const code = useRef<HTMLElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(''); notify('已复制', 'success', 1500);
    } catch {
      if (code.current) { const range = document.createRange(); range.selectNodeContents(code.current); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); }
      setMessage('复制失败，请选择 ID 手动复制');
    }
  }
  return <div className="record-id">
    <span>{label}：</span><code ref={code}>{value}</code>
    <AsyncButton type="button" className="btn btn-secondary btn-sm" aria-label={`复制${label} ${value}`} onClick={copy}>复制</AsyncButton>
    <span role="status">{message}</span>
  </div>;
}
