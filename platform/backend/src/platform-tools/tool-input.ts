import { validateOutputSchema } from './tool-output';

export function inputSchema(raw: any) {
  const properties = raw.properties ?? raw;
  return { type: 'object', properties, required: raw.required ?? Object.keys(properties).filter(k => properties[k]?.required === true) };
}
export function validateInputSchema(schema: any) {
  validateOutputSchema(schema);
}
export function checkInput(schema: any, value: any, path = '参数', partial = false, depth = 0): string[] {
  if (depth > 8) throw new Error('参数嵌套过深');
  const missing: string[] = [];
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}应为对象`);
    for (const key of schema.required ?? []) if (value[key] === undefined || value[key] === null || value[key] === '') missing.push(`${path}.${key}`);
    for (const [key, child] of Object.entries(value)) {
      if (!Object.prototype.hasOwnProperty.call(schema.properties, key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(`${path}.${key}未声明`);
      missing.push(...checkInput(schema.properties[key], child, `${path}.${key}`, partial, depth + 1));
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > (schema.maxItems ?? 100)) throw new Error(`${path}数组格式或长度无效`);
    if (value.length < (schema.minItems ?? 0)) missing.push(path);
    value.forEach((item, i) => missing.push(...checkInput(schema.items, item, `${path}[${i}]`, partial, depth + 1)));
  } else {
    if (schema.type === 'integer' ? !Number.isInteger(value) : typeof value !== schema.type) throw new Error(`${path}类型错误`);
    if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path}枚举无效`);
    if (typeof value === 'number' && (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) throw new Error(`${path}数值超出范围`);
    if (typeof value === 'string' && (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? 2000))) throw new Error(`${path}长度不符合要求`);
  }
  if (!partial && missing.length) throw new Error(`缺少工具必要参数：${missing.join('、')}`);
  return missing;
}
export function quotedValues(value: any, quote: string): boolean {
  if (value && typeof value === 'object') return Object.values(value).every(v => quotedValues(v, quote));
  return quote.includes(String(value));
}
