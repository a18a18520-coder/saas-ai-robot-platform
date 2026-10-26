export type QuotaAlertLevel = 'REMINDER' | 'STRONG';

export function quotaThreshold(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 100
    ? parsed
    : fallback;
}

export function quotaAlertLevel(
  config: Record<string, unknown> | undefined,
  used: number,
  limit: number,
): QuotaAlertLevel | undefined {
  if (limit <= 0) return undefined;
  const reminder = quotaThreshold(config?.threshold1, 80);
  const strong = Math.max(reminder, quotaThreshold(config?.threshold2, 90));
  const percent = (used / limit) * 100;
  if (percent >= strong) return 'STRONG';
  if (percent >= reminder) return 'REMINDER';
  return undefined;
}
