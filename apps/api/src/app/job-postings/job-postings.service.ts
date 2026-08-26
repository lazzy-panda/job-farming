import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { JobPosting, JobStatus, Source as SharedSource, SourceType } from '@job-farm/shared-models';
import { Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import {
  TelegramHttpConnector,
  RssConnector,
  FacebookConnector,
  ProxyBlockedError,
  ArbeitsagenturConnector,
  ArbeitsagenturJob,
  RemotiveConnector,
  RemotiveJob,
  RemoteOkConnector,
  RemoteOkJob,
  ArbeitnowConnector,
  ArbeitnowJob,
  TheMuseConnector,
  TheMuseJob,
  JobicyConnector,
  JobicyJob,
  FindworkConnector,
  FindworkJob,
  DevitjobsUkConnector,
  DevitjobsUkJob,
} from '@job-farm/scrapers';
import { parseVacancy } from '@job-farm/vacancy-parser';
import { ProxyManagerService } from '../proxy-manager/proxy-manager.service';
import { load } from 'cheerio';
import { ProxyDbRow } from '../proxies/proxy.types';

const JOB_PAGE_FETCH_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36';
const RAW_TEXT_MIN_LENGTH = 200;

interface ListParams {
  skip?: number;
  take?: number;
  sourceId?: string;
  status?: string;
}

interface CreateJobPostingDto {
  title: string;
  description?: string;
  rawContent?: string;
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
  rawContent: string | null;
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

  private async fetchRawContentIfNeeded(link?: string | null): Promise<string | null> {
    if (!link) {
      return null;
    }
    try {
      const response = await axios.get(link, {
        timeout: 20000,
        maxRedirects: 5,
        responseType: 'text',
        headers: {
          'User-Agent': JOB_PAGE_FETCH_UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      if (typeof response.data === 'string' && response.data.trim().length >= RAW_TEXT_MIN_LENGTH) {
        return response.data;
      }
    } catch (error) {
      this.logger.debug(
        `fetchRawContentIfNeeded failed for ${link}: ${error?.message || error}`,
      );
    }
    return null;
  }

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
    const hasUnavailablePage =
      /stellenangebot\s+(gibt\s+es\s+nicht\s+mehr|nicht\s+oder\s+nicht\s+mehr|nicht\s+mehr\s+verfügbar)/i.test(
        text,
      ) ||
      /job\s+(ist\s+)?nicht\s+mehr\s+verfügbar/i.test(text) ||
      /dieses\s+stellenangebot\s+gibt\s+es\s+nicht\s+mehr/i.test(text);
    if (hasUnavailablePage) {
      return { keep: false, reason: 'job_unavailable_page' };
    }
    const hasApplyCues =
      /\b(отклик|откликнутьс|apply|how\s+to\s+apply|send\s+(?:cv|resume)|tg:|telegram)\b/i.test(text) ||
      /@[a-z0-9_]{3,}/i.test(text) ||
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text);
    const hasSections =
      /\b(требовани|обязанност|услови|responsibilities|requirements|benefits)\b/i.test(text);

    // Hard-negative: CV/resume posts.
    const hasResumeTitle = /^(резюме|cv|resume)\b/i.test(title);
    const hasResumeWord = /\b(резюме|cv|resume)\b/i.test(text);
    const hasResumeHashtag = /#\s*(резюме|cv|resume)/i.test(text);
    const hasVacancyWord = hasVacancyWords;
    const hasResumeIntro =
      /\b(всем\s+привет|hi\s+all|hello\s+everyone|привет\s+всем|меня\s+зовут|моё\s+имя|мое\s+имя|my\s+name\s+is)\b/i.test(
        text,
      );
    const hasFirstPersonRole =
      /\bя\s+[а-яё0-9a-z][\w\s-]{0,30}?\s*(developer|engineer|designer|generalist|artist|cg|vfx|motion|3d)\b/i.test(
        text,
      );
    
    // Resume-seeking patterns (without vacancy context)
    const hasResumeSeekingPatterns =
      /\b(ищу\s+работу|ищу\s+позицию|looking\s+for\s+work|seeking\s+position|seeking\s+opportunity|open\s+to\s+opportunities|готов\s+рассмотреть|готов\s+к\s+работе|готов\s+к\s+релокации|relocation\s+ready|готов\s+к\s+переезду)\b/i.test(text);
    
    // Resume structure patterns (often appear in CV posts)
    const hasResumeStructurePatterns =
      /\b(опыт\s+работы|образование|мои\s+навыки|my\s+skills|портфолио|portfolio|готов\s+к\s+собеседованию|готов\s+к\s+интервью|готов\s+к\s+стажировке|готов\s+к\s+стажу)\b/i.test(text);
    
    // If title starts with resume word OR (has resume word AND no vacancy word) OR
    // (has seeking patterns AND no vacancy word) OR
    // (has structure patterns AND no vacancy word AND no apply cues AND no sections) OR
    // (first-person intro + роль без вакансии)
    if (
      hasResumeTitle ||
      (hasResumeWord && !hasVacancyWord) ||
      (hasResumeHashtag && !hasVacancyWord) ||
      (hasResumeSeekingPatterns && !hasVacancyWord) ||
      (hasResumeStructurePatterns && !hasVacancyWord && !hasApplyCues && !hasSections) ||
      ((hasResumeIntro || hasFirstPersonRole) && !hasVacancyWord && !hasApplyCues)
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
      const isTelegramSource =
        mapped.source?.sourceType === 'telegram' ||
        Boolean(mapped.source?.url && /t\.me/i.test(mapped.source.url));
      if (isTelegramSource) {
        // Hide obvious non-vacancy posts (promo/news/empty) coming from Telegram.
        const decision = this.isVacancyCandidate({
          title: mapped.title,
          description: mapped.description ?? null,
          tags: mapped.tags ?? null,
          link: mapped.link ?? null,
        });
        if (!decision.keep) {
          continue;
        }
      }
      out.push(mapped);
    }
    return out;
  }

  private isResumeText(text: string): boolean {
    const t = text.toLowerCase();
    return (
      /#\s*(резюме|cv|resume)/i.test(t) ||
      /\b(всем\s+привет|привет\s+всем|hello\s+everyone|hi\s+all)\b/i.test(t) ||
      /\b(меня\s+зовут|my\s+name\s+is)\b/i.test(t) ||
      /\b(ищу\s+работу|ищу\s+позицию|looking\s+for\s+work|seeking\s+position|open\s+to\s+opportunities)\b/i.test(
        t,
      )
    );
  }

  private hasFakeLocationText(text: string): boolean {
    const t = text.toLowerCase();
    return /\b(java|oop)\b/.test(t);
  }

  private hasLowSalaryText(text: string): boolean {
    const t = text.toLowerCase();
    const re = /(\d{2,4})\s*(eur|usd|gbp|chf|aud|cad|pln|czk|uah|kzt|byn|rub|rur|₽|\$|€|£)/i;
    const m = re.exec(t);
    if (!m) return false;
    const val = Number(m[1]);
    return !Number.isNaN(val) && val < 500;
  }

  /**
   * Вакансии из воронки поиска работы (отложенные и с откликами) не удаляются
   * автоматическими чистками: накопленная история нужна для чекпоинтов плана.
   */
  private readonly cleanupProtectionWhere: Prisma.JobPostingWhereInput = {
    status: { notIn: ['shortlisted', 'applied'] },
    applications: { none: {} },
  };

  async cleanupAnomalies(): Promise<{ removed: number }> {
    const all = await this.prisma.jobPosting.findMany({
      where: this.cleanupProtectionWhere,
      select: {
        id: true,
        title: true,
        description: true,
        rawContent: true,
        location: true,
        link: true,
      },
    });

    const badIds: string[] = [];
    for (const p of all) {
      const text = `${p.title ?? ''}\n${p.description ?? ''}\n${p.rawContent ?? ''}`;
      const loc = p.location ?? '';
      const isResume = this.isResumeText(text);
      const isFakeLoc = this.hasFakeLocationText(loc);
      const isLowSalary = this.hasLowSalaryText(text);
      const contentLen = (p.rawContent || p.description || '').trim().length;
      const isTooShort = contentLen > 0 && contentLen < 150;
      if (isResume || isFakeLoc || isLowSalary || isTooShort) {
        badIds.push(p.id);
      }
    }

    if (!badIds.length) {
      this.logger.log('cleanupAnomalies: no anomalies found');
      return { removed: 0 };
    }

    const chunkSize = 500;
    for (let i = 0; i < badIds.length; i += chunkSize) {
      const chunk = badIds.slice(i, i + chunkSize);
      await this.prisma.jobPosting.deleteMany({ where: { id: { in: chunk } } });
    }
    this.logger.log(`cleanupAnomalies: removed ${badIds.length} records`);
    return { removed: badIds.length };
  }

  async create(dto: CreateJobPostingDto): Promise<JobPosting> {
    const safeLink = this.validateLink(dto.link ?? null);
    const safeTitle = (dto.title ?? '').trim();
    const safeDescription = (dto.description ?? '').trim();
    const safeRawContent = (dto.rawContent ?? '').trim();

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
        rawContent: safeRawContent || safeDescription || null,
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

  /**
   * Скрейп Facebook-групп/страниц. Требует cookies живой сессии в
   * FACEBOOK_COOKIE_FILE (по умолчанию storage/facebook.cookies.txt) — без них
   * источник помечается lastError=facebook_cookies_required и пропускается.
   */
  private async scrapeFacebookSources(
    sources: Array<{ id: string; sourceType: string }>,
    dryRun: boolean,
  ): Promise<number> {
    const facebookSources = sources.filter((s) => s.sourceType === 'facebook');
    if (!facebookSources.length) {
      return 0;
    }
    if (!this.parseBooleanEnv(process.env.FACEBOOK_ENABLED, true)) {
      return 0;
    }

    const cookieHeader = this.readFacebookCookie();
    const connector = new FacebookConnector();
    const delayMs = this.parseNumberEnv(process.env.FACEBOOK_SOURCE_DELAY_MS, 3000) ?? 3000;
    let total = 0;

    for (let idx = 0; idx < facebookSources.length; idx++) {
      const source = await this.prisma.source.findFirst({
        where: { id: facebookSources[idx].id },
      });
      if (!source) {
        continue;
      }
      const metadata = (source.metadata as Record<string, unknown>) ?? {};

      if (!cookieHeader) {
        metadata.lastError = 'facebook_cookies_required';
        if (!dryRun) {
          await this.saveSourceMetadata(source.id, metadata);
        }
        this.logger.warn(
          `facebook source=${source.id} skipped: нет cookies (см. storage/facebook.cookies.txt)`,
        );
        continue;
      }

      const seenHashes = new Set(
        Array.isArray(metadata.lastHashes) ? (metadata.lastHashes as string[]) : [],
      );

      let items;
      try {
        items = await connector.fetchNewJobs({
          sourceId: source.id,
          sourceType: source.sourceType,
          url: source.url,
          metadata: { ...metadata, cookieHeader },
        });
      } catch (error) {
        const message = (error as Error)?.message ?? 'unknown_error';
        metadata.lastError = message;
        if (!dryRun) {
          await this.saveSourceMetadata(source.id, metadata);
        }
        this.logger.warn(`facebook source=${source.id} failed: ${message}`);
        continue;
      }

      const safeLinks = items
        .map((i) => this.validateLink(i.link ?? null))
        .filter((l): l is string => Boolean(l));
      const existing = await this.prisma.jobPosting.findMany({
        where: {
          sourceId: source.id,
          link: { in: safeLinks.length ? safeLinks : undefined },
        },
        select: { link: true },
      });
      const existingLinks = new Set(existing.map((e) => e.link));

      const skippedReasons: Record<string, number> = {};
      const fresh = items.filter((i) => {
        const link = this.validateLink(i.link ?? null);
        if (!link || existingLinks.has(link)) {
          return false;
        }
        if (i.hash && seenHashes.has(i.hash)) {
          return false;
        }
        const decision = this.isVacancyCandidate({
          title: i.title,
          description: i.description ?? null,
          tags: null,
          link,
        });
        if (!decision.keep) {
          skippedReasons[decision.reason] = (skippedReasons[decision.reason] ?? 0) + 1;
          return false;
        }
        return true;
      });

      if (fresh.length > 0 && !dryRun) {
        await this.prisma.jobPosting.createMany({
          data: fresh.map((i) => ({
            title: i.title,
            description: i.description ?? null,
            rawContent: i.description ?? null,
            link: this.validateLink(i.link ?? null),
            sourceId: source.id,
            status: 'new' as JobStatus,
            publishedAt: i.publishedAt ?? null,
          })),
        });
      }
      total += fresh.length;

      if (!dryRun) {
        const newHashes = [
          ...Array.from(seenHashes),
          ...items.map((i) => i.hash).filter((h): h is string => Boolean(h)),
        ].slice(-300);
        await this.saveSourceMetadata(source.id, {
          ...metadata,
          lastHashes: newHashes,
          lastScrapedAt: new Date().toISOString(),
          emptyRuns: fresh.length > 0 ? 0 : ((metadata.emptyRuns as number) ?? 0) + 1,
          lastError: null,
        });
      }

      this.logger.log(
        `facebook scrape source=${source.id} new=${fresh.length} fetched=${items.length} dryRun=${dryRun} skippedReasons=${JSON.stringify(skippedReasons)}`,
      );

      if (idx < facebookSources.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return total;
  }

  /** Cookie-строка сессии Facebook из файла (форматы: raw, "Cookie: ...", JSON [{name,value}]) */
  private readFacebookCookie(): string | null {
    const filePath = path.resolve(
      process.cwd(),
      process.env.FACEBOOK_COOKIE_FILE || 'storage/facebook.cookies.txt',
    );
    try {
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      if (!raw) {
        return null;
      }
      if (raw.startsWith('[') || raw.startsWith('{')) {
        const parsed = JSON.parse(raw) as
          | Array<{ name?: string; value?: string }>
          | { cookies?: Array<{ name?: string; value?: string }> };
        const list = Array.isArray(parsed) ? parsed : (parsed.cookies ?? []);
        const pairs = list
          .filter((c) => c?.name && c?.value !== undefined)
          .map((c) => `${c.name}=${c.value}`);
        return pairs.length ? pairs.join('; ') : null;
      }
      const line = raw.split('\n')[0].trim();
      return line.replace(/^Cookie:\s*/i, '') || null;
    } catch {
      return null;
    }
  }

  async updateStatus(id: string, status: string): Promise<JobPosting> {
    const allowed = ['new', 'shortlisted', 'applied', 'archived'];
    if (!allowed.includes(status)) {
      throw new BadRequestException(`Недопустимый статус. Допустимы: ${allowed.join(', ')}`);
    }
    try {
      const updated = await this.prisma.jobPosting.update({
        where: { id },
        data: { status },
      });
      return this.mapJob(updated);
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
    
    // Чтение настроек из переменных окружения для Telegram
    const sourceDelayMs = Number(process.env.TELEGRAM_SOURCE_DELAY_MS) || 2000;
    const sourceJitterMs = Number(process.env.TELEGRAM_SOURCE_JITTER_MS) || 1000;
    const pageDelayMs = Number(process.env.TELEGRAM_PAGE_DELAY_MS) || 1000;
    const pageJitterMs = Number(process.env.TELEGRAM_PAGE_JITTER_MS) || 500;
    const blockDurationHours = Number(process.env.TELEGRAM_BLOCK_DURATION_HOURS) || 2;
    const max429Retry = Number(process.env.TELEGRAM_MAX_429_RETRY) || 5;
    const useProxyRotation = process.env.TELEGRAM_USE_PROXY_ROTATION === 'true' || process.env.TELEGRAM_USE_PROXY_ROTATION === '1';
    const emptyWarnThreshold = Number(process.env.TELEGRAM_EMPTY_RUNS_WARN ?? 3);
    const emptyPauseThreshold = Number(process.env.TELEGRAM_EMPTY_RUNS_PAUSE ?? 5);
    const emptyDisableThreshold = Number(process.env.TELEGRAM_EMPTY_RUNS_DISABLE ?? 40);
    const blockStrikeLimit = Number(process.env.TELEGRAM_BLOCK_STRIKE_LIMIT ?? 5);
    const inactiveCooldownHours = Number(process.env.TELEGRAM_INACTIVE_COOLDOWN_HOURS ?? 24);
    const rotateOnResume = process.env.TELEGRAM_ROTATE_ON_RESUME !== 'false';
    
    // Чтение настроек из переменных окружения для RSS
    const rssSourceDelayMs = Number(process.env.RSS_SOURCE_DELAY_MS) || 2000;
    const rssSourceJitterMs = Number(process.env.RSS_SOURCE_JITTER_MS) || 1000;
    const rssMaxItems = Number(process.env.RSS_MAX_ITEMS) || 50;
    const rssUseProxyRotation =
      process.env.RSS_USE_PROXY_ROTATION !== 'false' && process.env.RSS_USE_PROXY_ROTATION !== '0';
    
    const sources = await this.prisma.source.findMany({
      where: sourceId ? { id: sourceId } : undefined,
    });
    if (!sources.length) {
      return { status: 'no_sources', count: 0 };
    }

    const connector = new TelegramHttpConnector();
    let total = 0;
    const telegramSources = sources.filter((s) => s.sourceType === 'telegram');

    for (let idx = 0; idx < telegramSources.length; idx++) {
      // Перезагружаем источник из базы для получения актуальных метаданных
      // Используем findFirst с принудительным обновлением через select
      const freshSource = await this.prisma.source.findFirst({
        where: { id: telegramSources[idx].id },
        select: {
          id: true,
          name: true,
          url: true,
          sourceType: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!freshSource) {
        continue;
      }
      const source = freshSource;
      const metadata = (source.metadata as Record<string, unknown>) ?? {};
      const now = new Date();
      const stopUntilStr = metadata.stopUntil as string | undefined;
      const stopUntil = stopUntilStr ? new Date(stopUntilStr) : null;
      if (stopUntil && stopUntil <= now) {
        delete metadata.stopUntil;
        delete metadata.lastError;
        metadata.blockStrikes = 0;
        await this.saveSourceMetadata(source.id, metadata);
        this.logger.log(`telegram source=${source.id} resumed after stop window`);
        if (rotateOnResume && useProxyRotation) {
          const resumedProxy = await this.proxyManager.getNext();
          if (resumedProxy) {
            this.applyProxyMetadata(metadata, resumedProxy as ProxyWithExtras);
            await this.saveSourceMetadata(source.id, metadata);
            this.logger.debug(
              `telegram source=${source.id} reassigned proxy=${resumedProxy.id} after stop window`,
            );
          }
        }
      }
      if (stopUntil && stopUntil > new Date()) {
        // Логируем для отладки - проверяем, откуда берутся блокировки
        this.logger.warn(
          `telegram source=${source.id} skipped until ${stopUntil.toISOString()} (loaded from DB: ${JSON.stringify(stopUntilStr)})`,
        );
        continue;
      }

      const inactiveFlag = metadata.inactive === true;
      const inactiveUntilStr = metadata.inactiveUntil as string | undefined;
      const inactiveUntil = inactiveUntilStr ? new Date(inactiveUntilStr) : null;
      if (inactiveFlag) {
        if (inactiveUntil && inactiveUntil <= now) {
          metadata.inactive = false;
          delete metadata.inactiveReason;
          delete metadata.inactiveUntil;
          metadata.emptyRuns = 0;
          await this.saveSourceMetadata(source.id, metadata);
          this.logger.log(`telegram source=${source.id} reactivated after cooldown`);
        } else {
          const untilLabel = inactiveUntil ? inactiveUntil.toISOString() : 'manual review';
          this.logger.warn(
            `telegram source=${source.id} inactive, next check after ${untilLabel}`,
          );
          continue;
        }
      }
      // Логируем успешную загрузку без блокировок (только первые 3 для отладки)
      if (idx < 3) {
        this.logger.debug(`telegram source=${source.id} no stopUntil, proceeding`);
      }
      
      // Автоматическое назначение прокси, если включена ротация и прокси не назначен
      if (useProxyRotation && !metadata.proxyId) {
        const proxy = await this.proxyManager.getNext();
        if (proxy) {
          this.applyProxyMetadata(metadata, proxy as ProxyWithExtras);
          // Обновляем метаданные в базе
          await this.prisma.source.update({
            where: { id: source.id },
            data: { metadata: metadata as Prisma.InputJsonValue },
          });
          this.logger.debug(`telegram source=${source.id} assigned proxy=${proxy.id}`);
        }
      } else if (useProxyRotation && metadata.proxyId && !metadata.userAgent) {
        await this.hydrateProxyMetadata(metadata);
      }
      
      // Установка дефолтных задержек, если не заданы в метаданных
      if (typeof metadata.delayMs !== 'number') {
        metadata.delayMs = pageDelayMs;
      }
      if (typeof metadata.jitterMs !== 'number') {
        metadata.jitterMs = pageJitterMs;
      }
      if (typeof metadata.max429Retry !== 'number') {
        metadata.max429Retry = max429Retry;
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
          
          // Пробуем получить новый прокси, если включена ротация
          let newProxy = null;
          if (useProxyRotation) {
            newProxy = await this.proxyManager.getNext();
            if (newProxy) {
              this.applyProxyMetadata(metadata, newProxy as ProxyWithExtras);
              this.logger.debug(`telegram source=${source.id} rotated to proxy=${newProxy.id}`);
            }
          }
          
          const blockDurationMs = blockDurationHours * 60 * 60 * 1000;
          const inactiveCooldownMs = inactiveCooldownHours * 60 * 60 * 1000;
          const strikes =
            (typeof metadata.blockStrikes === 'number' ? (metadata.blockStrikes as number) : 0) + 1;
          metadata.blockStrikes = strikes;
          metadata.lastError = `proxy_block_${error.status}`;
          metadata.stopUntil = new Date(Date.now() + blockDurationMs).toISOString();
          if (strikes >= blockStrikeLimit) {
            metadata.inactive = true;
            metadata.inactiveReason = 'block_strikes';
            if (inactiveCooldownHours > 0) {
              metadata.inactiveUntil = new Date(Date.now() + inactiveCooldownMs).toISOString();
            }
            this.logger.warn(
              `telegram source=${source.id} deactivated after ${strikes} proxy blocks`,
            );
          }
          await this.saveSourceMetadata(source.id, metadata);
          this.logger.warn(
            `telegram source=${source.id} proxy blocked status=${error.status}, paused for ${blockDurationHours}h`,
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
        const blockDurationMs = blockDurationHours * 60 * 60 * 1000;
        const inactiveCooldownMs = inactiveCooldownHours * 60 * 60 * 1000;
        metadata.emptyRuns = nextEmpty;
        metadata.lastScrapedAt = new Date().toISOString();

        if (nextEmpty >= emptyDisableThreshold) {
          metadata.inactive = true;
          metadata.inactiveReason = 'empty_runs';
          if (inactiveCooldownHours > 0) {
            metadata.inactiveUntil = new Date(Date.now() + inactiveCooldownMs).toISOString();
          }
          this.logger.warn(
            `telegram source=${source.id} deactivated due to ${nextEmpty} empty runs`,
          );
        } else if (nextEmpty >= emptyPauseThreshold) {
          metadata.stopUntil = new Date(Date.now() + blockDurationMs).toISOString();
          metadata.lastError = 'no_new_many_runs';
        }

        await this.saveSourceMetadata(source.id, metadata);
        if (nextEmpty >= emptyWarnThreshold) {
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
          rawContent: desc || null,
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
          description: p.rawContent ?? p.description ?? null,
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
            rawContent: p.rawContent ?? p.description ?? null,
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
              blockStrikes: 0,
            } as Prisma.InputJsonValue,
          },
        });
      }

      this.logger.log(
        `telegram scrape source=${source.id} new=${vacancyPayloads.length} skipped=${skippedPayloads.length} total=${total} lastMessage=${maxSeen} dryRun=${dryRun} skippedReasons=${JSON.stringify(skippedReasons)}`,
      );
      
      // Задержка между источниками для снижения нагрузки на Telegram API
      if (idx < telegramSources.length - 1) {
        const jitter = Math.floor(Math.random() * sourceJitterMs);
        await new Promise((resolve) => setTimeout(resolve, sourceDelayMs + jitter));
      }
    }

    // Обработка Facebook источников (группы/страницы, нужны cookies сессии)
    const facebookCount = await this.scrapeFacebookSources(sources, dryRun);
    if (facebookCount > 0) {
      total += facebookCount;
    }

    // Обработка RSS источников
    const rssConnector = new RssConnector();
    const rssSources = sources.filter((s) => s.sourceType === 'rss');

    for (let idx = 0; idx < rssSources.length; idx++) {
      // Перезагружаем источник из базы для получения актуальных метаданных
      const freshSource = await this.prisma.source.findFirst({
        where: { id: rssSources[idx].id },
        select: {
          id: true,
          name: true,
          url: true,
          sourceType: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!freshSource) {
        continue;
      }
      const source = freshSource;
      const metadata = (source.metadata as Record<string, unknown>) ?? {};
      const stopUntilStr = metadata.stopUntil as string | undefined;
      const stopUntil = stopUntilStr ? new Date(stopUntilStr) : null;
      if (stopUntil && stopUntil > new Date()) {
        this.logger.warn(`rss source=${source.id} skipped until ${stopUntil.toISOString()}`);
        continue;
      }

      // Автоматическое назначение прокси, если включена ротация и прокси не назначен
      if (rssUseProxyRotation && !metadata.proxyId) {
        const proxy = await this.proxyManager.getNext();
        if (proxy) {
          this.applyProxyMetadata(metadata, proxy as ProxyWithExtras);
          await this.prisma.source.update({
            where: { id: source.id },
            data: { metadata: metadata as Prisma.InputJsonValue },
          });
          this.logger.debug(`rss source=${source.id} assigned proxy=${proxy.id}`);
        }
      } else if (rssUseProxyRotation && metadata.proxyId && !metadata.userAgent) {
        await this.hydrateProxyMetadata(metadata);
      }

      // Установка дефолтных значений
      if (typeof metadata.maxItems !== 'number') {
        metadata.maxItems = rssMaxItems;
      }

      const seenHashes = new Set(
        Array.isArray(metadata.lastHashes) ? (metadata.lastHashes as string[]) : [],
      );
      const emptyRuns = typeof metadata.emptyRuns === 'number' ? metadata.emptyRuns : 0;

      let items;
      try {
        items = await rssConnector.fetchNewJobs({
          sourceId: source.id,
          sourceType: source.sourceType,
          url: source.url ?? null,
          metadata: metadata,
        });
      } catch (error) {
        if (error instanceof ProxyBlockedError) {
          await this.handleProxyBlock(metadata, error);
          if (rssUseProxyRotation) {
            const nextProxy = await this.proxyManager.getNext();
            if (nextProxy) {
              this.applyProxyMetadata(metadata, nextProxy as ProxyWithExtras);
              this.logger.warn(
                `rss source=${source.id} rotated proxy=${nextProxy.id} after blockage status=${error.status}`,
              );
            }
          }
          const blockDurationMs = blockDurationHours * 60 * 60 * 1000;
          await this.prisma.source.update({
            where: { id: source.id },
            data: {
              metadata: {
                ...(metadata ?? {}),
                lastError: `proxy_block_${error.status}`,
                stopUntil: new Date(Date.now() + blockDurationMs).toISOString(),
              } as Prisma.InputJsonValue,
            },
          });
          this.logger.warn(
            `rss source=${source.id} proxy blocked status=${error.status}, paused for ${blockDurationHours}h`,
          );
          lastError = `proxy_block_${error.status}`;
          continue;
        }
        const err = error as Error;
        this.logger.error(`rss source=${source.id} failed`, err);
        lastError = err.message ?? null;

        // Установка блокировки при критических ошибках
        if (err.message.includes('not found') || err.message.includes('forbidden')) {
          const isNotFound = err.message.includes('not found');
          const blockDurationMs = isNotFound
            ? 30 * 24 * 60 * 60 * 1000 // 30 дней для удалённых/несуществующих фидов
            : blockDurationHours * 60 * 60 * 1000;
          await this.prisma.source.update({
            where: { id: source.id },
            data: {
              metadata: {
                ...(metadata ?? {}),
                lastError: `rss_error_${isNotFound ? '404' : '403'}`,
                feedRemoved: isNotFound ? true : (metadata as Record<string, unknown>)?.feedRemoved,
                stopUntil: new Date(Date.now() + blockDurationMs).toISOString(),
              } as Prisma.InputJsonValue,
            },
          });
          this.logger.warn(
            `rss source=${source.id} blocked due to error (${isNotFound ? '404' : '403'}), paused for ${Math.round(blockDurationMs / (60 * 60 * 1000))}h`,
          );
        }
        continue;
      }

      if (!items.length) {
        const nextEmpty = emptyRuns + 1;
        const blockDurationMs = blockDurationHours * 60 * 60 * 1000;
        const stopFlag =
          nextEmpty >= 5
            ? {
                stopUntil: new Date(Date.now() + blockDurationMs).toISOString(),
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
          this.logger.warn(`rss source=${source.id} zero new items for ${nextEmpty} runs`);
        }
        continue;
      }

      const fallbackLink = (i: typeof items[number]) => i.link ?? null;

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

      // Фильтрация по дате публикации: только вакансии не старше 2 недель
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const recentItems = items.filter((i) => {
        if (!i.publishedAt) {
          // Если дата публикации отсутствует, пропускаем
          return false;
        }
        const publishedDate = i.publishedAt instanceof Date ? i.publishedAt : new Date(i.publishedAt);
        if (isNaN(publishedDate.getTime())) {
          return false;
        }
        return publishedDate >= twoWeeksAgo;
      });

      // Использование vacancy-parser для извлечения структурированных данных
      const candidates: ScrapeCandidatePayload[] = await Promise.all(
        recentItems.map(async (i) => {
          const fallbackText = `${i.title}\n${i.description || ''}`;
          let rawCandidate =
            i.rawContent && i.rawContent.trim().length > 0 ? i.rawContent : i.description || null;
          if (!rawCandidate || rawCandidate.trim().length < RAW_TEXT_MIN_LENGTH) {
            const fetched = await this.fetchRawContentIfNeeded(i.link);
            if (fetched) {
              rawCandidate = fetched;
            }
          }
          const textForParsing =
            rawCandidate && rawCandidate.trim().length > 0 ? rawCandidate : fallbackText;
          const parsed = parseVacancy(textForParsing, {
            sourceUrl: i.link || null,
            pageTitle: i.title,
          });

          const link = this.validateLink(fallbackLink(i));
          return {
            title: parsed.title?.value || i.title,
            description: i.description || null, // исходный фрагмент из RSS
            rawContent: rawCandidate || null,
            company: parsed.company?.name || i.company || null,
            location:
              parsed.location?.value?.city ||
              parsed.location?.value?.country ||
              i.location ||
              null,
            link,
            sourceId: source.id,
            status: 'new' as JobStatus,
            tags: i.tags ?? null,
            publishedAt: i.publishedAt ?? null,
            hash: i.hash ?? null,
          };
        }),
      );

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
          description: p.rawContent ?? p.description ?? null,
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
            rawContent: p.rawContent ?? p.description ?? null,
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

      const lastItemId = items.length > 0 ? items[0].hash || items[0].link || '' : metadata.lastItemId || '';

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
              lastItemId: lastItemId,
              lastHashes: newHashes,
              lastScrapedAt: new Date().toISOString(),
              emptyRuns: 0,
              stopUntil: null,
              lastError: null,
            } as Prisma.InputJsonValue,
          },
        });
      }

      this.logger.log(
        `rss scrape source=${source.id} new=${vacancyPayloads.length} skipped=${skippedPayloads.length} total=${total} lastItem=${lastItemId} dryRun=${dryRun} skippedReasons=${JSON.stringify(skippedReasons)}`,
      );

      // Задержка между RSS источниками
      if (idx < rssSources.length - 1) {
        const jitter = Math.floor(Math.random() * rssSourceJitterMs);
        await new Promise((resolve) => setTimeout(resolve, rssSourceDelayMs + jitter));
      }
    }

    // Очистка старых RSS вакансий (старше 2 недель) после обработки всех RSS источников
    if (rssSources.length > 0 && !dryRun) {
      await this.cleanupOldRssJobPostings();
    }

    const arbeitsagenturCount = await this.scrapeArbeitsagenturJobs(dryRun);
    if (arbeitsagenturCount > 0) {
      total += arbeitsagenturCount;
    }

    const remotiveCount = await this.scrapeRemotiveJobs(dryRun);
    if (remotiveCount > 0) {
      total += remotiveCount;
    }

    const remoteOkCount = await this.scrapeRemoteOkJobs(dryRun);
    if (remoteOkCount > 0) {
      total += remoteOkCount;
    }

    const jobicyCount = await this.scrapeJobicyJobs(dryRun);
    if (jobicyCount > 0) {
      total += jobicyCount;
    }

    const findworkCount = await this.scrapeFindworkJobs(dryRun);
    if (findworkCount > 0) {
      total += findworkCount;
    }

    const devitjobsCount = await this.scrapeDevitjobsUkJobs(dryRun);
    if (devitjobsCount > 0) {
      total += devitjobsCount;
    }

    const arbeitnowCount = await this.scrapeArbeitnowJobs(dryRun);
    if (arbeitnowCount > 0) {
      total += arbeitnowCount;
    }

    const themuseCount = await this.scrapeTheMuseJobs(dryRun);
    if (themuseCount > 0) {
      total += themuseCount;
    }

    const durationMs = Date.now() - started;
    if (total === 0) {
      this.logger.warn(`scrape finished with no new items in ${durationMs}ms`);
    }

    // Глобальная уборка: удаляем недоступные и устаревшие вакансии
    if (!dryRun) {
      await this.cleanupUnavailableAndOldJobs();
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

  /**
   * Публичный триггер для периодической уборки устаревших/недоступных вакансий.
   */
  async cleanupStaleJobs(): Promise<void> {
    await this.cleanupUnavailableAndOldJobs();
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

  private async saveSourceMetadata(sourceId: string, metadata: Record<string, unknown>): Promise<void> {
    await this.prisma.source.update({
      where: { id: sourceId },
      data: {
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  private async handleProxyBlock(metadata: Record<string, unknown>, error: ProxyBlockedError) {
    const proxyId = metadata.proxyId as string | undefined;
    if (proxyId) {
      await this.proxyManager.markBlocked(proxyId, error.status);
    }
    this.clearProxyMetadata(metadata);
  }

  private applyProxyMetadata(metadata: Record<string, unknown>, proxy: ProxyWithExtras): void {
    metadata.proxyId = proxy.id;
    metadata.proxyHost = proxy.host;
    metadata.proxyPort = proxy.port;

    if (proxy.username) {
      metadata.proxyUsername = proxy.username;
    } else {
      delete metadata.proxyUsername;
    }

    if (proxy.password) {
      metadata.proxyPassword = proxy.password;
    } else {
      delete metadata.proxyPassword;
    }

    if (proxy.userAgent) {
      metadata.userAgent = proxy.userAgent;
    } else {
      delete metadata.userAgent;
    }

    if (proxy.cookieHeader) {
      metadata.cookieHeader = proxy.cookieHeader;
      const headers =
        (metadata.headers as Record<string, string> | undefined) !== undefined
          ? { ...(metadata.headers as Record<string, string>) }
          : {};
      headers['Cookie'] = proxy.cookieHeader;
      metadata.headers = headers;
    } else {
      delete metadata.cookieHeader;
      if (metadata.headers) {
        const headers = { ...(metadata.headers as Record<string, string>) };
        if (headers['Cookie']) {
          delete headers['Cookie'];
        }
        if (Object.keys(headers).length) {
          metadata.headers = headers;
        } else {
          delete metadata.headers;
        }
      }
    }
  }

  private clearProxyMetadata(metadata: Record<string, unknown>): void {
    delete metadata.proxyId;
    delete metadata.proxyHost;
    delete metadata.proxyPort;
    delete metadata.proxyUsername;
    delete metadata.proxyPassword;
    delete metadata.userAgent;
    delete metadata.cookieHeader;
    if (metadata.headers) {
      const nextHeaders = { ...(metadata.headers as Record<string, string>) };
      if (nextHeaders['Cookie']) {
        delete nextHeaders['Cookie'];
      }
      if (Object.keys(nextHeaders).length) {
        metadata.headers = nextHeaders;
      } else {
        delete metadata.headers;
      }
    }
  }

  private async hydrateProxyMetadata(metadata: Record<string, unknown>): Promise<void> {
    const proxyId = metadata.proxyId as string | undefined;
    if (!proxyId) {
      return;
    }
    if (metadata.userAgent) {
      return;
    }
    const proxy = await this.prisma.proxy.findUnique({
      where: { id: proxyId },
    });
    if (proxy) {
      this.applyProxyMetadata(metadata, proxy as ProxyWithExtras);
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
      const cookieHeader = meta.cookieHeader as string | undefined;
      const headers: Record<string, string> = { 'user-agent': userAgent };
      if (cookieHeader) {
        headers['Cookie'] = cookieHeader;
      }

      const resp = await axios.get(url, {
        headers,
        timeout: 15000,
        proxy:
          proxyHost && proxyPort
            ? {
                host: proxyHost,
                port: proxyPort,
                protocol: 'http',
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

  private async enrichDescriptionsFromLinks<T extends { link?: string | null; description?: string | null; rawContent?: string | null }>(
    jobs: T[],
    options?: { minLength?: number; concurrency?: number },
  ): Promise<void> {
    const minLength = options?.minLength ?? 400;
    const concurrency = Math.max(1, Math.min(options?.concurrency ?? 4, 8));
    const targets = jobs.filter((job) =>
      this.shouldFetchFullContent(job.description ?? null, job.link ?? null, minLength),
    );
    if (!targets.length) {
      return;
    }
    const queue = [...targets];
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () =>
      (async () => {
        while (queue.length) {
          const job = queue.shift();
          if (!job || !job.link) {
            continue;
          }
          const text = await this.fetchJobPageText(job.link);
          if (text && text.length >= Math.max(200, minLength / 2)) {
            job.description = text;
            job.rawContent = text;
          }
        }
      })(),
    );
    await Promise.all(workers);
  }

  private shouldFetchFullContent(description: string | null, link: string | null, minLength: number): boolean {
    if (!link) {
      return false;
    }
    const normalized = (description ?? '').trim();
    if (!normalized) {
      return true;
    }
    if (normalized.length < minLength) {
      return true;
    }
    if (/https?:\/\/[^\s]+/i.test(normalized) && normalized.length < minLength * 2) {
      return true;
    }
    return false;
  }

  private async fetchJobPageText(url: string): Promise<string | null> {
    const directAttempt = await this.tryFetchJobPage(url);
    if (directAttempt?.text) {
      return directAttempt.text;
    }

    const shouldRetryWithProxy =
      directAttempt?.blocked ||
      (directAttempt?.status && [403, 401, 429].includes(directAttempt.status));
    if (!shouldRetryWithProxy) {
      return null;
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const proxy = await this.proxyManager.getNext();
      if (!proxy) {
        break;
      }
      const proxied = await this.tryFetchJobPage(url, proxy);
      if (proxied?.text) {
        return proxied.text;
      }
      if (proxied?.blocked && proxy.id) {
        await this.proxyManager.markBad(proxy.id, `job_fetch_blocked_${proxied.status ?? 'unknown'}`);
      }
    }

    return null;
  }

  private async tryFetchJobPage(
    url: string,
    proxy?: ProxyWithExtras | null,
  ): Promise<{ text?: string; blocked?: boolean; status?: number } | null> {
    try {
      const headers: Record<string, string> = {
        'User-Agent': proxy?.userAgent || JOB_PAGE_FETCH_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      };
      if (proxy?.cookieHeader) {
        headers['Cookie'] = proxy.cookieHeader;
      }
      const response = await axios.get<string>(url, {
        timeout: 20000,
        responseType: 'text',
        maxRedirects: 5,
        headers,
        proxy: proxy
          ? {
              host: proxy.host,
              port: proxy.port,
              protocol: 'http',
              auth:
                proxy.username && proxy.password
                  ? {
                      username: proxy.username,
                      password: proxy.password,
                    }
                  : undefined,
            }
          : undefined,
        validateStatus: (status) => status >= 200 && status < 400,
      });
      const html = typeof response.data === 'string' ? response.data : '';
      if (!html) {
        return { status: response.status };
      }
      if (this.detectHtmlChallenge(html)) {
        return { blocked: true, status: response.status };
      }
      const text = this.extractVisibleText(html);
      return text ? { text, status: response.status } : { status: response.status };
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const blocked = Boolean(status && [401, 403, 429].includes(status));
      this.logger.debug(
        `[job-content] ${proxy ? `proxy=${proxy.id}` : 'direct'} fetch failed ${url}: ${
          (error as Error)?.message ?? error
        }`,
      );
      return { blocked, status };
    }
  }

  private extractVisibleText(html: string): string | null {
    if (!html) {
      return null;
    }
    try {
      const $ = load(html);
      $('script, style, noscript, iframe, svg, header, footer, nav').remove();
      const candidates = [
        'article',
        'main',
        '[role="main"]',
        '.job-description',
        '.job__description',
        '.description',
        '.content',
      ];
      for (const selector of candidates) {
        const section = $(selector).first();
        if (section && section.length) {
          const text = this.normalizeWhitespace(section.text());
          if (text.length >= 200) {
            return text;
          }
        }
      }
      const bodyText = $('body').text();
      return this.normalizeWhitespace(bodyText);
    } catch {
      return this.normalizeWhitespace(html.replace(/<[^>]+>/g, ' '));
    }
  }

  private normalizeWhitespace(text: string): string {
    return (text ?? '').replace(/\s+/g, ' ').trim();
  }

  private detectHtmlChallenge(html: string): boolean {
    const lower = (html ?? '').toLowerCase();
    if (!lower) {
      return false;
    }
    return (
      lower.includes('cf-ray') ||
      lower.includes('cf-mitigated') ||
      lower.includes('cloudflare') && lower.includes('challenge') ||
      lower.includes('just a moment') ||
      lower.includes('security check') ||
      lower.includes('captcha')
    );
  }

  private mapJob(j: {
    id: string;
    title: string;
    description: string | null;
    rawContent: string | null;
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
      rawContent: j.rawContent ?? null,
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

  private parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined || value === null) {
      return fallback;
    }
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }
    return fallback;
  }

  private parseNumberEnv(value: string | undefined, fallback?: number): number | undefined {
    if (value === undefined || value === null || value === '') {
      return fallback;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return parsed;
  }

  private async scrapeArbeitsagenturJobs(dryRun: boolean): Promise<number> {
    const enabled = this.parseBooleanEnv(process.env.ARBEITSAGENTUR_ENABLED, false);
    if (!enabled) {
      return 0;
    }

    const days = this.parseNumberEnv(process.env.ARBEITSAGENTUR_DAYS, 14) ?? 14;
    const pageSize = this.parseNumberEnv(process.env.ARBEITSAGENTUR_PAGE_SIZE);
    const maxPages = this.parseNumberEnv(process.env.ARBEITSAGENTUR_MAX_PAGES);
    const detailConcurrency = this.parseNumberEnv(process.env.ARBEITSAGENTUR_DETAIL_CONCURRENCY);
    const includeDetails = this.parseBooleanEnv(process.env.ARBEITSAGENTUR_FETCH_DETAILS, true);
    const excludeZeitarbeit = this.parseBooleanEnv(
      process.env.ARBEITSAGENTUR_EXCLUDE_ZEITARBEIT,
      true,
    );

    const connector = new ArbeitsagenturConnector({
      apiKey: process.env.ARBEITSAGENTUR_API_KEY || undefined,
      baseUrl: process.env.ARBEITSAGENTUR_BASE_URL || undefined,
      detailConcurrency: detailConcurrency ?? undefined,
      logger: {
        debug: (message: string) => this.logger.debug(message),
        warn: (message: string) => this.logger.warn(message),
        error: (message: string) => this.logger.error(message),
      },
    });

    let jobs: ArbeitsagenturJob[] = [];
    try {
      jobs = await connector.fetchRecentJobs({
        days,
        pageSize: pageSize ?? undefined,
        maxPages: maxPages ?? undefined,
        includeDetails,
        excludeZeitarbeit,
      });
    } catch (error) {
      this.logger.error(
        `arbeitsagentur scrape failed: ${(error as Error)?.message ?? 'unknown error'}`,
        error as Error,
      );
      return 0;
    }

    if (!jobs.length) {
      this.logger.debug('arbeitsagentur scrape returned no jobs');
      if (!dryRun) {
        const source = await this.ensureArbeitsagenturSource();
        await this.cleanupArbeitsagenturJobPostings(source.id);
      }
      return 0;
    }

    const source = await this.ensureArbeitsagenturSource();
    const existing = await this.prisma.jobPosting.findMany({
      where: {
        sourceId: source.id,
        link: { in: jobs.map((job) => job.link) },
      },
      select: { link: true },
    });
    const existingLinks = new Set(existing.map((item) => item.link));
    const freshJobs = jobs.filter((job) => !existingLinks.has(job.link));
    if (!freshJobs.length) {
      if (!dryRun) {
        await this.cleanupArbeitsagenturJobPostings(source.id);
      }
      this.logger.debug('arbeitsagentur scrape: no new records to insert');
      return 0;
    }

    await this.enrichDescriptionsFromLinks(freshJobs);

    const count = freshJobs.length;
    if (dryRun) {
      this.logger.log(
        `arbeitsagentur scrape dry-run new=${count} skipped=${jobs.length - count}`,
      );
      return count;
    }

    await this.prisma.jobPosting.createMany({
      data: freshJobs.map((job) => ({
        title: job.title,
        description: job.description,
        rawContent: job.description,
        company: job.company,
        location: job.location,
        link: job.link,
        sourceId: source.id,
        status: 'new' as JobStatus,
        tags: job.tags,
        publishedAt: job.publishedAt,
      })),
    });
    this.logger.log(
      `arbeitsagentur scrape inserted=${count} skipped=${jobs.length - count} days=${days}`,
    );
    await this.cleanupArbeitsagenturJobPostings(source.id);
    return count;
  }

  private async ensureArbeitsagenturSource() {
    const existing = await this.prisma.source.findFirst({
      where: { sourceType: 'arbeitsagentur' },
    });
    if (existing) {
      return existing;
    }
    return await this.prisma.source.create({
      data: {
        name: 'Arbeitsagentur Jobsuche',
        sourceType: 'arbeitsagentur',
        url: 'https://con.arbeitsagentur.de/prod/jobboerse/jobsuche-ui/',
        metadata: {
          description: 'Bundesagentur für Arbeit Jobsuche API',
          autoManaged: true,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private async cleanupArbeitsagenturJobPostings(sourceId: string): Promise<void> {
    const maxAgeDays = this.parseNumberEnv(process.env.ARBEITSAGENTUR_MAX_AGE_DAYS, 14) ?? 14;
    if (maxAgeDays <= 0) {
      return;
    }
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.jobPosting.deleteMany({
      where: {
        sourceId,
        ...this.cleanupProtectionWhere,
        OR: [
          { publishedAt: { lt: cutoff } },
          { publishedAt: null, createdAt: { lt: cutoff } },
        ],
      },
    });
    if (result.count > 0) {
      this.logger.log(
        `Arbeitsagentur cleanup removed ${result.count} jobs older than ${maxAgeDays}d`,
      );
    }
  }

  private async scrapeRemotiveJobs(dryRun: boolean): Promise<number> {
    const enabled = this.parseBooleanEnv(process.env.REMOTIVE_ENABLED, false);
    if (!enabled) {
      return 0;
    }

    const days = this.parseNumberEnv(process.env.REMOTIVE_DAYS, 14) ?? 14;
    const perPage = this.parseNumberEnv(process.env.REMOTIVE_PAGE_SIZE, 100);
    const maxPages = this.parseNumberEnv(process.env.REMOTIVE_MAX_PAGES, 5);
    const category = process.env.REMOTIVE_CATEGORY || undefined;
    const search = process.env.REMOTIVE_SEARCH || undefined;
    const companySlug = process.env.REMOTIVE_COMPANY || undefined;

    const connector = new RemotiveConnector({
      baseUrl: process.env.REMOTIVE_BASE_URL || undefined,
      logger: {
        debug: (message: string) => this.logger.debug(message),
        warn: (message: string) => this.logger.warn(message),
        error: (message: string) => this.logger.error(message),
      },
    });

    let jobs: RemotiveJob[] = [];
    try {
      jobs = await connector.fetchRecentJobs({
        days,
        perPage: perPage ?? undefined,
        maxPages: maxPages ?? undefined,
        category,
        search,
        companySlug,
      });
    } catch (error) {
      this.logger.error(
        `remotive scrape failed: ${(error as Error)?.message ?? 'unknown error'}`,
        error as Error,
      );
      return 0;
    }

    if (!jobs.length) {
      if (!dryRun) {
        const source = await this.ensureRemotiveSource();
        await this.cleanupRemotiveJobPostings(source.id);
      }
      return 0;
    }

    const source = await this.ensureRemotiveSource();
    const existing = await this.prisma.jobPosting.findMany({
      where: {
        sourceId: source.id,
        link: { in: jobs.map((job) => job.link) },
      },
      select: { link: true },
    });
    const existingLinks = new Set(existing.map((item) => item.link));
    const freshJobs = jobs.filter((job) => !existingLinks.has(job.link));
    if (!freshJobs.length) {
      if (!dryRun) {
        await this.cleanupRemotiveJobPostings(source.id);
      }
      this.logger.debug('remotive scrape: no new records to insert');
      return 0;
    }

    await this.enrichDescriptionsFromLinks(freshJobs);

    const count = freshJobs.length;
    if (dryRun) {
      this.logger.log(`remotive scrape dry-run new=${count} skipped=${jobs.length - count}`);
      return count;
    }

    await this.prisma.jobPosting.createMany({
      data: freshJobs.map((job) => ({
        title: job.title,
        description: job.description,
        rawContent: job.description,
        company: job.company,
        location: job.location,
        link: job.link,
        sourceId: source.id,
        status: 'new' as JobStatus,
        tags: job.tags,
        publishedAt: job.publishedAt,
      })),
    });
    this.logger.log(
      `remotive scrape inserted=${count} skipped=${jobs.length - count} days=${days}`,
    );
    await this.cleanupRemotiveJobPostings(source.id);
    return count;
  }

  private async ensureRemotiveSource() {
    const existing = await this.prisma.source.findFirst({
      where: { sourceType: 'remotive' },
    });
    if (existing) {
      return existing;
    }
    return await this.prisma.source.create({
      data: {
        name: 'Remotive Public API',
        sourceType: 'remotive',
        url: 'https://remotive.com/remote-jobs',
        metadata: {
          description: 'Remotive Public Remote Jobs API',
          autoManaged: true,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private async cleanupRemotiveJobPostings(sourceId: string): Promise<void> {
    const maxAgeDays = this.parseNumberEnv(process.env.REMOTIVE_MAX_AGE_DAYS, 14) ?? 14;
    if (maxAgeDays <= 0) {
      return;
    }
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.jobPosting.deleteMany({
      where: {
        sourceId,
        ...this.cleanupProtectionWhere,
        OR: [
          { publishedAt: { lt: cutoff } },
          { publishedAt: null, createdAt: { lt: cutoff } },
        ],
      },
    });
    if (result.count > 0) {
      this.logger.log(
        `Remotive cleanup removed ${result.count} jobs older than ${maxAgeDays}d`,
      );
    }
  }

  private async scrapeRemoteOkJobs(dryRun: boolean): Promise<number> {
    const enabled = this.parseBooleanEnv(process.env.REMOTEOK_ENABLED, false);
    if (!enabled) {
      return 0;
    }

    const days = this.parseNumberEnv(process.env.REMOTEOK_DAYS, 14) ?? 14;
    const maxItems = this.parseNumberEnv(process.env.REMOTEOK_MAX_ITEMS, 250) ?? 250;
    const tagFilter = process.env.REMOTEOK_TAG || undefined;
    const locationFilter =
      process.env.REMOTEOK_LOCATION || process.env.REMOTEOK_COUNTRY || undefined;
    const companyFilter = process.env.REMOTEOK_COMPANY || undefined;
    const searchQuery = process.env.REMOTEOK_SEARCH || undefined;

    const connector = new RemoteOkConnector({
      baseUrl: process.env.REMOTEOK_BASE_URL || undefined,
      logger: {
        debug: (message: string) => this.logger.debug(message),
        warn: (message: string) => this.logger.warn(message),
        error: (message: string) => this.logger.error(message),
      },
    });

    let jobs: RemoteOkJob[] = [];
    try {
      jobs = await connector.fetchRecentJobs({
        days,
        maxItems,
        tag: tagFilter,
        location: locationFilter,
        company: companyFilter,
        search: searchQuery,
      });
    } catch (error) {
      this.logger.error(
        `remoteok scrape failed: ${(error as Error)?.message ?? 'unknown error'}`,
        error as Error,
      );
      return 0;
    }

    if (!jobs.length) {
      if (!dryRun) {
        const source = await this.ensureRemoteOkSource();
        await this.cleanupRemoteOkJobPostings(source.id);
      }
      return 0;
    }

    const source = await this.ensureRemoteOkSource();
    const existing = await this.prisma.jobPosting.findMany({
      where: {
        sourceId: source.id,
        link: { in: jobs.map((job) => job.link) },
      },
      select: { link: true },
    });
    const existingLinks = new Set(existing.map((item) => item.link));
    const freshJobs = jobs.filter((job) => !existingLinks.has(job.link));
    if (!freshJobs.length) {
      if (!dryRun) {
        await this.cleanupRemoteOkJobPostings(source.id);
      }
      this.logger.debug('remoteok scrape: no new records to insert');
      return 0;
    }

    await this.enrichDescriptionsFromLinks(freshJobs);

    const count = freshJobs.length;
    if (dryRun) {
      this.logger.log(
        `remoteok scrape dry-run new=${count} skipped=${jobs.length - count}`,
      );
      return count;
    }

    await this.prisma.jobPosting.createMany({
      data: freshJobs.map((job) => ({
        title: job.title,
        description: job.description,
        rawContent: job.description,
        company: job.company,
        location: job.location,
        link: job.link,
        sourceId: source.id,
        status: 'new' as JobStatus,
        tags: job.tags,
        publishedAt: job.publishedAt,
      })),
    });
    this.logger.log(
      `remoteok scrape inserted=${count} skipped=${jobs.length - count} days=${days}`,
    );
    await this.cleanupRemoteOkJobPostings(source.id);
    return count;
  }

  private async ensureRemoteOkSource() {
    const existing = await this.prisma.source.findFirst({
      where: { sourceType: 'remoteok' },
    });
    if (existing) {
      return existing;
    }
    return await this.prisma.source.create({
      data: {
        name: 'Remote OK Public Feed',
        sourceType: 'remoteok',
        url: 'https://remoteok.com/',
        metadata: {
          description: 'Remote OK public jobs feed',
          autoManaged: true,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private async cleanupRemoteOkJobPostings(sourceId: string): Promise<void> {
    const maxAgeDays = this.parseNumberEnv(process.env.REMOTEOK_MAX_AGE_DAYS, 14) ?? 14;
    if (maxAgeDays <= 0) {
      return;
    }
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.jobPosting.deleteMany({
      where: {
        sourceId,
        ...this.cleanupProtectionWhere,
        OR: [
          { publishedAt: { lt: cutoff } },
          { publishedAt: null, createdAt: { lt: cutoff } },
        ],
      },
    });
    if (result.count > 0) {
      this.logger.log(
        `Remote OK cleanup removed ${result.count} jobs older than ${maxAgeDays}d`,
      );
    }
  }

  private async scrapeJobicyJobs(dryRun: boolean): Promise<number> {
    const enabled = this.parseBooleanEnv(process.env.JOBICY_ENABLED, false);
    if (!enabled) {
      return 0;
    }

    const days = this.parseNumberEnv(process.env.JOBICY_DAYS, 14) ?? 14;
    const count = this.parseNumberEnv(process.env.JOBICY_COUNT, 100) ?? 100;
    const industry = process.env.JOBICY_INDUSTRY || undefined;
    const jobType = process.env.JOBICY_JOB_TYPE || undefined;
    const jobLevel = process.env.JOBICY_JOB_LEVEL || undefined;
    const geo = process.env.JOBICY_GEO || undefined;
    const tag = process.env.JOBICY_TAG || undefined;
    const company = process.env.JOBICY_COMPANY || undefined;
    const search = process.env.JOBICY_SEARCH || undefined;

    const connector = new JobicyConnector({
      baseUrl: process.env.JOBICY_BASE_URL || undefined,
      logger: {
        debug: (message: string) => this.logger.debug(message),
        warn: (message: string) => this.logger.warn(message),
        error: (message: string) => this.logger.error(message),
      },
    });

    let jobs: JobicyJob[] = [];
    try {
      jobs = await connector.fetchRecentJobs({
        days,
        count,
        industry,
        jobType,
        jobLevel,
        geo,
        tag,
        company,
        search,
      });
    } catch (error) {
      this.logger.error(
        `jobicy scrape failed: ${(error as Error)?.message ?? 'unknown error'}`,
        error as Error,
      );
      return 0;
    }

    if (!jobs.length) {
      if (!dryRun) {
        const source = await this.ensureJobicySource();
        await this.cleanupJobicyJobPostings(source.id);
      }
      return 0;
    }

    const source = await this.ensureJobicySource();
    const existing = await this.prisma.jobPosting.findMany({
      where: {
        sourceId: source.id,
        link: { in: jobs.map((job) => job.link) },
      },
      select: { link: true },
    });
    const existingLinks = new Set(existing.map((item) => item.link));
    const freshJobs = jobs.filter((job) => !existingLinks.has(job.link));
    if (!freshJobs.length) {
      if (!dryRun) {
        await this.cleanupJobicyJobPostings(source.id);
      }
      this.logger.debug('jobicy scrape: no new records to insert');
      return 0;
    }

    await this.enrichDescriptionsFromLinks(freshJobs);

    const countNew = freshJobs.length;
    if (dryRun) {
      this.logger.log(`jobicy scrape dry-run new=${countNew} skipped=${jobs.length - countNew}`);
      return countNew;
    }

    await this.prisma.jobPosting.createMany({
      data: freshJobs.map((job) => ({
        title: job.title,
        description: job.description,
        rawContent: job.description,
        company: job.company,
        location: job.location,
        link: job.link,
        sourceId: source.id,
        status: 'new' as JobStatus,
        tags: job.tags,
        publishedAt: job.publishedAt,
      })),
    });
    this.logger.log(
      `jobicy scrape inserted=${countNew} skipped=${jobs.length - countNew} days=${days}`,
    );
    await this.cleanupJobicyJobPostings(source.id);
    return countNew;
  }

  private async ensureJobicySource() {
    const existing = await this.prisma.source.findFirst({
      where: { sourceType: 'jobicy' },
    });
    if (existing) {
      return existing;
    }
    return await this.prisma.source.create({
      data: {
        name: 'Jobicy API',
        sourceType: 'jobicy',
        url: 'https://jobicy.com/',
        metadata: {
          description: 'Jobicy remote jobs API',
          autoManaged: true,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private async cleanupJobicyJobPostings(sourceId: string): Promise<void> {
    const maxAgeDays = this.parseNumberEnv(process.env.JOBICY_MAX_AGE_DAYS, 14) ?? 14;
    if (maxAgeDays <= 0) {
      return;
    }
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.jobPosting.deleteMany({
      where: {
        sourceId,
        ...this.cleanupProtectionWhere,
        OR: [
          { publishedAt: { lt: cutoff } },
          { publishedAt: null, createdAt: { lt: cutoff } },
        ],
      },
    });
    if (result.count > 0) {
      this.logger.log(
        `Jobicy cleanup removed ${result.count} jobs older than ${maxAgeDays}d`,
      );
    }
  }

  private async scrapeFindworkJobs(dryRun: boolean): Promise<number> {
    const enabled = this.parseBooleanEnv(process.env.FINDWORK_ENABLED, false);
    if (!enabled) {
      return 0;
    }
    const token = process.env.FINDWORK_API_KEY;
    if (!token) {
      this.logger.warn('findwork scrape skipped: FINDWORK_API_KEY is not set');
      return 0;
    }

    const days = this.parseNumberEnv(process.env.FINDWORK_DAYS, 14) ?? 14;
    const pageSize = this.parseNumberEnv(process.env.FINDWORK_PAGE_SIZE, 50) ?? 50;
    const maxPages = this.parseNumberEnv(process.env.FINDWORK_MAX_PAGES, 5) ?? 5;
    const search = process.env.FINDWORK_SEARCH || undefined;
    const location = process.env.FINDWORK_LOCATION || undefined;
    const company = process.env.FINDWORK_COMPANY || undefined;
    const employmentType = process.env.FINDWORK_EMPLOYMENT_TYPE || undefined;
    const remoteOnly = this.parseBooleanEnv(process.env.FINDWORK_REMOTE_ONLY, false);

    const connector = new FindworkConnector({
      token,
      baseUrl: process.env.FINDWORK_BASE_URL || undefined,
      logger: {
        debug: (message: string) => this.logger.debug(message),
        warn: (message: string) => this.logger.warn(message),
        error: (message: string) => this.logger.error(message),
      },
    });

    let jobs: FindworkJob[] = [];
    try {
      jobs = await connector.fetchRecentJobs({
        days,
        pageSize,
        maxPages,
        search,
        location,
        company,
        employmentType,
        remoteOnly,
      });
    } catch (error) {
      this.logger.error(
        `findwork scrape failed: ${(error as Error)?.message ?? 'unknown error'}`,
        error as Error,
      );
      return 0;
    }

    if (!jobs.length) {
      if (!dryRun) {
        const source = await this.ensureFindworkSource();
        await this.cleanupFindworkJobPostings(source.id);
      }
      return 0;
    }

    const source = await this.ensureFindworkSource();
    const existing = await this.prisma.jobPosting.findMany({
      where: {
        sourceId: source.id,
        link: { in: jobs.map((job) => job.link) },
      },
      select: { link: true },
    });
    const existingLinks = new Set(existing.map((item) => item.link));
    const freshJobs = jobs.filter((job) => !existingLinks.has(job.link));
    if (!freshJobs.length) {
      if (!dryRun) {
        await this.cleanupFindworkJobPostings(source.id);
      }
      this.logger.debug('findwork scrape: no new records to insert');
      return 0;
    }

    await this.enrichDescriptionsFromLinks(freshJobs);

    const countNew = freshJobs.length;
    if (dryRun) {
      this.logger.log(
        `findwork scrape dry-run new=${countNew} skipped=${jobs.length - countNew}`,
      );
      return countNew;
    }

    await this.prisma.jobPosting.createMany({
      data: freshJobs.map((job) => ({
        title: job.title,
        description: job.description,
        rawContent: job.description,
        company: job.company,
        location: job.location,
        link: job.link,
        sourceId: source.id,
        status: 'new' as JobStatus,
        tags: job.tags,
        publishedAt: job.publishedAt,
      })),
    });
    this.logger.log(
      `findwork scrape inserted=${countNew} skipped=${jobs.length - countNew} days=${days}`,
    );
    await this.cleanupFindworkJobPostings(source.id);
    return countNew;
  }

  private async ensureFindworkSource() {
    const existing = await this.prisma.source.findFirst({
      where: { sourceType: 'findwork' },
    });
    if (existing) {
      return existing;
    }
    return await this.prisma.source.create({
      data: {
        name: 'Findwork API',
        sourceType: 'findwork',
        url: 'https://findwork.dev/',
        metadata: {
          description: 'Findwork job search API (token required)',
          autoManaged: true,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private async cleanupFindworkJobPostings(sourceId: string): Promise<void> {
    const maxAgeDays = this.parseNumberEnv(process.env.FINDWORK_MAX_AGE_DAYS, 14) ?? 14;
    if (maxAgeDays <= 0) {
      return;
    }
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.jobPosting.deleteMany({
      where: {
        sourceId,
        ...this.cleanupProtectionWhere,
        OR: [
          { publishedAt: { lt: cutoff } },
          { publishedAt: null, createdAt: { lt: cutoff } },
        ],
      },
    });
    if (result.count > 0) {
      this.logger.log(
        `Findwork cleanup removed ${result.count} jobs older than ${maxAgeDays}d`,
      );
    }
  }

  private async scrapeDevitjobsUkJobs(dryRun: boolean): Promise<number> {
    const enabled = this.parseBooleanEnv(process.env.DEVITJOBS_ENABLED, false);
    if (!enabled) {
      return 0;
    }

    const days = this.parseNumberEnv(process.env.DEVITJOBS_DAYS, 14) ?? 14;
    const maxJobs = this.parseNumberEnv(process.env.DEVITJOBS_MAX_JOBS, 100) ?? 100;
    const city = process.env.DEVITJOBS_CITY || undefined;
    const techCategory = process.env.DEVITJOBS_TECH || undefined;
    const company = process.env.DEVITJOBS_COMPANY || undefined;
    const remoteOnly = this.parseBooleanEnv(process.env.DEVITJOBS_REMOTE_ONLY, false);
    const fetchDetails = this.parseBooleanEnv(process.env.DEVITJOBS_FETCH_DETAILS, true);
    const detailConcurrency =
      this.parseNumberEnv(process.env.DEVITJOBS_DETAIL_CONCURRENCY, 4) ?? 4;

    const connector = new DevitjobsUkConnector({
      listUrl: process.env.DEVITJOBS_LIST_URL || undefined,
      detailUrl: process.env.DEVITJOBS_DETAIL_URL || undefined,
      logger: {
        debug: (message: string) => this.logger.debug(message),
        warn: (message: string) => this.logger.warn(message),
        error: (message: string) => this.logger.error(message),
      },
    });

    let jobs: DevitjobsUkJob[] = [];
    try {
      jobs = await connector.fetchRecentJobs({
        days,
        limit: maxJobs,
        cityCategory: city,
        techCategory,
        company,
        remoteOnly,
        fetchDetails,
        detailConcurrency,
      });
    } catch (error) {
      this.logger.error(
        `devitjobs scrape failed: ${(error as Error)?.message ?? 'unknown error'}`,
        error as Error,
      );
      return 0;
    }

    if (!jobs.length) {
      if (!dryRun) {
        const source = await this.ensureDevitjobsUkSource();
        await this.cleanupDevitjobsUkPostings(source.id);
      }
      return 0;
    }

    const source = await this.ensureDevitjobsUkSource();
    const existing = await this.prisma.jobPosting.findMany({
      where: {
        sourceId: source.id,
        link: { in: jobs.map((job) => job.link) },
      },
      select: { link: true },
    });
    const existingLinks = new Set(existing.map((item) => item.link));
    const freshJobs = jobs.filter((job) => !existingLinks.has(job.link));
    if (!freshJobs.length) {
      if (!dryRun) {
        await this.cleanupDevitjobsUkPostings(source.id);
      }
      this.logger.debug('devitjobs scrape: no new records to insert');
      return 0;
    }

    await this.enrichDescriptionsFromLinks(freshJobs);

    const countNew = freshJobs.length;
    if (dryRun) {
      this.logger.log(
        `devitjobs scrape dry-run new=${countNew} skipped=${jobs.length - countNew}`,
      );
      return countNew;
    }

    await this.prisma.jobPosting.createMany({
      data: freshJobs.map((job) => ({
        title: job.title,
        description: job.description,
        rawContent: job.description,
        company: job.company,
        location: job.location,
        link: job.link,
        sourceId: source.id,
        status: 'new' as JobStatus,
        tags: job.tags,
        publishedAt: job.publishedAt,
      })),
    });
    this.logger.log(
      `devitjobs scrape inserted=${countNew} skipped=${jobs.length - countNew} days=${days}`,
    );
    await this.cleanupDevitjobsUkPostings(source.id);
    return countNew;
  }

  private async ensureDevitjobsUkSource() {
    const existing = await this.prisma.source.findFirst({
      where: { sourceType: 'devitjobs' },
    });
    if (existing) {
      return existing;
    }
    return await this.prisma.source.create({
      data: {
        name: 'DevITjobs UK',
        sourceType: 'devitjobs',
        url: 'https://devitjobs.uk/',
        metadata: {
          description: 'DevITjobs UK jobs feed',
          autoManaged: true,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private async cleanupDevitjobsUkPostings(sourceId: string): Promise<void> {
    const maxAgeDays = this.parseNumberEnv(process.env.DEVITJOBS_MAX_AGE_DAYS, 14) ?? 14;
    if (maxAgeDays <= 0) {
      return;
    }
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.jobPosting.deleteMany({
      where: {
        sourceId,
        ...this.cleanupProtectionWhere,
        OR: [
          { publishedAt: { lt: cutoff } },
          { publishedAt: null, createdAt: { lt: cutoff } },
        ],
      },
    });
    if (result.count > 0) {
      this.logger.log(
        `DevITjobs cleanup removed ${result.count} jobs older than ${maxAgeDays}d`,
      );
    }
  }

  private async scrapeArbeitnowJobs(dryRun: boolean): Promise<number> {
    const enabled = this.parseBooleanEnv(process.env.ARBEITNOW_ENABLED, false);
    if (!enabled) {
      return 0;
    }

    const days = this.parseNumberEnv(process.env.ARBEITNOW_DAYS, 14) ?? 14;
    const maxPages = this.parseNumberEnv(process.env.ARBEITNOW_MAX_PAGES, 5);

    const connector = new ArbeitnowConnector({
      baseUrl: process.env.ARBEITNOW_BASE_URL || undefined,
      logger: {
        debug: (message: string) => this.logger.debug(message),
        warn: (message: string) => this.logger.warn(message),
        error: (message: string) => this.logger.error(message),
      },
    });

    let jobs: ArbeitnowJob[] = [];
    try {
      jobs = await connector.fetchRecentJobs({
        days,
        maxPages: maxPages ?? undefined,
      });
    } catch (error) {
      this.logger.error(
        `arbeitnow scrape failed: ${(error as Error)?.message ?? 'unknown error'}`,
        error as Error,
      );
      return 0;
    }

    if (!jobs.length) {
      if (!dryRun) {
        const source = await this.ensureArbeitnowSource();
        await this.cleanupArbeitnowJobPostings(source.id);
      }
      return 0;
    }

    const source = await this.ensureArbeitnowSource();
    const existing = await this.prisma.jobPosting.findMany({
      where: {
        sourceId: source.id,
        link: { in: jobs.map((job) => job.link) },
      },
      select: { link: true },
    });
    const existingLinks = new Set(existing.map((item) => item.link));
    const freshJobs = jobs.filter((job) => !existingLinks.has(job.link));
    if (!freshJobs.length) {
      if (!dryRun) {
        await this.cleanupArbeitnowJobPostings(source.id);
      }
      this.logger.debug('arbeitnow scrape: no new records to insert');
      return 0;
    }

    await this.enrichDescriptionsFromLinks(freshJobs);

    const count = freshJobs.length;
    if (dryRun) {
      this.logger.log(
        `arbeitnow scrape dry-run new=${count} skipped=${jobs.length - count}`,
      );
      return count;
    }

    await this.prisma.jobPosting.createMany({
      data: freshJobs.map((job) => ({
        title: job.title,
        description: job.description,
        rawContent: job.description,
        company: job.company,
        location: job.location,
        link: job.link,
        sourceId: source.id,
        status: 'new' as JobStatus,
        tags: job.tags,
        publishedAt: job.publishedAt,
      })),
    });
    this.logger.log(
      `arbeitnow scrape inserted=${count} skipped=${jobs.length - count} days=${days}`,
    );
    await this.cleanupArbeitnowJobPostings(source.id);
    return count;
  }

  private async ensureArbeitnowSource() {
    const existing = await this.prisma.source.findFirst({
      where: { sourceType: 'arbeitnow' },
    });
    if (existing) {
      return existing;
    }
    return await this.prisma.source.create({
      data: {
        name: 'Arbeitnow Job Board',
        sourceType: 'arbeitnow',
        url: 'https://www.arbeitnow.com/',
        metadata: {
          description: 'Arbeitnow public job board API',
          autoManaged: true,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private async cleanupArbeitnowJobPostings(sourceId: string): Promise<void> {
    const maxAgeDays = this.parseNumberEnv(process.env.ARBEITNOW_MAX_AGE_DAYS, 14) ?? 14;
    if (maxAgeDays <= 0) {
      return;
    }
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.jobPosting.deleteMany({
      where: {
        sourceId,
        ...this.cleanupProtectionWhere,
        OR: [
          { publishedAt: { lt: cutoff } },
          { publishedAt: null, createdAt: { lt: cutoff } },
        ],
      },
    });
    if (result.count > 0) {
      this.logger.log(
        `Arbeitnow cleanup removed ${result.count} jobs older than ${maxAgeDays}d`,
      );
    }
  }

  private async scrapeTheMuseJobs(dryRun: boolean): Promise<number> {
    const enabled = this.parseBooleanEnv(process.env.THEMUSE_ENABLED, false);
    if (!enabled) {
      return 0;
    }

    const days = this.parseNumberEnv(process.env.THEMUSE_DAYS, 14) ?? 14;
    const perPage = this.parseNumberEnv(process.env.THEMUSE_PAGE_SIZE, 50);
    const maxPages = this.parseNumberEnv(process.env.THEMUSE_MAX_PAGES, 5);
    const searchCategory = process.env.THEMUSE_CATEGORY || undefined;
    const searchCompany = process.env.THEMUSE_COMPANY || undefined;
    const searchLocation = process.env.THEMUSE_LOCATION || undefined;
    const searchLevel = process.env.THEMUSE_LEVEL || undefined;

    const connector = new TheMuseConnector({
      baseUrl: process.env.THEMUSE_BASE_URL || undefined,
      logger: {
        debug: (message: string) => this.logger.debug(message),
        warn: (message: string) => this.logger.warn(message),
        error: (message: string) => this.logger.error(message),
      },
    });

    let jobs: TheMuseJob[] = [];
    try {
      jobs = await connector.fetchRecentJobs({
        days,
        perPage: perPage ?? undefined,
        maxPages: maxPages ?? undefined,
        category: searchCategory,
        company: searchCompany,
        location: searchLocation,
        level: searchLevel,
      });
    } catch (error) {
      this.logger.error(
        `themuse scrape failed: ${(error as Error)?.message ?? 'unknown error'}`,
        error as Error,
      );
      return 0;
    }

    if (!jobs.length) {
      if (!dryRun) {
        const source = await this.ensureTheMuseSource();
        await this.cleanupTheMuseJobPostings(source.id);
      }
      return 0;
    }

    const source = await this.ensureTheMuseSource();
    const existing = await this.prisma.jobPosting.findMany({
      where: {
        sourceId: source.id,
        link: { in: jobs.map((job) => job.link) },
      },
      select: { link: true },
    });
    const existingLinks = new Set(existing.map((item) => item.link));
    const freshJobs = jobs.filter((job) => !existingLinks.has(job.link));
    if (!freshJobs.length) {
      if (!dryRun) {
        await this.cleanupTheMuseJobPostings(source.id);
      }
      this.logger.debug('themuse scrape: no new records to insert');
      return 0;
    }

    await this.enrichDescriptionsFromLinks(freshJobs);

    const count = freshJobs.length;
    if (dryRun) {
      this.logger.log(`themuse scrape dry-run new=${count} skipped=${jobs.length - count}`);
      return count;
    }

    await this.prisma.jobPosting.createMany({
      data: freshJobs.map((job) => ({
        title: job.title,
        description: job.description,
        rawContent: job.description,
        company: job.company,
        location: job.location,
        link: job.link,
        sourceId: source.id,
        status: 'new' as JobStatus,
        tags: job.tags,
        publishedAt: job.publishedAt,
      })),
    });
    this.logger.log(`themuse scrape inserted=${count} skipped=${jobs.length - count} days=${days}`);
    await this.cleanupTheMuseJobPostings(source.id);
    return count;
  }

  private async ensureTheMuseSource() {
    const existing = await this.prisma.source.findFirst({
      where: { sourceType: 'themuse' },
    });
    if (existing) {
      return existing;
    }
    return await this.prisma.source.create({
      data: {
        name: 'The Muse Open API',
        sourceType: 'themuse',
        url: 'https://www.themuse.com/',
        metadata: {
          description: 'The Muse public jobs API',
          autoManaged: true,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private async cleanupTheMuseJobPostings(sourceId: string): Promise<void> {
    const maxAgeDays = this.parseNumberEnv(process.env.THEMUSE_MAX_AGE_DAYS, 14) ?? 14;
    if (maxAgeDays <= 0) {
      return;
    }
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.jobPosting.deleteMany({
      where: {
        sourceId,
        ...this.cleanupProtectionWhere,
        OR: [
          { publishedAt: { lt: cutoff } },
          { publishedAt: null, createdAt: { lt: cutoff } },
        ],
      },
    });
    if (result.count > 0) {
      this.logger.log(
        `The Muse cleanup removed ${result.count} jobs older than ${maxAgeDays}d`,
      );
    }
  }

  private async cleanupOldRssJobPostings(): Promise<void> {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    // Получаем все RSS источники
    const rssSources = await this.prisma.source.findMany({
      where: { sourceType: 'rss' },
      select: { id: true },
    });

    if (rssSources.length === 0) {
      return;
    }

    const rssSourceIds = rssSources.map((s) => s.id);

    // Находим старые RSS вакансии (старше 2 недель)
    const oldJobs = await this.prisma.jobPosting.findMany({
      where: {
        sourceId: { in: rssSourceIds },
        ...this.cleanupProtectionWhere,
        OR: [
          { publishedAt: { lt: twoWeeksAgo } },
          { publishedAt: null, createdAt: { lt: twoWeeksAgo } },
        ],
      },
      select: { id: true },
    });

    if (oldJobs.length === 0) {
      return;
    }

    // Удаляем связанные applications
    const jobIds = oldJobs.map((j) => j.id);
    await this.prisma.application.deleteMany({
      where: { jobPostingId: { in: jobIds } },
    });

    // Удаляем старые RSS вакансии
    const deletedCount = await this.prisma.jobPosting.deleteMany({
      where: { id: { in: jobIds } },
    });

    this.logger.log(
      `Cleaned up old RSS job postings: removed ${deletedCount.count} jobs older than 2 weeks`,
    );
  }

  /**
   * Удаляет вакансии старше 2 недель (для всех источников) и те, что ведут на недоступные страницы.
   * Нужна, чтобы не хранить "job is no longer available" и просроченные записи.
   */
  private async cleanupUnavailableAndOldJobs(): Promise<void> {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    // Удаляем устаревшие записи по publishedAt/createdAt
    const deletedOld = await this.prisma.jobPosting.deleteMany({
      where: {
        ...this.cleanupProtectionWhere,
        OR: [
          { publishedAt: { lt: twoWeeksAgo } },
          { publishedAt: null, createdAt: { lt: twoWeeksAgo } },
        ],
      },
    });

    // Удаляем недоступные страницы по характерным фразам
    const unavailablePatterns = [
      'stellenangebot gibt es nicht',
      'nicht mehr verfügbar',
      'job ist nicht mehr verfügbar',
      'job existiert nicht mehr',
      'dieses stellenangebot gibt es nicht',
      'stellenangebot ist nicht mehr verfügbar',
    ];

    const unavailableWhere = {
      OR: unavailablePatterns.map((p) => ({
        OR: [
          { description: { contains: p } },
          { rawContent: { contains: p } },
        ],
      })),
    };

    const deletedUnavailable = await this.prisma.jobPosting.deleteMany({
      where: { ...this.cleanupProtectionWhere, ...unavailableWhere },
    });

    if (deletedOld.count || deletedUnavailable.count) {
      this.logger.log(
        `cleanupUnavailableAndOldJobs removed old=${deletedOld.count} unavailable=${deletedUnavailable.count}`,
      );
    }
  }
}

type ProxyWithExtras = ProxyDbRow;
