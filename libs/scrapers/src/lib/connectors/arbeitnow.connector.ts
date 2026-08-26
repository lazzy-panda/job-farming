import axios, { AxiosInstance } from 'axios';
import { load } from 'cheerio';

type ArbeitnowApiResponse = {
  data?: ArbeitnowJobRecord[];
  links?: { next?: string | null };
  meta?: {
    current_page?: number;
    last_page?: number;
    total?: number;
  };
};

type ArbeitnowJobRecord = {
  slug?: string;
  title?: string;
  company_name?: string;
  company_url?: string;
  description?: string;
  job_types?: string[];
  location?: string;
  tags?: string[];
  job_slug?: string;
  job_type?: string;
  created_at?: string;
  url?: string;
  remote?: boolean;
};

export type ArbeitnowJob = {
  id: string;
  title: string;
  description: string;
  company: string | null;
  location: string | null;
  link: string;
  publishedAt: Date | null;
  tags: string | null;
};

export type ArbeitnowFetchOptions = {
  days?: number;
  maxPages?: number;
};

type ArbeitnowConnectorOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  userAgent?: string;
  logger?: {
    debug?(message: string): void;
    warn?(message: string, meta?: unknown): void;
    error?(message: string, meta?: unknown): void;
  };
};

const DEFAULT_BASE_URL = 'https://www.arbeitnow.com/api/job-board-api';
const DEFAULT_MAX_PAGES = 5;
const DEFAULT_DAYS = 14;

export class ArbeitnowConnector {
  private readonly client: AxiosInstance;
  private readonly options: Required<Omit<ArbeitnowConnectorOptions, 'logger'>>;
  private readonly logger?: ArbeitnowConnectorOptions['logger'];

  constructor(opts?: ArbeitnowConnectorOptions) {
    this.logger = opts?.logger;
    this.options = {
      baseUrl: opts?.baseUrl || DEFAULT_BASE_URL,
      timeoutMs: opts?.timeoutMs ?? 15000,
      userAgent:
        opts?.userAgent ||
        'JobFarmBot/1.0 (+https://github.com/kirill/job_farm; arbeitnow collector)',
    };

    this.client = axios.create({
      baseURL: this.options.baseUrl,
      timeout: this.options.timeoutMs,
      headers: {
        'User-Agent': this.options.userAgent,
        Accept: 'application/json',
      },
    });
  }

  async fetchRecentJobs(fetchOptions?: ArbeitnowFetchOptions): Promise<ArbeitnowJob[]> {
    const maxPages = Math.max(1, fetchOptions?.maxPages ?? DEFAULT_MAX_PAGES);
    const cutoff = this.buildCutoff(fetchOptions?.days ?? DEFAULT_DAYS);
    const jobs: ArbeitnowJob[] = [];

    for (let page = 1; page <= maxPages; page++) {
      try {
        const resp = await this.client.get<ArbeitnowApiResponse>('', {
          params: { page },
        });
        const records = resp.data?.data ?? [];
        if (!records.length) {
          break;
        }
        for (const record of records) {
          const mapped = this.mapJob(record);
          if (!mapped) {
            continue;
          }
          if (cutoff && mapped.publishedAt && mapped.publishedAt < cutoff) {
            continue;
          }
          jobs.push(mapped);
        }

        const lastPage = resp.data?.meta?.last_page;
        if (lastPage && page >= lastPage) {
          break;
        }
        if (records.length === 0) {
          break;
        }
      } catch (error) {
        this.logger?.warn?.(
          `arbeitnow page=${page} failed: ${(error as Error)?.message ?? 'unknown error'}`,
          error,
        );
        break;
      }
    }

    return jobs;
  }

  private buildCutoff(days?: number): Date | null {
    const effective = Number.isFinite(days) ? Math.max(1, Number(days)) : DEFAULT_DAYS;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - effective);
    return cutoff;
  }

  private mapJob(record: ArbeitnowJobRecord): ArbeitnowJob | null {
    const title = (record.title || '').trim();
    const link =
      record.url ||
      (record.slug ? `https://www.arbeitnow.com/jobs/${record.slug}` : null);
    if (!title || !link) {
      return null;
    }
    return {
      id: record.slug ? `arbeitnow:${record.slug}` : link,
      title,
      description: this.normalizeDescription(record.description ?? ''),
      company: record.company_name?.trim() || null,
      location: record.location?.trim() || null,
      link,
      publishedAt: this.parseDate(record.created_at),
      tags: this.buildTags(record),
    };
  }

  private parseDate(value?: string): Date | null {
    if (!value) {
      return null;
    }
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  private normalizeDescription(html: string): string {
    if (!html) {
      return '';
    }
    try {
      const $ = load(html);
      return $.text().trim();
    } catch {
      return html.replace(/<[^>]*>/g, '').trim();
    }
  }

  private buildTags(record: ArbeitnowJobRecord): string | null {
    const tags = new Set<string>();
    (record.tags ?? []).forEach((t) => {
      const value = (t || '').trim();
      if (value) {
        tags.add(value);
      }
    });
    (record.job_types ?? []).forEach((t) => {
      const value = (t || '').trim();
      if (value) {
        tags.add(value);
      }
    });
    if (record.job_type) {
      tags.add(record.job_type.trim());
    }
    if (record.remote) {
      tags.add('remote');
    }
    return tags.size ? Array.from(tags).join(', ') : null;
  }
}
