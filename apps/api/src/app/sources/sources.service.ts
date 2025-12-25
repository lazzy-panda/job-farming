import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Source, SourceType } from '@job-farm/shared-models';
import { Prisma } from '@prisma/client';
import { load } from 'cheerio';
import * as crypto from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import axios from 'axios';

interface CreateSourceDto {
  name: string;
  sourceType: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

type UpdateSourceDto = Partial<CreateSourceDto>;

@Injectable()
export class SourcesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<Source[]> {
    return this.prisma.source.findMany().then((items) => {
      const deduped: Source[] = [];
      const seen = new Set<string>();
      for (const s of items) {
        const mapped = this.mapSource(s);
        const key = this.normalizeUrl(mapped.url ?? '') || mapped.id;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        deduped.push(mapped);
      }
      return deduped;
    });
  }

  async create(dto: CreateSourceDto): Promise<Source> {
    // Валидация URL
    if (!dto.url || !dto.url.trim()) {
      throw new BadRequestException('URL обязателен');
    }

    const url = dto.url.trim();
    if (!this.isValidUrl(url)) {
      throw new BadRequestException('Некорректный URL');
    }

    // Определение типа источника
    const sourceType = this.resolveSourceType(dto.sourceType, url);

    // Ограничение типов источников только telegram и rss
    if (sourceType !== 'telegram' && sourceType !== 'rss') {
      throw new BadRequestException('Поддерживаются только источники типа telegram и rss');
    }

    // Проверка доступности и валидности источника
    if (sourceType === 'telegram') {
      await this.validateTelegramSource(url);
    } else if (sourceType === 'rss') {
      await this.validateRssSource(url);
    }

    const urlNormalized = this.normalizeUrl(url);
    if (urlNormalized) {
      await this.assertUniqueUrl(urlNormalized);
    }

    const metadataPayload =
      sourceType === 'telegram'
        ? await this.buildTelegramMetadata(url, dto.metadata, dto.name)
        : this.toJson(dto.metadata);

    const payload: Prisma.SourceCreateInput = {
      name: dto.name,
      sourceType,
      url,
      metadata: metadataPayload,
    };
    return this.prisma.source.create({ data: payload }).then((s) => this.mapSource(s));
  }

  async update(id: string, dto: UpdateSourceDto): Promise<Source> {
    const current = await this.prisma.source.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException('Source not found');
    }

    const nextUrl = dto.url === undefined ? current.url : dto.url ?? null;
    const nextType = this.resolveSourceType(
      dto.sourceType ?? current.sourceType,
      nextUrl ?? undefined,
    );
    if (dto.url !== undefined) {
      const normalizedUrl = this.normalizeUrl(nextUrl ?? '');
      if (normalizedUrl && normalizedUrl !== this.normalizeUrl(current.url ?? '')) {
        await this.assertUniqueUrl(normalizedUrl, current.id);
      }
    }

    const shouldUpdateSourceType = dto.sourceType !== undefined || dto.url !== undefined;

    let metadataInput: Prisma.InputJsonValue | undefined;
    if (nextType === 'telegram') {
      const baseMetadata =
        dto.metadata === undefined
          ? ((current.metadata as Record<string, unknown>) ?? {})
          : dto.metadata;
      metadataInput = await this.buildTelegramMetadata(nextUrl, baseMetadata, dto.name ?? current.name);
    } else if (dto.metadata !== undefined) {
      metadataInput = this.toJson(dto.metadata);
    }

    const payload: Prisma.SourceUpdateInput = {
      name: dto.name,
      sourceType: shouldUpdateSourceType ? nextType : undefined,
      url: dto.url === undefined ? undefined : nextUrl,
      metadata: metadataInput,
    };
    const updated = await this.prisma.source.update({
      where: { id },
      data: payload,
    });
    return this.mapSource(updated);
  }

  async remove(id: string): Promise<Source> {
    try {
      const deleted = await this.prisma.$transaction(async (tx) => {
        await tx.jobPosting.updateMany({
          where: { sourceId: id },
          data: { sourceId: null },
        });
        return tx.source.delete({ where: { id } });
      });
      return this.mapSource(deleted);
    } catch {
      throw new NotFoundException('Source not found');
    }
  }

  private mapSource(s: {
    id: string;
    name: string;
    sourceType: string;
    url: string | null;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): Source {
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

  private toJson(value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue {
    return (value ?? {}) as Prisma.InputJsonValue;
  }

  private normalizeUrl(raw: string): string {
    let v = (raw ?? '').trim().toLowerCase();
    v = v.replace(/^https?:\/\//, '');
    v = v.replace(/^www\./, '');
    v = v.replace(/^t\.me\/s\//, 't.me/');
    v = v.replace(/\/+$/, '');
    return v;
  }

  private resolveSourceType(sourceType: string, url?: string | null): SourceType {
    if (sourceType === 'telegram') {
      return 'telegram';
    }
    if (sourceType === 'rss') {
      return 'rss';
    }
    if (this.isTelegramUrl(url)) {
      return 'telegram';
    }
    if (this.isRssUrl(url)) {
      return 'rss';
    }
    return (sourceType as SourceType) || 'site';
  }

  private isRssUrl(url?: string | null): boolean {
    if (!url) {
      return false;
    }
    const lower = url.toLowerCase();
    return (
      lower.includes('/feed') ||
      lower.includes('/rss') ||
      lower.endsWith('.xml') ||
      lower.endsWith('.rss') ||
      lower.includes('rss.xml') ||
      lower.includes('feed.xml')
    );
  }

  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private isTelegramUrl(url?: string | null): boolean {
    if (!url) {
      return false;
    }
    return /t\.me\//i.test(url);
  }

  private async buildTelegramMetadata(
    url: string | null,
    base: Record<string, unknown> | null | undefined,
    fallbackName?: string | null,
  ): Promise<Prisma.InputJsonValue> {
    const profile = await this.assertTelegramChannelAccessible(url);
    const metadata: Record<string, unknown> = { ...(base ?? {}) };
    metadata.telegramSlug = profile.slug;
    if (profile.title || fallbackName) {
      metadata.telegramTitle = profile.title ?? fallbackName ?? metadata.telegramTitle;
    }
    if (profile.avatar) {
      metadata.telegramAvatar = profile.avatar;
    }
    return this.toJson(metadata);
  }

  private async validateTelegramSource(url: string): Promise<void> {
    const slug = this.extractTelegramSlug(url);
    if (!slug) {
      throw new BadRequestException('Некорректная ссылка на Telegram-канал');
    }

    const probeUrl = `https://t.me/s/${slug}`;
    let status: number;
    let finalUrl: string;
    let body: string;
    try {
      const response = await axios.get(probeUrl, {
        headers: { 'user-agent': this.telegramUserAgent },
        maxRedirects: 10,
        validateStatus: () => true, // Не выбрасывать ошибку на любой статус
        responseType: 'text',
      });
      status = response.status;
      // axios может хранить финальный URL в разных местах в зависимости от версии
      finalUrl = (response.request?.res?.responseUrl) || (response.request?.responseURL) || (response.config?.url) || probeUrl;
      body = response.data as string;
    } catch (error) {
      throw new BadRequestException(
        `Не удалось проверить доступность Telegram-канала: ${(error as Error).message}`,
      );
    }

    // ПРИОРИТЕТ: Проверяем признаки канала в теле ответа ПЕРВЫМИ
    // (некоторые каналы могут возвращать редиректы или не-200, но HTML содержит информацию о канале)
    const hasTgmePageExtra = body.includes('tgme_page_extra');
    const hasTelegramView = body.includes('Telegram: View');
    const hasMembersOnline = body.includes('members') && body.includes('online');
    const hasChannelIndicatorsInBody = hasTgmePageExtra || hasTelegramView || hasMembersOnline;

    // ВАЖНО: Если есть признаки канала, сразу продолжаем валидацию, НЕ проверяя статус/URL
    if (hasChannelIndicatorsInBody) {
      // Это канал - продолжаем валидацию (проверка последнего сообщения будет ниже)
      // НЕ проверяем статус/URL, если есть признаки канала
    } else {
      // НЕТ признаков канала - проверяем статус и URL
      // Но сначала проверяем, что finalUrl содержит t.me
      if (!finalUrl || !finalUrl.includes('t.me')) {
        throw new BadRequestException(
          'Канал Telegram закрыт или не имеет публичного просмотра. Убедитесь, что канал публичный и доступен по ссылке https://t.me/s/...',
        );
      }
      
      if (status < 200 || status >= 300) {
        throw new BadRequestException(
          `Канал Telegram недоступен (статус: ${status}). Убедитесь, что канал публичный и доступен по ссылке https://t.me/s/...`,
        );
      }
    }

    // Проверяем наличие сообщений канала
    const hasChannelMessages = 
      body.includes('tgme_widget_message') || 
      body.includes('tgme_channel_history') ||
      body.includes('tgme_widget_message_wrap');
    
    // Если hasChannelIndicatorsInBody === true, это канал - продолжаем валидацию
    // Если сообщения не видны без авторизации, проверка последнего сообщения будет пропущена

    // Проверка последнего сообщения (не старше 3 недель)
    // Только если сообщения видны в веб-версии
    // Если hasChannelIndicatorsInBody === true, но hasChannelMessages === false,
    // это означает, что канал валиден, но сообщения требуют авторизации - пропускаем проверку даты
    if (hasChannelMessages) {
      const threeWeeksAgo = new Date();
      threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 21);

      const lastMessageDate = this.extractLastMessageDate(body);
      if (!lastMessageDate) {
        // Если не удалось извлечь дату, но канал доступен, возможно канал пустой
        // Проверяем, есть ли вообще сообщения
        const $ = load(body);
        const messages = $('.tgme_widget_message').toArray();
        if (messages.length === 0) {
          // Если нет сообщений, но есть признаки канала - это валидный канал, просто сообщения требуют авторизации
          if (hasChannelIndicatorsInBody) {
            return; // Канал валиден, пропускаем проверку даты
          }
          throw new BadRequestException(
            'Канал не содержит сообщений или не является публичным каналом с вакансиями.',
          );
        }
        throw new BadRequestException('Не удалось определить дату последнего сообщения в канале');
      }

      if (lastMessageDate < threeWeeksAgo) {
        throw new BadRequestException(
          `Последнее сообщение в канале было ${lastMessageDate.toLocaleDateString('ru-RU')}. Канал должен быть активен (последнее сообщение не позднее 3 недель назад).`,
        );
      }
    } else if (hasChannelIndicatorsInBody) {
      // Канал валиден (есть признаки канала), но сообщения не видны без авторизации
      // Пропускаем проверку даты - канал можно добавить
      return;
    }
    // Если сообщения не видны без авторизации, но это точно канал - пропускаем проверку даты
  }

  private extractLastMessageDate(html: string): Date | null {
    try {
      const $ = load(html);
      const messages = $('.tgme_widget_message').toArray();
      if (messages.length === 0) {
        return null;
      }

      // Берем первое сообщение (самое свежее)
      const firstMessage = $(messages[0]);
      const timeAttr =
        firstMessage.find('time[datetime]').first().attr('datetime') ??
        firstMessage.find('.tgme_widget_message_date time[datetime]').first().attr('datetime') ??
        null;

      if (!timeAttr) {
        return null;
      }

      return new Date(timeAttr);
    } catch {
      return null;
    }
  }

  private async validateRssSource(url: string): Promise<void> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'user-agent': this.telegramUserAgent },
      });
    } catch {
      throw new BadRequestException('Не удалось проверить доступность RSS-ленты');
    }

    if (response.status < 200 || response.status >= 400) {
      throw new BadRequestException(`RSS-лента недоступна (статус: ${response.status})`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();

    // Проверка валидности RSS
    if (!this.isValidRssFeed(text, contentType)) {
      throw new BadRequestException('URL не является валидной RSS-лентой');
    }
  }

  private isValidRssFeed(content: string, contentType: string): boolean {
    const lowerContent = content.toLowerCase();
    const lowerContentType = contentType.toLowerCase();

    // Проверка по content-type
    if (lowerContentType.includes('xml') || lowerContentType.includes('rss') || lowerContentType.includes('atom')) {
      // Проверка наличия RSS/Atom элементов
      return (
        lowerContent.includes('<rss') ||
        lowerContent.includes('<feed') ||
        lowerContent.includes('<channel') ||
        lowerContent.includes('xmlns="http://www.w3.org/2005/atom"')
      );
    }

    // Проверка по содержимому
    return (
      lowerContent.includes('<rss') ||
      lowerContent.includes('<feed') ||
      (lowerContent.includes('<channel') && lowerContent.includes('<item'))
    );
  }

  private async assertTelegramChannelAccessible(url?: string | null): Promise<{
    slug: string;
    title?: string | null;
    avatar?: string | null;
  }> {
    const slug = this.extractTelegramSlug(url);
    if (!slug) {
      throw new BadRequestException('Некорректная ссылка на Telegram-канал');
    }
    const probeUrl = `https://t.me/s/${slug}`;
    let response: Response;
    let body: string;
    try {
      response = await fetch(probeUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'user-agent': this.telegramUserAgent },
      });
      body = await response.text();
    } catch {
      throw new BadRequestException('Не удалось проверить доступность Telegram-канала');
    }

    if (response.status !== 200) {
      throw new BadRequestException(
        'Канал Telegram закрыт или не имеет публичного просмотра (https://t.me/s/...).',
      );
    }

    const profile = this.parseTelegramProfile(body);
    return {
      slug,
      title: profile.title ?? null,
      avatar: profile.avatar ?? null,
    };
  }

  private parseTelegramProfile(html: string): { title?: string; avatar?: string } {
    try {
      const $ = load(html);
      const title =
        $('meta[property="og:title"]').attr('content') ||
        $('.tgme_page_title span').first().text();
      const avatar =
        $('meta[property="og:image"]').attr('content') ||
        $('.tgme_page_photo_image img').attr('src') ||
        $('.tgme_page_photo_image').attr('src');
      return {
        title: title?.trim(),
        avatar: avatar?.trim(),
      };
    } catch {
      return {};
    }
  }

  private extractTelegramSlug(url?: string | null): string | null {
    if (!url) {
      return null;
    }
    try {
      const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
      if (!/t\.me$/i.test(parsed.hostname)) {
        return null;
      }
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (!parts.length) {
        return null;
      }
      const [first, second] = parts;
      const slug = first === 's' || first === 'c' ? second : first;
      if (!slug || slug.startsWith('+') || slug.toLowerCase().startsWith('joinchat')) {
        return null;
      }
      return slug;
    } catch {
      return null;
    }
  }

  async getTelegramAvatarUrl(sourceId: string): Promise<string | null> {
    const src = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { metadata: true },
    });
    const metadata = (src?.metadata as Record<string, unknown>) ?? {};
    const raw = (metadata.telegramAvatar as string | undefined) ?? null;
    return this.normalizeAvatarUrl(raw);
  }

  async getOrFetchTelegramAvatarCache(
    sourceId: string,
  ): Promise<{ buffer: Buffer; contentType: string } | null> {
    const src = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { metadata: true },
    });
    const metadata = (src?.metadata as Record<string, unknown>) ?? {};
    const avatarUrl = this.normalizeAvatarUrl((metadata.telegramAvatar as string | undefined) ?? null);
    if (!avatarUrl) {
      return null;
    }

    const cacheKey = this.hashCacheKey(avatarUrl);
    const cachedKey = (metadata.telegramAvatarCacheKey as string | undefined) ?? null;
    const cachedContentType = (metadata.telegramAvatarContentType as string | undefined) ?? null;
    const cachedExt = (metadata.telegramAvatarExt as string | undefined) ?? null;

    if (cachedKey === cacheKey && cachedExt && cachedContentType) {
      const cachedPath = this.buildAvatarCachePath(sourceId, cachedExt);
      const exists = await this.fileExists(cachedPath);
      if (exists) {
        const buffer = await fs.readFile(cachedPath);
        return { buffer, contentType: cachedContentType };
      }
    }

    const fetched = await this.fetchExternalAvatar(avatarUrl);
    const ext = this.resolveAvatarExtension(fetched.contentType);
    const filePath = this.buildAvatarCachePath(sourceId, ext);
    const relativePath = this.buildAvatarCacheRelativePath(sourceId, ext);
    await this.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, fetched.buffer);

    await this.prisma.source.update({
      where: { id: sourceId },
      data: {
        metadata: {
          ...(metadata ?? {}),
          telegramAvatarCacheKey: cacheKey,
          telegramAvatarContentType: fetched.contentType,
          telegramAvatarExt: ext,
          telegramAvatarCachedAt: new Date().toISOString(),
          // local cache references (stored in DB)
          telegramAvatarLocalPath: relativePath,
          telegramAvatarLocalUrl: `/api/sources/${sourceId}/avatar`,
        } as Prisma.InputJsonValue,
      },
    });

    return fetched;
  }

  private async fetchExternalAvatar(url: string): Promise<{ buffer: Buffer; contentType: string }> {
    const parsed = this.safeParseUrl(url);
    if (!parsed) {
      throw new BadRequestException('Invalid avatar url');
    }
    if (!this.isAllowedAvatarHost(parsed.hostname)) {
      throw new BadRequestException('Avatar host not allowed');
    }

    const resp = await fetch(parsed.toString(), {
      method: 'GET',
      headers: {
        'user-agent': this.telegramUserAgent,
        referer: 'https://t.me/',
      },
    });
    if (!resp.ok) {
      throw new BadRequestException(`Avatar fetch failed status=${resp.status}`);
    }
    const contentType = resp.headers.get('content-type') ?? 'image/jpeg';
    const ab = await resp.arrayBuffer();
    return { buffer: Buffer.from(ab), contentType };
  }

  private readonly telegramUserAgent =
    'Mozilla/5.0 (compatible; JobFarmBot/1.0; +https://job.farm)';

  private readonly avatarCacheDir = process.env.AVATAR_CACHE_DIR || './storage/avatars';

  private buildAvatarCachePath(sourceId: string, ext: string): string {
    return path.resolve(process.cwd(), this.avatarCacheDir, `source-${sourceId}.${ext}`);
  }

  private buildAvatarCacheRelativePath(sourceId: string, ext: string): string {
    const dir = this.avatarCacheDir.replace(/^\.\/+/, '');
    return `${dir}/source-${sourceId}.${ext}`;
  }

  private hashCacheKey(input: string): string {
    return crypto.createHash('sha1').update(input).digest('hex');
  }

  private resolveAvatarExtension(contentType: string): string {
    const ct = (contentType ?? '').toLowerCase();
    if (ct.includes('image/png')) return 'png';
    if (ct.includes('image/webp')) return 'webp';
    if (ct.includes('image/gif')) return 'gif';
    if (ct.includes('image/svg+xml')) return 'svg';
    return 'jpg';
  }

  private async ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private normalizeAvatarUrl(raw: string | null): string | null {
    const value = raw?.trim() ?? '';
    if (!value) {
      return null;
    }
    if (value.startsWith('//')) {
      return `https:${value}`;
    }
    if (value.startsWith('http://')) {
      return `https://${value.slice('http://'.length)}`;
    }
    if (!value.startsWith('https://') && !value.startsWith('http://')) {
      return `https://${value.replace(/^\/+/, '')}`;
    }
    return value;
  }

  private safeParseUrl(raw: string): URL | null {
    try {
      return new URL(raw);
    } catch {
      return null;
    }
  }

  private isAllowedAvatarHost(hostname: string): boolean {
    const host = hostname.toLowerCase();
    return (
      host === 't.me' ||
      host.endsWith('.t.me') ||
      host === 'telegram.org' ||
      host.endsWith('.telegram.org') ||
      host === 'telegram-cdn.org' ||
      host.endsWith('.telegram-cdn.org') ||
      // Telegram web view often uses telesco.pe CDN for avatars
      host === 'telesco.pe' ||
      host.endsWith('.telesco.pe')
    );
  }

  private async assertUniqueUrl(normalizedUrl: string, excludeId?: string) {
    const existing = await this.prisma.source.findMany({
      where: {
        id: excludeId ? { not: excludeId } : undefined,
        url: { not: null },
      },
      select: { id: true, url: true },
    });
    const duplicate = existing.find(
      (item) => this.normalizeUrl(item.url ?? '') === normalizedUrl,
    );
    if (duplicate) {
      throw new ConflictException('Источник с таким адресом уже существует');
    }
  }
}
