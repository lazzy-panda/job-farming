import axios, { AxiosInstance } from 'axios';
import { load } from 'cheerio';

type JobicyApiResponse = {
  success?: boolean;
  error?: string;
  jobs?: JobicyJobRecord[];
  jobCount?: number;
  lastUpdate?: string;
};

type JobicyJobRecord = {
  id?: number | string;
  url?: string;
  jobSlug?: string;
  jobTitle?: string;
  companyName?: string;
  jobIndustry?: Array<string | null>;
  jobType?: Array<string | null>;
  jobGeo?: string;
  jobLevel?: string;
  jobTags?: Array<string | null>;
  jobExcerpt?: string;
  jobDescription?: string;
  pubDate?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryPeriod?: string;
};

export type JobicyJob = {
  id: string;
  title: string;
  description: string;
  company: string | null;
  location: string | null;
  link: string;
  publishedAt: Date | null;
  tags: string | null;
};

export type JobicyFetchOptions = {
  days?: number;
  count?: number;
  industry?: string;
  jobType?: string;
  jobLevel?: string;
  geo?: string;
  tag?: string;
  search?: string;
  company?: string;
};

type JobicyConnectorOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  userAgent?: string;
  logger?: {
    debug?(message: string): void;
    warn?(message: string, meta?: unknown): void;
    error?(message: string, meta?: unknown): void;
  };
};

const DEFAULT_BASE_URL = 'https://jobicy.com/api/v2/remote-jobs';
const DEFAULT_TIMEOUT = 15000;
const DEFAULT_DAYS = 14;
const DEFAULT_COUNT = 100;
const MAX_COUNT = 100;
const MIN_COUNT = 1;

export class JobicyConnector {
  private readonly client: AxiosInstance;
  private readonly options: Required<Omit<JobicyConnectorOptions, 'logger'>>;
  private readonly logger?: JobicyConnectorOptions['logger'];

  constructor(opts?: JobicyConnectorOptions) {
    this.logger = opts?.logger;
    this.options = {
      baseUrl: opts?.baseUrl || DEFAULT_BASE_URL,
      timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT,
      userAgent:
        opts?.userAgent ||
        'JobFarmBot/1.0 (+https://github.com/kirill/job_farm; jobicy collector)',
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

  async fetchRecentJobs(fetchOptions?: JobicyFetchOptions): Promise<JobicyJob[]> {
    const params = this.buildParams(fetchOptions);
    let response: JobicyApiResponse | null = null;
    try {
      const resp = await this.client.get<JobicyApiResponse>('', { params });
      response = resp.data ?? null;
    } catch (error) {
      this.logger?.error?.(
        `jobicy fetch failed: ${(error as Error)?.message ?? 'unknown error'}`,
        error,
      );
      throw error;
    }

    if (response?.success === false) {
      const err = response?.error || 'unknown Jobicy API error';
      this.logger?.warn?.(`jobicy api responded with error: ${err}`);
      return [];
    }
    const records = Array.isArray(response?.jobs) ? response?.jobs ?? [] : [];
    if (!records.length) {
      return [];
    }

    const cutoff = this.buildCutoff(fetchOptions?.days ?? DEFAULT_DAYS);
    const jobs: JobicyJob[] = [];
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
    return jobs;
  }

  private buildParams(opts?: JobicyFetchOptions): Record<string, string | number> {
    const params: Record<string, string | number> = {
      count: this.normalizeCount(opts?.count),
    };
    const maybeSet = (key: string, value?: string) => {
      if (value && value.trim()) {
        params[key] = value.trim();
      }
    };
    maybeSet('industry', opts?.industry);
    maybeSet('jobType', opts?.jobType);
    maybeSet('jobLevel', opts?.jobLevel);
    maybeSet('geo', opts?.geo);
    maybeSet('tag', opts?.tag);
    maybeSet('search', opts?.search);
    maybeSet('company', opts?.company);
    return params;
  }

  private normalizeCount(value?: number): number {
    if (!value || !Number.isFinite(value)) {
      return DEFAULT_COUNT;
    }
    if (value < MIN_COUNT) {
      return MIN_COUNT;
    }
    if (value > MAX_COUNT) {
      return MAX_COUNT;
    }
    return Math.floor(value);
  }

  private buildCutoff(days?: number): Date | null {
    const effective = Number.isFinite(days) ? Math.max(1, Number(days)) : DEFAULT_DAYS;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - effective);
    return cutoff;
  }

  private mapJob(record: JobicyJobRecord): JobicyJob | null {
    const title = (record.jobTitle || '').trim();
    const link = (record.url || '').trim();
    if (!title || !link) {
      return null;
    }
    return {
      id: record.id ? `jobicy:${record.id}` : record.jobSlug || link,
      title,
      description: this.normalizeDescription(
        record.jobDescription ?? record.jobExcerpt ?? '',
      ),
      company: record.companyName?.trim() || null,
      location: record.jobGeo?.trim() || null,
      link,
      publishedAt: this.parseDate(record.pubDate),
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

  private buildTags(record: JobicyJobRecord): string | null {
    const tags = new Set<string>();
    const collect = (items?: Array<string | null>) => {
      (items ?? []).forEach((item) => {
        const value = (item || '').trim();
        if (value) {
          tags.add(value);
        }
      });
    };
    collect(record.jobIndustry);
    collect(record.jobType);
    collect(record.jobTags);
    if (record.jobLevel) {
      tags.add(record.jobLevel.trim());
    }
    if (record.salaryMin || record.salaryMax) {
      const salaryParts = [
        record.salaryMin ? `min:${record.salaryMin}` : null,
        record.salaryMax ? `max:${record.salaryMax}` : null,
        record.salaryCurrency,
        record.salaryPeriod,
      ]
        .filter(Boolean)
        .map((p) => (p as string).trim());
      if (salaryParts.length) {
        tags.add(`salary(${salaryParts.join(' ')})`);
      }
    }
    return tags.size ? Array.from(tags).join(', ') : null;
  }
}
