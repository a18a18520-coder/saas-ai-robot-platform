import { ModalFrame, AsyncButton } from './Interaction';
import { useEffect, useState } from 'react';

interface Props {
  tenantName: string;
  account: string;
  password: string;
  onClose: () => void;
}

export default function InitialTenantCredentialsDialog({
  tenantName,
  account,
  password,
  onClose,
}: Props) {
  const [copied, setCopied] = useState<'account' | 'password' | 'all' | null>(
    null,
  );
  const [copyError, setCopyError] = useState('');

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  async function copy(value: string, target: 'account' | 'password' | 'all') {
    setCopyError('');
    try {
      await navigator.clipboard.writeText(value);
      setCopied(target);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopyError('复制失败，请手动选择并保存凭据');
    }
  }

  return (
    <ModalFrame title="租户已开通" onClose={() => { onClose(); }}>
      <div
        className="modal initial-credentials-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="initial-credentials-title"
        aria-describedby="initial-credentials-description"
      >
        <div className="m-head">
          <h3 id="initial-credentials-title">租户已开通</h3>
        </div>
        <div className="m-body">
          <div className="credential-success" aria-hidden="true">
            ✓
          </div>
          <h2>{tenantName}</h2>
          <p
            className="muted"
            id="initial-credentials-description"
          >
            请现在保存管理员登录凭据。关闭后平台不会再次显示这份临时密码。
          </p>

          <div className="credential-row">
            <div>
              <span className="credential-label">管理员账号</span>
              <code>{account}</code>
            </div>
            <AsyncButton
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => copy(account, 'account')}
            >
              {copied === 'account' ? '已复制' : '复制'}
            </AsyncButton>
          </div>
          <div className="credential-row">
            <div>
              <span className="credential-label">临时初始密码</span>
              <code>{password}</code>
            </div>
            <AsyncButton
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => copy(password, 'password')}
            >
              {copied === 'password' ? '已复制' : '复制'}
            </AsyncButton>
          </div>

          <div className="ai-warning info credential-notice">
            <span className="ic" aria-hidden="true">
              ⓘ
            </span>
            <span>
              此密码仅用于首次登录。管理员登录后必须立即设置自己的新密码，完成前不能访问租户业务功能。
            </span>
          </div>
          {copyError && (
            <div className="small credential-copy-error" role="alert">
              {copyError}
            </div>
          )}
        </div>
        <div className="m-foot">
          <AsyncButton
            type="button"
            className="btn btn-secondary"
            onClick={() =>
              copy(
                `租户：${tenantName}\n管理员账号：${account}\n临时密码：${password}`,
                'all',
              )
            }
          >
            {copied === 'all' ? '凭据已复制' : '复制全部凭据'}
          </AsyncButton>
          <AsyncButton type="button" className="btn btn-primary" onClick={onClose}>
            我已安全保存
          </AsyncButton>
        </div>
      </div>
    </ModalFrame>
  );
}
