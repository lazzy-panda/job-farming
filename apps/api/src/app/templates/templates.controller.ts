import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { TemplatesService } from './templates.service';

@Controller('templates')
export class TemplatesController {
  constructor(private readonly service: TemplatesService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  create(
    @Body()
    body: { name: string; content: string; channel?: string },
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
}

