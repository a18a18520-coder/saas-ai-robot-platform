import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BroadcastRecord } from './broadcast-record.entity';
import { Group } from '../groups/group.entity';
import { Channel } from '../channels/channel.entity';
import { Notification } from '../notifications/notification.entity';
import { BroadcastService } from './broadcast.service';
import { BroadcastController } from './broadcast.controller';
import { ChannelsModule } from '../channels/channels.module';

@Module({
  imports: [TypeOrmModule.forFeature([BroadcastRecord, Group, Channel, Notification]), ChannelsModule],
  controllers: [BroadcastController],
  providers: [BroadcastService],
})
export class BroadcastModule {}
