import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { JobPosting, Source } from '@job-farm/shared-models';
import type { VacancyParseResult } from '../../api.service';
import { VacancyParseClientService } from '../../vacancy-parse-client.service';
import { VacancyParseJsonComponent } from '../vacancy-parse-json/vacancy-parse-json.component';

const API_BASE = 'http://127.0.0.1:3000/api';

@Component({
  standalone: true,
  selector: 'app-job-cards',
  imports: [CommonModule, MatCardModule, MatButtonModule, MatIconModule, VacancyParseJsonComponent],
  templateUrl: './job-cards.component.html',
  styleUrls: ['./job-cards.component.scss'],
})
export class JobCardsComponent {
  @Input() jobs: JobPosting[] = [];
  @Input() sources: Source[] = [];
  @Output() open = new EventEmitter<JobPosting>();
  @Output() remove = new EventEmitter<JobPosting>();

  private readonly parseClient = inject(VacancyParseClientService);
  private readonly parsedByJobId = new Map<string, VacancyParseResult>();
  private readonly parseRequested = new Set<string>();
  private readonly parsedTick = signal(0);

  private readonly failedAvatarJobIds = new Set<string>();
  private readonly expandedDescriptions = new Set<string>();

  getParsedTitle(job: JobPosting): string {
    const parsed = this.getParsed(job);
    const titleValue = this.readString(((parsed?.title as Record<string, unknown>) ?? {})['value']);
    return titleValue ?? '—';
  }

  getParsedWorkFormat(job: JobPosting): string {
    const parsed = this.getParsed(job);
    const value = this.readString(((parsed?.workFormat as Record<string, unknown>) ?? {})['value']);
    if (value === 'remote') return 'Удалённо';
    if (value === 'onsite') return 'В офисе';
    if (value === 'hybrid') return 'Гибрид';
    return '—';
  }

  getParsedSalary(job: JobPosting): string {
    const parsed = this.getParsed(job);
    const salary = (parsed?.salary as Record<string, unknown>) ?? {};
    const min = this.readNumber(salary['min']);
    const max = this.readNumber(salary['max']);
    if (min === null && max === null) {
      return '—';
    }
    const currency = this.readString(salary['currency']) ?? '';
    const period = this.readString(salary['period']) ?? '';

    const minValue = min ?? max ?? null;
    const maxValue = max ?? min ?? null;
    const amount = (minValue !== null && maxValue !== null && minValue !== maxValue)
      ? `${this.formatMoney(minValue)}–${this.formatMoney(maxValue)}`
      : this.formatMoney(minValue ?? maxValue ?? 0);

    const currencyPart = currency && currency !== 'UNKNOWN' ? ` ${currency}` : '';
    const periodPart = this.formatPeriod(period);
    return `${amount}${currencyPart}${periodPart}`;
  }

  getSourceName(job: JobPosting): string {
    const src = this.sources.find((s) => s.id === job.sourceId);
    return src?.name ?? '—';
  }

  getChannelTitle(job: JobPosting): string {
    const src = this.resolveSource(job);
    const metadata = (src?.metadata as Record<string, unknown>) ?? {};
    return (
      (metadata['telegramTitle'] as string) ??
      (metadata['channelTitle'] as string) ??
      src?.name ??
      this.getSourceName(job)
    );
  }

  getChannelAvatar(job: JobPosting): string | null {
    if (this.failedAvatarJobIds.has(job.id)) {
      return null;
    }
    const src = this.resolveSource(job);
    const metadata = (src?.metadata as Record<string, unknown>) ?? {};
    const raw =
      (metadata['telegramAvatar'] as string) ??
      (metadata['channelAvatar'] as string) ??
      null;
    const normalized = this.normalizeAvatarUrl(raw);
    if (!normalized) {
      return null;
    }
    if (src?.id && (metadata['telegramAvatar'] as string | undefined)) {
      return `${API_BASE}/sources/${src.id}/avatar`;
    }
    return normalized;
  }

  getChannelInitial(job: JobPosting): string {
    const title = this.getChannelTitle(job);
    return title?.charAt(0)?.toUpperCase() ?? '#';
  }

  getJobDate(job: JobPosting): Date | null {
    return this.parseDate(job.publishedAt ?? job.createdAt ?? job.updatedAt ?? null);
  }

  onAvatarError(jobId: string): void {
    if (!jobId) {
      return;
    }
    this.failedAvatarJobIds.add(jobId);
  }

  trackById(_index: number, item: JobPosting): string {
    return item.id;
  }

  getShortTitle(title: string | null | undefined): string {
    if (!title) {
      return '';
    }
    const words = title.trim().split(/\s+/);
    return words.slice(0, 3).join(' ');
  }

  getShortDescription(description: string | null | undefined): string {
    if (!description) {
      return '';
    }
    const trimmed = description.trim();
    const targetLength = Math.max(20, Math.floor(trimmed.length / 10));
    if (trimmed.length <= targetLength) {
      return trimmed;
    }
    return trimmed.slice(0, targetLength) + '...';
  }

  isDescriptionExpanded(jobId: string): boolean {
    return this.expandedDescriptions.has(jobId);
  }

  toggleDescription(jobId: string): void {
    if (this.expandedDescriptions.has(jobId)) {
      this.expandedDescriptions.delete(jobId);
    } else {
      this.expandedDescriptions.add(jobId);
    }
  }

  shouldShowExpandButton(description: string | null | undefined): boolean {
    if (!description) {
      return false;
    }
    // We use CSS line-clamp for collapsed view, so we can only approximate "needs expand button"
    // without DOM measurements. Keep the button for long texts.
    return description.trim().length > 320;
  }

  private resolveSource(job: JobPosting): Source | null {
    return (
      job.source ??
      (job.sourceId ? this.sources.find((s) => s.id === job.sourceId) ?? null : null)
    );
  }

  private normalizeAvatarUrl(raw: string | null): string | null {
    const value = raw?.trim() ?? '';
    if (!value) {
      return null;
    }
    if (value.startsWith('//')) {
      return `https:${value}`;
    }
    if (value.startsWith('http://')) {
      return `https://${value.slice('http://'.length)}`;
    }
    if (!value.startsWith('https://') && !value.startsWith('http://')) {
      return `https://${value.replace(/^\/+/, '')}`;
    }
    return value;
  }

  private parseDate(raw: string | null): Date | null {
    const value = raw?.trim() ?? '';
    if (!value) {
      return null;
    }

    if (/^\d+$/.test(value)) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return null;
      }
      const ms = value.length <= 10 ? numeric * 1000 : numeric;
      const date = new Date(ms);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    let normalized = value;

    // Prisma/SQLite sometimes returns "YYYY-MM-DD HH:mm:ss" (no timezone)
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(normalized)) {
      normalized = normalized.replace(' ', 'T');
    }

    // If timezone is missing, assume UTC to avoid local shift surprises.
    if (
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(normalized) &&
      !/[zZ]|[+-]\d{2}:\d{2}$/.test(normalized)
    ) {
      normalized = `${normalized}Z`;
    }

    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private getParsed(job: JobPosting): VacancyParseResult | null {
    this.parsedTick(); // make template reactive to updates

    const id = job.id ?? '';
    if (!id) {
      return null;
    }

    const cached = this.parsedByJobId.get(id);
    if (cached) {
      return cached;
    }

    if (!this.parseRequested.has(id)) {
      this.parseRequested.add(id);
      void this.parseClient.parseJob(job)
        .then((res) => {
          this.parsedByJobId.set(id, res);
          this.parsedTick.update((v) => v + 1);
        })
        .catch(() => {
          this.parsedByJobId.set(id, { meta: { warnings: ['parse_request_failed'] } });
          this.parsedTick.update((v) => v + 1);
        });
    }

    return null;
  }

  private readString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const v = value.trim();
    return v ? v : null;
  }

  private readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    return null;
  }

  private formatMoney(value: number): string {
    // Compact formatting without locales to keep UI stable.
    return Math.round(value).toString();
  }

  private formatPeriod(period: string): string {
    if (period === 'hour') return ' /час';
    if (period === 'day') return ' /день';
    if (period === 'week') return ' /нед';
    if (period === 'month') return ' /мес';
    if (period === 'year') return ' /год';
    if (period === 'project') return ' /проект';
    return '';
  }
}
