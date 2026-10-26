import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Group } from './group.entity';
import { GroupMember } from './group-member.entity';
import { GroupsController } from './groups.controller';
import { GroupMembersController } from './group-members.controller';
import { User } from '../users/user.entity';
import { AuditModule } from '../audit/audit.module';
import { GroupRegistrationService } from './group-registration.service';
import { Robot } from '../robots/robot.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Group, GroupMember, User, Robot]), AuditModule],
  controllers: [GroupsController, GroupMembersController],
  providers: [GroupRegistrationService],
  exports: [GroupRegistrationService],
})
export class GroupsModule {}
