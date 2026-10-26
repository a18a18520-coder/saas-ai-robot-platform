/** 本地时区时间格式化（数据库/API 返回 UTC ISO 字符串，展示必须转本地时区，禁止 toISOString 截取） */

const pad = (n: number) => String(n).padStart(2, '0');

/** 本地时区 YYYY-MM-DD HH:mm:ss（表格/详情时间列） */
export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).replace('T', ' ').slice(0, 19);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 本地时区 MM-DD HH:mm:ss（紧凑列表时间列） */
export function fmtMDHM(iso?: string | null): string {
  const s = fmtDateTime(iso);
  return s === '—' ? s : s.slice(5);
}

/** 本地时区 YYYY-MM-DD（日期列） */
export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 本地时区日期戳（文件名用，如 audit-2026-09-04.csv） */
export function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
