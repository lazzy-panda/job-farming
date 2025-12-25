import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Res } from '@nestjs/common';
import { SourcesService } from './sources.service';
import type { Response } from 'express';

@Controller('sources')
export class SourcesController {
  constructor(private readonly service: SourcesService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  create(
    @Body()
    body: {
      name: string;
      sourceType: string;
      url?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Get(':id/avatar')
  async avatar(@Param('id') id: string, @Res() res: Response) {
    const cached = await this.service.getOrFetchTelegramAvatarCache(id);
    if (!cached) {
      throw new NotFoundException('Avatar not found');
    }
    res.setHeader('Content-Type', cached.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(cached.buffer);
  }
}

