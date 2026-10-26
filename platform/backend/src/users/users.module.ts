import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User, UserIdentity } from './user.entity';
import { GroupMember } from '../groups/group-member.entity';
import { IdentityService } from './identity.service';
import { UsersController } from './users.controller';
import { Channel } from '../channels/channel.entity';
import { AuditModule } from '../audit/audit.module';
import { DirectorySyncService } from './directory-sync.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserIdentity, GroupMember, Channel]), AuditModule],
  controllers: [UsersController],
  providers: [IdentityService, DirectorySyncService],
  exports: [IdentityService, DirectorySyncService],
})
export class UsersModule {}
