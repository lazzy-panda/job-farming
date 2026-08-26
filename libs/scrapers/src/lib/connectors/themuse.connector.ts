import axios, { AxiosInstance } from 'axios';
import { load } from 'cheerio';

type TheMuseJobRecord = {
  id?: number;
  name?: string;
  short_name?: string;
  type?: string;
  publication_date?: string;
  contents?: string;
  refs?: {
    landing_page?: string;
  };
  company?: {
    name?: string;
    short_name?: string;
  };
  locations?: Array<{ name?: string }>;
  categories?: Array<{ name?: string }>;
  levels?: Array<{ name?: string }>;
  tags?: string[];
};

type TheMuseApiResponse = {
  page?: number;
  page_count?: number;
  items_per_page?: number;
  total?: number;
  results?: TheMuseJobRecord[];
};

export type TheMuseJob = {
  id: string;
  title: string;
  description: string;
  company: string | null;
  location: string | null;
  link: string;
  publishedAt: Date | null;
  tags: string | null;
};

export type TheMuseFetchOptions = {
  days?: number;
  perPage?: number;
  maxPages?: number;
  category?: string;
  company?: string;
  location?: string;
  level?: string;
};

type TheMuseConnectorOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  userAgent?: string;
  logger?: {
    debug?(message: string): void;
    warn?(message: string, meta?: unknown): void;
    error?(message: string, meta?: unknown): void;
  };
};

const DEFAULT_BASE_URL = 'https://www.themuse.com/api/public/jobs';
const DEFAULT_PER_PAGE = 50;
const DEFAULT_MAX_PAGES = 5;
const DEFAULT_DAYS = 14;

export class TheMuseConnector {
  private readonly client: AxiosInstance;
  private readonly options: Required<Omit<TheMuseConnectorOptions, 'logger'>>;
  private readonly logger?: TheMuseConnectorOptions['logger'];

  constructor(opts?: TheMuseConnectorOptions) {
    this.logger = opts?.logger;
    this.options = {
      baseUrl: opts?.baseUrl || DEFAULT_BASE_URL,
      timeoutMs: opts?.timeoutMs ?? 15000,
      userAgent:
        opts?.userAgent ||
        'JobFarmBot/1.0 (+https://github.com/kirill/job_farm; themuse collector)',
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

  async fetchRecentJobs(fetchOptions?: TheMuseFetchOptions): Promise<TheMuseJob[]> {
    const perPage = this.normalizePerPage(fetchOptions?.perPage);
    const maxPages = Math.max(1, fetchOptions?.maxPages ?? DEFAULT_MAX_PAGES);
    const cutoff = this.buildCutoff(fetchOptions?.days ?? DEFAULT_DAYS);

    const jobs: TheMuseJob[] = [];
    for (let page = 1; page <= maxPages; page++) {
      try {
        const resp = await this.client.get<TheMuseApiResponse>('', {
          params: {
            page,
            items_per_page: perPage,
            category: fetchOptions?.category,
            company: fetchOptions?.company,
            location: fetchOptions?.location,
            level: fetchOptions?.level,
            descending: true,
          },
        });
        const results = resp.data?.results ?? [];
        if (!results.length) {
          break;
        }
        for (const record of results) {
          const mapped = this.mapJob(record);
          if (!mapped) {
            continue;
          }
          if (cutoff && mapped.publishedAt && mapped.publishedAt < cutoff) {
            continue;
          }
          jobs.push(mapped);
        }
        if (results.length < perPage) {
          break;
        }
      } catch (error) {
        this.logger?.warn?.(
          `themuse page=${page} failed: ${(error as Error)?.message ?? 'unknown error'}`,
          error,
        );
        break;
      }
    }
    return jobs;
  }

  private normalizePerPage(size?: number): number {
    if (!size || !Number.isFinite(size)) {
      return DEFAULT_PER_PAGE;
    }
    return Math.max(1, Math.min(100, Math.floor(size)));
  }

  private buildCutoff(days?: number): Date | null {
    const effective = Number.isFinite(days) ? Math.max(1, Number(days)) : DEFAULT_DAYS;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - effective);
    return cutoff;
  }

  private mapJob(record: TheMuseJobRecord): TheMuseJob | null {
    const title = (record.name || '').trim();
    const link =
      record.refs?.landing_page ||
      (record.short_name
        ? `https://www.themuse.com/jobs/${record.company?.short_name}/${record.short_name}`
        : null);
    if (!title || !link) {
      return null;
    }
    return {
      id: record.id ? `themuse:${record.id}` : link,
      title,
      description: this.normalizeDescription(record.contents ?? ''),
      company: record.company?.name?.trim() || null,
      location: this.buildLocation(record),
      link,
      publishedAt: this.parseDate(record.publication_date),
      tags: this.buildTags(record),
    };
  }

  private buildLocation(record: TheMuseJobRecord): string | null {
    if (!record.locations?.length) {
      return null;
    }
    const values = record.locations
      .map((loc) => (loc.name || '').trim())
      .filter(Boolean);
    return values.length ? values.join(', ') : null;
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

  private buildTags(record: TheMuseJobRecord): string | null {
    const tags = new Set<string>();
    (record.tags ?? []).forEach((t) => {
      const value = (t || '').trim();
      if (value) {
        tags.add(value);
      }
    });
    (record.categories ?? []).forEach((c) => {
      const value = (c.name || '').trim();
      if (value) {
        tags.add(value);
      }
    });
    (record.levels ?? []).forEach((l) => {
      const value = (l.name || '').trim();
      if (value) {
        tags.add(value);
      }
    });
    return tags.size ? Array.from(tags).join(', ') : null;
  }
}
