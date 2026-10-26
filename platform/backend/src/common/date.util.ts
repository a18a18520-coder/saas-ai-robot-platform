/** 本地时区日期工具（数据库存 UTC 的 timestamptz 正确，但「日期」字符串字段必须用本地时区，禁用 toISOString 截取——东八区凌晨会差一天） */

/** 本地时区日期 YYYY-MM-DD（cycleStartAt/nextExpireAt 等日期字段用） */
export function localDateISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 本地时区日期（含时）的偏移天数计算 */
export function daysBetweenLocal(startISO: string, now: Date = new Date()): number {
  const [y, m, d] = startISO.split('-').map(Number);
  const start = new Date(y, m - 1, d).getTime();
  return Math.floor((now.getTime() - start) / 86_400_000);
}
