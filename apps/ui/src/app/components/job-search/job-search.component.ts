import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, EventEmitter, Input, Output, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';

interface SourceButton {
  label: string;
  value: string;
  icon: string;
}

const API_SOURCE_TYPES = [
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
];

@Component({
  standalone: true,
  selector: 'app-job-search',
  imports: [CommonModule],
  templateUrl: './job-search.component.html',
  styleUrl: './job-search.component.scss',
})
export class JobSearchComponent implements OnInit, OnChanges {
  @Input() public query: string = '';
  @Input() public total: number = 0;
  @Input() public filtered: number = 0;
  @Input() public sourceTypes: string[] | null = null;
  @Input() public activeSource: string = '';

  @Output() public queryChange = new EventEmitter<string>();
  @Output() public sourceChange = new EventEmitter<string>();

  private iconCache: Record<string, SafeHtml> = {};
  private readonly baseSources: SourceButton[] = [
    { label: 'Telegram', value: 'telegram', icon: 'telegram' },
    { label: 'Facebook', value: 'facebook', icon: 'facebook' },
    { label: 'RSS', value: 'rss', icon: 'rss' },
    { label: 'API', value: 'api', icon: 'api' },
  ];

  // Пресеты 12-недельного плана: «|» — ИЛИ между вариантами, пробел — И между словами
  public readonly presets: Array<{ label: string; value: string }> = [
    { label: 'DM/РП (план)', value: 'delivery manager | руководител проект | менеджер проект | project manager' },
    { label: 'Удалёнка', value: 'удал | remote' },
    { label: 'Angular (запас)', value: 'angular' },
  ];
  public sources: SourceButton[] = [];

  constructor(
    private readonly sanitizer: DomSanitizer,
    private readonly http: HttpClient,
  ) {}

  public ngOnChanges(changes: SimpleChanges): void {
    if (changes['sourceTypes']) {
      this.updateSourceButtons();
    }
  }

  public ngOnInit(): void {
    this.updateSourceButtons();
  }

  private async loadIcon(iconType: string): Promise<void> {
    if (this.iconCache[iconType]) {
      return;
    }

    try {
      const svgContent = await firstValueFrom(
        this.http.get(`/icons/${iconType}.svg`, { responseType: 'text' }),
      );
      const svgWithSize = svgContent.replace('<svg', '<svg width="15" height="15"');
      this.iconCache[iconType] = this.sanitizer.bypassSecurityTrustHtml(svgWithSize);
    } catch (error) {
      console.error(`Failed to load icon ${iconType}:`, error);
      this.iconCache[iconType] = this.sanitizer.bypassSecurityTrustHtml('');
    }
  }

  public getSourceIconSvg(iconType: string): SafeHtml {
    return this.iconCache[iconType] || this.sanitizer.bypassSecurityTrustHtml('');
  }

  private updateSourceButtons(): void {
    const available = new Set(
      Array.isArray(this.sourceTypes)
        ? this.sourceTypes.map((type) => (type ?? '').trim()).filter(Boolean)
        : [],
    );
    const hasApiSources =
      available.size === 0 ||
      Array.from(available).some((type) => API_SOURCE_TYPES.includes(type));

    const resolved: SourceButton[] = [];
    for (const base of this.baseSources) {
      if (base.value === 'api') {
        if (hasApiSources) {
          resolved.push(base);
        }
        continue;
      }
      if (available.size === 0 || available.has(base.value)) {
        resolved.push(base);
      }
    }

    this.sources = resolved.length ? resolved : [...this.baseSources];
    void Promise.all(this.sources.map((item) => this.loadIcon(item.icon)));
  }

  public onInput(value: string): void {
    this.query = value ?? '';
    this.queryChange.emit(this.query);
  }

  public isPresetActive(value: string): boolean {
    return this.query.trim() === value.trim();
  }

  public togglePreset(value: string): void {
    this.queryChange.emit(this.isPresetActive(value) ? '' : value.trim());
  }

  public isSourceActive(value: string): boolean {
    return this.activeSource === value;
  }

  public toggleSource(value: string): void {
    this.sourceChange.emit(this.isSourceActive(value) ? '' : value);
  }

  public clear(): void {
    this.queryChange.emit('');
  }
}
