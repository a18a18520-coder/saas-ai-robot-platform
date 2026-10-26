import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** 租户上下文注入（多租户隔离 §4.3 — 应用层统一出口） */
export interface TenantContext {
  tenantId: string;
  role: 'PLATFORM_ADMIN' | 'TENANT_ADMIN';
  accountId: string;
}

export const Tenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const req = ctx.switchToHttp().getRequest();
    return req.tenantContext;
  },
);
