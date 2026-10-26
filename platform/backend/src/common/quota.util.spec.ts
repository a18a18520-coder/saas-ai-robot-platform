import { quotaAlertLevel, quotaThreshold } from './quota.util';

describe('quota utilities', () => {
  it('按租户配置的双阈值返回预警等级', () => {
    const config = { threshold1: '70', threshold2: '90' };
    expect(quotaAlertLevel(config, 69, 100)).toBeUndefined();
    expect(quotaAlertLevel(config, 70, 100)).toBe('REMINDER');
    expect(quotaAlertLevel(config, 90, 100)).toBe('STRONG');
  });

  it('无效阈值回退平台基线', () => {
    expect(quotaThreshold('not-a-number', 80)).toBe(80);
    expect(
      quotaAlertLevel({ threshold1: '-1', threshold2: '101' }, 90, 100),
    ).toBe('STRONG');
  });
});
