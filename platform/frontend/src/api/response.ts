/** Reject proxy HTML/error pages instead of treating them as a successful empty API response. */
export async function readApiJson<T>(response: Response): Promise<T> {
  if (response.status >= 500) throw new Error('后端服务暂不可用，请确认服务和数据库已启动后重试。');
  if (response.status === 204) return null as T;
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('接口未返回有效数据，请检查是否打开了正确的平台地址及后端代理配置。');
  }
  try { return await response.json() as T; }
  catch { throw new Error('接口返回的数据不完整，请重试。'); }
}
