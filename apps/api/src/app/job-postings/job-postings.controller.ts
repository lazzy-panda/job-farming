import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { JobPostingsService } from './job-postings.service';

@Controller('job-postings')
export class JobPostingsController {
  constructor(private readonly service: JobPostingsService) {}

  @Get()
  findAll(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('sourceId') sourceId?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findAll({
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
      sourceId: sourceId || undefined,
      status: status || undefined,
    });
  }

  @Post()
  create(
    @Body()
    body: {
      title: string;
      description?: string;
      company?: string;
      location?: string;
      link?: string;
      sourceId?: string;
      status?: string;
      tags?: string;
      publishedAt?: string;
    },
  ) {
    return this.service.create({
      ...body,
      publishedAt: body.publishedAt ? new Date(body.publishedAt) : undefined,
    });
  }

  @Post('scrape')
  async scrape(@Query('sourceId') sourceId?: string, @Query('dryRun') dryRun?: string) {
    return this.service.scrape(sourceId || undefined, dryRun === 'true');
  }

  @Post('backfill-published-at')
  async backfillPublishedAt(
    @Query('sourceId') sourceId?: string,
    @Query('maxPages') maxPages?: string,
    @Query('dryRun') dryRun?: string,
  ) {
    return this.service.backfillTelegramPublishedAt({
      sourceId: sourceId || undefined,
      maxPages: maxPages ? Number(maxPages) : undefined,
      dryRun: dryRun === 'true',
    });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
