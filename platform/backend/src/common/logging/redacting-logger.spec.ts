import { redactLogValue } from './redacting-logger';

describe('log redaction', () => {
  it('redacts nested secrets and authorization headers', () => {
    expect(redactLogValue({ headers: { authorization: 'Bearer abc.def' }, config: { app_secret: 'secret-value' }, ok: 'visible' }))
      .toEqual({ headers: { authorization: '[REDACTED]' }, config: { app_secret: '[REDACTED]' }, ok: 'visible' });
  });

  it('redacts credentials embedded in URLs, JSON and encrypted values', () => {
    const value = 'url?access_token=abc&name=x {"apiKey":"xyz"} enc:v1:a:b:c';
    expect(redactLogValue(value)).toBe('url?access_token=[REDACTED]&name=x {"apiKey":"[REDACTED]"} [ENCRYPTED]');
  });
});
