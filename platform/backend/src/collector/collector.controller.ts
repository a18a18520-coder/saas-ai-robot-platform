import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { AuthPayload } from '../auth/auth.service';
import { CollectorService } from './collector.service';
type AuthRequest = { auth: AuthPayload };
@Controller('api/v1/tenant/collector')
export class CollectorController {
  constructor(private readonly service: CollectorService) {}
  @Get('profile') profile(@Req() r: AuthRequest) { return this.service.profile(r.auth); }
  @Post('devices') register(@Req() r: AuthRequest, @Body() b: unknown) { return this.service.register(r.auth, b); }
  @Get('devices') devices(@Req() r: AuthRequest) { return this.service.devices(r.auth); }
  @Post('devices/:id/revoke') revoke(@Req() r: AuthRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.revoke(r.auth, id); }
  @Get('groups') groups(@Req() r: AuthRequest) { return this.service.groups(r.auth); }
  @Get('devices/:id/bindings') bindings(@Req() r: AuthRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.bindings(r.auth, id); }
  @Post('devices/:id/bindings') bind(@Req() r: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.service.bind(r.auth, id, b); }
  @Post('devices/:id/messages') ingest(@Req() r: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.service.ingest(r.auth, id, b); }
  @Get('devices/:id/receipts') receipts(@Req() r: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Query('ids') ids: string) { return this.service.receipts(r.auth, id, ids); }
  @Get('messages') messages(@Req() r: AuthRequest, @Query('page') page: string) { return this.service.messages(r.auth, page); }
  @Post('messages/:id/process') reprocess(@Req() r: AuthRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.reprocess(r.auth, id); }
}
