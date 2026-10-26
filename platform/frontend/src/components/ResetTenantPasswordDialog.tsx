import { ModalFrame, AsyncButton } from './Interaction';
import { useState } from "react";

interface Props {
  tenantName: string;
  account: string;
  onConfirm: (password: string) => Promise<void>;
  onCancel: () => void;
}

/** 高风险凭据操作：双次输入、强度校验、会话失效提示。 */
export default function ResetTenantPasswordDialog({
  tenantName,
  account,
  onConfirm,
  onCancel,
}: Props) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const strong =
    password.length >= 10 &&
    password.length <= 128 &&
    /[a-z]/i.test(password) &&
    /\d/.test(password);
  const matches = confirmation.length > 0 && confirmation === password;

  async function submit() {
    if (!strong || !matches || saving) return;
    setSaving(true);
    setError("");
    try {
      await onConfirm(password);
    } catch (cause) {
      setError((cause as Error).message);
      setSaving(false);
    }
  }

  return (
    <ModalFrame title="重置租户管理员密码" onClose={() => { !saving && onCancel(); }}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-tenant-password-title"
        aria-describedby="reset-tenant-password-description"
      >
        <div className="m-head">
          <h3 id="reset-tenant-password-title">重置租户管理员密码</h3>
          <AsyncButton closeDialog
            type="button"
            className="x"
            aria-label="关闭"
            disabled={saving}
            onClick={onCancel}
          >
            ×
          </AsyncButton>
        </div>
        <div className="m-body">
          <div
            className="ai-warning info"
            id="reset-tenant-password-description"
            style={{ marginBottom: 18 }}
          >
            <span className="ic" aria-hidden="true">
              ⓘ
            </span>
            <span>
              将为「{tenantName}」管理员 <b>{account}</b> 设置临时密码。
              旧刷新凭据会立即失效，管理员下次登录必须先修改密码。
            </span>
          </div>

          <div className="form-item">
            <label htmlFor="tenant-new-password">新密码</label>
            <input
              id="tenant-new-password"
              className="input"
              type={showPassword ? "text" : "password"}
              value={password}
              autoComplete="new-password"
              autoFocus
              aria-invalid={password.length > 0 && !strong}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="10-128 位，同时包含字母和数字"
            />
            <div
              className="f-desc"
              style={{
                marginTop: 6,
                color:
                  password.length > 0 && !strong
                    ? "var(--error-text)"
                    : undefined,
              }}
            >
              {password.length > 0 && !strong
                ? "密码尚未满足强度要求"
                : "请使用未在其他系统中使用过的密码"}
            </div>
          </div>

          <div className="form-item">
            <label htmlFor="tenant-confirm-password">再次输入新密码</label>
            <input
              id="tenant-confirm-password"
              className="input"
              type={showPassword ? "text" : "password"}
              value={confirmation}
              autoComplete="new-password"
              aria-invalid={confirmation.length > 0 && !matches}
              onChange={(event) => setConfirmation(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void submit()}
            />
            {confirmation.length > 0 && !matches && (
              <div
                className="f-desc"
                role="alert"
                style={{ marginTop: 6, color: "var(--error-text)" }}
              >
                两次输入的密码不一致
              </div>
            )}
          </div>

          <label className="flex gap-3" style={{ cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={showPassword}
              onChange={(event) => setShowPassword(event.target.checked)}
              style={{ accentColor: "var(--primary)" }}
            />
            <span className="small">显示密码</span>
          </label>

          {error && (
            <div className="ai-warning" role="alert" style={{ marginTop: 16 }}>
              <span className="ic" aria-hidden="true">
                ⚠
              </span>
              <span>{error}</span>
            </div>
          )}
        </div>
        <div className="m-foot">
          <AsyncButton closeDialog
            type="button"
            className="btn btn-secondary"
            disabled={saving}
            onClick={onCancel}
          >
            取消
          </AsyncButton>
          <AsyncButton
            type="button"
            className="btn btn-primary"
            disabled={!strong || !matches || saving}
            onClick={() => submit()}
          >
            {saving ? "重置中…" : "设置临时密码"}
          </AsyncButton>
        </div>
      </div>
    </ModalFrame>
  );
}
