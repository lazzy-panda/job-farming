import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { JobPostingsService } from './job-postings.service';

export type ScrapeJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ScrapeJobRecord {
  id: string;
  status: ScrapeJobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  params: {
    sourceId: string | null;
    dryRun: boolean;
  };
  result?: Record<string, unknown>;
  error?: string;
}

interface EnqueueParams {
  sourceId?: string;
  dryRun?: boolean;
}

@Injectable()
export class ScrapeJobsService {
  private readonly logger = new Logger(ScrapeJobsService.name);
  private readonly jobs = new Map<string, ScrapeJobRecord>();
  private readonly historyLimit = Number(process.env.SCRAPE_JOBS_HISTORY ?? 100);

  constructor(private readonly jobPostingsService: JobPostingsService) {}

  enqueue(params: EnqueueParams): ScrapeJobRecord {
    const now = new Date().toISOString();
    const record: ScrapeJobRecord = {
      id: randomUUID(),
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      params: {
        sourceId: params.sourceId ?? null,
        dryRun: params.dryRun ?? false,
      },
    };

    this.jobs.set(record.id, record);
    this.runJob(record);
    return this.clone(record);
  }

  getJob(jobId: string): ScrapeJobRecord | null {
    const record = this.jobs.get(jobId);
    return record ? this.clone(record) : null;
  }

  private clone(record: ScrapeJobRecord): ScrapeJobRecord {
    return {
      ...record,
      params: { ...record.params },
      result: record.result ? { ...record.result } : undefined,
    };
  }

  private runJob(record: ScrapeJobRecord): void {
    setImmediate(async () => {
      const startedAt = new Date().toISOString();
      record.status = 'running';
      record.startedAt = startedAt;
      record.updatedAt = startedAt;
      try {
        const result = await this.jobPostingsService.scrape(
          record.params.sourceId ?? undefined,
          record.params.dryRun,
        );
        const finishedAt = new Date().toISOString();
        record.status = 'completed';
        record.result = result as Record<string, unknown>;
        record.finishedAt = finishedAt;
        record.updatedAt = finishedAt;
      } catch (error) {
        const finishedAt = new Date().toISOString();
        record.status = 'failed';
        record.error = error instanceof Error ? error.message : String(error);
        record.finishedAt = finishedAt;
        record.updatedAt = finishedAt;
        this.logger.error(`Scrape job ${record.id} failed`, error as Error);
      } finally {
        this.pruneHistory();
      }
    });
  }

  private pruneHistory(): void {
    if (this.jobs.size <= this.historyLimit) {
      return;
    }

    const removable = Array.from(this.jobs.values())
      .filter((job) => job.status === 'completed' || job.status === 'failed')
      .sort((a, b) => {
        const aDate = a.finishedAt ?? a.createdAt;
        const bDate = b.finishedAt ?? b.createdAt;
        return aDate.localeCompare(bDate);
      });

    while (this.jobs.size > this.historyLimit && removable.length) {
      const job = removable.shift();
      if (job) {
        this.jobs.delete(job.id);
      }
    }
  }
}
