export function tenantIdFromToken(token: string): string | null {
  try {
    const encoded = token.split('.')[1];
    if (!encoded) return null;
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as { tenantId?: unknown };
    return typeof payload.tenantId === 'string' && payload.tenantId ? payload.tenantId : null;
  } catch {
    return null;
  }
}

export function normalizeTenantPath(path: string, token: string, base: string): string {
  const tenantId = tenantIdFromToken(token);
  if (!tenantId) return path;
  const url = new URL(`${base}${path}`);
  url.searchParams.set('tenantId', tenantId);
  return `${url.pathname}${url.search}`;
}
