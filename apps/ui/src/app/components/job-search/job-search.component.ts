import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, EventEmitter, Input, Output, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
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
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
  ],
  templateUrl: './job-search.component.html',
  styleUrl: './job-search.component.scss',
})
export class JobSearchComponent implements OnInit, OnChanges {
  @Input() public query: string = '';
  @Input() public total: number = 0;
  @Input() public filtered: number = 0;
  @Input() public sourceTypes: string[] | null = null;

  @Output() public queryChange = new EventEmitter<string>();
  @Output() public sourceChange = new EventEmitter<string>();

  private iconCache: Record<string, SafeHtml> = {};
  private readonly baseSources: SourceButton[] = [
    { label: 'Telegram', value: 'telegram', icon: 'telegram' },
    { label: 'RSS', value: 'rss', icon: 'rss' },
    { label: 'API', value: 'api', icon: 'api' },
  ];

  // Пресеты под 12-недельный план: трек А — DM/РП, запасной трек (недели 9+) — Angular.
  // «|» — ИЛИ между вариантами, пробел — И между словами.
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

  public async ngOnInit(): Promise<void> {
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
      const svgWithSize = svgContent.replace('<svg', '<svg width="20" height="20"');
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
    const normalized = this.normalizeKeyboardLayout(value ?? '');
    this.query = normalized;
    this.queryChange.emit(normalized);
  }

  public applyPreset(value: string): void {
    const next = (value ?? '').trim();
    this.queryChange.emit(next);
  }

  public applySource(value: string): void {
    this.sourceChange.emit(value ?? '');
  }

  public clear(): void {
    this.queryChange.emit('');
  }

  /**
   * Преобразует введённый текст из раскладки RU -> EN, если встречаются кириллические символы,
   * чтобы пользователю не приходилось вручную переключать язык при поиске.
   */
  private normalizeKeyboardLayout(input: string): string {
    if (!input) return '';
    const ruToEn: Record<string, string> = {
      й: 'q', ц: 'w', у: 'e', к: 'r', е: 't', н: 'y', г: 'u', ш: 'i', щ: 'o', з: 'p', х: '[', ъ: ']',
      ф: 'a', ы: 's', в: 'd', а: 'f', п: 'g', р: 'h', о: 'j', л: 'k', д: 'l', ж: ';', э: '\'',
      я: 'z', ч: 'x', с: 'c', м: 'v', и: 'b', т: 'n', ь: 'm', б: ',', ю: '.',
      Й: 'Q', Ц: 'W', У: 'E', К: 'R', Е: 'T', Н: 'Y', Г: 'U', Ш: 'I', Щ: 'O', З: 'P', Х: '{', Ъ: '}',
      Ф: 'A', Ы: 'S', В: 'D', А: 'F', П: 'G', Р: 'H', О: 'J', Л: 'K', Д: 'L', Ж: ':', Э: '"',
      Я: 'Z', Ч: 'X', С: 'C', М: 'V', И: 'B', Т: 'N', Ь: 'M', Б: '<', Ю: '>',
    };
    let hasCyr = false;
    const converted = Array.from(input)
      .map((ch) => {
        const repl = ruToEn[ch];
        if (repl !== undefined) {
          hasCyr = true;
          return repl;
        }
        return ch;
      })
      .join('');
    return hasCyr ? converted : input;
  }
}
