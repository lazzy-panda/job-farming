import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);
  private static readonly defaultRetentionDays = 14;
  private static readonly maxBatchSize = 300;

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async removeOldJobs() {
    const retentionDays = this.readRetentionDays();
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const targets = await this.prisma.jobPosting.findMany({
      where: {
        // Вакансии из воронки плана (отложенные и с откликами) не удаляем:
        // накопленная история нужна для чекпоинтов.
        status: { notIn: ['shortlisted', 'applied'] },
        applications: { none: {} },
        OR: [
          { publishedAt: { lt: cutoff } },
          { publishedAt: null, createdAt: { lt: cutoff } },
        ],
      },
      select: { id: true },
    });

    if (targets.length === 0) {
      return;
    }

    let deletedJobs = 0;
    let deletedApplications = 0;

    for (const batch of this.chunk(targets.map((t) => t.id), CleanupService.maxBatchSize)) {
      const appsRes = await this.prisma.application.deleteMany({
        where: { jobPostingId: { in: batch } },
      });
      const jobsRes = await this.prisma.jobPosting.deleteMany({
        where: { id: { in: batch } },
      });
      deletedApplications += appsRes.count;
      deletedJobs += jobsRes.count;
    }

    this.logger.log(
      `Removed old job postings retentionDays=${retentionDays} cutoff=${cutoff.toISOString()} jobs=${deletedJobs} applications=${deletedApplications}`,
    );
  }

  private readRetentionDays(): number {
    const raw = (process.env.JOB_RETENTION_DAYS ?? '').trim();
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      return Math.min(365, Math.floor(n));
    }
    return CleanupService.defaultRetentionDays;
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      out.push(items.slice(i, i + size));
    }
    return out;
  }
}

