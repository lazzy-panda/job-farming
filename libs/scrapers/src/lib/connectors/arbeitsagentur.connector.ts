import axios, { AxiosInstance } from 'axios';

type ArbeitsagenturSearchResponse = {
  stellenangebote?: ArbeitsagenturListing[];
  maxErgebnisse?: number;
  page?: number;
  size?: number;
};

type ArbeitsagenturListing = {
  refnr?: string;
  titel?: string;
  beruf?: string;
  arbeitgeber?: string;
  arbeitsort?: {
    ort?: string;
    region?: string;
    land?: string;
    plz?: string;
  };
  aktuelleVeroeffentlichungsdatum?: string;
};

type ArbeitsagenturJobDetails = {
  stellenangebotsTitel?: string;
  stellenangebotsBeschreibung?: string;
  firma?: string;
  hauptberuf?: string;
  referenznummer?: string;
  veroeffentlichungszeitraum?: { von?: string };
  datumErsteVeroeffentlichung?: string;
  stellenlokationen?: Array<{
    adresse?: {
      ort?: string;
      region?: string;
      land?: string;
    };
  }>;
  arbeitgeberKundennummerHash?: string;
};

export type ArbeitsagenturJob = {
  refnr: string;
  title: string;
  description: string;
  company: string | null;
  location: string | null;
  link: string;
  publishedAt: Date | null;
  hash: string;
  tags: string | null;
};

export type ArbeitsagenturFetchOptions = {
  days?: number;
  pageSize?: number;
  maxPages?: number;
  angebotsart?: number;
  includeDetails?: boolean;
  excludeZeitarbeit?: boolean;
};

type ArbeitsagenturConnectorOptions = {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  userAgent?: string;
  detailConcurrency?: number;
  logger?: {
    debug?(message: string): void;
    warn?(message: string, meta?: unknown): void;
    error?(message: string, meta?: unknown): void;
  };
};

const DEFAULT_BASE_URL = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service';
const DEFAULT_API_KEY = 'jobboerse-jobsuche';
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 5;
const DEFAULT_DAYS = 14;
const DEFAULT_DETAIL_CONCURRENCY = 3;

export class ArbeitsagenturConnector {
  private readonly client: AxiosInstance;
  private readonly options: Required<Omit<ArbeitsagenturConnectorOptions, 'logger'>>;
  private readonly logger?: ArbeitsagenturConnectorOptions['logger'];

  constructor(opts?: ArbeitsagenturConnectorOptions) {
    this.logger = opts?.logger;
    this.options = {
      apiKey: opts?.apiKey || DEFAULT_API_KEY,
      baseUrl: opts?.baseUrl || DEFAULT_BASE_URL,
      timeoutMs: opts?.timeoutMs ?? 15000,
      userAgent:
        opts?.userAgent ||
        'JobFarmBot/1.0 (+https://github.com/kirill/job_farm; arbeitsagentur collector)',
      detailConcurrency: opts?.detailConcurrency ?? DEFAULT_DETAIL_CONCURRENCY,
    };

    this.client = axios.create({
      baseURL: this.options.baseUrl,
      timeout: this.options.timeoutMs,
      headers: {
        'X-API-Key': this.options.apiKey,
        'User-Agent': this.options.userAgent,
        Accept: 'application/json',
      },
    });
  }

  async fetchRecentJobs(fetchOptions?: ArbeitsagenturFetchOptions): Promise<ArbeitsagenturJob[]> {
    const days = Math.max(1, fetchOptions?.days ?? DEFAULT_DAYS);
    const pageSize = this.normalizePageSize(fetchOptions?.pageSize);
    const maxPages = Math.max(1, fetchOptions?.maxPages ?? DEFAULT_MAX_PAGES);
    const listings = await this.fetchListings({
      days,
      pageSize,
      maxPages,
      angebotsart: fetchOptions?.angebotsart ?? 1,
      excludeZeitarbeit: fetchOptions?.excludeZeitarbeit ?? true,
    });
    if (!listings.length) {
      return [];
    }

    const includeDetails = fetchOptions?.includeDetails !== false;
    if (!includeDetails) {
      return listings.map((listing) => this.mapListingToJob(listing, null));
    }
    return await this.enrichWithDetails(listings);
  }

  private normalizePageSize(size?: number): number {
    if (!size || !Number.isFinite(size)) {
      return DEFAULT_PAGE_SIZE;
    }
    return Math.max(1, Math.min(100, Math.floor(size)));
  }

  private async fetchListings(params: {
    days: number;
    pageSize: number;
    maxPages: number;
    angebotsart: number;
    excludeZeitarbeit: boolean;
  }): Promise<ArbeitsagenturListing[]> {
    const out: ArbeitsagenturListing[] = [];
    for (let page = 1; page <= params.maxPages; page++) {
      try {
        const response = await this.client.get<ArbeitsagenturSearchResponse>('/pc/v4/jobs', {
          params: {
            page,
            size: params.pageSize,
            angebotsart: params.angebotsart,
            veroeffentlichtseit: params.days,
            zeitarbeit: params.excludeZeitarbeit ? false : undefined,
            pav: params.excludeZeitarbeit ? false : undefined,
          },
        });
        const items = response.data?.stellenangebote ?? [];
        const valid = items.filter((item): item is ArbeitsagenturListing => Boolean(item?.refnr));
        out.push(...valid);
        if (!items.length || valid.length < params.pageSize) {
          break;
        }
      } catch (error) {
        this.logger?.warn?.(
          `arbeitsagentur listings page=${page} failed: ${(error as Error)?.message}`,
          error,
        );
        break;
      }
    }
    return out;
  }

  private async enrichWithDetails(listings: ArbeitsagenturListing[]): Promise<ArbeitsagenturJob[]> {
    const jobs: ArbeitsagenturJob[] = [];
    let cursor = 0;

    const worker = async () => {
      for (;;) {
        const listing = listings[cursor++];
        if (!listing) {
          break;
        }
        try {
          const details = await this.fetchJobDetails(listing.refnr as string);
          jobs.push(this.mapListingToJob(listing, details));
        } catch (error) {
          this.logger?.warn?.(
            `arbeitsagentur details refnr=${listing.refnr} failed: ${(error as Error)?.message}`,
            error,
          );
          jobs.push(this.mapListingToJob(listing, null));
        }
      }
    };

    const concurrency = Math.max(1, this.options.detailConcurrency);
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return jobs;
  }

  private async fetchJobDetails(refnr: string): Promise<ArbeitsagenturJobDetails | null> {
    if (!refnr) {
      return null;
    }
    const encoded = Buffer.from(refnr, 'utf-8').toString('base64');
    try {
      const response = await this.client.get<ArbeitsagenturJobDetails>(
        `/pc/v4/jobdetails/${encoded}`,
      );
      return response.data ?? null;
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        return null;
      }
      throw error;
    }
  }

  private mapListingToJob(
    listing: ArbeitsagenturListing,
    details: ArbeitsagenturJobDetails | null,
  ): ArbeitsagenturJob {
    const refnr = listing.refnr as string;
    const title =
      details?.stellenangebotsTitel ??
      listing.titel ??
      listing.beruf ??
      details?.hauptberuf ??
      'Без названия';
    const description =
      details?.stellenangebotsBeschreibung ??
      listing.titel ??
      listing.beruf ??
      'Описание недоступно';
    const company = (details?.firma ?? listing.arbeitgeber ?? null) || null;
    const location =
      details?.stellenlokationen?.map((loc) => loc?.adresse?.ort).filter(Boolean).join(', ') ??
      listing.arbeitsort?.ort ??
      listing.arbeitsort?.region ??
      listing.arbeitsort?.land ??
      null;
    const publishedAt =
      this.parseDate(
        details?.veroeffentlichungszeitraum?.von ??
          details?.datumErsteVeroeffentlichung ??
          listing.aktuelleVeroeffentlichungsdatum,
      ) ?? null;

    return {
      refnr,
      title: title.trim(),
      description: description.trim(),
      company,
      location,
      link: this.buildJobLink(refnr),
      publishedAt,
      hash: refnr,
      tags: details?.arbeitgeberKundennummerHash ?? null,
    };
  }

  private parseDate(input?: string): Date | null {
    if (!input) {
      return null;
    }
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private buildJobLink(refnr: string): string {
    const encoded = encodeURIComponent(Buffer.from(refnr, 'utf-8').toString('base64'));
    return `https://con.arbeitsagentur.de/prod/jobboerse/jobsuche-ui/?jobdetails=${encoded}`;
  }
}
