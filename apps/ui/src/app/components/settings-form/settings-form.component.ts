import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

interface SettingsField {
  key: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'number';
}

@Component({
  standalone: true,
  selector: 'app-settings-form',
  imports: [CommonModule, FormsModule],
  templateUrl: './settings-form.component.html',
  styleUrls: ['./settings-form.component.scss'],
})
export class SettingsFormComponent {
  @Input() settings: Record<string, string | number> = {};
  @Output() save = new EventEmitter<Record<string, string | number>>();

  readonly smtpFields: SettingsField[] = [
    { key: 'SMTP_HOST', label: 'SMTP host', placeholder: 'smtp.example.com' },
    { key: 'SMTP_PORT', label: 'SMTP port', placeholder: '587', type: 'number' },
    { key: 'SMTP_USER', label: 'SMTP user' },
    { key: 'SMTP_PASS', label: 'SMTP pass' },
    { key: 'SMTP_FROM', label: 'SMTP from', placeholder: 'jobs@example.com' },
    { key: 'API_PORT', label: 'Порт API', placeholder: '3000', type: 'number' },
  ];

  readonly telegramFields: SettingsField[] = [
    { key: 'TELEGRAM_DELAY_MS', label: 'Задержка (мс)', placeholder: '2000', type: 'number' },
    { key: 'TELEGRAM_JITTER_MS', label: 'Джиттер (мс)', placeholder: '1000', type: 'number' },
    { key: 'TELEGRAM_MAX_PAGES', label: 'Макс страниц', placeholder: '3', type: 'number' },
    { key: 'TELEGRAM_USER_AGENT', label: 'User-Agent' },
    { key: 'TELEGRAM_KEYWORDS', label: 'Keyword filters (через запятую)' },
  ];

  readonly proxyFields: SettingsField[] = [
    { key: 'TELEGRAM_PROXY_HOST', label: 'Proxy host' },
    { key: 'TELEGRAM_PROXY_PORT', label: 'Proxy port', placeholder: '8080', type: 'number' },
    { key: 'TELEGRAM_PROXY_USER', label: 'Proxy user' },
    { key: 'TELEGRAM_PROXY_PASS', label: 'Proxy pass' },
  ];

  get proxyEnabled(): boolean {
    const value = this.settings['TELEGRAM_PROXY_ENABLED'] as string | number | boolean | undefined;
    return value === true || value === 'true' || value === 1 || value === '1';
  }

  toggleProxy(): void {
    this.settings['TELEGRAM_PROXY_ENABLED'] = (!this.proxyEnabled) as unknown as string;
  }
}
