import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContentFilterWord } from './content-filter-word.entity';
import { ContentFilterHit } from './content-filter-hit.entity';

export interface FilterResult { text: string; action: 'PASS' | 'REPLACED' | 'REJECTED'; words: string[]; }

/** 黑名单拦截（替换/拒绝/告警）和白名单豁免；故障时降级放行，不中断消息主链路。 */
@Injectable()
export class ContentFilterService {
  private readonly logger = new Logger(ContentFilterService.name);
  constructor(
    @InjectRepository(ContentFilterWord) private readonly words: Repository<ContentFilterWord>,
    @InjectRepository(ContentFilterHit) private readonly hits: Repository<ContentFilterHit>,
  ) {}

  async filter(text: string, ctx: { tenantId?: string; robotId?: string; direction: 'input' | 'output' }): Promise<FilterResult> {
    try {
      const all = (await this.words.find({ where: { isActive: true } }))
        .filter((word) => this.appliesToTenant(word.scope, ctx.tenantId));
      const whites = all.filter((word) => word.listType === 'white');
      let result = text; const matched: string[] = [];
      for (const word of all.filter((item) => item.listType === 'black')) {
        if (!result.includes(word.word)) continue;
        // 例外短语必须实际出现在本次文本中，避免词库中存在例外即全局放行。
        if (whites.some((white) => text.includes(white.word) && (white.word === word.word || white.word.includes(word.word)))) {
          await this.record(ctx, word.word, 'white', 'EXEMPT', text); continue;
        }
        matched.push(word.word);
        await this.record(ctx, word.word, 'black', word.action, text);
        if (word.action === 'REJECT') return { text: '', action: 'REJECTED', words: matched };
        if (word.action === 'REPLACE') result = result.split(word.word).join('***');
      }
      return { text: result, action: result === text ? 'PASS' : 'REPLACED', words: matched };
    } catch (error) {
      this.logger.warn(`内容过滤降级放行: ${(error as Error).message}`);
      return { text, action: 'PASS', words: [] };
    }
  }

  private async record(ctx: { tenantId?: string; robotId?: string; direction: 'input' | 'output' }, word: string, listType: 'black' | 'white', action: ContentFilterHit['action'], content: string) {
    await this.hits.save(this.hits.create({ ...ctx, word, listType, action, content: content.slice(0, 80) }));
    await this.words.increment({ word }, 'hitCount', 1);
  }

  /** 平台历史数据使用 global/全局；管理界面为指定租户保存为“指定:<tenantId>”。 */
  private appliesToTenant(scope: string | undefined, tenantId: string | undefined): boolean {
    if (!scope || scope === 'global' || scope === '全局') return true;
    return Boolean(tenantId) && (scope === tenantId || scope === `指定:${tenantId}`);
  }
}
