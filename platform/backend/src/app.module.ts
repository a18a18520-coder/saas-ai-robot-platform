import { EvaluationsModule } from './evaluations/evaluations.module';
import { CollectorModule } from './collector/collector.module';
import { WikiModule } from './wiki/wiki.module';
import { ModelsModule } from './models/models.module';
import { Module } from '@nestjs/common';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { PlanLimitFilter } from './plans/plan-limit.filter';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TenantsModule } from './tenants/tenants.module';
import { PlansModule } from './plans/plans.module';
import { DifyModule } from './dify/dify.module';
import { PlatformAuditModule } from './platform-audit/platform-audit.module';
import { PlatformSettingsModule } from './platform-settings/platform-settings.module';
import { PlatformToolsModule } from './platform-tools/platform-tools.module';
import { AuthModule } from './auth/auth.module';
import { ContentFilterModule } from './content-filter/content-filter.module';
import { RobotsModule } from './robots/robots.module';
import { GroupsModule } from './groups/groups.module';
import { UsersModule } from './users/users.module';
import { PermissionsModule } from './permissions/permissions.module';
import { SessionsModule } from './sessions/sessions.module';
import { AiRouterModule } from './ai-router/ai-router.module';
import { AuditModule } from './audit/audit.module';
import { BroadcastModule } from './broadcast/broadcast.module';
import { RolesModule } from './roles/roles.module';
import { NotificationsModule } from './notifications/notifications.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { ChannelsModule } from './channels/channels.module';
import { FollowUpsModule } from './follow-ups/follow-ups.module';
import { StatsModule } from './stats/stats.module';
import { PaymentsModule } from './payments/payments.module';
import { ApiAuthGuard } from './auth/api-auth.guard';
import { DATABASE_ENTITIES } from './database/entities';
import { validateEnvironment } from './config/environment';
import { HealthModule } from './health/health.module';
import { SecretsModule } from './secrets/secrets.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    SecretsModule,
    ModelsModule,
    WikiModule,
    EvaluationsModule,
    CollectorModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        host: cfg.get('DB_HOST', 'localhost'),
        port: cfg.get<number>('DB_PORT', 5432),
        username: cfg.get('DB_USER', 'robot'),
        password: cfg.get('DB_PASS', 'robot'),
        database: cfg.get('DB_NAME', 'robot_platform'),
        entities: DATABASE_ENTITIES,
        migrations: [`${__dirname}/database/migrations/*{.ts,.js}`],
        migrationsTableName: 'schema_migrations',
        migrationsRun: cfg.get('DB_MIGRATIONS_RUN', 'false') === 'true',
        synchronize: cfg.get('DB_SYNC', 'false') === 'true',
      }),
    }),
    TenantsModule,
    PlansModule,
    DifyModule,
    PlatformAuditModule,
    PlatformToolsModule,
    PlatformSettingsModule,
    AuthModule,
    ContentFilterModule,
    RobotsModule,
    GroupsModule,
    UsersModule,
    PermissionsModule,
    SessionsModule,
    AiRouterModule,
    AuditModule,
    BroadcastModule,
    RolesModule,
    NotificationsModule,
    KnowledgeModule,
    ChannelsModule,
    FollowUpsModule,
    StatsModule,
    PaymentsModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ApiAuthGuard }, { provide: APP_FILTER, useClass: PlanLimitFilter }],
})
export class AppModule {}
