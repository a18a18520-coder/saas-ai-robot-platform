import { BadGatewayException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Channel } from '../channels/channel.entity';
import { hashPhone, maskPhone } from './user.constants';
import { User, UserIdentity } from './user.entity';
import { SecretsService } from '../secrets/secrets.service';
import { channelSecretFields } from '../channels/channel-secrets';

interface DirectoryEmployee {
  externalId: string;
  name: string;
  mobile?: string;
  department?: string;
}

/** 从已连接企业渠道拉取通讯录，并建立厂商用户 ID → 平台员工身份映射。 */
@Injectable()
export class DirectorySyncService {
  constructor(
    @InjectRepository(Channel) private readonly channels: Repository<Channel>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserIdentity) private readonly identities: Repository<UserIdentity>,
    private readonly audit: AuditService,
    private readonly secrets: SecretsService,
  ) {}

  async sync(tenantId: string, channelId?: string): Promise<{ channelId: string; channel: string; fetched: number; created: number; updated: number }> {
    if (!tenantId) throw new HttpException({ code: 40001, message: '参数缺失: tenantId', data: null }, HttpStatus.BAD_REQUEST);
    let channel = channelId
      ? await this.channels.findOne({ where: { id: channelId, tenantId } })
      : null;
    if (!channel && !channelId) {
      const candidates = await this.channels.find({
        where: { tenantId, status: 'connected', type: In(['wecom', 'dingtalk', 'feishu']) },
        order: { createdAt: 'ASC' },
      });
      channel = candidates.find((candidate) => {
        const config = this.secrets.decryptRecord(candidate.config, channelSecretFields(candidate.type));
        return this.requiredCredentials(candidate.type).every((field) => Boolean(config[field]));
      }) ?? null;
    }
    if (!channel || channel.status !== 'connected' || !['wecom', 'dingtalk', 'feishu'].includes(channel.type)) {
      throw new HttpException({ code: 42201, message: '请先连接企业微信、钉钉或飞书渠道', data: null }, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    channel.config = this.secrets.decryptRecord(channel.config, channelSecretFields(channel.type));
    const missing = this.requiredCredentials(channel.type).filter((field) => !channel.config?.[field]);
    if (missing.length) {
      throw new HttpException({ code: 42201, message: `${this.channelName(channel.type)}渠道缺少配置: ${missing.join(', ')}`, data: null }, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    let employees: DirectoryEmployee[];
    try {
      if (channel.type === 'wecom') employees = await this.fetchWeCom(channel);
      else if (channel.type === 'dingtalk') employees = await this.fetchDingTalk(channel);
      else employees = await this.fetchFeishu(channel);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadGatewayException({ code: 50201, message: `通讯录同步失败：${(error as Error).message}`, data: null });
    }

    let created = 0, updated = 0;
    for (const employee of employees) {
      if (!employee.externalId || !employee.name) continue;
      const mobile = employee.mobile?.replace(/\D/g, '');
      const identity = await this.identities.findOne({ where: { tenantId, channel: channel.type, channelUserId: employee.externalId } });
      let user = identity ? await this.users.findOne({ where: { id: identity.userId, tenantId } }) : null;
      if (mobile && /^1[3-9]\d{9}$/.test(mobile)) {
        user = await this.users.findOne({ where: { tenantId, phoneHash: hashPhone(mobile) } }) ?? user;
      }
      if (!user) {
        user = this.users.create({ tenantId, identity: '员工', status: 'ACTIVE' });
        created++;
      } else {
        updated++;
      }
      user.name = employee.name;
      user.identity = '员工';
      user.status = 'ACTIVE';
      if (employee.department) user.department = employee.department;
      if (mobile && /^1[3-9]\d{9}$/.test(mobile)) {
        user.phoneHash = hashPhone(mobile);
        user.phoneMasked = maskPhone(mobile);
      }
      user = await this.users.save(user);
      if (identity) {
        identity.userId = user.id; identity.confidence = '高';
        await this.identities.save(identity);
      } else {
        await this.identities.save(this.identities.create({ tenantId, userId: user.id, channel: channel.type, channelUserId: employee.externalId, confidence: '高' }));
      }
    }

    await this.audit.log({ tenantId, question: `[用户] 同步${this.channelName(channel.type)}通讯录`, result: `拉取 ${employees.length} / 新增 ${created} / 更新 ${updated}`, channelUserId: 'admin' }).catch(() => undefined);
    return { channelId: channel.id, channel: channel.type, fetched: employees.length, created, updated };
  }

  private async fetchWeCom(channel: Channel): Promise<DirectoryEmployee[]> {
    const c = channel.config ?? {};
    const token = await this.wecomToken(c.corp_id, c.secret);
    const departments = await this.getJson<{ errcode: number; errmsg?: string; department?: Array<{ id: number; name: string }> }>(`https://qyapi.weixin.qq.com/cgi-bin/department/list?access_token=${encodeURIComponent(token)}`);
    if (departments.errcode !== 0) throw new Error(`企微部门接口失败: ${departments.errcode} ${departments.errmsg ?? ''}`);
    const departmentNames = new Map((departments.department ?? []).map((item) => [item.id, item.name]));
    const result = new Map<string, DirectoryEmployee>();
    for (const departmentId of departmentNames.keys()) {
      const users = await this.getJson<{ errcode: number; errmsg?: string; userlist?: Array<{ userid: string; name: string; mobile?: string; department?: number[] }> }>(`https://qyapi.weixin.qq.com/cgi-bin/user/list?access_token=${encodeURIComponent(token)}&department_id=${departmentId}&fetch_child=0`);
      if (users.errcode !== 0) throw new Error(`企微成员接口失败: ${users.errcode} ${users.errmsg ?? ''}`);
      for (const item of users.userlist ?? []) {
        result.set(item.userid, { externalId: item.userid, name: item.name, mobile: item.mobile, department: item.department?.map((id) => departmentNames.get(id)).filter(Boolean).join(' / ') });
      }
    }
    return [...result.values()];
  }

  private async fetchDingTalk(channel: Channel): Promise<DirectoryEmployee[]> {
    const c = channel.config ?? {};
    const auth = await this.postJson<{ accessToken?: string; code?: string; message?: string }>('https://api.dingtalk.com/v1.0/oauth2/accessToken', { appKey: c.app_key, appSecret: c.app_secret });
    if (!auth.accessToken) throw new Error(`钉钉鉴权失败: ${auth.code ?? ''} ${auth.message ?? ''}`);
    const token = encodeURIComponent(auth.accessToken);
    const result = new Map<string, DirectoryEmployee>();
    const queue: Array<{ deptId: number; name: string }> = [{ deptId: 1, name: '根部门' }];
    const seen = new Set<number>();
    while (queue.length) {
      const department = queue.shift()!;
      if (seen.has(department.deptId)) continue;
      seen.add(department.deptId);
      const children = await this.postJson<{ errcode?: number; errmsg?: string; result?: Array<{ dept_id?: number; name?: string }> }>(`https://oapi.dingtalk.com/topapi/v2/department/listsub?access_token=${token}`, { dept_id: department.deptId });
      if (children.errcode !== 0) throw new Error(`钉钉部门接口失败: ${children.errcode ?? ''} ${children.errmsg ?? ''}`);
      for (const child of children.result ?? []) if (child.dept_id) queue.push({ deptId: child.dept_id, name: child.name ?? String(child.dept_id) });
      let cursor = 0;
      do {
        const page = await this.postJson<{ errcode?: number; errmsg?: string; result?: { list?: Array<{ userid?: string; name?: string; mobile?: string }>; next_cursor?: number; has_more?: boolean } }>(`https://oapi.dingtalk.com/topapi/v2/user/list?access_token=${token}`, { dept_id: department.deptId, cursor, size: 100 });
        if (page.errcode !== 0) throw new Error(`钉钉成员接口失败: ${page.errcode ?? ''} ${page.errmsg ?? ''}`);
        for (const item of page.result?.list ?? []) {
          const externalId = item.userid ?? '';
          if (externalId && item.name) result.set(externalId, { externalId, name: item.name, mobile: item.mobile, department: department.name });
        }
        if (!page.result?.has_more || page.result.next_cursor === undefined) break;
        cursor = page.result.next_cursor;
      } while (true);
    }
    return [...result.values()];
  }

  private async fetchFeishu(channel: Channel): Promise<DirectoryEmployee[]> {
    const c = channel.config ?? {};
    const auth = await this.postJson<{ code?: number; msg?: string; tenant_access_token?: string }>('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', { app_id: c.app_id, app_secret: c.app_secret });
    if (auth.code !== 0 || !auth.tenant_access_token) throw new Error(`飞书鉴权失败: ${auth.code ?? ''} ${auth.msg ?? ''}`);
    const headers = { Authorization: `Bearer ${auth.tenant_access_token}` };
    const result = new Map<string, DirectoryEmployee>();
    const departmentNames = new Map<string, string>([['0', '根部门']]);
    let departmentToken = '';
    do {
      const suffix = departmentToken ? `&page_token=${encodeURIComponent(departmentToken)}` : '';
      const page = await this.getJson<{ code?: number; msg?: string; data?: { items?: Array<{ department_id?: string; open_department_id?: string; name?: string }>; has_more?: boolean; page_token?: string } }>(`https://open.feishu.cn/open-apis/contact/v3/departments/0/children?department_id_type=department_id&fetch_child=true&page_size=50${suffix}`, headers);
      if (page.code !== 0) throw new Error(`飞书部门接口失败: ${page.code ?? ''} ${page.msg ?? ''}`);
      for (const item of page.data?.items ?? []) {
        const id = item.department_id ?? item.open_department_id;
        if (id) departmentNames.set(id, item.name ?? id);
      }
      departmentToken = page.data?.has_more ? (page.data.page_token ?? '') : '';
    } while (departmentToken);

    for (const [departmentId, departmentName] of departmentNames) {
      let pageToken = '';
      do {
        const suffix = pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : '';
        const page = await this.getJson<{ code?: number; msg?: string; data?: { items?: Array<{ open_id?: string; user_id?: string; name?: string; mobile?: string }>; has_more?: boolean; page_token?: string } }>(`https://open.feishu.cn/open-apis/contact/v3/users/find_by_department?department_id=${encodeURIComponent(departmentId)}&department_id_type=department_id&user_id_type=open_id&page_size=50${suffix}`, headers);
        if (page.code !== 0) throw new Error(`飞书成员接口失败: ${page.code ?? ''} ${page.msg ?? ''}`);
        for (const item of page.data?.items ?? []) {
          const externalId = item.open_id ?? item.user_id ?? '';
          if (externalId && item.name) result.set(externalId, { externalId, name: item.name, mobile: item.mobile, department: departmentName });
        }
        pageToken = page.data?.has_more ? (page.data.page_token ?? '') : '';
      } while (pageToken);
    }
    return [...result.values()];
  }

  private async wecomToken(corpId?: string, secret?: string): Promise<string> {
    if (!corpId || !secret) throw new Error('企微渠道缺少 corp_id/secret');
    const auth = await this.getJson<{ errcode: number; errmsg?: string; access_token?: string }>(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`);
    if (auth.errcode !== 0 || !auth.access_token) throw new Error(`企微鉴权失败: ${auth.errcode} ${auth.errmsg ?? ''}`);
    return auth.access_token;
  }

  private async getJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
    const response = await fetch(url, { headers });
    const result = await response.json() as T;
    if (!response.ok) throw new Error(`厂商接口 HTTP ${response.status}`);
    return result;
  }

  private async postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json() as T;
    if (!response.ok) throw new Error(`厂商接口 HTTP ${response.status}`);
    return result;
  }

  private channelName(type: string): string {
    return ({ wecom: '企业微信', dingtalk: '钉钉', feishu: '飞书' } as Record<string, string>)[type] ?? type;
  }

  private requiredCredentials(type: string): string[] {
    return ({
      wecom: ['corp_id', 'secret'],
      dingtalk: ['app_key', 'app_secret'],
      feishu: ['app_id', 'app_secret'],
    } as Record<string, string[]>)[type] ?? [];
  }
}
