import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
dotenv.config();

import { Plan } from '../plans/plan.entity';
import { Tenant } from '../tenants/tenant.entity';
import { Robot } from '../robots/robot.entity';
import { User, UserIdentity } from '../users/user.entity';
import { Group } from '../groups/group.entity';
import { GroupMember } from '../groups/group-member.entity';
import { KnowledgeBase } from '../knowledge/knowledge-base.entity';
import { KnowledgeFile } from '../knowledge/tenant-knowledge.controller';
import { Channel } from '../channels/channel.entity';
import { Conversation, Message } from '../sessions/conversation.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { Notification } from '../notifications/notification.entity';
import { PaymentOrder } from '../payments/payment-order.entity';
import { TenantDifyResource } from '../dify/tenant-dify-resource.entity';
import { TenantAccount } from '../tenants/tenant-account.entity';
import { LoginLog } from '../tenants/tenant-account.entity';
import { hashPassword } from '../auth/password.util';
import { createHash } from 'crypto';
import { localDateISO } from '../common/date.util';
import { ConfigService } from '@nestjs/config';
import { SecretsService } from '../secrets/secrets.service';
import { channelSecretFields } from '../channels/channel-secrets';
import {
  PlatformAccount,
  PlatformRole,
} from '../platform-identity/platform-identity.entity';
import { PlatformIdentityService } from '../platform-identity/platform-identity.service';
import { Role, RolePermission } from '../roles/role.entity';
import {
  BUILTIN_TENANT_ROLE_WINDOWS,
  TENANT_ADMIN_WINDOWS,
} from '../tenants/tenant-account.defaults';

/**
 * 演示模拟数据 seed（租户端 + 管理端）：
 *  - 4 个新租户（状态多样：ACTIVE×2 / DISABLED / PENDING_ACTIVATION）
 *  - 每个 ACTIVE 租户：机器人/用户/知识库/群/会话/渠道/Dify 资源
 *  - 管理端：审计（AI 调用 + 操作类）、通知、支付订单
 * 幂等：租户名已存在则跳过，可重复执行
 * 用法: npx ts-node -r tsconfig-paths/register src/seed/seed-demo.ts
 */
const ds = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'robot',
  password: process.env.DB_PASS ?? 'robot',
  database: process.env.DB_NAME ?? 'robot_platform',
  entities: [
    Plan,
    Tenant,
    Robot,
    User,
    UserIdentity,
    Group,
    GroupMember,
    KnowledgeBase,
    KnowledgeFile,
    Channel,
    Conversation,
    Message,
    AuditLog,
    Notification,
    PaymentOrder,
    TenantDifyResource,
    TenantAccount,
    LoginLog,
    PlatformRole,
    PlatformAccount,
    Role,
    RolePermission,
  ],
  synchronize: false,
});

const secrets = new SecretsService(new ConfigService(process.env));

const daysAgo = (days: number, hour = 10, minute = 0): Date => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d;
};

/** 与运行时一致的 hash（identity.service/import：robot: 盐前缀 + 全 64 位 sha256） */
const phoneHash = (p: string): string =>
  createHash('sha256').update(`robot:${p}`).digest('hex');
/** 脱敏手机号（与 users 列表展示一致 138****6688） */
const maskPhone = (p: string): string =>
  p.length === 11 ? p.slice(0, 3) + '****' + p.slice(7) : p;

async function seed() {
  await ds.initialize();
  const R = {
    plans: ds.getRepository(Plan),
    tenants: ds.getRepository(Tenant),
    robots: ds.getRepository(Robot),
    users: ds.getRepository(User),
    identities: ds.getRepository(UserIdentity),
    groups: ds.getRepository(Group),
    members: ds.getRepository(GroupMember),
    kbs: ds.getRepository(KnowledgeBase),
    files: ds.getRepository(KnowledgeFile),
    channels: ds.getRepository(Channel),
    convs: ds.getRepository(Conversation),
    msgs: ds.getRepository(Message),
    audits: ds.getRepository(AuditLog),
    notifications: ds.getRepository(Notification),
    orders: ds.getRepository(PaymentOrder),
    dify: ds.getRepository(TenantDifyResource),
    loginLogs: ds.getRepository(LoginLog),
    roles: ds.getRepository(Role),
    rolePermissions: ds.getRepository(RolePermission),
  };

  const planByName = new Map((await R.plans.find()).map((p) => [p.name, p]));

  // ── 平台账号与角色验收数据（幂等）──────────────────
  const platformIdentities = new PlatformIdentityService(
    ds.getRepository(PlatformAccount),
    ds.getRepository(PlatformRole),
    new ConfigService(process.env),
  );
  const builtinAdmin = await platformIdentities.ensureBuiltins();
  const platformRoles = await platformIdentities.listRoles();
  const demoPlatformAccounts = [
    {
      name: '演示平台运营',
      account: 'operator@platform.local',
      password: 'Operator@2026',
      roleCode: 'PLATFORM_OPERATOR',
    },
    {
      name: '演示平台审计',
      account: 'auditor@platform.local',
      password: 'Auditor@2026',
      roleCode: 'PLATFORM_AUDITOR',
    },
  ];
  const existingPlatformAccounts = await platformIdentities.listAccounts();
  for (const demo of demoPlatformAccounts) {
    if (existingPlatformAccounts.some((item) => item.account === demo.account))
      continue;
    const role = platformRoles.find((item) => item.code === demo.roleCode);
    if (role) {
      await platformIdentities.createAccount({ ...demo, roleId: role.id });
    }
  }
  if ((await R.loginLogs.count({ where: { domain: 'platform' } })) === 0) {
    await R.loginLogs.save([
      R.loginLogs.create({
        account: builtinAdmin.account,
        domain: 'platform',
        ip: '127.0.0.1',
        result: '成功',
        createdAt: daysAgo(0, 9, 15),
      }),
      R.loginLogs.create({
        account: 'operator@platform.local',
        domain: 'platform',
        ip: '127.0.0.1',
        result: '成功',
        createdAt: daysAgo(1, 14, 30),
      }),
      R.loginLogs.create({
        account: 'unknown@platform.local',
        domain: 'platform',
        ip: '10.0.0.8',
        result: '失败',
        createdAt: daysAgo(2, 20, 5),
      }),
    ]);
  }

  // ── 租户定义 ────────────────────────────────────────────────
  type TenantDef = {
    name: string;
    adminEmail: string;
    plan: string;
    status: Tenant['status'];
    cycleDaysAgo: number;
    trial: boolean;
    disabledReason?: string;
  };
  const tenantsDef: TenantDef[] = [
    {
      name: '星云智能科技',
      adminEmail: 'admin@nebula.cn',
      plan: '专业版',
      status: 'ACTIVE',
      cycleDaysAgo: 18,
      trial: false,
    },
    {
      name: '蓝海商贸集团',
      adminEmail: 'admin@blueocean.com',
      plan: '标准版',
      status: 'ACTIVE',
      cycleDaysAgo: 5,
      trial: false,
    },
    {
      name: '天穹教育咨询',
      adminEmail: 'admin@tianqiong.edu',
      plan: '标准版',
      status: 'DISABLED',
      cycleDaysAgo: 40,
      trial: true,
      disabledReason: '试用到期未续费（平台停用）',
    },
    {
      name: '晨曦医疗器械',
      adminEmail: 'admin@chenxi.med',
      plan: '旗舰版',
      status: 'PENDING_ACTIVATION',
      cycleDaysAgo: 0,
      trial: false,
    },
  ];

  let createdTenants = 0;
  for (const t of tenantsDef) {
    const exists = await R.tenants.findOne({ where: { name: t.name } });
    if (exists) continue;
    const plan = planByName.get(t.plan);
    const tenant = await R.tenants.save(
      R.tenants.create({
        name: t.name,
        adminEmail: t.adminEmail,
        planId: plan?.id ?? planByName.values().next().value.id,
        status: t.status,
        cycleStartAt: localDateISO(daysAgo(t.cycleDaysAgo)),
        isTrial: t.trial,
        aiQuotaUsed: Math.floor(
          (plan?.aiQuota ?? 3000) * (0.3 + Math.random() * 0.5),
        ),
        disabledReason: t.disabledReason,
      }),
    );
    createdTenants++;
    if (t.status !== 'ACTIVE') continue;

    // ── Dify 资源分配 ──────────────────────────────────────
    const difyApps = [
      {
        resourceId: `ds-app-${tenant.id.slice(0, 4)}-01`,
        resourceName: `${t.name}客服助手`,
        datasetId: `ds-${tenant.id.slice(0, 6)}-a`,
        dsKey: `ds-key-${tenant.id.slice(0, 8)}a`,
      },
      {
        resourceId: `ds-app-${tenant.id.slice(0, 4)}-02`,
        resourceName: `${t.name}知识问答`,
        datasetId: `ds-${tenant.id.slice(0, 6)}-b`,
        dsKey: `ds-key-${tenant.id.slice(0, 8)}b`,
      },
    ];
    await R.dify.save(
      difyApps.map((d) =>
        R.dify.create({
          tenantId: tenant.id,
          ...d,
          dsKey: secrets.encrypt(d.dsKey),
        }),
      ),
    );

    // ── 机器人 ─────────────────────────────────────────────
    const robotDefs: Array<{
      name: string;
      type: string;
      status: Robot['status'];
      difyAppId: string;
      desc: string;
    }> = [
      {
        name: `${t.name}客服机器人`,
        type: '客服机器人',
        status: 'PUBLISHED',
        difyAppId: difyApps[0].resourceId,
        desc: '售前咨询与常见问题自动应答，未命中转人工',
      },
      {
        name: `${t.name}业务查询助手`,
        type: '业务助手',
        status: 'PUBLISHED',
        difyAppId: difyApps[1].resourceId,
        desc: '订单/库存/进度查询',
      },
      {
        name: `${t.name}知识库助手`,
        type: '知识助手',
        status: 'DRAFT',
        difyAppId: difyApps[1].resourceId,
        desc: '内部制度与文档问答（草稿）',
      },
    ];
    const robots: Robot[] = [];
    for (const r of robotDefs) {
      robots.push(
        await R.robots.save(
          R.robots.create({
            tenantId: tenant.id,
            name: r.name,
            type: r.type,
            description: r.desc,
            difyAppId: r.difyAppId,
            kbPool: [],
            toolIdentifiers: [],
            status: r.status,
            humanHandoff: {
              enabled: true,
              fallback: '抱歉，我暂时没找到答案，已通知客服为您处理，请稍候~',
            },
            createdAt: daysAgo(10 + robots.length * 5),
          }),
        ),
      );
    }

    // ── 知识库 + 文件 ──────────────────────────────────────
    const kbDefs: Array<{
      name: string;
      visibility: KnowledgeBase['visibility'];
      files: Array<[string, number, number, string]>;
    }> = [
      {
        name: `${t.name}产品资料库`,
        visibility: 'all',
        files: [
          ['产品介绍-2026Q2.pdf', 2, 2457600, 'synced'],
          ['常见问题FAQ.md', 1, 48230, 'synced'],
          ['销售话术手册.docx', 2, 612340, 'synced'],
        ],
      },
      {
        name: `${t.name}内部制度库`,
        visibility: 'restricted',
        files: [
          ['员工手册2026.pdf', 2, 1820000, 'synced'],
          ['薪酬保密制度.docx', 3, 42000, 'synced'],
        ],
      },
    ];
    const kbIds: string[] = [];
    for (const kb of kbDefs) {
      const saved = await R.kbs.save(
        R.kbs.create({
          tenantId: tenant.id,
          datasetId: kb.name.includes('制度')
            ? `ds-${tenant.id.slice(0, 6)}-b`
            : `ds-${tenant.id.slice(0, 6)}-a`,
          name: kb.name,
          visibility: kb.visibility,
          deptIds: [],
          createdBy: tenant.adminEmail,
        }),
      );
      kbIds.push(saved.id);
      for (const [fname, sec, size, sync] of kb.files) {
        await R.files.save(
          R.files.create({
            tenantId: tenant.id,
            datasetId: saved.datasetId,
            difyDocumentId: `doc-${saved.id.slice(0, 8)}-${fname.slice(0, 4)}`,
            name: fname,
            secLevel: sec as 1 | 2 | 3,
            size,
            syncStatus: sync,
          }),
        );
      }
    }

    // ── 用户 + 身份映射 ────────────────────────────────────
    // 手机号段按租户偏移（users.phone_hash 全局唯一，避免跨租户冲突）
    const tenantSeq = tenantsDef.findIndex((x) => x.name === t.name);
    const phoneBase = 13801000000 + tenantSeq * 100;
    const userDefs: Array<[string, string, string]> = [
      ['张伟', '管理员', '总经办'],
      ['李娜', '客服', '客服部'],
      ['王强', '运营', '运营部'],
      ['赵敏', '员工', '销售部'],
      ['刘洋', '员工', '销售部'],
      ['陈静', '员工', '市场部'],
      ['孙磊', '客服', '客服部'],
      ['周芳', '员工', '人事部'],
    ];
    const users: User[] = [];
    for (let ui = 0; ui < userDefs.length; ui++) {
      const [name, identity, dept] = userDefs[ui];
      const phone = String(phoneBase + ui);
      users.push(
        await R.users.save(
          R.users.create({
            tenantId: tenant.id,
            name,
            identity,
            department: dept,
            phoneHash: phoneHash(phone),
            phoneMasked: maskPhone(phone),
            status: 'ACTIVE',
          }),
        ),
      );
    }
    for (let i = 0; i < users.length; i++) {
      await R.identities.save(
        R.identities.create({
          tenantId: tenant.id,
          userId: users[i].id,
          channel: 'wecom',
          channelUserId: `wm_${tenant.id.slice(0, 4)}_${i + 1}`,
          confidence: i < 4 ? '高' : '低',
        }),
      );
    }

    // ── 渠道 ───────────────────────────────────────────────
    await R.channels.save(
      R.channels.create({
        tenantId: tenant.id,
        type: 'wecom',
        name: `${t.name}企业微信`,
        config: secrets.encryptRecord(
          {
            corp_id: `ww-${tenant.id.slice(0, 8)}`,
            agent_id: '1000002',
            token: 'demo',
            aes_key: 'demo',
          },
          channelSecretFields('wecom'),
        ),
        status: 'connected',
        bindRobotId: robots[0].id,
      }),
    );

    // ── 群 + 成员 ──────────────────────────────────────────
    const groupDefs = [
      {
        name: `${t.name}客户服务群`,
        chatId: `chat-${tenant.id.slice(0, 6)}-svc`,
        robot: robots[0],
        members: users.slice(0, 6),
      },
      {
        name: `${t.name}销售协作群`,
        chatId: `chat-${tenant.id.slice(0, 6)}-sales`,
        robot: robots[1],
        members: users.slice(2, 8),
      },
      {
        name: `${t.name}待绑定测试群`,
        chatId: `chat-${tenant.id.slice(0, 6)}-pending`,
        robot: undefined,
        members: users.slice(4, 6),
      },
    ];
    for (const g of groupDefs) {
      const group = await R.groups.save(
        R.groups.create({
          tenantId: tenant.id,
          chatId: g.chatId,
          name: g.name,
          groupType: 'internal',
          robotId: g.robot?.id,
          status: g.robot ? 'BOUND' : 'PENDING',
          handoffRole: g.robot ? '客服' : undefined,
          channel: 'wecom',
        }),
      );
      for (const u of g.members) {
        await R.members.save(
          R.members.create({
            groupId: group.id,
            channelUserId: `wm_${tenant.id.slice(0, 4)}_${users.indexOf(u) + 1}`,
            source: 'wecom',
            userId: u.id,
            groupRoleOverride:
              u.identity === '管理员' ? 'group_admin' : undefined,
          }),
        );
      }
    }

    // ── 会话 + 消息 ────────────────────────────────────────
    const qa: Array<[string, string]> = [
      [
        '你们的产品支持哪些渠道接入？',
        '我们支持企业微信、钉钉、飞书以及 Web 聊天四种渠道接入，企业微信渠道支持群聊自动应答与转人工。',
      ],
      [
        '订单状态怎么查询？',
        '您可以在订单中心选择待发货/已发货/已完成等状态筛选，也可以直接告诉我订单号帮您查询。',
      ],
      [
        '退款多久能到账？',
        '退款审核通过后 1-3 个工作日原路退回，对公转账的订单会退回至原付款账户。',
      ],
      [
        '如何添加新的知识库文件？',
        '进入知识库页面点击上传文件，支持 PDF/Word/Markdown 格式，上传后会自动完成解析与切片同步。',
      ],
    ];
    for (let i = 0; i < 4; i++) {
      const conv = await R.convs.save(
        R.convs.create({
          tenantId: tenant.id,
          robotId: robots[i % 2].id,
          userId: users[i + 1].id,
          createdAt: daysAgo(9 - i * 2, 9 + i),
          updatedAt: daysAgo(9 - i * 2, 9 + i + 1),
        }),
      );
      const [q, a] = qa[i % qa.length];
      await R.msgs.save(
        R.msgs.create({
          conversationId: conv.id,
          role: 'user',
          content: q,
          createdAt: daysAgo(9 - i * 2, 9 + i),
        }),
      );
      await R.msgs.save(
        R.msgs.create({
          conversationId: conv.id,
          role: 'assistant',
          content: a,
          createdAt: daysAgo(9 - i * 2, 9 + i, 5),
        }),
      );
    }

    // ── 该租户的 AI 调用审计（近 30 天分布） ─────────────────
    const aiQuestions = [
      ['订单发货后多久能修改地址？', '知识命中'],
      ['发票抬头怎么修改？', '知识命中'],
      ['会员积分怎么兑换？', '未命中转人工'],
      ['你们的合作流程是怎样的？', '知识命中'],
      ['催款函件模板发我一下', '权限拒绝'],
      ['支持私有化部署吗？', '知识命中'],
      ['这份合同需要法务审核吗？', '未命中转人工'],
      ['API 接口文档在哪里看？', '知识命中'],
    ] as const;
    for (let i = 0; i < 8; i++) {
      const [q, result] = aiQuestions[i];
      // 近 7 天分布（本月调用可计数；昨天到今天为主）
      const when = daysAgo(i < 2 ? 0 : i < 4 ? 1 : i < 6 ? 3 : 5, 9 + (i % 9));
      await R.audits.save(
        R.audits.create({
          tenantId: tenant.id,
          robotId: robots[i % 2].id,
          userId: users[(i + 2) % users.length].id,
          channelUserId: `wm_${tenant.id.slice(0, 4)}_${((i + 2) % users.length) + 1}`,
          question: q,
          result,
          answer: result === '知识命中' ? '根据知识库回答：' + q : undefined,
          datasetHits:
            result === '知识命中'
              ? [
                  {
                    dataset_id: kbIds[0],
                    content: q.slice(0, 20),
                    score: 0.82 + i * 0.02,
                  },
                ]
              : undefined,
          traceId: `tr-${tenant.id.slice(0, 6)}-${1000 + i}`,
          durationMs: 320 + i * 90,
          stages: [
            { name: '身份识别', durationMs: 18, result: 'ok' },
            {
              name: '权限计算',
              durationMs: 45,
              result: result === '权限拒绝' ? 'denied' : 'ok',
            },
            {
              name: '知识检索',
              durationMs: result === '未命中转人工' ? 0 : 210,
              result: result === '未命中转人工' ? 'no-hit' : 'hit',
            },
          ],
          createdAt: when,
        }),
      );
    }
  }

  // ── 管理端：支付订单（挂到已存在租户上） ────────────────────
  const [anyTenant] = await R.tenants.find({
    where: { status: 'ACTIVE' },
    take: 1,
  });
  if (anyTenant) {
    const pMap = new Map((await R.plans.find()).map((p) => [p.name, p]));
    const orderDefs: Array<
      Partial<PaymentOrder> & { plan: string; days: number }
    > = [
      {
        tenantId: anyTenant.id,
        plan: '专业版',
        amount: 199900,
        payType: 'WECHAT',
        status: 'PAID',
        days: 40,
        qrContent: 'weixin://wxpay/bizpayurl?pr=DEMO01',
      },
      {
        tenantId: anyTenant.id,
        plan: '标准版',
        amount: 99900,
        payType: 'ALIPAY',
        status: 'PAID',
        days: 33,
        qrContent: 'alipays://platformapi/startapp?orderId=DEMO02',
      },
      {
        tenantId: anyTenant.id,
        plan: '旗舰版',
        amount: 399900,
        payType: 'BANK_TRANSFER',
        status: 'PENDING_VERIFICATION',
        days: 1,
        bankInfo: {
          accountName: '示例科技有限公司',
          accountNo: '3100 1234 5678 9012 345',
          bank: '招商银行上海分行',
        },
      },
      {
        tenantId: anyTenant.id,
        plan: '标准版',
        amount: 0,
        payType: 'WECHAT',
        status: 'CANCELLED',
        days: 20,
      },
      {
        tenantId: anyTenant.id,
        plan: '专业版',
        amount: 156600,
        payType: 'WECHAT',
        status: 'PENDING',
        days: 0,
        qrContent: 'weixin://wxpay/bizpayurl?pr=DEMO05',
      },
    ];
    for (const o of orderDefs) {
      const plan = pMap.get(o.plan);
      await R.orders.save(
        R.orders.create({
          tenantId: anyTenant.id,
          planId: plan?.id,
          planName: o.plan,
          amount: o.amount ?? 0,
          payType: o.payType,
          status: o.status,
          qrContent: o.qrContent,
          bankInfo: o.bankInfo,
          createdAt: daysAgo(o.days, 14),
          paidAt: o.status === 'PAID' ? daysAgo(o.days, 14, 5) : undefined,
        }),
      );
    }
  }

  // ── 管理端：通知 ─────────────────────────────────────────
  const tenants = await R.tenants.find();
  // 新播种的租户也要拥有可直接绑定管理账号的内置角色与功能权限。
  for (const tenant of tenants) {
    for (const [name, windows] of Object.entries(BUILTIN_TENANT_ROLE_WINDOWS)) {
      let role = await R.roles.findOne({
        where: { tenantId: tenant.id, name },
      });
      if (role) continue;
      role = await R.roles.save(
        R.roles.create({
          tenantId: tenant.id,
          name,
          isBuiltin: true,
          status: 'ACTIVE',
        }),
      );
      for (const resourceId of windows) {
        await R.rolePermissions.save(
          R.rolePermissions.create({
            roleId: role.id,
            resourceType: 'window',
            resourceId,
          }),
        );
      }
    }
  }
  const activeTenant = tenants.find((t) => t.status === 'ACTIVE');
  const notifDefs: Array<Partial<Notification>> = [
    {
      tenantId: 'platform',
      type: 'system',
      title: '新租户待分配 Dify 资源',
      content:
        '租户「晨曦医疗器械」（admin@chenxi.med）及主管理员已创建，请继续分配 Dify 资源',
      link: '/tenants',
    },
    {
      tenantId: activeTenant?.id ?? 'platform',
      type: 'quota',
      title: 'AI 额度预警',
      content: '本月 AI 调用已达额度的 95%，接近上限，请关注使用情况',
      link: '/t/settings',
    },
    {
      tenantId: activeTenant?.id ?? 'platform',
      type: 'quota',
      title: 'AI 额度预警',
      content: '本月 AI 调用已达额度的 80%，建议评估套餐档位是否需要升级',
      link: '/t/settings',
    },
    {
      tenantId: 'platform',
      type: 'verification',
      title: '对公转账待核销',
      content: `租户「${activeTenant?.name ?? '—'}」转账 ¥3999.00 购买「旗舰版」，请核对到账`,
      link: '/payments',
    },
    {
      tenantId: activeTenant?.id ?? 'platform',
      type: 'broadcast_failed',
      title: '群发失败人工介入',
      content:
        '群发「618 活动通知」发送 12/14 成功，2 个群发送失败，请人工介入',
      link: '/t/broadcast',
    },
    {
      tenantId: activeTenant?.id ?? 'platform',
      type: 'handoff',
      title: '转人工待跟进',
      content: '「订单查询」未命中知识库，已转人工待跟进队列',
      link: '/t/follow-ups',
    },
  ];
  for (let i = 0; i < notifDefs.length; i++) {
    const n = notifDefs[i];
    await R.notifications.save(
      R.notifications.create({
        ...n,
        title: n.title,
        content: n.content,
        isRead: i > 2,
        createdAt: daysAgo(i * 2, 9 + i),
      }),
    );
  }

  // ── 管理端：操作类审计（[模块] 前缀，分布到各 ACTIVE 租户详情日志） ─
  const opLogs: Array<{ tenant: string; q: string; r: string }> = [
    {
      tenant: '星云智能科技',
      q: '[开通] 创建主管理员（admin@nebula.cn）',
      r: '临时初始密码已生成（首次登录必须修改）',
    },
    {
      tenant: '星云智能科技',
      q: '[套餐] 换套餐（标准版 → 专业版）',
      r: '免付直接切换（已用 2 天，差价 ≤ 0）',
    },
    {
      tenant: '蓝海商贸集团',
      q: '[支付] 套餐变更（免付）',
      r: '套餐变更（→ 标准版）',
    },
    {
      tenant: '蓝海商贸集团',
      q: '[知识] 上传文件（员工手册2026.pdf）',
      r: '同步完成（synced）',
    },
    {
      tenant: '平台',
      q: '[平台] 禁用租户（天穹教育咨询）',
      r: '试用到期未续费',
    },
  ];
  const tenantByName = new Map(tenants.map((t) => [t.name, t]));
  for (let i = 0; i < opLogs.length; i++) {
    const { tenant: tn, q, r } = opLogs[i];
    const tid = tenantByName.get(tn)?.id ?? 'platform';
    await R.audits.save(
      R.audits.create({
        tenantId: tid,
        question: q,
        result: r,
        traceId: `op-${100 + i}`,
        createdAt: daysAgo(0 + (i % 3), 15),
      }),
    );
  }

  // 演示租户管理员（tenant_accounts 真实化登录；幂等 upsert by account）
  const accounts = ds.getRepository(TenantAccount);
  const demoAccounts = [
    {
      account: 'admin@demo.com',
      password: 'Tenant@2026',
      name: '演示租户管理员',
      role: 'TENANT_ADMIN' as const,
    },
  ];
  for (const a of demoAccounts) {
    const exist = await accounts.findOne({ where: { account: a.account } });
    const tenant = exist
      ? await R.tenants.findOne({ where: { id: exist.tenantId } })
      : await R.tenants.findOne({ where: {} });
    const administratorRole = tenant
      ? await R.roles.findOne({
          where: { tenantId: tenant.id, name: '管理员', status: 'ACTIVE' },
        })
      : null;
    if (!exist) {
      await accounts.save(
        accounts.create({
          tenantId: tenant?.id ?? '9fa63b5b-f8d3-4f31-a242-1a00901da84e',
          name: a.name,
          account: a.account,
          passwordHash: hashPassword(a.password),
          role: a.role,
          roleId: administratorRole?.id,
          sessionVersion: 0,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          windows: [...TENANT_ADMIN_WINDOWS],
        }),
      );
      console.log(`   - 演示管理员已播种: ${a.account}`);
    } else if (!exist.roleId && administratorRole) {
      exist.role = 'TENANT_ADMIN';
      exist.roleId = administratorRole.id;
      exist.windows = [...TENANT_ADMIN_WINDOWS];
      await accounts.save(exist);
      console.log(`   - 演示管理员已关联角色: ${a.account}`);
    }
  }

  console.log(`✅ Demo Seed 完成: 新增租户 ${createdTenants} 个`);
  console.log('   - 租户端: 机器人/用户/知识库/群/会话/渠道/Dify 资源 已生成');
  console.log('   - 管理端: 审计记录 / 通知 / 支付订单 / 平台账号角色 已生成');
  console.log(
    `   - 固定超管: ${builtinAdmin.account}（密码取自 PLATFORM_SUPER_ADMIN_PASSWORD）`,
  );
  console.log('   - 演示运营: operator@platform.local / Operator@2026');
  console.log('   - 演示审计: auditor@platform.local / Auditor@2026');
  await ds.destroy();
}

seed().catch((e) => {
  console.error('❌ Demo Seed 失败:', e.message);
  process.exit(1);
});
