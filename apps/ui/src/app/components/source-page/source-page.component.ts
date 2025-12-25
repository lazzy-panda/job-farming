import { Component, OnInit, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Source } from '@job-farm/shared-models';
import { ApiService } from '../../api.service';
import { SourceCreateComponent } from '../source-create/source-create.component';
import { DashboardHeaderComponent } from '../dashboard-header/dashboard-header.component';
import { PaginationComponent } from '../pagination/pagination.component';

@Component({
  standalone: true,
  selector: 'app-source-page',
  imports: [
    CommonModule,
    MatCardModule,
    MatSnackBarModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
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

  public readonly paginatedSources = computed(() => {
    const list = this.sources();
    const start = this.pageIndex() * this.pageSize();
    return list.slice(start, start + this.pageSize());
  });

  constructor(private readonly api: ApiService, private readonly snack: MatSnackBar) {
    effect(() => {
      const total = this.sources().length;
      const size = this.pageSize();
      const maxIndex = total === 0 ? 0 : Math.max(0, Math.ceil(total / size) - 1);
      if (this.pageIndex() > maxIndex) {
        this.pageIndex.set(maxIndex);
      }
    });
  }

  public ngOnInit(): void {
    this.loadSources();
  }

  public removeSource(source: Source): void {
    if (!source?.id) {
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
        this.sources.set(this.dedupeSources(data ?? []));
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
    // NestJS возвращает ошибки в формате { error: string } или { error: { message: string } }
    const err = error as { error?: string | { message?: unknown } | unknown };
    
    if (err?.error) {
      if (typeof err.error === 'string') {
        return err.error;
      }
      if (typeof err.error === 'object' && err.error !== null) {
        const message = (err.error as { message?: unknown })?.message;
        if (typeof message === 'string') {
          return message;
        }
        if (Array.isArray(message)) {
          return message.join(', ');
        }
      }
    }
    
    if (typeof error === 'string') {
      return error;
    }
    
    return fallback;
  }
}
