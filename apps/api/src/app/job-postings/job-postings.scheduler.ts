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

  // Ежедневная чистка аномалий (резюме, фейковые локации, низкие зарплаты, слишком короткие описания)
  @Cron(process.env.CLEANUP_CRON ?? CronExpression.EVERY_DAY_AT_3AM)
  async cleanupAnomalies() {
    try {
      const res = await this.jobPostingsService.cleanupAnomalies();
      this.logger.log(`cleanupAnomalies removed=${res.removed}`);
    } catch (error) {
      this.logger.error('cleanupAnomalies failed', error as Error);
    }
  }

  // Регулярная уборка устаревших/недоступных вакансий, даже если скрап упал
  @Cron(process.env.CLEANUP_STALE_CRON ?? CronExpression.EVERY_6_HOURS)
  async cleanupStaleJobs() {
    try {
      await this.jobPostingsService.cleanupStaleJobs();
      this.logger.log('cleanupStaleJobs completed');
    } catch (error) {
      this.logger.error('cleanupStaleJobs failed', error as Error);
    }
  }
}
