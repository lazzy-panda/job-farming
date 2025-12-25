import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, SimpleChanges, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { OverlayModule } from '@angular/cdk/overlay';
import type { JobPosting } from '@job-farm/shared-models';
import type { VacancyParseResult } from '../../api.service';
import { VacancyParseClientService } from '../../vacancy-parse-client.service';

@Component({
  standalone: true,
  selector: 'app-vacancy-parse-json',
  imports: [CommonModule, MatButtonModule, MatIconModule, OverlayModule],
  templateUrl: './vacancy-parse-json.component.html',
  styleUrl: './vacancy-parse-json.component.scss',
})
export class VacancyParseJsonComponent implements OnChanges {
  private readonly client = inject(VacancyParseClientService);

  @Input({ required: true }) job!: JobPosting;

  readonly open = signal(false);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<VacancyParseResult | null>(null);

  private lastKey: string | null = null;

  readonly hasText = computed(() => Boolean((this.job?.description ?? '').trim()));
  readonly isDisabled = computed(() => (this.result()?.meta?.warnings ?? []).includes('disabled'));

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['job']) {
      this.ensureParsed();
    }
  }

  toggle(): void {
    this.open.update((v) => !v);
  }

  close(): void {
    this.open.set(false);
  }

  async copyJson(): Promise<void> {
    try {
      const value = this.result();
      if (!value) {
        return;
      }
      const raw = JSON.stringify(value, null, 2);
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(raw);
      }
    } catch {
      // ignore
    }
  }

  async refresh(): Promise<void> {
    this.lastKey = null;
    this.result.set(null);
    await this.ensureParsed(true);
  }

  private async ensureParsed(force = false): Promise<void> {
    const job = this.job;
    if (!job?.id) {
      return;
    }

    const key = `${job.id}:${job.updatedAt ?? ''}`;
    if (!force && this.lastKey === key && this.result()) {
      return;
    }

    this.lastKey = key;
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.client.parseJob(job);
      this.result.set(res);
    } catch (e) {
      this.error.set('parse_failed');
      // eslint-disable-next-line no-console
      console.warn('[vacancy-parser] parse failed', e);
    } finally {
      this.loading.set(false);
    }
  }
}
