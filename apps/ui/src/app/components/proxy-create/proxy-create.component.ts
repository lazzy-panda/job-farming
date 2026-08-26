import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { ProxyRecord } from '@job-farm/shared-models';

@Component({
  standalone: true,
  selector: 'app-proxy-create',
  imports: [
    CommonModule,
    FormsModule,
    MatInputModule,
    MatButtonModule,
    MatCheckboxModule,
  ],
  templateUrl: './proxy-create.component.html',
  styleUrls: ['./proxy-create.component.scss'],
})
export class ProxyCreateComponent {
  @Input() model: Partial<ProxyRecord> = {
    host: '',
    port: 1080,
    protocol: 'http',
    username: '',
    password: '',
    userAgent: '',
    cookieHeader: '',
    active: true,
  };
  @Output() submit = new EventEmitter<Partial<ProxyRecord>>();

  public hostError: string | null = null;
  public portError: string | null = null;

  public isValidHost(host: string): boolean {
    if (!host || !host.trim()) {
      return false;
    }
    // Проверка на IP или доменное имя
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    return ipRegex.test(host) || domainRegex.test(host);
  }

  public isValidPort(port: number | string | undefined): boolean {
    if (port === undefined || port === null || port === '') {
      return false;
    }
    const num = typeof port === 'string' ? parseInt(port, 10) : port;
    return !isNaN(num) && num > 0 && num <= 65535;
  }

  public onHostChange(value: string): void {
    const host = (value ?? '').trim();
    this.hostError = null;

    if (host && !this.isValidHost(host)) {
      this.hostError = 'Некорректный адрес (IP или доменное имя)';
    }
  }

  public onPortChange(value: string | number): void {
    this.portError = null;

    if (!this.isValidPort(value)) {
      this.portError = 'Порт должен быть числом от 1 до 65535';
    } else {
      const num = typeof value === 'string' ? parseInt(value, 10) : value;
      this.model.port = num;
    }
  }

  public submitProxy(): void {
    const host = (this.model.host ?? '').trim();
    const port = this.model.port;

    if (!host) {
      this.hostError = 'Адрес обязателен';
      return;
    }

    if (!this.isValidHost(host)) {
      this.hostError = 'Некорректный адрес';
      return;
    }

    if (!this.isValidPort(port)) {
      this.portError = 'Порт обязателен';
      return;
    }

    this.hostError = null;
    this.portError = null;

    this.submit.emit({
      ...this.model,
      host,
      port: typeof port === 'string' ? parseInt(port, 10) : port,
      protocol: (this.model.protocol as 'http' | 'https' | 'socks5') || 'http',
      username: this.model.username?.trim() || undefined,
      password: this.model.password?.trim() || undefined,
      userAgent: this.model.userAgent?.trim() || undefined,
      cookieHeader: this.model.cookieHeader?.trim() || undefined,
    });
  }
}
