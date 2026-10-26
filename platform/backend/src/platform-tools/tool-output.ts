import { BadRequestException } from '@nestjs/common';

export function validateOutputSchema(schema: any, depth = 0): void {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || depth > 8 || !['object', 'array', 'string', 'number', 'integer', 'boolean'].includes(schema.type)) throw new BadRequestException('出参 Schema 需声明有效类型，最多嵌套 8 层');
  if (schema.type === 'object') {
    if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) throw new BadRequestException('对象出参需声明 properties');
    if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((k: any) => typeof k !== 'string' || !Object.prototype.hasOwnProperty.call(schema.properties, k)))) throw new BadRequestException('出参必填字段未声明');
    for (const [key, value] of Object.entries(schema.properties)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new BadRequestException('出参字段名无效');
      validateOutputSchema(value, depth + 1);
    }
  }
  if (schema.type === 'array') validateOutputSchema(schema.items, depth + 1);
}

export function validateOutput(schema: any, value: unknown, path = '返回值', depth = 0): void {
  if (!schema || depth > 8) throw new BadRequestException('出参声明无效或嵌套过深');
  if (value === null && schema.nullable === true) return;
  if (schema.enum && !schema.enum.includes(value)) throw new BadRequestException(`${path}不在出参枚举中`);
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException(`${path}应为对象`);
    for (const key of schema.required ?? []) if (!Object.prototype.hasOwnProperty.call(value, key)) throw new BadRequestException(`${path}.${key}缺失`);
    for (const [key, field] of Object.entries(schema.properties ?? {})) if (Object.prototype.hasOwnProperty.call(value, key)) validateOutput(field, (value as any)[key], `${path}.${key}`, depth + 1);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new BadRequestException(`${path}应为数组`);
    if (schema.items) value.forEach(v => validateOutput(schema.items, v, path, depth + 1));
  } else if (schema.type === 'integer' ? !Number.isInteger(value) : typeof value !== schema.type) throw new BadRequestException(`${path}类型不符合出参声明`);
}
export function renderOutput(template: string, data: Record<string, unknown>) {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, path: string) => {
    let value: any = data;
    for (const key of path.split('.')) {
      if (['__proto__', 'constructor', 'prototype'].includes(key) || !value || !Object.prototype.hasOwnProperty.call(value, key)) throw new BadRequestException(`返回结果缺少模板字段：${path}`);
      value = value[key];
    }
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}

export function renderOutputList(template: string, data: Record<string, unknown>, listPath: string, emptyMessage = '未找到匹配记录。') {
  let rows: any = data;
  for (const key of listPath.split('.')) {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || !rows || !Object.prototype.hasOwnProperty.call(rows, key)) throw new BadRequestException('返回结果缺少列表字段');
    rows = rows[key];
  }
  if (!Array.isArray(rows)) throw new BadRequestException('返回列表格式无效');
  return rows.length ? rows.map(row => renderOutput(template, { ...data, item: Object.fromEntries(Object.entries(row).map(([k,v]) => [k, v ?? '未提供'])) })).join('\n') : emptyMessage;
}

export function projectOutput(schema: any, value: any): any {
  if (value === null && schema.nullable === true) return null;
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties ?? {}).filter(([key]) => Object.prototype.hasOwnProperty.call(value, key)).map(([key, field]) => [key, projectOutput(field, value[key])]));
  if (schema.type === 'array') return value.map((item: any) => projectOutput(schema.items, item));
  return value;
}
