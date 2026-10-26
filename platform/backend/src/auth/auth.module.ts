import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TenantAccount, LoginLog } from '../tenants/tenant-account.entity';
import { Tenant } from '../tenants/tenant.entity';
import { OidcService } from './oidc.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoginAttemptLimiter } from './login-attempt-limiter.service';
import { PlatformIdentityModule } from '../platform-identity/platform-identity.module';
import { RolesModule } from '../roles/roles.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TenantAccount, LoginLog, Tenant]),
    PlatformIdentityModule,
    RolesModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET', 'dev-secret'),
        signOptions: { expiresIn: '30m' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, OidcService, LoginAttemptLimiter],
  exports: [AuthService, LoginAttemptLimiter],
})
export class AuthModule {}
