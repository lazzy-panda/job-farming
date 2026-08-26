import { Component, OnInit, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { ProxyRecord } from '@job-farm/shared-models';
import { ApiService } from '../../api.service';
import { ProxyCreateComponent } from '../proxy-create/proxy-create.component';
import { DashboardHeaderComponent } from '../dashboard-header/dashboard-header.component';
import { PaginationComponent } from '../pagination/pagination.component';

@Component({
  standalone: true,
  selector: 'app-proxy-page',
  imports: [
    CommonModule,
    MatCardModule,
    MatSnackBarModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatChipsModule,
    ProxyCreateComponent,
    DashboardHeaderComponent,
    PaginationComponent,
  ],
  templateUrl: './proxy-page.component.html',
  styleUrl: './proxy-page.component.scss',
})
export class ProxyPageComponent implements OnInit {
  private static readonly defaultProxy: Partial<ProxyRecord> = {
    host: '',
    port: 1080,
    protocol: 'http',
    username: '',
    password: '',
    userAgent: '',
    cookieHeader: '',
    active: true,
  };

  public proxyModel: Partial<ProxyRecord> = { ...ProxyPageComponent.defaultProxy };
  public proxies = signal<ProxyRecord[]>([]);
  public loading = false;
  public editingId: string | null = null;
  public readonly pageIndex = signal(0);
  public readonly pageSize = signal(20);
  public readonly pageSizeOptions = [20, 50, 100];

  public readonly paginatedProxies = computed(() => {
    const list = this.proxies();
    const start = this.pageIndex() * this.pageSize();
    return list.slice(start, start + this.pageSize());
  });

  constructor(private readonly api: ApiService, private readonly snack: MatSnackBar) {
    effect(() => {
      const total = this.proxies().length;
      const size = this.pageSize();
      const maxIndex = total === 0 ? 0 : Math.max(0, Math.ceil(total / size) - 1);
      if (this.pageIndex() > maxIndex) {
        this.pageIndex.set(maxIndex);
      }
    });
  }

  public ngOnInit(): void {
    this.loadProxies();
  }

  public removeProxy(proxy: ProxyRecord): void {
    if (!proxy?.id) {
      return;
    }
    this.loading = true;
    this.api.deleteProxy(proxy.id).subscribe({
      next: () => {
        this.snack.open('Прокси удалён', 'OK', { duration: 2000 });
        this.loadProxies();
      },
      error: () => {
        this.loading = false;
        this.snack.open('Не удалось удалить прокси', 'OK', { duration: 2000 });
      },
    });
  }

  public loadProxies(): void {
    this.loading = true;
    this.api.getProxies().subscribe({
      next: (data) => {
        this.proxies.set(data ?? []);
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.snack.open('Не удалось загрузить прокси', 'OK', { duration: 2000 });
      },
    });
  }

  public onPageChange(event: { pageIndex: number; pageSize: number }): void {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
  }

  public editProxy(proxy: ProxyRecord): void {
    this.editingId = proxy.id;
    this.proxyModel = {
      id: proxy.id,
      host: proxy.host,
      port: proxy.port,
      protocol: proxy.protocol || 'http',
      username: proxy.username ?? '',
      password: proxy.password ?? '',
      userAgent: proxy.userAgent ?? '',
      cookieHeader: proxy.cookieHeader ?? '',
      active: proxy.active,
    };
  }

  public cancelEdit(): void {
    this.editingId = null;
    this.proxyModel = { ...ProxyPageComponent.defaultProxy };
  }

  public createProxy(payload?: Partial<ProxyRecord>): void {
    const dto = payload ?? this.proxyModel;

    if (!dto.host || !dto.port) {
      this.snack.open('Заполните все обязательные поля', 'OK', { duration: 2000 });
      return;
    }

    if (this.editingId) {
      // Обновление существующего прокси
      this.api.updateProxy(this.editingId, dto).subscribe({
        next: () => {
          this.snack.open('Прокси обновлён', 'OK', { duration: 2000 });
          this.cancelEdit();
          this.loadProxies();
        },
        error: (err) => {
          this.snack.open(this.getErrorMessage(err, 'Ошибка обновления прокси'), 'OK', {
            duration: 3000,
          });
        },
      });
    } else {
      // Создание нового прокси
      const payload = {
        host: dto.host,
        port: dto.port,
        protocol: (dto.protocol as 'http' | 'https' | 'socks5') || 'http',
        username: dto.username?.trim() || undefined,
        password: dto.password?.trim() || undefined,
        userAgent: dto.userAgent?.trim() || undefined,
        cookieHeader: dto.cookieHeader?.trim() || undefined,
        active: dto.active ?? true,
      };

      this.api.createProxy(payload as {
        host: string;
        port: number;
        username?: string;
        password?: string;
        userAgent?: string;
        cookieHeader?: string;
        active?: boolean;
      }).subscribe({
        next: () => {
          this.snack.open('Прокси создан', 'OK', { duration: 2000 });
          this.proxyModel = { ...ProxyPageComponent.defaultProxy };
          this.loadProxies();
        },
        error: (err) => {
          this.snack.open(this.getErrorMessage(err, 'Ошибка создания прокси'), 'OK', {
            duration: 3000,
          });
        },
      });
    }
  }

  public toggleActive(proxy: ProxyRecord): void {
    this.api.updateProxy(proxy.id, { active: !proxy.active }).subscribe({
      next: () => {
        this.snack.open(proxy.active ? 'Прокси деактивирован' : 'Прокси активирован', 'OK', {
          duration: 2000,
        });
        this.loadProxies();
      },
      error: () => {
        this.snack.open('Не удалось изменить статус прокси', 'OK', { duration: 2000 });
      },
    });
  }

  public formatProxyAddress(proxy: ProxyRecord): string {
    const auth = proxy.username ? `${proxy.username}@` : '';
    return `${auth}${proxy.host}:${proxy.port}`;
  }

  public formatLastStatus(proxy: ProxyRecord): string {
    if (!proxy.lastStatus) {
      return '—';
    }
    if (proxy.lastStatus.startsWith('blocked:')) {
      return `Заблокирован (${proxy.lastStatus.replace('blocked:', '')})`;
    }
    return proxy.lastStatus;
  }

  public formatCookiePreview(cookieHeader?: string | null): string {
    if (!cookieHeader) {
      return '';
    }
    const trimmed = cookieHeader.trim();
    if (trimmed.length <= 80) {
      return trimmed;
    }
    return `${trimmed.slice(0, 77)}...`;
  }

  private getErrorMessage(error: unknown, fallback: string): string {
    const httpError = error as { error?: unknown; message?: string };

    if (httpError?.error !== undefined) {
      const errorBody = httpError.error;

      if (typeof errorBody === 'string') {
        return errorBody;
      }

      if (typeof errorBody === 'object' && errorBody !== null) {
        const body = errorBody as Record<string, unknown>;

        if (typeof body['message'] === 'string') {
          return body['message'] as string;
        }

        if (Array.isArray(body['message'])) {
          return (body['message'] as string[]).join(', ');
        }

        if (typeof body['error'] === 'string') {
          return body['error'] as string;
        }
      }
    }

    if (typeof httpError?.message === 'string' && httpError.message !== 'Http failure response') {
      return httpError.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    return fallback;
  }
}
