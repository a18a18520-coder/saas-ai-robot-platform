export function readableFilename(name: string): string {
  if (!/^[\u0000-\u00ff]+$/.test(name)) return name;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(name, c => c.charCodeAt(0))); }
  catch { return name; }
}
