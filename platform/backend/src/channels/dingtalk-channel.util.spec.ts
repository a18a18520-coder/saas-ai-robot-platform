import { dingTalkConnectionMode, ensureDingTalkConfig } from './dingtalk-channel.util';

describe('DingTalk channel config', () => {
  it('keeps legacy channels on Stream mode and generates a stable callback token', () => {
    const first = ensureDingTalkConfig({ app_key: 'key' });
    const second = ensureDingTalkConfig(first);

    expect(dingTalkConnectionMode(first)).toBe('stream');
    expect(first.callback_token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(second.callback_token).toBe(first.callback_token);
  });

  it('preserves an explicit HTTP mode', () => {
    expect(dingTalkConnectionMode(ensureDingTalkConfig({ connection_mode: 'http' }))).toBe('http');
  });
});
