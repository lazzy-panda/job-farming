import { Body, Controller, Get, Post } from '@nestjs/common';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  @Get()
  get() {
    return this.service.get();
  }

  @Post()
  save(@Body() body: Record<string, unknown>) {
    return this.service.upsert(body);
  }
}

