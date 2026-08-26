import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ResumesService } from './resumes.service';

@Controller('resumes')
export class ResumesController {
  constructor(private readonly service: ResumesService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get('stats')
  stats() {
    return this.service.stats();
  }

  @Post()
  create(
    @Body()
    body: {
      name: string;
      title: string;
      content: string;
      notes?: string;
      isDefault?: boolean;
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
}
