import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobPostingsService } from './job-postings.service';

@Injectable()
export class JobPostingsScheduler {
  private readonly logger = new Logger(JobPostingsScheduler.name);

  constructor(private readonly jobPostingsService: JobPostingsService) {}

  @Cron(process.env.TELEGRAM_POLL_CRON ?? CronExpression.EVERY_10_MINUTES)
  async pollTelegramSources() {
    try {
      const result = await this.jobPostingsService.scrape();
      this.logger.log(
        `cron scrape finished status=${result.status} count=${result.count}`,
      );
    } catch (error) {
      this.logger.error('cron scrape failed', error as Error);
    }
  }
}
