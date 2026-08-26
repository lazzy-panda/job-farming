import { Component, OnInit, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { Source } from '@job-farm/shared-models';
import { ApiService } from '../../api.service';
import { SourceCreateComponent } from '../source-create/source-create.component';
import { DashboardHeaderComponent } from '../dashboard-header/dashboard-header.component';
import { PaginationComponent } from '../pagination/pagination.component';
import { JfConfirmService } from '../confirm-dialog/confirm.service';

@Component({
  standalone: true,
  selector: 'app-source-page',
  imports: [
    CommonModule,
    MatSnackBarModule,
    SourceCreateComponent,
    DashboardHeaderComponent,
    PaginationComponent,
  ],
  templateUrl: './source-page.component.html',
  styleUrl: './source-page.component.scss',
})
export class SourcePageComponent implements OnInit {
  private static readonly defaultSource: Partial<Source> = {
    name: '',
    sourceType: 'site',
    url: '',
  };

  public sourceModel: Partial<Source> = { ...SourcePageComponent.defaultSource };
  public sources = signal<Source[]>([]);
  public loading = false;
  public readonly pageIndex = signal(0);
  public readonly pageSize = signal(20);
  public readonly pageSizeOptions = [20, 50, 100];

  private iconCache: Record<string, SafeHtml> = {};

  public readonly paginatedSources = computed(() => {
    const list = this.sources();
    const start = this.pageIndex() * this.pageSize();
    return list.slice(start, start + this.pageSize());
  });


  constructor(
    private readonly api: ApiService,
    private readonly snack: MatSnackBar,
    private readonly http: HttpClient,
    private readonly sanitizer: DomSanitizer,
    private readonly confirmDialog: JfConfirmService,
  ) {
    effect(() => {
      const total = this.sources().length;
      const size = this.pageSize();
      const maxIndex = total === 0 ? 0 : Math.max(0, Math.ceil(total / size) - 1);
      if (this.pageIndex() > maxIndex) {
        this.pageIndex.set(maxIndex);
      }
    });
  }

  public async ngOnInit(): Promise<void> {
    // Предзагрузка иконок
    await Promise.all(['telegram', 'rss', 'facebook', 'arbeitsagentur'].map((icon) => this.loadIcon(icon)));
    this.loadSources();
  }

  private async loadIcon(iconType: string): Promise<void> {
    if (this.iconCache[iconType]) {
      return;
    }

    try {
      const svgContent = await firstValueFrom(
        this.http.get(`/icons/${iconType}.svg`, { responseType: 'text' }),
      );
      const svgWithSize = svgContent.replace(
        '<svg',
        '<svg width="20" height="20"',
      );
      this.iconCache[iconType] = this.sanitizer.bypassSecurityTrustHtml(svgWithSize);
    } catch (error) {
      console.error(`Failed to load icon ${iconType}:`, error);
      this.iconCache[iconType] = this.sanitizer.bypassSecurityTrustHtml('');
    }
  }

  public getSourceIconSvg(source: Source): SafeHtml {
    const iconType =
      source.sourceType === 'telegram'
        ? 'telegram'
        : source.sourceType === 'rss'
          ? 'rss'
          : source.sourceType === 'facebook'
            ? 'facebook'
            : source.sourceType === 'arbeitsagentur'
              ? 'arbeitsagentur'
              : null;
    if (!iconType) {
      return this.sanitizer.bypassSecurityTrustHtml('');
    }
    return this.iconCache[iconType] || this.sanitizer.bypassSecurityTrustHtml('');
  }

  public async removeSource(source: Source): Promise<void> {
    if (!source?.id) {
      return;
    }
    const confirmed = await this.confirmDialog.ask(
      `Удалить источник «${this.getDisplayName(source)}»? Собранные с него вакансии останутся.`,
    );
    if (!confirmed) {
      return;
    }
    this.loading = true;
    this.api.deleteSource(source.id).subscribe({
      next: () => {
        this.snack.open('Источник удалён', 'OK', { duration: 2000 });
        this.loadSources();
      },
      error: () => {
        this.loading = false;
        this.snack.open('Не удалось удалить источник', 'OK', { duration: 2000 });
      },
    });
  }

  public loadSources(): void {
    this.loading = true;
    this.api.getSources().subscribe({
      next: (data) => {
        const deduped = this.dedupeSources(data ?? []);
        // Сортируем по createdAt в порядке убывания (новые источники первыми)
        const sorted = deduped.sort((a, b) => {
          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return dateB - dateA; // Убывание: новые первыми
        });
        this.sources.set(sorted);
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.snack.open('Не удалось загрузить источники', 'OK', { duration: 2000 });
      },
    });
  }

  public onPageChange(event: { pageIndex: number; pageSize: number }): void {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
  }

  public getDisplayName(source: Source): string {
    // Если название есть и не равно URL, используем его
    if (source.name && source.name !== source.url && !source.name.includes('t.me/')) {
      return source.name;
    }
    
    // Если название = URL или содержит URL, извлекаем slug
    if (source.url) {
      try {
        const url = new URL(source.url.startsWith('http') ? source.url : `https://${source.url}`);
        const parts = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
        if (parts.length > 0) {
          const slug = parts[0].toLowerCase() === 's' ? parts[1] : parts[0];
          if (slug) {
            return slug.replace(/^@/, '');
          }
        }
      } catch {
        // Если не удалось распарсить URL, возвращаем как есть
      }
    }
    
    return source.name || source.url || '—';
  }

  public getSubscribersCount(source: Source): number | null {
    if (source.sourceType !== 'telegram') {
      return null;
    }
    const metadata = (source.metadata as Record<string, unknown>) ?? {};
    const count = metadata['telegramSubscribersCount'];
    if (typeof count === 'number' && count > 0) {
      return count;
    }
    return null;
  }

  public formatSubscribersCount(count: number): string {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    }
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toLocaleString('ru-RU');
  }

  public createSource(payload?: Partial<Source>): void {
    const dto = payload ?? this.sourceModel;
    const urlRaw = (dto.url ?? '').trim();
    if (!urlRaw) {
      this.snack.open('Введите адрес источника', 'OK', { duration: 2000 });
      return;
    }

    const normalizedUrl = this.normalizeUrl(urlRaw);
    if (normalizedUrl && this.hasSource(normalizedUrl)) {
      this.snack.open('Такой источник уже добавлен', 'OK', { duration: 2000 });
      return;
    }

    const normalized: Partial<Source> = {
      name: dto.name?.trim() || urlRaw,
      sourceType: dto.sourceType ?? 'site',
      url: urlRaw,
      metadata: dto.metadata,
    };

    console.log('[SourcePage] Creating source:', normalized);
    this.api.createSource(normalized).subscribe({
      next: () => {
        this.snack.open('Источник создан', 'OK', { duration: 2000 });
        this.sourceModel = { ...SourcePageComponent.defaultSource };
        this.loadSources();
      },
      error: (err) =>
        this.snack.open(this.getErrorMessage(err, 'Ошибка создания источника'), 'OK', {
          duration: 3000,
        }),
    });
  }

  private dedupeSources(list: Source[]): Source[] {
    const seen = new Set<string>();
    const result: Source[] = [];
    for (const item of list) {
      const key = this.normalizeUrl(item.url ?? '') || (item.id ?? '').toString();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(item);
    }
    return result;
  }

  private normalizeUrl(raw: string): string {
    let url = raw.trim().toLowerCase();
    url = url.replace(/^https?:\/\//, '');
    url = url.replace(/^www\./, '');
    url = url.replace(/\/+$/, '');
    return url;
  }

  private hasSource(normalizedUrl: string): boolean {
    return this.sources().some((s) => this.normalizeUrl(s.url ?? '') === normalizedUrl);
  }

  private getErrorMessage(error: unknown, fallback: string): string {
    // Angular HttpClient возвращает HttpErrorResponse с полем error, содержащим тело ответа
    // NestJS HttpExceptionFilter возвращает ошибки в формате:
    // { statusCode: number, error: string | object, timestamp: string }
    // где error может быть строкой или объектом с полем message
    
    const httpError = error as { error?: unknown; message?: string };
    
    // Проверяем поле error (тело ответа от сервера)
    if (httpError?.error !== undefined) {
      const errorBody = httpError.error;
      
      // Если error - строка, возвращаем её (это основной формат NestJS)
      if (typeof errorBody === 'string') {
        return errorBody;
      }
      
      // Если error - объект, ищем error или message
      if (typeof errorBody === 'object' && errorBody !== null) {
        const body = errorBody as Record<string, unknown>;
        
        // Сначала проверяем поле error (NestJS формат: {statusCode: 409, error: '...'})
        if (typeof body['error'] === 'string') {
          return body['error'] as string;
        }
        
        // NestJS может вернуть message напрямую
        if (typeof body['message'] === 'string') {
          return body['message'] as string;
        }
        
        // Или массив сообщений
        if (Array.isArray(body['message'])) {
          return (body['message'] as string[]).join(', ');
        }
      }
    }
    
    // Проверяем message на верхнем уровне (стандартное поле HttpErrorResponse)
    if (typeof httpError?.message === 'string' && httpError.message !== 'Http failure response') {
      return httpError.message;
    }
    
    // Если error - строка напрямую
    if (typeof error === 'string') {
      return error;
    }
    
    return fallback;
  }
}
