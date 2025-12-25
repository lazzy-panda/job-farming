import { Injectable, Logger } from '@nestjs/common';
import { defaultParseResult, parseVacancy, ParseResult } from '@job-farm/vacancy-parser';
import { createHash } from 'node:crypto';

export interface VacancyParseInput {
  text: string;
  pageTitle?: string;
  sourceUrl?: string;
  debug?: boolean;
}

type ParserHints = {
  defaultCountry?: string;
  currencyHint?: 'RUB' | 'USD' | 'EUR' | 'GBP' | 'CHF' | 'SEK' | 'NOK' | 'DKK' | 'PLN' | 'UNKNOWN';
};

function isEnabledFlag(value: string | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

type CacheEntry = { value: ParseResult; expiresAtMs: number };

@Injectable()
export class VacancyParseService {
  private readonly logger = new Logger(VacancyParseService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly stats = {
    total: 0,
    titleLow: 0,
    salaryFound: 0,
    noContacts: 0,
    warnings: new Map<string, number>(),
  };

  parse(input: VacancyParseInput): ParseResult {
    const enabled = this.isParserEnabled();
    if (!enabled) {
      const res = defaultParseResult();
      res.meta.warnings.push('disabled');
      res.meta.sourceUrl = input.sourceUrl ?? null;
      return res;
    }

    const cacheEnabled = isEnabledFlag(process.env.VACANCY_PARSER_CACHE_ENABLED);
    const cacheTtlMs = 60 * 60 * 1000; // 1h
    const cacheKey = cacheEnabled ? this.buildCacheKey(input) : null;
    if (cacheKey) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAtMs > Date.now()) {
        const hit = { ...cached.value };
        hit.meta.warnings = Array.from(new Set([...(hit.meta.warnings ?? []), 'cache_hit']));
        return hit;
      }
    }

    try {
      const hints = this.inferHintsFromSourceUrl(input.sourceUrl);
      const result = parseVacancy(input.text, {
        pageTitle: input.pageTitle,
        sourceUrl: input.sourceUrl,
        debug: input.debug,
        strict: true,
        ...hints,
      });

      if (cacheKey) {
        this.cache.set(cacheKey, { value: result, expiresAtMs: Date.now() + cacheTtlMs });
      }

      this.recordMetrics(result);
      return result;
    } catch (_err) {
      const res = defaultParseResult();
      res.meta.warnings.push('parser_failed');
      res.meta.sourceUrl = input.sourceUrl ?? null;
      this.recordMetrics(res);
      return res;
    }
  }

  private buildCacheKey(input: VacancyParseInput): string {
    const value = JSON.stringify({
      text: input.text,
      pageTitle: input.pageTitle ?? null,
      sourceUrl: input.sourceUrl ?? null,
      debug: Boolean(input.debug),
    });
    return createHash('sha256').update(value).digest('hex');
  }

  private isParserEnabled(): boolean {
    const raw = (process.env.VACANCY_PARSER_ENABLED ?? '').trim();
    // In development we want the parser ON by default, unless explicitly disabled.
    // In production we keep the previous behavior: OFF unless explicitly enabled.
    const nodeEnv = (process.env.NODE_ENV ?? '').trim().toLowerCase();
    const isProd = nodeEnv === 'production';

    if (!raw) {
      return !isProd;
    }
    return isEnabledFlag(raw);
  }

  private inferHintsFromSourceUrl(sourceUrl: string | undefined): ParserHints {
    const url = (sourceUrl ?? '').trim();
    if (!url) {
      return {};
    }
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (host.endsWith('.co.uk') || host.endsWith('.uk')) {
        return { defaultCountry: 'GB', currencyHint: 'GBP' };
      }
      if (
        host.endsWith('.de') ||
        host.endsWith('.fr') ||
        host.endsWith('.nl') ||
        host.endsWith('.es') ||
        host.endsWith('.it') ||
        host.endsWith('.gr') ||
        host.endsWith('.cy')
      ) {
        const defaultCountry =
          host.endsWith('.gr') ? 'GR' : host.endsWith('.cy') ? 'CY' : undefined;
        return { defaultCountry, currencyHint: 'EUR' };
      }
      if (host.endsWith('.ch')) {
        return { defaultCountry: 'CH', currencyHint: 'CHF' };
      }
      if (host.endsWith('.se')) {
        return { defaultCountry: 'SE', currencyHint: 'SEK' };
      }
      if (host.endsWith('.no')) {
        return { defaultCountry: 'NO', currencyHint: 'NOK' };
      }
      if (host.endsWith('.dk')) {
        return { defaultCountry: 'DK', currencyHint: 'DKK' };
      }
      if (host.endsWith('.pl')) {
        return { currencyHint: 'PLN' };
      }
      if (host.endsWith('.com')) {
        return { currencyHint: 'USD' };
      }
      return {};
    } catch {
      return {};
    }
  }

  private recordMetrics(result: ParseResult): void {
    this.stats.total += 1;
    if ((result.confidence?.title ?? 0) < 0.6) {
      this.stats.titleLow += 1;
    }
    if ((result.salary?.min ?? null) !== null || (result.salary?.max ?? null) !== null) {
      this.stats.salaryFound += 1;
    }
    const contactsCount =
      (result.contacts?.emails?.length ?? 0) +
      (result.contacts?.phones?.length ?? 0) +
      (result.contacts?.telegram?.length ?? 0) +
      (result.contacts?.urls?.length ?? 0);
    if (contactsCount === 0) {
      this.stats.noContacts += 1;
    }
    for (const w of result.meta?.warnings ?? []) {
      this.stats.warnings.set(w, (this.stats.warnings.get(w) ?? 0) + 1);
    }

    // Log aggregates every 50 calls to keep noise low.
    if (this.stats.total % 50 !== 0) {
      return;
    }
    const pct = (n: number) => Math.round((n / this.stats.total) * 1000) / 10;
    const topWarnings = Array.from(this.stats.warnings.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([k, v]) => `${k}:${v}`);

    this.logger.log(
      `vacancy_parser_stats total=${this.stats.total} titleLowPct=${pct(this.stats.titleLow)} salaryFoundPct=${pct(
        this.stats.salaryFound,
      )} noContactsPct=${pct(this.stats.noContacts)} topWarnings=${topWarnings.join(',')}`,
    );
  }
}
