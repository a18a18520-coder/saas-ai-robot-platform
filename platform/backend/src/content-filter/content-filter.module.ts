import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentFilterWord } from './content-filter-word.entity';
import { ContentFilterHit } from './content-filter-hit.entity';
import { ContentFilterService } from './content-filter.service';
import { ContentFilterController } from './content-filter.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ContentFilterWord, ContentFilterHit])],
  controllers: [ContentFilterController],
  providers: [ContentFilterService],
  exports: [ContentFilterService],
})
export class ContentFilterModule {}
