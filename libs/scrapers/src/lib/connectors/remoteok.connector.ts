import axios, { AxiosInstance } from 'axios';
import { load } from 'cheerio';

type RemoteOkApiResponse = RemoteOkJobRecord[];

type RemoteOkJobRecord = {
  slug?: string;
  id?: number | string;
  epoch?: number;
  date?: string;
  company?: string;
  company_logo?: string;
  position?: string;
  tags?: Array<string | null>;
  description?: string;
  url?: string;
  apply_url?: string;
  location?: string;
  original?: boolean;
};

export type RemoteOkJob = {
  id: string;
  title: string;
  description: string;
  company: string | null;
  location: string | null;
  link: string;
  publishedAt: Date | null;
  tags: string | null;
};

export type RemoteOkFetchOptions = {
  days?: number;
  maxItems?: number;
  tag?: string;
  location?: string;
  company?: string;
  search?: string;
};

type RemoteOkConnectorOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  userAgent?: string;
  logger?: {
    debug?(message: string): void;
    warn?(message: string, meta?: unknown): void;
    error?(message: string, meta?: unknown): void;
  };
};

const DEFAULT_BASE_URL = 'https://remoteok.com/api';
const DEFAULT_TIMEOUT = 20000;
const DEFAULT_DAYS = 14;
const DEFAULT_MAX_ITEMS = 250;

export class RemoteOkConnector {
  private readonly client: AxiosInstance;
  private readonly options: Required<Omit<RemoteOkConnectorOptions, 'logger'>>;
  private readonly logger?: RemoteOkConnectorOptions['logger'];

  constructor(opts?: RemoteOkConnectorOptions) {
    this.logger = opts?.logger;
    this.options = {
      baseUrl: opts?.baseUrl || DEFAULT_BASE_URL,
      timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT,
      userAgent:
        opts?.userAgent ||
        'JobFarmBot/1.0 (+https://github.com/kirill/job_farm; remoteok collector)',
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

  async fetchRecentJobs(fetchOptions?: RemoteOkFetchOptions): Promise<RemoteOkJob[]> {
    const cutoff = this.buildCutoff(fetchOptions?.days ?? DEFAULT_DAYS);
    const maxItems = this.normalizeMaxItems(fetchOptions?.maxItems ?? DEFAULT_MAX_ITEMS);

    let response: RemoteOkApiResponse = [];
    try {
      const resp = await this.client.get<RemoteOkApiResponse>('');
      if (Array.isArray(resp.data)) {
        response = resp.data;
      }
    } catch (error) {
      this.logger?.error?.(
        `remoteok fetch failed: ${(error as Error)?.message ?? 'unknown error'}`,
        error,
      );
      throw error;
    }

    const jobs: RemoteOkJob[] = [];
    for (const record of response) {
      const mapped = this.mapJob(record);
      if (!mapped) {
        continue;
      }
      if (cutoff && mapped.publishedAt && mapped.publishedAt < cutoff) {
        continue;
      }
      if (!this.matchesFilters(record, mapped, fetchOptions)) {
        continue;
      }
      jobs.push(mapped);
      if (jobs.length >= maxItems) {
        break;
      }
    }
    return jobs;
  }

  private normalizeMaxItems(value?: number): number {
    if (!value || Number.isNaN(value)) {
      return DEFAULT_MAX_ITEMS;
    }
    return Math.max(1, Math.min(1000, Math.floor(value)));
  }

  private buildCutoff(days?: number): Date | null {
    const effective = Number.isFinite(days) ? Math.max(1, Number(days)) : DEFAULT_DAYS;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - effective);
    return cutoff;
  }

  private matchesFilters(
    record: RemoteOkJobRecord,
    mapped: RemoteOkJob,
    opts?: RemoteOkFetchOptions,
  ): boolean {
    if (!opts) {
      return true;
    }
    if (opts.tag) {
      const tag = opts.tag.trim().toLowerCase();
      const hasTag =
        (record.tags ?? []).some((t) => (t || '').trim().toLowerCase() === tag) ||
        (record.tags ?? [])
          .map((t) => (t || '').trim().toLowerCase())
          .some((t) => t.includes(tag));
      if (!hasTag) {
        return false;
      }
    }
    if (opts.location) {
      const location = opts.location.trim().toLowerCase();
      const jobLocation = (mapped.location ?? '').toLowerCase();
      if (!jobLocation.includes(location)) {
        return false;
      }
    }
    if (opts.company) {
      const company = opts.company.trim().toLowerCase();
      const jobCompany = (mapped.company ?? '').toLowerCase();
      if (!jobCompany.includes(company)) {
        return false;
      }
    }
    if (opts.search) {
      const needle = opts.search.trim().toLowerCase();
      const haystack = `${mapped.title}\n${mapped.description}`.toLowerCase();
      if (!haystack.includes(needle)) {
        return false;
      }
    }
    return true;
  }

  private mapJob(record: RemoteOkJobRecord): RemoteOkJob | null {
    const title = (record.position || '').trim();
    const link =
      record.apply_url ||
      record.url ||
      (record.slug ? `https://remoteok.com/remote-jobs/${record.slug}` : null);
    if (!title || !link) {
      return null;
    }
    return {
      id: record.id ? `remoteok:${record.id}` : link,
      title,
      description: this.normalizeDescription(record.description ?? ''),
      company: record.company?.trim() || null,
      location: record.location?.trim() || null,
      link,
      publishedAt: this.parseDate(record),
      tags: this.buildTags(record),
    };
  }

  private parseDate(record: RemoteOkJobRecord): Date | null {
    if (record.date) {
      const dt = new Date(record.date);
      if (!Number.isNaN(dt.getTime())) {
        return dt;
      }
    }
    if (record.epoch) {
      const dt = new Date(record.epoch * 1000);
      if (!Number.isNaN(dt.getTime())) {
        return dt;
      }
    }
    return null;
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

  private buildTags(record: RemoteOkJobRecord): string | null {
    const tags = new Set<string>();
    (record.tags ?? []).forEach((t) => {
      const value = (t || '').trim();
      if (value) {
        tags.add(value);
      }
    });
    return tags.size ? Array.from(tags).join(', ') : null;
  }
}
