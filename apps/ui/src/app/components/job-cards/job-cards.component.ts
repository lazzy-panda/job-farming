import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { JobPosting, Source } from '@job-farm/shared-models';
import { ApiService, TranslationResponse, VacancyParseResult } from '../../api.service';
import { VacancyParseClientService } from '../../vacancy-parse-client.service';
import { VacancyParseJsonComponent } from '../vacancy-parse-json/vacancy-parse-json.component';
import { firstValueFrom } from 'rxjs';

const API_BASE = 'http://127.0.0.1:3000/api';

@Component({
  standalone: true,
  selector: 'app-job-cards',
  imports: [CommonModule, VacancyParseJsonComponent],
  templateUrl: './job-cards.component.html',
  styleUrls: ['./job-cards.component.scss'],
})
export class JobCardsComponent {
  @Input() jobs: JobPosting[] = [];
  @Input() sources: Source[] = [];
  @Output() open = new EventEmitter<JobPosting>();
  @Output() remove = new EventEmitter<JobPosting>();
  /** Изменилась воронка (отклик/шортлист) — дашборду пора обновить панель плана */
  @Output() funnelChanged = new EventEmitter<void>();
  /** Клик «Сбросить фильтры» в пустом состоянии */
  @Output() resetFilters = new EventEmitter<void>();

  private readonly applyingIds = new Set<string>();

  private readonly parseClient = inject(VacancyParseClientService);
  private readonly api = inject(ApiService);
  private readonly parsedByJobId = new Map<string, VacancyParseResult>();
  private readonly parseRequested = new Set<string>();
  private readonly parsedTick = signal(0);
  private readonly translations = new Map<string, string>();
  private readonly translationErrors = new Map<string, string>();
  private readonly translationLoading = new Set<string>();
  private readonly translationTick = signal(0);

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
    
    // Если зарплата >= 1000 (будет отформатирована с "K") и период = "month",
    // убираем "/мес", так как обычно "125K USD" означает годовую зарплату
    const hasKFormat = (minValue !== null && minValue >= 1000) || (maxValue !== null && maxValue >= 1000);
    const shouldSkipMonthPeriod = hasKFormat && period === 'month';
    
    const amount = (minValue !== null && maxValue !== null && minValue !== maxValue)
      ? `${this.formatMoney(minValue)}–${this.formatMoney(maxValue)}`
      : this.formatMoney(minValue ?? maxValue ?? 0);

    const currencyPart = currency && currency !== 'UNKNOWN' ? ` ${currency}` : '';
    const periodPart = shouldSkipMonthPeriod ? '' : this.formatPeriod(period);
    return `${amount}${currencyPart}${periodPart}`;
  }

  getSourceName(job: JobPosting): string {
    const src = this.sources.find((s) => s.id === job.sourceId);
    return src?.name ?? '—';
  }

  getParsedExperience(job: JobPosting): string {
    const parsed = this.getParsed(job);
    const value = this.readString(((parsed?.experience as Record<string, unknown>) ?? {})['value']);
    if (!value) return '—';
    const labels: Record<string, string> = {
      junior: 'Junior',
      middle: 'Middle',
      senior: 'Senior',
      lead: 'Lead',
    };
    return labels[value] ?? value;
  }

  getSourceHost(job: JobPosting): string {
    const url = job.source?.url ?? '';
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  isShortlisted(job: JobPosting): boolean {
    return job.status === 'shortlisted';
  }

  isApplied(job: JobPosting): boolean {
    return job.status === 'applied';
  }

  isApplying(jobId: string): boolean {
    return this.applyingIds.has(jobId);
  }

  toggleShortlist(job: JobPosting): void {
    const next = job.status === 'shortlisted' ? 'new' : 'shortlisted';
    this.api.updateJobPostingStatus(job.id, next).subscribe({
      next: (updated) => {
        job.status = updated.status;
        this.funnelChanged.emit();
      },
    });
  }

  createApplication(job: JobPosting, kind: 'adapted' | 'template'): void {
    if (this.applyingIds.has(job.id) || job.status === 'applied') {
      return;
    }
    this.applyingIds.add(job.id);
    const channel = this.resolveSource(job)?.sourceType ?? 'manual';
    this.api.createApplication({ jobPostingId: job.id, channel, kind }).subscribe({
      next: () => {
        job.status = 'applied';
        this.funnelChanged.emit();
      },
      complete: () => this.applyingIds.delete(job.id),
      error: () => this.applyingIds.delete(job.id),
    });
  }

  getChannelTitle(job: JobPosting): string {
    const src = this.resolveSource(job);
    
    // Для RSS источников используем название компании из парсинга
    if (src?.sourceType === 'rss') {
      const parsed = this.getParsed(job);
      const company = parsed?.company as { name?: string } | null | undefined;
      if (company?.name && company.name.trim()) {
        return company.name.trim();
      }
    }
    
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

  getPrimaryContact(job: JobPosting): { label: string; href: string } | null {
    const parsed = this.getParsed(job);
    const contacts = (parsed?.contacts as Record<string, unknown>) ?? {};
    const emails = Array.isArray(contacts['emails']) ? (contacts['emails'] as string[]) : [];
    const phones = Array.isArray(contacts['phones']) ? (contacts['phones'] as string[]) : [];
    const urls = Array.isArray(contacts['urls']) ? (contacts['urls'] as string[]) : [];

    const email = emails.find((e) => typeof e === 'string' && e.includes('@'));
    if (email) {
      const address = email.trim();
      return { label: address, href: `mailto:${address}` };
    }

    const phone = phones.find((p) => typeof p === 'string' && p.trim().length >= 7);
    if (phone) {
      const number = phone.trim();
      const digitsOnly = number.replace(/[^\d+]/g, '');
      return { label: number, href: `tel:${digitsOnly || number}` };
    }

    const firstUrl = urls.find((u) => typeof u === 'string' && u.trim().length > 0);
    if (firstUrl) {
      const normalizedUrl = this.normalizeUrl(firstUrl);
      return { label: normalizedUrl, href: normalizedUrl };
    }

    const fallback = this.normalizeUrl(job.link ?? '');
    if (fallback) {
      return { label: fallback, href: fallback };
    }
    return null;
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

  getTranslatedText(jobId: string): string | null {
    this.translationTick();
    return this.translations.get(jobId) ?? null;
  }

  getTranslationError(jobId: string): string | null {
    this.translationTick();
    return this.translationErrors.get(jobId) ?? null;
  }

  isTranslationLoading(jobId: string): boolean {
    this.translationTick();
    return this.translationLoading.has(jobId);
  }

  async translateJob(job: JobPosting): Promise<void> {
    if (!job?.id || this.translationLoading.has(job.id)) {
      return;
    }
    const sourceText = (job.rawContent ?? job.description ?? '').trim();
    if (!sourceText) {
      this.translationErrors.set(job.id, 'Нет текста для перевода');
      this.translations.delete(job.id);
      this.translationTick.update((v) => v + 1);
      return;
    }

    this.translationErrors.delete(job.id);
    this.translationLoading.add(job.id);
    this.translationTick.update((v) => v + 1);

    try {
      const response: TranslationResponse = await firstValueFrom(
        this.api.translateText({
          jobId: job.id,
          text: sourceText,
          targetLang: 'ru',
        }),
      );
      const translated = (response?.text ?? '').trim();
      if (translated) {
        this.translations.set(job.id, translated);
      } else {
        this.translationErrors.set(job.id, 'Модель вернула пустой ответ');
        this.translations.delete(job.id);
      }
    } catch (error) {
      const err =
        (error as { error?: { message?: string } })?.error?.message ??
        (error as Error)?.message ??
        'Ошибка перевода';
      this.translationErrors.set(job.id, err);
    } finally {
      this.translationLoading.delete(job.id);
      this.translationTick.update((v) => v + 1);
    }
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

  private normalizeUrl(raw: string): string {
    const value = (raw ?? '').trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('//')) return `https:${value}`;
    return `https://${value}`;
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
    // Compact formatting with K notation (1000 → 1K)
    if (value >= 1000000) {
      const millions = value / 1000000;
      return millions % 1 === 0 ? `${millions}M` : `${millions.toFixed(1)}M`;
    }
    if (value >= 1000) {
      const thousands = value / 1000;
      return thousands % 1 === 0 ? `${thousands}K` : `${thousands.toFixed(1)}K`;
    }
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
