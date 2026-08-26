import axios, { AxiosInstance } from 'axios';
import { load } from 'cheerio';

type FindworkApiResponse = {
  next?: string | null;
  previous?: string | null;
  results?: FindworkJobRecord[];
  count?: number;
};

type FindworkJobRecord = {
  id?: number | string;
  role?: string;
  company_name?: string;
  text?: string;
  location?: string;
  url?: string;
  date_posted?: string;
  employment_type?: string;
  keywords?: Array<string | null>;
  tags?: Array<string | null>;
  remote?: boolean;
};

export type FindworkJob = {
  id: string;
  title: string;
  description: string;
  company: string | null;
  location: string | null;
  link: string;
  publishedAt: Date | null;
  tags: string | null;
};

export type FindworkFetchOptions = {
  days?: number;
  pageSize?: number;
  maxPages?: number;
  search?: string;
  location?: string;
  company?: string;
  remoteOnly?: boolean;
  employmentType?: string;
};

type FindworkConnectorOptions = {
  token: string;
  baseUrl?: string;
  timeoutMs?: number;
  userAgent?: string;
  logger?: {
    debug?(message: string): void;
    warn?(message: string, meta?: unknown): void;
    error?(message: string, meta?: unknown): void;
  };
};

const DEFAULT_BASE_URL = 'https://findwork.dev/api/jobs/';
const DEFAULT_TIMEOUT = 15000;
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 5;
const DEFAULT_DAYS = 14;

export class FindworkConnector {
  private readonly client: AxiosInstance;
  private readonly options: Required<Omit<FindworkConnectorOptions, 'logger'>>;
  private readonly logger?: FindworkConnectorOptions['logger'];

  constructor(opts: FindworkConnectorOptions) {
    if (!opts?.token) {
      throw new Error('FindworkConnector requires API token');
    }
    this.logger = opts.logger;
    this.options = {
      token: opts.token,
      baseUrl: opts.baseUrl || DEFAULT_BASE_URL,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT,
      userAgent:
        opts.userAgent ||
        'JobFarmBot/1.0 (+https://github.com/kirill/job_farm; findwork collector)',
    };
    this.client = axios.create({
      baseURL: this.options.baseUrl,
      timeout: this.options.timeoutMs,
      headers: {
        Authorization: `Token ${this.options.token}`,
        'User-Agent': this.options.userAgent,
        Accept: 'application/json',
      },
    });
  }

  async fetchRecentJobs(fetchOptions?: FindworkFetchOptions): Promise<FindworkJob[]> {
    const pageSize = this.normalizePageSize(fetchOptions?.pageSize);
    const maxPages = Math.max(1, fetchOptions?.maxPages ?? DEFAULT_MAX_PAGES);
    const cutoff = this.buildCutoff(fetchOptions?.days ?? DEFAULT_DAYS);
    const baseParams: Record<string, string | number | boolean> = {
      ...(fetchOptions?.search ? { search: fetchOptions.search } : {}),
      ...(fetchOptions?.location ? { location: fetchOptions.location } : {}),
      ...(fetchOptions?.company ? { company: fetchOptions.company } : {}),
      ...(fetchOptions?.employmentType ? { employment_type: fetchOptions.employmentType } : {}),
      ...(fetchOptions?.remoteOnly ? { remote: true } : {}),
    };

    const jobs: FindworkJob[] = [];
    for (let page = 1; page <= maxPages; page++) {
      try {
        const resp = await this.client.get<FindworkApiResponse>('', {
          params: {
            ...baseParams,
            page,
            ...(pageSize ? { page_size: pageSize } : {}),
          },
        });
        const records = resp.data?.results ?? [];
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
          if (fetchOptions?.remoteOnly === true && record.remote === false) {
            continue;
          }
          jobs.push(mapped);
        }
        if (!resp.data?.next) {
          break;
        }
      } catch (error) {
        this.logger?.warn?.(
          `findwork page=${page} failed: ${(error as Error)?.message ?? 'unknown error'}`,
          error,
        );
        break;
      }
    }
    return jobs;
  }

  private normalizePageSize(value?: number): number {
    if (!value || !Number.isFinite(value)) {
      return DEFAULT_PAGE_SIZE;
    }
    return Math.max(1, Math.min(100, Math.floor(value)));
  }

  private buildCutoff(days?: number): Date | null {
    const effective = Number.isFinite(days) ? Math.max(1, Number(days)) : DEFAULT_DAYS;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - effective);
    return cutoff;
  }

  private mapJob(record: FindworkJobRecord): FindworkJob | null {
    const title = (record.role || '').trim();
    const link = (record.url || '').trim();
    if (!title || !link) {
      return null;
    }
    return {
      id: record.id ? `findwork:${record.id}` : link,
      title,
      description: this.normalizeDescription(record.text ?? ''),
      company: record.company_name?.trim() || null,
      location: record.location?.trim() || null,
      link,
      publishedAt: this.parseDate(record.date_posted),
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

  private buildTags(record: FindworkJobRecord): string | null {
    const tags = new Set<string>();
    const collect = (items?: Array<string | null>) => {
      (items ?? []).forEach((item) => {
        const value = (item || '').trim();
        if (value) {
          tags.add(value);
        }
      });
    };
    collect(record.keywords);
    collect(record.tags);
    if (record.employment_type) {
      tags.add(record.employment_type.trim());
    }
    if (record.remote) {
      tags.add('remote');
    }
    return tags.size ? Array.from(tags).join(', ') : null;
  }
}
