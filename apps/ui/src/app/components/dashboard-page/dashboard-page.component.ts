import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { finalize, firstValueFrom } from 'rxjs';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { RouterModule } from '@angular/router';
import { JobPosting, Source } from '@job-farm/shared-models';
import { ApiService } from '../../api.service';
import { JobCardsComponent } from '../job-cards/job-cards.component';
import { DashboardHeaderComponent } from '../dashboard-header/dashboard-header.component';
import { SortMode } from '../sort-menu/sort-menu.component';
import { PaginationComponent } from '../pagination/pagination.component';
import { JobSearchComponent } from '../job-search/job-search.component';
import { PlanPanelComponent } from '../plan-panel/plan-panel.component';
import { JfConfirmService } from '../confirm-dialog/confirm.service';

@Component({
  standalone: true,
  selector: 'app-dashboard-page',
  imports: [
    CommonModule,
    MatSnackBarModule,
    RouterModule,
    JobCardsComponent,
    DashboardHeaderComponent,
    JobSearchComponent,
    PaginationComponent,
    PlanPanelComponent,
  ],
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.scss',
})
export class DashboardPageComponent implements OnInit {
  private readonly apiSourceTypes = new Set([
    'arbeitsagentur',
    'arbeitnow',
    'remotive',
    'remoteok',
    'jobicy',
    'findwork',
    'devitjobs',
    'themuse',
    'theirstack',
    'fantasticjobs',
    'jobdata',
    'techmap',
    'okjob',
    'whatjobs',
    'usajobs',
    'jobs2careers',
    'graphqljobs',
  ]);
  private readonly api = inject(ApiService);
  private readonly snack = inject(MatSnackBar);
  private readonly confirmDialog = inject(JfConfirmService);

  readonly jobs = signal<JobPosting[]>([]);
  readonly sources = signal<Source[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly sortMode = signal<SortMode>('date_desc');
  readonly pageIndex = signal(0);
  readonly pageSize = signal(20);
  readonly searchQuery = signal('');
  readonly sourceTypeFilter = signal<string>('');
  readonly pageSizeOptions = [20, 50, 100];
  readonly availableSourceTypes = computed(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const source of this.sources()) {
      const type = source.sourceType;
      if (!type || seen.has(type)) {
        continue;
      }
      seen.add(type);
      ordered.push(type);
    }
    return ordered;
  });
  readonly filteredJobs = computed(() => {
    let list = [...this.jobs()];
    
    // Фильтрация по типу источника
    const sourceType = this.sourceTypeFilter();
    if (sourceType) {
      list = list.filter((job) => {
        const source = this.sources().find((s) => s.id === job.sourceId);
        const type = source?.sourceType ?? '';
        if (sourceType === 'api') {
          return this.apiSourceTypes.has(type);
        }
        return type === sourceType;
      });
    }
    
    // Поиск по тексту
    list = this.applySearch(list, this.searchQuery());
    
    // Сортировка
    switch (this.sortMode()) {
      case 'date_asc':
        return list.sort((a, b) => this.getJobDate(a) - this.getJobDate(b));
      case 'company':
        return list.sort((a, b) =>
          (a.company ?? '').localeCompare(b.company ?? '', undefined, { sensitivity: 'base' }),
        );
      default:
        return list.sort((a, b) => this.getJobDate(b) - this.getJobDate(a));
    }
  });
  readonly totalFiltered = computed(() => this.filteredJobs().length);
  readonly paginatedJobs = computed(() => {
    const start = this.pageIndex() * this.pageSize();
    return this.filteredJobs().slice(start, start + this.pageSize());
  });

  filters: { status: string; sourceId: string } = { status: '', sourceId: '' };

  constructor() {
    effect(() => {
      const total = this.totalFiltered();
      const size = this.pageSize();
      const maxIndex = total === 0 ? 0 : Math.max(0, Math.ceil(total / size) - 1);
      if (this.pageIndex() > maxIndex) {
        this.pageIndex.set(maxIndex);
      }
    });
  }

  ngOnInit(): void {
    this.installDebugHooks();
    this.loadSources();
    this.loadJobs();
  }

  getSourceName(job: JobPosting) {
    const src = this.sources().find((s) => s.id === job.sourceId);
    return src?.name ?? '—';
  }

  loadSources() {
    this.api.getSources().subscribe((s) => this.sources.set(s));
  }

  loadJobs() {
    this.loading.set(true);
    this.api
      .getJobPostings({
        sourceId: this.filters.sourceId || undefined,
        status: this.filters.status || undefined,
      })
      .subscribe({
        next: (data) => {
          this.jobs.set(data);
          this.pageIndex.set(0);
          this.loadError.set(null);
          this.runDebugParse(data);
        },
        error: (err) => {
          console.error(err);
          const status = err?.status ? `GET /api/job-postings — ${err.status}` : 'GET /api/job-postings';
          this.loadError.set(status);
          this.loading.set(false);
        },
        complete: () => this.loading.set(false),
      });
  }

  refreshAndScrape() {
    this.loading.set(true);
    this.api
      .runScrape()
      .pipe(finalize(() => this.loadJobs()))
      .subscribe({
        next: () => this.snack.open('Сбор вакансий запущен', 'OK', { duration: 2000 }),
        error: () => this.snack.open('Не удалось запустить сбор', 'OK', { duration: 2000 }),
      });
  }

  openAndCopy(job: JobPosting) {
    const text = `Здравствуйте, хочу откликнуться на позицию "${job.title}"${
      job.company ? ` в компании ${job.company}` : ''
    }. Ссылка: ${job.link ?? ''}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      this.snack.open('Текст отклика скопирован', 'OK', { duration: 2000 });
    }
    if (job.link) {
      window.open(job.link, '_blank');
    }
  }

  async deleteJob(job: JobPosting) {
    if (!job?.id) {
      return;
    }
    const confirmed = await this.confirmDialog.ask(`Удалить вакансию «${job.title}»?`);
    if (!confirmed) {
      return;
    }
    this.loading.set(true);
    this.api.deleteJobPosting(job.id).subscribe({
      next: () => {
        this.jobs.update((list) => list.filter((j) => j.id !== job.id));
        this.snack.open('Вакансия удалена', 'OK', { duration: 2000 });
        this.normalizePageIndex();
      },
      error: () => {
        this.snack.open('Не удалось удалить вакансию', 'OK', { duration: 2000 });
      },
      complete: () => this.loading.set(false),
    });
  }

  onSortChange(mode: SortMode) {
    this.sortMode.set(mode);
    this.pageIndex.set(0);
  }

  onSearchQueryChange(query: string) {
    this.searchQuery.set((query ?? '').trim());
    this.pageIndex.set(0);
  }

  onSourceChange(sourceType: string) {
    this.sourceTypeFilter.set(sourceType ?? '');
    this.pageIndex.set(0);
  }

  resetFilters() {
    this.searchQuery.set('');
    this.sourceTypeFilter.set('');
    this.pageIndex.set(0);
  }

  onPageChange(event: { pageIndex: number; pageSize: number }) {
    if (event.pageSize !== this.pageSize()) {
      this.pageSize.set(event.pageSize);
    }
    this.pageIndex.set(event.pageIndex);
  }

  private applySearch(jobs: JobPosting[], query: string): JobPosting[] {
    const q = (query ?? '').trim().toLowerCase();
    if (!q) {
      return jobs;
    }

    // «|» разделяет альтернативы (ИЛИ), внутри альтернативы слова соединяются по И
    const alternatives = q
      .split('|')
      .map((part) =>
        part
          .split(/[\s,;]+/g)
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 8),
      )
      .filter((tokens) => tokens.length > 0)
      .slice(0, 8);

    if (alternatives.length === 0) {
      return jobs;
    }

    return jobs.filter((job) => {
      const haystack = [
        job.title ?? '',
        job.company ?? '',
        job.location ?? '',
        job.description ?? '',
        job.link ?? '',
      ]
        .join(' ')
        .toLowerCase();

      return alternatives.some((tokens) => tokens.every((t) => haystack.includes(t)));
    });
  }

  private getJobDate(job: JobPosting): number {
    const raw = job.publishedAt ?? job.createdAt ?? job.updatedAt ?? null;
    if (!raw) {
      return 0;
    }
    const date = this.parseDate(raw);
    return date?.getTime() ?? 0;
  }

  private parseDate(raw: string): Date | null {
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

    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(normalized)) {
      normalized = normalized.replace(' ', 'T');
    }

    if (
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(normalized) &&
      !/[zZ]|[+-]\d{2}:\d{2}$/.test(normalized)
    ) {
      normalized = `${normalized}Z`;
    }

    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private normalizePageIndex() {
    const total = this.totalFiltered();
    const size = this.pageSize();
    const maxIndex = total === 0 ? 0 : Math.max(0, Math.ceil(total / size) - 1);
    if (this.pageIndex() > maxIndex) {
      this.pageIndex.set(maxIndex);
    }
  }

  private isDebugParseEnabled(): boolean {
    try {
      const params = this.getAllQueryParams();
      if (params.get('debugParse') === '1') {
        return true;
      }
      return window.localStorage.getItem('debugParse') === '1';
    } catch {
      return false;
    }
  }

  private getDebugParseLimit(): number {
    try {
      const params = this.getAllQueryParams();
      const raw = params.get('debugParseLimit') ?? '';
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) {
        return Math.min(200, Math.floor(n));
      }
      return 30;
    } catch {
      return 30;
    }
  }

  private getAllQueryParams(): URLSearchParams {
    const search = window.location.search ?? '';
    const params = new URLSearchParams(search);

    // Support hash-based routing where query params may be inside the hash part.
    // Example: http://host/#/dashboard?debugParse=1
    const hash = window.location.hash ?? '';
    const qIdx = hash.indexOf('?');
    if (qIdx >= 0) {
      const hashQuery = hash.slice(qIdx + 1);
      const hashParams = new URLSearchParams(hashQuery);
      hashParams.forEach((v, k) => {
        if (!params.has(k)) {
          params.set(k, v);
        }
      });
    }

    return params;
  }

  private installDebugHooks(): void {
    // Allow running debug parse manually from browser console:
    // window.jobFarmDebugParse(50)
    // window.jobFarmDebugParseOne('<jobId>')
    const w = window as unknown as Record<string, unknown>;
    w['jobFarmDebugParse'] = (limit?: number) => {
      const n = Number(limit);
      const lim = Number.isFinite(n) && n > 0 ? Math.min(200, Math.floor(n)) : this.getDebugParseLimit();
      void this.debugParseJobs(this.jobs().slice(0, lim));
    };
    w['jobFarmDebugParseOne'] = (jobId?: string) => {
      const id = (jobId ?? '').trim();
      if (!id) {
        console.warn('[vacancy-parser] jobFarmDebugParseOne(jobId) requires jobId');
        return;
      }
      const job = this.jobs().find((j) => j.id === id);
      if (!job) {
        console.warn(`[vacancy-parser] job not found jobId=${id}`);
        return;
      }
      void this.debugParseJobs([job]);
    };

    console.log('[vacancy-parser] debug hooks installed: window.jobFarmDebugParse(limit?), window.jobFarmDebugParseOne(jobId)');
  }

  private runDebugParse(jobs: JobPosting[]): void {
    if (!this.isDebugParseEnabled()) {
      return;
    }
    void this.debugParseJobs(jobs);
  }

  private async debugParseJobs(jobs: JobPosting[]): Promise<void> {
    const limit = this.getDebugParseLimit();
    const list = jobs.slice(0, Math.min(limit, jobs.length));

    console.log(`[vacancy-parser] parse ${list.length}/${jobs.length} jobs (limit=${limit})`);
    for (let i = 0; i < list.length; i += 1) {
      const job = list[i];
      const text = (job.description ?? '').trim();
      if (!text) {
        console.warn(`[vacancy-parser] skip empty description jobId=${job.id} title="${job.title}"`);
        continue;
      }

      try {
        const parsed = await firstValueFrom(
          this.api.parseVacancy({
            text,
            pageTitle: job.title,
            sourceUrl: job.link ?? undefined,
            debug: false,
          }),
        );

        console.groupCollapsed(`[vacancy-parser] ${i + 1}/${list.length} ${job.title} (${job.id})`);
        console.log('sourceUrl', job.link ?? null);
        console.log('parsed.title', parsed.title);
        console.log('parsed.salary', parsed.salary);
        console.log('parsed.location', parsed.location);
        console.log('parsed.contacts', parsed.contacts);
        console.log('warnings', parsed.meta?.warnings ?? []);
        console.log('confidence', parsed.confidence);
        console.groupEnd();
      } catch (err) {
        console.warn(`[vacancy-parser] failed jobId=${job.id} title="${job.title}"`, err);
      }

      // small delay to avoid spamming the API
      await new Promise((r) => setTimeout(r, 40));
    }
    console.log('[vacancy-parser] done');
  }
}
