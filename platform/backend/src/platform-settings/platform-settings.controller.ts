import { Body, Controller, Get, Put } from '@nestjs/common';
import { PlatformSetting } from './platform-setting.entity';
import { PlatformSettingsService } from './platform-settings.service';

/** 平台设置（对齐原型 platform-settings.html）：真实落库 */
@Controller('api/v1/platform/settings')
export class PlatformSettingsController {
  constructor(private readonly settings: PlatformSettingsService) {}

  /** 读取设置（无记录时返回默认值并初始化） */
  @Get()
  async get() {
    return { code: 0, message: 'success', data: await this.settings.getSafe() };
  }

  /** 保存设置（合并更新） */
  @Put()
  async save(@Body() body: Partial<PlatformSetting>) {
    return { code: 0, message: 'success', data: await this.settings.save(body) };
  }
}
