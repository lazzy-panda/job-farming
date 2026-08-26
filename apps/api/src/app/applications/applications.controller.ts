import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApplicationsService } from './applications.service';

@Controller('applications')
export class ApplicationsController {
  constructor(private readonly service: ApplicationsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get('stats')
  stats() {
    return this.service.stats();
  }

  @Get('followups')
  followups() {
    return this.service.followups();
  }

  @Post()
  create(
    @Body()
    body: {
      jobPostingId: string;
      channel: string;
      status?: string;
      kind?: string;
      resumeVersion?: string;
      notes?: string;
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
