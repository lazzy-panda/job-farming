import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import type { JobPosting } from '@job-farm/shared-models';
import type { VacancyParseResult } from './api.service';

@Injectable({ providedIn: 'root' })
export class VacancyParseClientService {
  private readonly api = inject(ApiService);

  private readonly cache = new Map<string, VacancyParseResult>();
  private readonly inflight = new Map<string, Promise<VacancyParseResult>>();

  private active = 0;
  private readonly queue: Array<() => void> = [];
  private readonly maxConcurrency = 3;

  async parseJob(job: JobPosting): Promise<VacancyParseResult> {
    const key = this.buildKey(job);

    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const existing = this.inflight.get(key);
    if (existing) {
      return existing;
    }

    const task = this.runWithConcurrency(async () => {
      const text = (job.description ?? '').trim();
      if (!text) {
        const res: VacancyParseResult = { meta: { warnings: ['empty_text'] } };
        this.cache.set(key, res);
        return res;
      }

      const res = await firstValueFrom(
        this.api.parseVacancy({
          text,
          pageTitle: job.title,
          sourceUrl: job.link ?? undefined,
          debug: false,
        }),
      );
      this.cache.set(key, res);
      return res;
    }).finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, task);
    return task;
  }

  clear(): void {
    this.cache.clear();
    this.inflight.clear();
  }

  private buildKey(job: JobPosting): string {
    const id = job.id ?? '';
    const updated = job.updatedAt ?? '';
    return `${id}:${updated}`;
  }

  private async runWithConcurrency<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active += 1;
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }
}
