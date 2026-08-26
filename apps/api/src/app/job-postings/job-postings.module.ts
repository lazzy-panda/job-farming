import { Module } from '@nestjs/common';
import { JobPostingsController } from './job-postings.controller';
import { JobPostingsService } from './job-postings.service';
import { JobPostingsScheduler } from './job-postings.scheduler';
import { ProxyManagerModule } from '../proxy-manager/proxy-manager.module';
import { ScrapeJobsService } from './scrape-jobs.service';

@Module({
  imports: [ProxyManagerModule],
  controllers: [JobPostingsController],
  providers: [JobPostingsService, JobPostingsScheduler, ScrapeJobsService],
})
export class JobPostingsModule {}
