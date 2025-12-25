import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Source } from '@job-farm/shared-models';

@Component({
  standalone: true,
  selector: 'app-source-create',
  imports: [
    CommonModule,
    FormsModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './source-create.component.html',
  styleUrls: ['./source-create.component.scss'],
})
export class SourceCreateComponent {
  @Input() model: Partial<Source> = { name: '', url: '', sourceType: 'site' };
  @Output() submit = new EventEmitter<Partial<Source>>();

  public urlError: string | null = null;

  public isTelegramSource(): boolean {
    const url = (this.model.url ?? '').trim();
    return this.model.sourceType === 'telegram' || /t\.me\//i.test(url);
  }

  public isRssSource(): boolean {
    const url = (this.model.url ?? '').trim();
    if (!url) {
      return false;
    }
    const lower = url.toLowerCase();
    return (
      lower.includes('/feed') ||
      lower.includes('/rss') ||
      lower.endsWith('.xml') ||
      lower.endsWith('.rss') ||
      lower.includes('rss.xml') ||
      lower.includes('feed.xml')
    );
  }

  public isValidUrl(url: string): boolean {
    if (!url || !url.trim()) {
      return false;
    }
    try {
      const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  public onUrlChange(value: string) {
    const url = (value ?? '').trim();
    this.urlError = null;

    if (url && !this.isValidUrl(url)) {
      this.urlError = 'Некорректный URL';
      return;
    }

    if (/t\.me\//i.test(url)) {
      this.model.sourceType = 'telegram';
    } else if (this.isRssSource()) {
      this.model.sourceType = 'rss';
    } else if (url) {
      this.urlError = 'Поддерживаются только ссылки на Telegram (t.me/...) и RSS-ленты';
    }
  }

  public submitSource(): void {
    const url = (this.model.url ?? '').trim();

    if (!url) {
      this.urlError = 'URL обязателен';
      return;
    }

    if (!this.isValidUrl(url)) {
      this.urlError = 'Некорректный URL';
      return;
    }

    if (!/t\.me\//i.test(url) && !this.isRssSource()) {
      this.urlError = 'Поддерживаются только ссылки на Telegram (t.me/...) и RSS-ленты';
      return;
    }

    this.urlError = null;
    this.submit.emit({
      ...this.model,
      url,
    });
  }
}
