/** 用户身份常量（共享单一来源：实体默认值 / 校验白名单 / 前端选项 / 角色映射保持一致） */
import { createHash } from 'crypto';

/** 合法身份集合（对齐 0e07f04：玩家 → 用户；人工优先级：游客(重置) 回自动识别） */
export const IDENTITIES = ['游客', '员工', '用户', '客服', '运营', '管理员'] as const;
export type Identity = (typeof IDENTITIES)[number];

/** 身份 → 默认权限角色（用户=普通个人用户；员工需部门知识矩阵，未指派角色时权限回退见 permission.compute） */
export const IDENTITY_ROLE: Record<string, string | undefined> = {
  游客: '游客', 用户: '用户', 客服: '客服', 运营: '运营', 管理员: '管理员',
  员工: undefined,
};

/** 手机号脱敏（138****6688；仅展示/导入/绑定路径调用，不做为加密手段） */
export function maskPhone(phone: string): string {
  return phone.length === 11 ? phone.slice(0, 3) + '****' + phone.slice(7) : phone.replace(/(\d{3})\d+(\d{2})/, '$1****$2');
}

/** 手机号不可逆指纹；只用于租户内身份匹配，不返回客户端。 */
export function hashPhone(phone: string): string {
  // 延续既有数据使用的固定命名空间，避免升级后失去身份匹配。
  return createHash('sha256').update(`robot:${phone}`).digest('hex');
}
