import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { JobPosting, JobStatus, Source as SharedSource, SourceType } from '@job-farm/shared-models';
import { Prisma } from '@prisma/client';
import { TelegramHttpConnector, ProxyBlockedError } from '@job-farm/scrapers';
import { ProxyManagerService } from '../proxy-manager/proxy-manager.service';
import { load } from 'cheerio';

interface ListParams {
  skip?: number;
  take?: number;
  sourceId?: string;
  status?: string;
}

interface CreateJobPostingDto {
  title: string;
  description?: string;
  company?: string;
  location?: string;
  link?: string;
  sourceId?: string;
  status?: string;
  tags?: string;
  publishedAt?: Date;
}

interface BackfillParams {
  sourceId?: string;
  maxPages?: number;
  dryRun?: boolean;
}

type ScrapeCandidatePayload = {
  title: string;
  description: string | null;
  company: string | null;
  location: string | null;
  link: string | null;
  sourceId: string;
  status: JobStatus;
  tags: string | null;
  publishedAt: Date | null;
  // Not stored in DB, used only for per-source dedupe based on connector output
  hash: string | null;
};

type ScrapeCreatePayload = Omit<ScrapeCandidatePayload, 'link'> & { link: string };

@Injectable()
export class JobPostingsService {
  private readonly logger = new Logger(JobPostingsService.name);
  private lastMetrics:
    | {
        count: number;
        durationMs: number;
        lastError?: string | null;
      }
    | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly proxyManager: ProxyManagerService,
  ) {}

  private isVacancyCandidate(input: {
    title: string;
    description: string | null;
    tags: string | null;
    link: string | null;
  }): { keep: boolean; reason: string } {
    const title = (input.title ?? '').trim();
    const description = (input.description ?? '').trim();
    const tags = (input.tags ?? '').trim();
    const link = (input.link ?? '').trim();

    const text = `${title}\n${description}\n${tags}\n${link}`.toLowerCase();

    if (!description) {
      return { keep: false, reason: 'empty_description' };
    }
    if (description.length < 40 && title.toLowerCase() === 'вакансия') {
      return { keep: false, reason: 'too_short_generic' };
    }

    const hasVacancyWords = /\b(ваканси|позици|ищем|требуетс|нанимаем|hiring|vacancy|job\s+opening|open\s+position|we\s+are\s+looking\s+for|looking\s+for)\b/i.test(
      text,
    );
    const hasApplyCues =
      /\b(отклик|откликнутьс|apply|how\s+to\s+apply|send\s+(?:cv|resume)|tg:|telegram)\b/i.test(text) ||
      /@[a-z0-9_]{3,}/i.test(text) ||
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text);
    const hasSections =
      /\b(требовани|обязанност|услови|responsibilities|requirements|benefits)\b/i.test(text);

    // Hard-negative: CV/resume posts.
    const hasResumeTitle = /^(резюме|cv|resume)\b/i.test(title);
    const hasResumeWord = /\b(резюме|cv|resume)\b/i.test(text);
    const hasVacancyWord = hasVacancyWords;
    
    // Resume-seeking patterns (without vacancy context)
    const hasResumeSeekingPatterns =
      /\b(ищу\s+работу|ищу\s+позицию|looking\s+for\s+work|seeking\s+position|seeking\s+opportunity|open\s+to\s+opportunities|готов\s+рассмотреть|готов\s+к\s+работе|готов\s+к\s+релокации|relocation\s+ready|готов\s+к\s+переезду)\b/i.test(text);
    
    // Resume structure patterns (often appear in CV posts)
    const hasResumeStructurePatterns =
      /\b(опыт\s+работы|образование|мои\s+навыки|my\s+skills|портфолио|portfolio|готов\s+к\s+собеседованию|готов\s+к\s+интервью|готов\s+к\s+стажировке|готов\s+к\s+стажу)\b/i.test(text);
    
    // If title starts with resume word OR (has resume word AND no vacancy word) OR
    // (has seeking patterns AND no vacancy word) OR
    // (has structure patterns AND no vacancy word AND no apply cues AND no sections)
    if (
      hasResumeTitle ||
      (hasResumeWord && !hasVacancyWord) ||
      (hasResumeSeekingPatterns && !hasVacancyWord) ||
      (hasResumeStructurePatterns && !hasVacancyWord && !hasApplyCues && !hasSections)
    ) {
      return { keep: false, reason: 'resume_post' };
    }
    const hasSalary =
      /(\b\d{1,3}(?:[ \t.,'’]\d{3})+\b|\b\d{2,}\s*(?:₽|\$|€|usd|eur|rub|gbp|k|тыс)\b)/i.test(text);
    const hasRoleWords =
      /\b(developer|engineer|designer|manager|analyst|recruiter|qa|devops|product|backend|frontend|fullstack|дизайнер|разработчик|менеджер|аналитик|рекрутер|тестировщик|девопс|маркетолог|копирайтер)\b/i.test(
        text,
      );

    const hasPromoWords =
      /\b(спецпредложен|акци[яи]|скидк|промокод|вебинар|эфир|курс|марафон|челлендж|подборк|папк[ау]\s+с\s+telegram|папк[ау]\b|канал(ы|ов)?|подписчик|поздравля|новост|налогов|бот\b|чат-бот|воркшоп)\b/i.test(
        text,
      );

    // Score-based decision to avoid false negatives.
    let score = 0;
    if (hasVacancyWords) score += 2;
    if (hasApplyCues) score += 1;
    if (hasSections) score += 1;
    if (hasSalary) score += 1;
    if (hasRoleWords) score += 1;
    if (hasPromoWords) score -= 3;

    if (hasPromoWords && score <= 0) {
      return { keep: false, reason: 'promo_or_news' };
    }
    if (!hasVacancyWords && !hasRoleWords && score <= 0) {
      return { keep: false, reason: 'no_vacancy_signals' };
    }
    return { keep: true, reason: 'ok' };
  }

  async findAll(params: ListParams = {}): Promise<JobPosting[]> {
    const { skip, take, sourceId, status } = params;
    const items = await this.prisma.jobPosting.findMany({
      skip,
      take,
      where: {
        sourceId: sourceId || undefined,
        status: status || undefined,
      },
      include: { source: true },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    });
    // De-duplicate at read time to hide legacy duplicates in UI.
    const out: JobPosting[] = [];
    const seen = new Set<string>();
    for (const j of items) {
      const mapped = this.mapJob(j);
      const key = this.buildJobDedupKey(mapped);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      // Hide obvious non-vacancy posts (promo/news/empty) from UI by default.
      const decision = this.isVacancyCandidate({
        title: mapped.title,
        description: mapped.description ?? null,
        tags: mapped.tags ?? null,
        link: mapped.link ?? null,
      });
      if (!decision.keep) {
        continue;
      }
      out.push(mapped);
    }
    return out;
  }

  async create(dto: CreateJobPostingDto): Promise<JobPosting> {
    const safeLink = this.validateLink(dto.link ?? null);
    const safeTitle = (dto.title ?? '').trim();
    const safeDescription = (dto.description ?? '').trim();

    if (!safeTitle) {
      throw new BadRequestException('Title is required');
    }

    const existing = await this.findDuplicateJobPosting({
      sourceId: dto.sourceId ?? null,
      link: safeLink,
      title: safeTitle,
      description: safeDescription || null,
    });
    if (existing) {
      return this.mapJob(existing);
    }

    const created = await this.prisma.jobPosting.create({
      data: {
        title: safeTitle,
        description: safeDescription || null,
        company: dto.company,
        location: dto.location,
        link: safeLink,
        sourceId: dto.sourceId,
        status: dto.status ?? 'new',
        tags: dto.tags,
        publishedAt: dto.publishedAt,
      },
    });
    return this.mapJob(created);
  }

  async remove(id: string): Promise<JobPosting> {
    try {
      const deleted = await this.prisma.jobPosting.delete({ where: { id } });
      return this.mapJob(deleted);
    } catch {
      throw new NotFoundException('Job posting not found');
    }
  }

  async scrape(
    sourceId?: string,
    dryRun = false,
  ): Promise<{ status: string; count: number; preview?: Array<{ title: string; link: string | null }> }> {
    const started = Date.now();
    let lastError: string | null = null;
    const sources = await this.prisma.source.findMany({
      where: sourceId ? { id: sourceId } : undefined,
    });
    if (!sources.length) {
      return { status: 'no_sources', count: 0 };
    }

    const connector = new TelegramHttpConnector();
    let total = 0;

    for (const source of sources) {
      if (source.sourceType !== 'telegram') {
        continue;
      }

      const metadata = (source.metadata as Record<string, unknown>) ?? {};
      const stopUntil = metadata.stopUntil
        ? new Date(metadata.stopUntil as string)
        : null;
      if (stopUntil && stopUntil > new Date()) {
        this.logger.warn(`telegram source=${source.id} skipped until ${stopUntil.toISOString()}`);
        continue;
      }

      const seenHashes = new Set(
        Array.isArray(metadata.lastHashes) ? (metadata.lastHashes as string[]) : [],
      );
      const emptyRuns = typeof metadata.emptyRuns === 'number' ? metadata.emptyRuns : 0;

      let items;
      try {
        items = await connector.fetchNewJobs({
          sourceId: source.id,
          sourceType: source.sourceType,
          url: source.url ?? undefined,
          metadata,
        });
      } catch (error) {
        if (error instanceof ProxyBlockedError) {
          await this.handleProxyBlock(metadata, error);
          await this.prisma.source.update({
            where: { id: source.id },
            data: {
              metadata: {
                ...(metadata ?? {}),
                lastError: `proxy_block_${error.status}`,
                stopUntil: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
              } as Prisma.InputJsonValue,
            },
          });
          this.logger.warn(
            `telegram source=${source.id} proxy blocked status=${error.status}, paused`,
          );
          lastError = `proxy_block_${error.status}`;
          continue;
        }
        this.logger.error(`telegram source=${source.id} failed`, error as Error);
        lastError = (error as Error)?.message ?? null;
        continue;
      }

      if (!items.length) {
        const nextEmpty = emptyRuns + 1;
        const stopFlag =
          nextEmpty >= 5
            ? {
                stopUntil: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
                lastError: 'no_new_many_runs',
              }
            : {};

        await this.prisma.source.update({
          where: { id: source.id },
          data: {
            metadata: {
              ...(metadata ?? {}),
              emptyRuns: nextEmpty,
              lastScrapedAt: new Date().toISOString(),
              ...stopFlag,
            } as Prisma.InputJsonValue,
          },
        });
        if (nextEmpty >= 3) {
          this.logger.warn(`telegram source=${source.id} zero new messages for ${nextEmpty} runs`);
        }
        continue;
      }

      const fallbackLink = (i: typeof items[number]) =>
        i.link ?? (i.messageId ? `https://t.me/${i.channel ?? ''}/${i.messageId}` : null);

      const safeLinks = items
        .map((i) => this.validateLink(fallbackLink(i)))
        .filter((l): l is string => Boolean(l));

      const existing = await this.prisma.jobPosting.findMany({
        where: {
          sourceId: source.id,
          link: { in: safeLinks.length ? safeLinks : undefined },
        },
        select: { link: true },
      });
      const existingLinks = new Set(existing.map((e) => e.link));

      const candidates: ScrapeCandidatePayload[] = items.map((i) => {
        const desc = (i.description ?? '').trim();
        const link = this.validateLink(fallbackLink(i));
        const title = (i.title ?? '').trim();
        return {
          title,
          // Keep original vacancy text in full (do NOT truncate),
          // truncation must be applied only in the parser copy, not in DB storage.
          description: desc || null,
          company: i.company ?? null,
          location: i.location ?? null,
          link,
          sourceId: source.id,
          status: 'new' as JobStatus,
          tags: i.tags ?? null,
          publishedAt: i.publishedAt ?? null,
          hash: (i as { hash?: string | null }).hash ?? null,
        };
      });

      const payloads: ScrapeCreatePayload[] = this.dedupeCreateManyPayloads(
        candidates
          .filter((p) => Boolean(p.title) && p.link && !existingLinks.has(p.link))
          .map((p) => ({ ...p, link: p.link as string })),
      ).filter((p) => (!p.hash || !seenHashes.has(p.hash)));

      const skippedReasons: Record<string, number> = {};
      const skippedPayloads: ScrapeCreatePayload[] = [];
      const vacancyPayloads: ScrapeCreatePayload[] = [];
      for (const p of payloads) {
        const decision = this.isVacancyCandidate({
          title: p.title,
          description: p.description ?? null,
          tags: p.tags ?? null,
          link: p.link ?? null,
        });
        if (!decision.keep) {
          skippedReasons[decision.reason] = (skippedReasons[decision.reason] ?? 0) + 1;
          skippedPayloads.push(p);
          continue;
        }
        vacancyPayloads.push(p);
      }

      if (vacancyPayloads.length > 0) {
        if (!dryRun) {
          const createData: Prisma.JobPostingCreateManyInput[] = vacancyPayloads.map((p) => ({
            title: p.title,
            description: p.description,
            company: p.company,
            location: p.location,
            link: p.link,
            sourceId: p.sourceId,
            status: p.status,
            tags: p.tags,
            publishedAt: p.publishedAt,
          }));
          await this.prisma.jobPosting.createMany({ data: createData });
        }
        total += vacancyPayloads.length;
      }

      const maxSeen = items.reduce(
        (acc, curr) => Math.max(acc, curr.messageId ?? 0),
        (metadata.lastMessageId as number) ?? 0,
      );

      const newHashes = [
        ...Array.from(seenHashes),
        ...[...vacancyPayloads, ...skippedPayloads]
          .map((p) => p.hash)
          .filter((h): h is string => Boolean(h)),
      ].slice(-200);

      if (!dryRun) {
        await this.prisma.source.update({
          where: { id: source.id },
          data: {
            metadata: {
              ...(metadata ?? {}),
              lastMessageId: maxSeen,
              lastScrapedAt: new Date().toISOString(),
              lastHashes: newHashes,
              emptyRuns: 0,
              stopUntil: null,
              lastError: null,
            } as Prisma.InputJsonValue,
          },
        });
      }

      this.logger.log(
        `telegram scrape source=${source.id} new=${vacancyPayloads.length} skipped=${skippedPayloads.length} total=${total} lastMessage=${maxSeen} dryRun=${dryRun} skippedReasons=${JSON.stringify(skippedReasons)}`,
      );
    }

    const durationMs = Date.now() - started;
    if (total === 0) {
      this.logger.warn(`telegram scrape finished with no new items in ${durationMs}ms`);
    }
    this.lastMetrics = { count: total, durationMs, lastError };

    return {
      status: dryRun ? 'dry_run' : total > 0 ? 'created' : 'no_new',
      count: total,
    };
  }

  getMetrics() {
    return this.lastMetrics;
  }

  async backfillTelegramPublishedAt(params: BackfillParams): Promise<{
    status: string;
    scannedSources: number;
    scannedJobs: number;
    updated: number;
    missing: number;
  }> {
    const maxPages = Number.isFinite(params.maxPages) ? Math.max(1, params.maxPages as number) : 20;
    const dryRun = params.dryRun === true;

    const sources = await this.prisma.source.findMany({
      where: params.sourceId ? { id: params.sourceId } : undefined,
    });

    const telegramSources = sources.filter((s) => s.sourceType === 'telegram');
    let scannedJobs = 0;
    let updated = 0;
    let missing = 0;

    for (const source of telegramSources) {
      const meta = (source.metadata as Record<string, unknown>) ?? {};
      const channel =
        (meta.telegramSlug as string | undefined) ??
        this.extractTelegramSlugFromUrl(source.url ?? null) ??
        null;
      if (!channel) {
        continue;
      }

      const jobs = await this.prisma.jobPosting.findMany({
        where: {
          sourceId: source.id,
          link: { contains: 't.me/' },
        },
        select: { id: true, link: true, publishedAt: true, createdAt: true },
      });
      scannedJobs += jobs.length;

      const targets = jobs
        .map((j) => {
          const parsed = this.extractTelegramMessageFromLink(j.link ?? null);
          return { ...j, parsed };
        })
        .filter((j) => Boolean(j.parsed))
        .filter((j) => this.shouldBackfillPublishedAt(j.publishedAt, j.createdAt));

      if (!targets.length) {
        continue;
      }

      const neededMessageIds = new Set<number>();
      for (const t of targets) {
        neededMessageIds.add((t.parsed as { messageId: number }).messageId);
      }

      const publishedMap = await this.fetchTelegramPublishedAtMap(channel, maxPages, meta, neededMessageIds);

      for (const t of targets) {
        const messageId = (t.parsed as { messageId: number }).messageId;
        const next = publishedMap.get(messageId) ?? null;
        if (!next) {
          missing += 1;
          continue;
        }
        if (!dryRun) {
          await this.prisma.jobPosting.update({
            where: { id: t.id },
            data: { publishedAt: next },
          });
        }
        updated += 1;
      }
    }

    return {
      status: dryRun ? 'dry_run' : 'updated',
      scannedSources: telegramSources.length,
      scannedJobs,
      updated,
      missing,
    };
  }

  private validateLink(link: string | null): string | null {
    if (!link) return null;
    try {
      const u = new URL(link);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        return link.trim();
      }
      return null;
    } catch {
      return null;
    }
  }

  private buildJobDedupKey(job: JobPosting): string {
    const sourcePart = job.sourceId ?? 'no_source';
    const link = (job.link ?? '').trim();
    if (link) {
      return `${sourcePart}:link:${link}`;
    }
    const title = (job.title ?? '').trim();
    const desc = (job.description ?? '').trim();
    const descShort = desc ? desc.slice(0, 300) : '';
    if (!title && !descShort) {
      return `${sourcePart}:id:${job.id}`;
    }
    return `${sourcePart}:text:${title}:${descShort}`;
  }

  private dedupeCreateManyPayloads(payloads: ScrapeCreatePayload[]): ScrapeCreatePayload[] {
    const seen = new Set<string>();
    const out: ScrapeCreatePayload[] = [];
    for (const p of payloads) {
      const key = p.link ? `link:${p.link}` : p.hash ? `hash:${p.hash}` : '';
      if (!key) {
        continue;
      }
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(p);
    }
    return out;
  }

  private async findDuplicateJobPosting(input: {
    sourceId: string | null;
    link: string | null;
    title: string;
    description: string | null;
  }): Promise<Prisma.JobPostingGetPayload<{ include: { source: true } }> | null> {
    const where: Prisma.JobPostingWhereInput = input.link
      ? {
          sourceId: input.sourceId ?? undefined,
          link: input.link,
        }
      : {
          sourceId: input.sourceId ?? undefined,
          title: input.title,
          description: input.description ?? undefined,
        };

    return await this.prisma.jobPosting.findFirst({
      where,
      include: { source: true },
    });
  }

  private async handleProxyBlock(metadata: Record<string, unknown>, error: ProxyBlockedError) {
    const proxyId = metadata.proxyId as string | undefined;
    if (proxyId) {
      await this.proxyManager.markBlocked(proxyId, error.status);
    }
  }

  private shouldBackfillPublishedAt(publishedAt: Date | null, createdAt: Date): boolean {
    if (!publishedAt) {
      return true;
    }
    const diffMs = Math.abs(publishedAt.getTime() - createdAt.getTime());
    return diffMs <= 5000;
  }

  private extractTelegramSlugFromUrl(url: string | null): string | null {
    if (!url) {
      return null;
    }
    const matched = url.match(/t\.me\/(?:s\/)?([^/?#]+)/i);
    return matched?.[1] ?? null;
  }

  private extractTelegramMessageFromLink(link: string | null): { channel: string; messageId: number } | null {
    const value = (link ?? '').trim();
    if (!value) {
      return null;
    }
    const matched = value.match(/t\.me\/(?:s\/)?([^/?#]+)\/(\d+)(?:[/?#]|$)/i);
    if (!matched?.[1] || !matched?.[2]) {
      return null;
    }
    const messageId = Number(matched[2]);
    if (!messageId || Number.isNaN(messageId)) {
      return null;
    }
    return { channel: matched[1], messageId };
  }

  private async fetchTelegramPublishedAtMap(
    channel: string,
    maxPages: number,
    meta: Record<string, unknown>,
    neededMessageIds: Set<number>,
  ): Promise<Map<number, Date>> {
    const result = new Map<number, Date>();
    const userAgent = (meta.userAgent as string | undefined) ?? 'JobFarmBackfill/1.0';

    for (let page = 1; page <= maxPages && neededMessageIds.size > 0; page += 1) {
      const url = page > 1 ? `https://t.me/s/${channel}?page=${page}` : `https://t.me/s/${channel}`;
      const html = await this.fetchTelegramHtml(url, meta, userAgent);
      if (!html) {
        break;
      }
      const pageMap = this.parseTelegramPagePublishedAt(html);
      for (const [messageId, dt] of pageMap.entries()) {
        if (neededMessageIds.has(messageId)) {
          result.set(messageId, dt);
          neededMessageIds.delete(messageId);
        }
      }
    }

    return result;
  }

  private async fetchTelegramHtml(
    url: string,
    meta: Record<string, unknown>,
    userAgent: string,
  ): Promise<string> {
    try {
      const proxyHost = meta.proxyHost as string | undefined;
      const proxyPort = meta.proxyPort as number | undefined;
      const proxyUsername = meta.proxyUsername as string | undefined;
      const proxyPassword = meta.proxyPassword as string | undefined;

      const resp = await axios.get(url, {
        headers: { 'user-agent': userAgent },
        timeout: 15000,
        proxy:
          proxyHost && proxyPort
            ? {
                host: proxyHost,
                port: proxyPort,
                protocol: 'https',
                auth:
                  proxyUsername && proxyPassword
                    ? { username: proxyUsername, password: proxyPassword }
                    : undefined,
              }
            : undefined,
        validateStatus: () => true,
      });
      if (resp.status !== 200) {
        return '';
      }
      return resp.data as string;
    } catch {
      return '';
    }
  }

  private parseTelegramPagePublishedAt(html: string): Map<number, Date> {
    const $ = load(html);
    const map = new Map<number, Date>();
    const elements = $('.tgme_widget_message').toArray();
    for (const el of elements) {
      const dataPost = $(el).attr('data-post');
      if (!dataPost) {
        continue;
      }
      const [, idStr] = dataPost.split('/');
      const messageId = Number(idStr);
      if (!messageId || Number.isNaN(messageId)) {
        continue;
      }
      const timeAttr =
        $(el).find('time[datetime]').first().attr('datetime') ??
        $(el).find('.tgme_widget_message_date time[datetime]').first().attr('datetime') ??
        null;
      if (!timeAttr) {
        continue;
      }
      const dt = new Date(timeAttr);
      if (Number.isNaN(dt.getTime())) {
        continue;
      }
      map.set(messageId, dt);
    }
    return map;
  }

  private mapJob(j: {
    id: string;
    title: string;
    description: string | null;
    company: string | null;
    location: string | null;
    link: string | null;
    status: string;
    tags: string | null;
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    sourceId: string | null;
    source?: {
      id: string;
      name: string;
      sourceType: string;
      url: string | null;
      metadata: unknown;
      createdAt: Date;
      updatedAt: Date;
    } | null;
  }): JobPosting {
    return {
      id: j.id,
      title: j.title,
      description: j.description ?? null,
      company: j.company ?? null,
      location: j.location ?? null,
      link: j.link ?? null,
      status: (j.status as JobStatus) ?? 'new',
      tags: j.tags ?? null,
      publishedAt: j.publishedAt ? j.publishedAt.toISOString() : null,
      createdAt: j.createdAt.toISOString(),
      updatedAt: j.updatedAt.toISOString(),
      sourceId: j.sourceId ?? null,
      source: j.source ? this.mapSource(j.source) : null,
    };
  }

  private mapSource(s: {
    id: string;
    name: string;
    sourceType: string;
    url: string | null;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): SharedSource {
    return {
      id: s.id,
      name: s.name,
      sourceType: (s.sourceType as SourceType) ?? 'site',
      url: s.url ?? null,
      metadata: (s.metadata as Record<string, unknown>) ?? {},
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }
}
