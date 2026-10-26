import { EvaluationCase, EvaluationRun } from '../evaluations/evaluation.entity';
import { CollectorBinding, CollectorDevice, CollectorMessage } from '../collector/collector.entity';
import { WikiPage, WikiVersion } from '../wiki/wiki.entity';
import { IngestionJob } from '../knowledge/ingestion.entity';
import { ModelConfig } from '../models/model.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { BroadcastRecord } from '../broadcast/broadcast-record.entity';
import { Channel } from '../channels/channel.entity';
import { ContentFilterHit } from '../content-filter/content-filter-hit.entity';
import { ContentFilterWord } from '../content-filter/content-filter-word.entity';
import { TenantDifyResource } from '../dify/tenant-dify-resource.entity';
import { FollowUp } from '../follow-ups/follow-up.entity';
import { GroupMember } from '../groups/group-member.entity';
import { Group } from '../groups/group.entity';
import { KnowledgeBase } from '../knowledge/knowledge-base.entity';
import { KnowledgeFile } from '../knowledge/tenant-knowledge.controller';
import { Notification } from '../notifications/notification.entity';
import { PaymentOrder } from '../payments/payment-order.entity';
import { Plan } from '../plans/plan.entity';
import { PlatformSetting } from '../platform-settings/platform-setting.entity';
import { Tool } from '../platform-tools/tool.entity';
import {
  PlatformAccount,
  PlatformRole,
} from '../platform-identity/platform-identity.entity';
import { Robot } from '../robots/robot.entity';
import { CollectionRecord } from '../robots/collection-record.entity';
import { Dept, DeptKb, Role, RolePermission } from '../roles/role.entity';
import { Conversation, Message } from '../sessions/conversation.entity';
import { LoginLog, TenantAccount } from '../tenants/tenant-account.entity';
import { Tenant } from '../tenants/tenant.entity';
import { User, UserIdentity } from '../users/user.entity';

export const DATABASE_ENTITIES = [
  CollectorBinding, CollectorDevice, CollectorMessage,
  EvaluationCase, EvaluationRun, ModelConfig, WikiPage, WikiVersion, IngestionJob,
  Tenant,
  Plan,
  TenantDifyResource,
  Tool,
  ContentFilterWord,
  Robot,
  CollectionRecord,
  Group,
  GroupMember,
  User,
  UserIdentity,
  Conversation,
  Message,
  AuditLog,
  BroadcastRecord,
  Role,
  RolePermission,
  Dept,
  DeptKb,
  Notification,
  KnowledgeFile,
  KnowledgeBase,
  Channel,
  FollowUp,
  PlatformSetting,
  PaymentOrder,
  TenantAccount,
  LoginLog,
  ContentFilterHit,
  PlatformRole,
  PlatformAccount,
];
