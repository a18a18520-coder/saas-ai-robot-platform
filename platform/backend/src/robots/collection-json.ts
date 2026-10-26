/** Decimal identities avoid accepting JSON numbers rounded by JavaScript. */
export function decimalParts(text: string): { coefficient: bigint; scale: number } {
  const m = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!m || text.length > 100 || Math.abs(Number(m[4] ?? 0)) > 30) throw new Error('数字格式或精度无效');
  let coefficient = BigInt(m[2] + (m[3] ?? '')) * (m[1] === '-' ? -1n : 1n);
  let scale = (m[3]?.length ?? 0) - Number(m[4] ?? 0);
  if (scale < 0) { coefficient *= 10n ** BigInt(-scale); scale = 0; }
  while (scale > 0 && coefficient % 10n === 0n) { coefficient /= 10n; scale--; }
  return { coefficient, scale };
}
function identity(text: string) { const n = decimalParts(text); return `${n.coefficient}/${n.scale}`; }
export function exactProduct(input: string, multiplier: number): number {
  const a = decimalParts(input), b = decimalParts(String(multiplier));
  const coefficient = a.coefficient * b.coefficient, scale = a.scale + b.scale;
  const exact = `${coefficient}e-${scale}`;
  const value = Number(exact);
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER || identity(exact) !== identity(String(value))) throw new Error('转换结果超出安全数字范围或精度');
  return value;
}

/** No duplicate (including escaped) keys, unsafe numbers, deep nesting or trailing prose. */
export function parseCollectionJson(text: string): unknown {
  if (typeof text !== 'string' || text.length > 200000) throw new Error('模型返回内容过长');
  let source = text.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(source);
  if (fenced) source = fenced[1].trim();
  // Validate grammar first; the second pass adds checks JSON.parse does not provide.
  JSON.parse(source);
  let offset = 0;
  const space = () => { while (/\s/.test(source[offset] ?? '') && offset < source.length) offset++; };
  const string = (): string => {
    const start = offset++;
    while (offset < source.length) {
      if (source[offset++] === '"') return JSON.parse(source.slice(start, offset));
      if (source[offset - 1] === '\\') offset++;
    }
    throw new Error('字符串未结束');
  };
  const value = (depth: number): unknown => {
    if (depth > 12) throw new Error('模型返回嵌套过深');
    space();
    if (source[offset] === '"') return string();
    if (source[offset] === '{') {
      offset++; space();
      const object: Record<string, unknown> = Object.create(null);
      if (source[offset] === '}') { offset++; return object; }
      while (true) {
        space(); const key = string(); space(); offset++; // colon; grammar already validated
        if (Object.prototype.hasOwnProperty.call(object, key)) throw new Error('JSON 包含重复字段');
        object[key] = value(depth + 1); space();
        if (source[offset++] === '}') return object;
      }
    }
    if (source[offset] === '[') {
      offset++; space(); const array: unknown[] = [];
      if (source[offset] === ']') { offset++; return array; }
      while (true) { array.push(value(depth + 1)); space(); if (source[offset++] === ']') return array; }
    }
    const token = /^(true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(offset))![0];
    offset += token.length;
    const parsed = JSON.parse(token);
    if (typeof parsed === 'number' && (!Number.isFinite(parsed) || Math.abs(parsed) > Number.MAX_SAFE_INTEGER || identity(token) !== identity(String(parsed)))) throw new Error('JSON 数字超出安全范围或发生精度损失');
    return parsed;
  };
  return value(0);
}
