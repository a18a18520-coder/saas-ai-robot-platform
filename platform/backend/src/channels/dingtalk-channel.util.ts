import { randomBytes } from 'crypto';

export type DingTalkConnectionMode = 'stream' | 'http';

/** 兼容历史渠道：未配置连接方式时继续使用 Stream。 */
export function dingTalkConnectionMode(config: Record<string, string> | undefined): DingTalkConnectionMode {
  return config?.connection_mode === 'http' ? 'http' : 'stream';
}

/** HTTP 回调使用不可枚举的渠道令牌，避免公开端点被伪造调用。 */
export function ensureDingTalkConfig(config: Record<string, string>): Record<string, string> {
  return {
    ...config,
    connection_mode: dingTalkConnectionMode(config),
    callback_token: config.callback_token || randomBytes(24).toString('base64url'),
  };
}
