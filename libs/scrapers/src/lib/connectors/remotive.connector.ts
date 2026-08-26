import axios, { AxiosInstance } from 'axios';
import { load } from 'cheerio';

type RemotiveApiResponse = {
  jobs?: RemotiveJobRecord[];
  meta?: Record<string, unknown>;
};

type RemotiveJobRecord = {
  id?: number;
  url?: string;
  title?: string;
  company_name?: string;
  candidate_required_location?: string;
  salary?: string;
  publication_date?: string;
  job_type?: string;
  tags?: string[];
  description?: string;
  job_slug?: string;
  category?: string;
  job_city?: string;
  job_state?: string;
  job_country?: string;
};

export type RemotiveJob = {
  id: string;
  title: string;
  description: string;
  company: string | null;
  location: string | null;
  link: string;
  publishedAt: Date | null;
  tags: string | null;
};

export type RemotiveFetchOptions = {
  days?: number;
  perPage?: number;
  maxPages?: number;
  search?: string;
  category?: string;
  companySlug?: string;
};

type RemotiveConnectorOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  userAgent?: string;
  logger?: {
    debug?(message: string): void;
    warn?(message: string, meta?: unknown): void;
    error?(message: string, meta?: unknown): void;
  };
};

const DEFAULT_BASE_URL = 'https://remotive.com/api/remote-jobs';
const DEFAULT_PER_PAGE = 100;
const DEFAULT_MAX_PAGES = 5;
const DEFAULT_DAYS = 14;

export class RemotiveConnector {
  private readonly client: AxiosInstance;
  private readonly options: Required<Omit<RemotiveConnectorOptions, 'logger'>>;
  private readonly logger?: RemotiveConnectorOptions['logger'];

  constructor(opts?: RemotiveConnectorOptions) {
    this.logger = opts?.logger;
    this.options = {
      baseUrl: opts?.baseUrl || DEFAULT_BASE_URL,
      timeoutMs: opts?.timeoutMs ?? 15000,
      userAgent:
        opts?.userAgent ||
        'JobFarmBot/1.0 (+https://github.com/kirill/job_farm; remotive collector)',
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

  async fetchRecentJobs(fetchOptions?: RemotiveFetchOptions): Promise<RemotiveJob[]> {
    const perPage = this.normalizePerPage(fetchOptions?.perPage);
    const maxPages = Math.max(1, fetchOptions?.maxPages ?? DEFAULT_MAX_PAGES);
    const cutoff = this.buildCutoff(fetchOptions?.days ?? DEFAULT_DAYS);

    const collected: RemotiveJob[] = [];
    for (let page = 0; page < maxPages; page++) {
      try {
        const resp = await this.client.get<RemotiveApiResponse>('', {
          params: {
            limit: perPage,
            page,
            search: fetchOptions?.search,
            category: fetchOptions?.category,
            company_name: fetchOptions?.companySlug,
          },
        });
        const jobs = resp.data?.jobs ?? [];
        if (!jobs.length) {
          break;
        }
        for (const record of jobs) {
          const mapped = this.mapJob(record);
          if (!mapped) {
            continue;
          }
          if (cutoff && mapped.publishedAt && mapped.publishedAt < cutoff) {
            continue;
          }
          collected.push(mapped);
        }
        if (jobs.length < perPage) {
          break;
        }
      } catch (error) {
        this.logger?.warn?.(
          `remotive page=${page} failed: ${(error as Error)?.message ?? 'unknown error'}`,
          error,
        );
        break;
      }
    }
    return collected;
  }

  private normalizePerPage(size?: number): number {
    if (!size || !Number.isFinite(size)) {
      return DEFAULT_PER_PAGE;
    }
    return Math.max(1, Math.min(200, Math.floor(size)));
  }

  private buildCutoff(days?: number): Date | null {
    const limit = Number.isFinite(days) ? Math.max(1, Number(days)) : DEFAULT_DAYS;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - limit);
    return cutoff;
  }

  private mapJob(job: RemotiveJobRecord): RemotiveJob | null {
    const link = job.url;
    const title = (job.title || '').trim();
    if (!link || !title) {
      return null;
    }
    return {
      id: job.id ? String(job.id) : link,
      title,
      description: this.normalizeDescription(job.description ?? ''),
      company: job.company_name?.trim() || null,
      location:
        job.candidate_required_location?.trim() ||
        job.job_city ||
        job.job_country ||
        null,
      link,
      publishedAt: this.parseDate(job.publication_date),
      tags: this.buildTags(job),
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

  private buildTags(job: RemotiveJobRecord): string | null {
    const tags = new Set<string>();
    (job.tags ?? []).forEach((t) => {
      const value = (t || '').trim();
      if (value) {
        tags.add(value);
      }
    });
    [job.job_type, job.category, job.salary]
      .filter(Boolean)
      .map((v) => (v as string).trim())
      .forEach((v) => {
        if (v) {
          tags.add(v);
        }
      });
    return tags.size ? Array.from(tags).join(', ') : null;
  }
}
