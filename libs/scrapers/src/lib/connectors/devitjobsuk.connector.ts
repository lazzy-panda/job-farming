import axios, { AxiosInstance } from 'axios';

type DevitjobsLightRecord = {
  _id?: string;
  jobUrl?: string;
  name?: string;
  company?: string;
  companyId?: string;
  actualCity?: string;
  cityCategory?: string;
  stateCategory?: string;
  address?: string;
  workplace?: string;
  remoteType?: string | null;
  techCategory?: string;
  technologies?: string[];
  filterTags?: string[];
  perkKeys?: string[];
  language?: string;
  jobType?: string;
  expLevel?: string;
  activeFrom?: string;
  redirectJobUrl?: string;
  candidateContactWay?: string;
  companyWebsiteLink?: string;
  annualSalaryFrom?: number;
  annualSalaryTo?: number;
  companyType?: string;
  companySize?: string;
};

type DevitjobsDetailedRecord = DevitjobsLightRecord & {
  description?: string;
  responsibilitiesTextArea?: string;
  requirementsMustTextArea?: string;
};

export type DevitjobsUkJob = {
  id: string;
  title: string;
  description: string;
  company: string | null;
  location: string | null;
  link: string;
  publishedAt: Date | null;
  tags: string | null;
};

export type DevitjobsUkFetchOptions = {
  days?: number;
  limit?: number;
  cityCategory?: string;
  techCategory?: string;
  company?: string;
  remoteOnly?: boolean;
  fetchDetails?: boolean;
  detailConcurrency?: number;
};

type DevitjobsUkConnectorOptions = {
  listUrl?: string;
  detailUrl?: string;
  timeoutMs?: number;
  userAgent?: string;
  logger?: {
    debug?(message: string): void;
    warn?(message: string, meta?: unknown): void;
    error?(message: string, meta?: unknown): void;
  };
};

const DEFAULT_LIST_URL = 'https://devitjobs.uk/api/jobsLight';
const DEFAULT_DETAIL_URL = 'https://devitjobs.uk/api/jobs';
const DEFAULT_TIMEOUT = 15000;
const DEFAULT_DAYS = 14;
const DEFAULT_LIMIT = 100;
const DEFAULT_DETAIL_CONCURRENCY = 4;

export class DevitjobsUkConnector {
  private readonly listClient: AxiosInstance;
  private readonly detailClient: AxiosInstance;
  private readonly options: Required<Omit<DevitjobsUkConnectorOptions, 'logger'>>;
  private readonly logger?: DevitjobsUkConnectorOptions['logger'];

  constructor(opts?: DevitjobsUkConnectorOptions) {
    this.logger = opts?.logger;
    this.options = {
      listUrl: opts?.listUrl || DEFAULT_LIST_URL,
      detailUrl: opts?.detailUrl || DEFAULT_DETAIL_URL,
      timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT,
      userAgent:
        opts?.userAgent ||
        'JobFarmBot/1.0 (+https://github.com/kirill/job_farm; devitjobs collector)',
    };

    const commonConfig = {
      timeout: this.options.timeoutMs,
      headers: {
        'User-Agent': this.options.userAgent,
        Accept: 'application/json, text/html',
      },
    };

    this.listClient = axios.create({
      baseURL: this.options.listUrl,
      ...commonConfig,
    });
    this.detailClient = axios.create({
      baseURL: this.options.detailUrl,
      ...commonConfig,
    });
  }

  async fetchRecentJobs(fetchOptions?: DevitjobsUkFetchOptions): Promise<DevitjobsUkJob[]> {
    const days = Math.max(1, fetchOptions?.days ?? DEFAULT_DAYS);
    const limit = Math.max(1, fetchOptions?.limit ?? DEFAULT_LIMIT);
    const cutoff = this.buildCutoff(days);

    let records: DevitjobsLightRecord[] = [];
    try {
      const resp = await this.listClient.get<DevitjobsLightRecord[]>(
        '',
        { responseType: 'json' },
      );
      records = Array.isArray(resp.data) ? resp.data : [];
    } catch (error) {
      this.logger?.error?.(
        `devitjobs fetch list failed: ${(error as Error)?.message ?? 'unknown error'}`,
        error,
      );
      throw error;
    }

    let filtered = records.filter((job) => {
      const publishedAt = this.parseDate(job.activeFrom);
      if (cutoff && publishedAt && publishedAt < cutoff) {
        return false;
      }
      if (
        fetchOptions?.cityCategory &&
        job.cityCategory?.toLowerCase() !== fetchOptions.cityCategory.toLowerCase()
      ) {
        return false;
      }
      if (
        fetchOptions?.techCategory &&
        job.techCategory?.toLowerCase() !== fetchOptions.techCategory.toLowerCase()
      ) {
        return false;
      }
      if (
        fetchOptions?.company &&
        job.company?.toLowerCase() !== fetchOptions.company.toLowerCase()
      ) {
        return false;
      }
      if (fetchOptions?.remoteOnly) {
        if (
          job.workplace !== 'remote' &&
          job.remoteType !== 'onlycountry' &&
          job.remoteType !== 'countryandeu'
        ) {
          return false;
        }
      }
      return true;
    });

    filtered = filtered.slice(0, limit);

    if (fetchOptions?.fetchDetails !== false && filtered.length > 0) {
      const concurrency =
        fetchOptions?.detailConcurrency && fetchOptions.detailConcurrency > 0
          ? Math.min(fetchOptions.detailConcurrency, 8)
          : DEFAULT_DETAIL_CONCURRENCY;
      const detailMap = await this.fetchDetails(filtered, concurrency);
      filtered = filtered.map((job) => detailMap.get(job.jobUrl ?? job._id ?? '') ?? job);
    }

    return filtered.map((record) => this.mapJob(record)).filter((job): job is DevitjobsUkJob =>
      Boolean(job),
    );
  }

  private async fetchDetails(
    jobs: DevitjobsLightRecord[],
    concurrency: number,
  ): Promise<Map<string, DevitjobsDetailedRecord>> {
    const out = new Map<string, DevitjobsDetailedRecord>();
    const queue = [...jobs];
    const workers: Promise<void>[] = [];

    const worker = async () => {
      while (queue.length) {
        const job = queue.shift();
        if (!job || !job.jobUrl) {
          continue;
        }
        const detail = await this.fetchSingleDetail(job.jobUrl);
        if (detail) {
          out.set(job.jobUrl, detail);
        }
      }
    };

    for (let i = 0; i < concurrency; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return out;
  }

  private async fetchSingleDetail(slug: string): Promise<DevitjobsDetailedRecord | null> {
    try {
      const resp = await this.detailClient.get<string>(`/${slug}`, {
        responseType: 'text',
      });
      const html = resp.data;
      // 1) Пробуем старый инжект window.__detailedJob
      const match = html.match(/window\.__detailedJob\s*=\s*(\{[\s\S]*?\})<\/script>/);
      if (match?.[1]) {
        return JSON.parse(match[1]) as DevitjobsDetailedRecord;
      }
      // 2) Fallback: Next.js __NEXT_DATA__
      const nextDataMatch = html.match(
        /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
      );
      if (nextDataMatch?.[1]) {
        try {
          const data = JSON.parse(nextDataMatch[1]) as Record<string, any>;
          const job =
            data?.['props']?.['pageProps']?.['job'] ??
            data?.['props']?.['pageProps']?.['jobDetails'] ??
            data?.['pageProps']?.['job'] ??
            null;
          if (job) {
            return job as DevitjobsDetailedRecord;
          }
        } catch {
          // ignore parse error
        }
      }
      return null;
    } catch (error) {
      this.logger?.warn?.(
        `devitjobs detail slug=${slug} failed: ${(error as Error)?.message ?? 'unknown error'}`,
        error,
      );
      return null;
    }
  }

  private mapJob(record: DevitjobsLightRecord | DevitjobsDetailedRecord): DevitjobsUkJob | null {
    const title = (record.name || '').trim();
    const company = (record.company || '').trim();
    if (!title || !company) {
      return null;
    }
    const link =
      record.redirectJobUrl?.trim() ||
      (record.jobUrl ? `https://devitjobs.uk/jobs/${record.jobUrl}` : null);
    if (!link) {
      return null;
    }
    const detailed = record as DevitjobsDetailedRecord;
    const sections: string[] = [];
    if (detailed.description) {
      sections.push(detailed.description.trim());
    }
    if (detailed.responsibilitiesTextArea) {
      sections.push(detailed.responsibilitiesTextArea.trim());
    }
    if (detailed.requirementsMustTextArea) {
      sections.push(detailed.requirementsMustTextArea.trim());
    }
    const metaInfo = [
      record.companyType && `Company type: ${record.companyType}`,
      record.companySize && `Size: ${record.companySize}`,
    ]
      .filter(Boolean)
      .join('\n');
    if (metaInfo) {
      sections.push(metaInfo);
    }
    const description = sections.join('\n\n').trim();
    const tags = this.buildTags(record);

    return {
      id: record._id ? `devitjobs:${record._id}` : link,
      title,
      description,
      company,
      location: record.actualCity?.trim() || record.cityCategory?.trim() || null,
      link,
      publishedAt: this.parseDate(record.activeFrom),
      tags,
    };
  }

  private buildTags(record: DevitjobsLightRecord): string | null {
    const tags = new Set<string>();
    const pushArray = (items?: string[]) =>
      (items ?? []).forEach((item) => {
        const value = (item || '').trim();
        if (value) {
          tags.add(value);
        }
      });
    pushArray(record.technologies);
    pushArray(record.filterTags);
    pushArray(record.perkKeys);
    if (record.techCategory) {
      tags.add(record.techCategory.trim());
    }
    if (record.language) {
      tags.add(record.language.trim());
    }
    if (record.workplace === 'remote' || record.remoteType) {
      tags.add('remote');
    }
    return tags.size ? Array.from(tags).join(', ') : null;
  }

  private parseDate(value?: string): Date | null {
    if (!value) {
      return null;
    }
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  private buildCutoff(days: number): Date | null {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return cutoff;
  }
}
