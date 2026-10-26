import { BadRequestException } from '@nestjs/common';
import { exactProduct, parseCollectionJson } from './collection-json';

export const COLLECTION_VALIDATION_VERSION = 3;
export interface CollectionFieldRules {
  mode?: 'strict' | 'review';
  sourceLabel?: string;
  format?: 'text' | 'date';
  enumValues?: string[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  integer?: boolean;
  sourceUnit?: string;
  multiplier?: number;
  trueValues?: string[];
  falseValues?: string[];
}
export interface CollectionValidationIssue { code: string; message: string; field?: string; itemIndex?: number; }
export class CollectionValidationError extends Error {
  constructor(public readonly issue: CollectionValidationIssue) { super(issue.message); }
}

export interface CollectionField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  description: string;
  rules?: CollectionFieldRules;
}
export interface CollectionConfig {
  trigger: 'all' | 'mention';
  prompt: string;
  constraints: string;
  keywords: string[];
  fields: CollectionField[];
}
export interface CollectionItem {
  values: Record<string, string | number | boolean | null>;
  evidence: Record<string, string>;
  missingFields: string[];
  reviewFields: string[];
}
export interface CollectionResult {
  status: 'collected' | 'needs_review' | 'ignored';
  reason: string;
  items: CollectionItem[];
}

const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value: object, keys: readonly string[]) => Object.keys(value).every(k => keys.includes(k));
const fieldKeys = ['key', 'label', 'type', 'required', 'description', 'rules'];
const ruleKeys = ['mode', 'sourceLabel', 'format', 'enumValues', 'minLength', 'maxLength', 'minimum', 'maximum', 'integer', 'sourceUnit', 'multiplier', 'trueValues', 'falseValues'];
function ruleConfig(field: CollectionField, fail: (message: string) => never) {
  const r = field.rules;
  if (r === undefined) return;
  if (!object(r) || !onlyKeys(r, ruleKeys)) fail(`字段 ${field.label} 的约束配置无效或包含未知选项`);
  if (r.mode !== undefined && !['strict', 'review'].includes(r.mode)) fail('字段校验模式无效');
  for (const k of ['sourceLabel', 'sourceUnit'] as const) if (r[k] !== undefined && (typeof r[k] !== 'string' || !r[k].trim() || r[k] !== r[k].trim() || r[k].length > 50)) fail('原文标签和单位需为 1–50 字且不能有首尾空格');
  const stringOnly = ['format', 'enumValues', 'minLength', 'maxLength'];
  const numberOnly = ['minimum', 'maximum', 'integer', 'sourceUnit', 'multiplier'];
  const booleanOnly = ['trueValues', 'falseValues'];
  if (Object.keys(r).some(k => (stringOnly.includes(k) && field.type !== 'string') || (numberOnly.includes(k) && field.type !== 'number') || (booleanOnly.includes(k) && field.type !== 'boolean'))) fail(`字段 ${field.label} 的约束与数据类型不匹配`);
  if (r.format !== undefined && !['text', 'date'].includes(r.format)) fail('文本格式无效');
  for (const k of ['minLength', 'maxLength'] as const) if (r[k] !== undefined && (!Number.isInteger(r[k]) || r[k]! < 1 || r[k]! > 4000)) fail('文本长度限制需为 1–4000 的整数');
  if ((r.minLength ?? 1) > (r.maxLength ?? 4000)) fail('文本最小长度不能大于最大长度');
  for (const k of ['minimum', 'maximum', 'multiplier'] as const) if (r[k] !== undefined && (!Number.isFinite(r[k]) || Math.abs(r[k]!) > Number.MAX_SAFE_INTEGER)) fail('数字约束必须在安全数字范围内');
  if (r.minimum !== undefined && r.maximum !== undefined && r.minimum > r.maximum) fail('数值下限不能大于上限');
  if (r.multiplier !== undefined && (r.multiplier <= 0 || r.multiplier > 1e9)) fail('单位转换倍率需大于 0 且不超过 10 亿');
  if (r.integer !== undefined && typeof r.integer !== 'boolean') fail('整数开关无效');
  for (const k of ['enumValues', 'trueValues', 'falseValues'] as const) {
    const values = r[k];
    if (values !== undefined && (!Array.isArray(values) || !values.length || values.length > 50 || values.some(v => typeof v !== 'string' || !v.trim() || v !== v.trim() || v.length > 100) || new Set(values).size !== values.length)) fail('允许值需为 1–50 个不重复的非空文本，每个最多 100 字');
  }
  if ((r.trueValues ?? ['是', 'true']).some(v => (r.falseValues ?? ['否', 'false']).includes(v))) fail('“是”和“否”的原文取值不能重叠');
  if (r.enumValues?.some(v => v.length < (r.minLength ?? 1) || v.length > (r.maxLength ?? 4000) || (r.format === 'date' && dateValue(v) !== v))) fail('枚举取值与文本长度或日期格式冲突');
  if (r.mode === 'review' && (r.sourceUnit !== undefined || r.multiplier !== undefined || r.trueValues !== undefined || r.falseValues !== undefined)) fail('模型归纳模式不能同时配置确定性转换；请选择严格模式');
}

function dateValue(text: string): string | null {
  const match = /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})$/.exec(text);
  const chinese = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(text);
  const parts = match ? [match[1], match[3], match[4]] : chinese?.slice(1);
  if (!parts) return null;
  const [year, month, day] = parts.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1000 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function checkField(value: string | number | boolean, quote: string, field: CollectionField, source: string): string | null {
  const r = field.rules ?? {};
  const positions: number[] = [];
  for (let at = source.indexOf(quote); at >= 0; at = source.indexOf(quote, at + 1)) positions.push(at);
  let eligible = positions;
  if (r.sourceLabel) {
    // Escape the literal admin label; never run an administrator-supplied regex.
    const escaped = r.sourceLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const label = new RegExp(`(?:^|[\\s,，;；。])${escaped}[ \\t]{0,32}[:：][ \\t]{0,32}$`);
    // Bound each prefix check: repeated one-character quotes must not cause
    // quadratic rescans of a long incoming message.
    eligible = eligible.filter(at => label.test(source.slice(Math.max(0, at - r.sourceLabel!.length - 66), at)));
    if (!eligible.length) return '原文依据不位于指定标签之后（格式：标签：值）';
  }
  // All positional requirements must hold for the SAME source occurrence.
  // Look beyond horizontal whitespace so padding a quote cannot disguise a
  // truncated tagged name, date range, or boolean qualifier.
  const completeEnding = (at: number) => /^(?:[ \t]*$|[ \t]*[,，;；。\r\n!?！？"”'’\)\]】」])/u.test(source.slice(at + quote.trimEnd().length));
  if (r.mode !== 'review' && field.type === 'string' && r.sourceLabel) {
    eligible = eligible.filter(completeEnding);
    if (!eligible.length) return '依据必须包含标签后的完整取值，不能截短姓名或编号';
  }
  if (r.mode !== 'review' && (field.type !== 'string' || r.enumValues || r.format === 'date')) {
    const boundary = (char: string) => !char || /[\s,，;；。!?！？:：()[\]【】「」"“”'‘’]/.test(char);
    const leading = quote.length - quote.trimStart().length;
    eligible = eligible.filter(at => boundary(source[at + leading - 1] ?? '') && boundary(source[at + quote.trimEnd().length] ?? ''));
    if (field.type === 'boolean' || r.format === 'date') eligible = eligible.filter(completeEnding);
    if (!eligible.length) return '依据必须是独立取值，不能从否定词、范围或其他数字中截取一部分';
  }
  if (typeof value === 'string') {
    if (value !== value.trim() || value.length < (r.minLength ?? 1) || value.length > (r.maxLength ?? 4000)) return '文本长度或首尾空格不符合约束';
    if (r.enumValues && !r.enumValues.includes(value)) return '取值不在允许的枚举范围内';
    if (r.format === 'date' && dateValue(value) !== value) return '日期必须是有效的 YYYY-MM-DD，不接受相对日期';
    if (r.mode !== 'review' && value !== (r.format === 'date' ? dateValue(quote.trim()) : quote.trim())) return '字段值与原文摘录或规定的日期转换不一致';
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) return '数值超出安全范围';
    if (r.integer && !Number.isInteger(value)) return '必须是整数，不能自动四舍五入';
    if ((r.minimum !== undefined && value < r.minimum) || (r.maximum !== undefined && value > r.maximum)) return '数值超出允许范围';
    if (r.mode !== 'review') {
      let token = quote.trim();
      if (r.sourceUnit) {
        if (!token.endsWith(r.sourceUnit)) return '原文单位与配置不一致';
        token = token.slice(0, -r.sourceUnit.length).trim();
      }
      if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(token)) return '数字依据需为单个阿拉伯数字及配置单位，不能含范围或推测';
      try { if (exactProduct(token.replace(/,/g, ''), r.multiplier ?? 1) !== value) return '数值与原文及单位转换倍率不一致'; }
      catch { return '数值转换发生精度损失或超出安全范围'; }
    }
  } else if (r.mode !== 'review') {
    if (!(value ? r.trueValues ?? ['是', 'true'] : r.falseValues ?? ['否', 'false']).includes(quote.trim())) return '布尔值与配置的原文取值不一致';
  }
  return null;
}

export function validateCollectionConfig(config: unknown, ready = false): asserts config is CollectionConfig {
  const fail = (message: string): never => { throw new BadRequestException(message); };
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail('收集配置格式无效');
  if (!onlyKeys(config as Record<string, unknown>, ['trigger', 'prompt', 'constraints', 'keywords', 'fields'])) fail('收集配置包含未知选项');
  const c = config as CollectionConfig;
  if (!['all', 'mention'].includes(c.trigger)) fail('请选择有效的收集触发方式');
  if (typeof c.prompt !== 'string' || c.prompt.length > 12000 || (ready && !c.prompt.trim())) fail('收集提示词不能为空且不能超过 12000 字');
  if (typeof c.constraints !== 'string' || c.constraints.length > 6000) fail('收集约束不能超过 6000 字');
  if (!Array.isArray(c.keywords) || c.keywords.length > 20 || c.keywords.some(k => typeof k !== 'string' || !k.trim() || k.length > 100)) fail('关键词最多 20 个，每个为 1–100 字');
  if (!Array.isArray(c.fields) || c.fields.length > 20 || (ready && !c.fields.length)) fail('请配置 1–20 个提取字段');
  const keys = new Set<string>();
  for (const f of c.fields) {
    if (!object(f) || !onlyKeys(f, fieldKeys)) fail('字段配置格式无效或包含未知选项');
    if (!f || typeof f !== 'object' || typeof f.key !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/.test(f.key) || ['constructor', 'prototype', '__proto__'].includes(f.key) || keys.has(f.key)) fail('字段标识需唯一，以字母开头，仅含字母、数字和下划线，最多 50 字');
    keys.add(f.key);
    if (typeof f.label !== 'string' || !f.label.trim() || f.label.length > 100) fail('字段名称需为 1–100 字');
    if (!['string', 'number', 'boolean'].includes(f.type) || typeof f.required !== 'boolean') fail('字段类型或必填设置无效');
    if (typeof f.description !== 'string' || f.description.length > 1000) fail('字段提取说明不能超过 1000 字');
    ruleConfig(f, fail);
  }
}

/** Model output is untrusted: accept only configured keys, typed values and exact source quotes. */
export function parseCollectionResult(text: string, config: CollectionConfig, source: string): CollectionResult {
  validateCollectionConfig(config, true);
  const fail = (code: string, message: string, field?: string, itemIndex?: number): never => { throw new CollectionValidationError({ code, message, ...(field ? { field } : {}), ...(itemIndex !== undefined ? { itemIndex } : {}) }); };
  let raw: any;
  try { raw = parseCollectionJson(text); } catch (e) { fail('INVALID_JSON', e instanceof SyntaxError ? '模型返回不是完整有效的 JSON' : (e as Error).message); }
  if (!object(raw) || !onlyKeys(raw, ['matched', 'reason', 'items']) || typeof raw.matched !== 'boolean' || !Array.isArray(raw.items) || typeof raw.reason !== 'string' || !raw.reason.trim() || raw.reason.length > 500) fail('INVALID_ENVELOPE', '模型返回格式不符合收集协议');
  if (!raw.matched) {
    if (raw.items.length) fail('UNMATCHED_ITEMS', '未命中的消息不能包含提取结果');
    return { status: 'ignored', reason: raw.reason, items: [] };
  }
  if (!raw.items.length || raw.items.length > 20) fail('ITEM_COUNT', '每条消息需返回 1–20 条结果');
  const keys = new Set(config.fields.map(f => f.key));
  const items: CollectionItem[] = raw.items.map((item: any, itemIndex: number) => {
    if (!object(item) || !onlyKeys(item, ['values', 'evidence']) || !object(item.values) || !object(item.evidence)) fail('INVALID_ITEM', '提取结果缺少字段值或原文依据，或包含额外属性', undefined, itemIndex);
    if (Object.keys(item.values).some(k => !keys.has(k)) || Object.keys(item.evidence).some(k => !keys.has(k))) fail('UNKNOWN_FIELD', '模型返回了未配置的字段', undefined, itemIndex);
    const values: CollectionItem['values'] = {};
    const evidence: CollectionItem['evidence'] = {};
    const missingFields: string[] = [];
    const reviewFields: string[] = [];
    for (const f of config.fields) {
      const fieldFail = (code: string, message: string) => fail(code, `字段「${f.label}」：${message}`, f.key, itemIndex);
      if (!Object.prototype.hasOwnProperty.call(item.values, f.key)) fieldFail('MISSING_KEY', '未返回该字段；未知值必须显式返回 null');
      const value = item.values[f.key];
      if (value !== null && (typeof value !== f.type || (typeof value === 'number' && !Number.isFinite(value)) || (typeof value === 'string' && (!value.trim() || value.length > 4000)))) fieldFail('FIELD_TYPE', '类型或长度无效');
      const quote = item.evidence[f.key];
      if (value === null && Object.prototype.hasOwnProperty.call(item.evidence, f.key)) fieldFail('NULL_EVIDENCE', '空值不能携带原文依据');
      if (value !== null && (typeof quote !== 'string' || !quote.trim() || quote.length > 4000 || !source.includes(quote))) fieldFail('INVALID_EVIDENCE', '缺少可核对的原文依据');
      if (value !== null) {
        const error = checkField(value, quote, f, source);
        if (error) fieldFail('FIELD_RULE', error);
        if (f.rules?.mode === 'review') reviewFields.push(f.key);
      }
      values[f.key] = value;
      if (value !== null) evidence[f.key] = quote;
      if (f.required && value === null) missingFields.push(f.key);
    }
    if (Object.values(values).every(value => value === null)) fail('EMPTY_ITEM', '提取结果不能全部为空', undefined, itemIndex);
    return { values, evidence, missingFields, reviewFields };
  });
  const signatures = items.map(item => JSON.stringify(item.values));
  if (new Set(signatures).size !== signatures.length) fail('DUPLICATE_ITEM', '同一条消息返回了重复的结构化记录，无法确认是否重复计量');
  return { status: items.some(i => i.missingFields.length || i.reviewFields.length) ? 'needs_review' : 'collected', reason: raw.reason, items };
}

/** Provider-independent schema in the prompt; the server validator remains authoritative. */
export function collectionOutputSchema(config: CollectionConfig) {
  const properties = Object.fromEntries(config.fields.map(f => [f.key, { type: [f.type, 'null'], ...(f.rules?.enumValues ? { enum: [...f.rules.enumValues, null] } : {}) }]));
  return { type: 'object', additionalProperties: false, required: ['matched', 'reason', 'items'], properties: {
    matched: { type: 'boolean' }, reason: { type: 'string', minLength: 1, maxLength: 500 },
    items: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false, required: ['values', 'evidence'], properties: {
      values: { type: 'object', additionalProperties: false, required: config.fields.map(f => f.key), properties },
      evidence: { type: 'object', additionalProperties: false, properties: Object.fromEntries(config.fields.map(f => [f.key, { type: 'string', minLength: 1, maxLength: 4000 }])) },
    } } },
  } };
}
