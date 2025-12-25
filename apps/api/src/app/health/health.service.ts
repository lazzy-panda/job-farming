import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JobPostingsService } from '../job-postings/job-postings.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobPostings: JobPostingsService,
  ) {}

  async getHealth() {
    const [jobPostings, sources, applications] = await Promise.all([
      this.prisma.jobPosting.count(),
      this.prisma.source.count(),
      this.prisma.application.count(),
    ]);

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      db: true,
      counts: { jobPostings, sources, applications },
      scrape: this.jobPostings.getMetrics(),
    };
  }
}

