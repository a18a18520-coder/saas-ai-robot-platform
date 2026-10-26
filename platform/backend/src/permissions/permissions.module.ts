import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { PermissionService } from './permission.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [PermissionService],
  exports: [PermissionService],
})
export class PermissionsModule {}
