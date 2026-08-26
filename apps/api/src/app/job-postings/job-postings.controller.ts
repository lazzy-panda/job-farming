import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { JobPostingsService } from './job-postings.service';
import { ScrapeJobsService } from './scrape-jobs.service';

@Controller('job-postings')
export class JobPostingsController {
  constructor(
    private readonly service: JobPostingsService,
    private readonly scrapeJobs: ScrapeJobsService,
  ) {}

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
      rawContent?: string;
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
  async scrape(
    @Query('sourceId') sourceId?: string,
    @Query('dryRun') dryRun?: string,
    @Query('async') asyncFlag?: string,
  ) {
    const dryRunMode = dryRun === 'true';
    const asyncMode = asyncFlag === 'true';
    if (asyncMode) {
      const job = this.scrapeJobs.enqueue({
        sourceId: sourceId || undefined,
        dryRun: dryRunMode,
      });
      return {
        jobId: job.id,
        status: job.status,
        queuedAt: job.createdAt,
        updatedAt: job.updatedAt,
        params: job.params,
      };
    }
    return this.service.scrape(sourceId || undefined, dryRunMode);
  }

  @Get('scrape/:jobId')
  async getScrapeJob(@Param('jobId') jobId: string) {
    const job = this.scrapeJobs.getJob(jobId);
    if (!job) {
      throw new NotFoundException('Scrape job not found');
    }
    return job;
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

  @Patch(':id')
  updateStatus(@Param('id') id: string, @Body() body: { status: string }) {
    return this.service.updateStatus(id, body.status);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
