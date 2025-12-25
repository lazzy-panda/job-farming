import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { JobPostingsModule } from '../job-postings/job-postings.module';
import { ProxyManagerModule } from '../proxy-manager/proxy-manager.module';
import { PrismaModule } from '../prisma/prisma.module';
import { JobPostingsService } from '../job-postings/job-postings.service';

@Module({
  imports: [PrismaModule, JobPostingsModule, ProxyManagerModule],
  controllers: [HealthController],
  providers: [HealthService, JobPostingsService],
})
export class HealthModule {}

