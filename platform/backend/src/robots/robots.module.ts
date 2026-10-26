import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Robot } from './robot.entity';
import { Group } from '../groups/group.entity';
import { RobotsController } from './robots.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Robot, Group])],
  controllers: [RobotsController],
})
export class RobotsModule {}
