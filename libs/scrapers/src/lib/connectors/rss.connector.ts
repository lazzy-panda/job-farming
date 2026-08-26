import axios from 'axios';
import { SourceConnector, SourceContext } from '../scrapers';
import * as crypto from 'crypto';
import { load } from 'cheerio';
import { ProxyBlockedError } from '../errors';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Parser = require('rss-parser');

// Типы из rss-parser
type ParserItem = {
  link?: string;
  guid?: string;
  title?: string;
  pubDate?: string;
  creator?: string;
  summary?: string;
  content?: string | { '#text'?: string };
  isoDate?: string;
  categories?: string[] | string;
  contentSnippet?: string;
  description?: string;
  [key: string]: unknown;
};

type ParserOutput = {
  title?: string;
  items: ParserItem[];
  [key: string]: unknown;
};

type RssMetadata = {
  feedUrl?: string;
  lastItemId?: string;
  lastItemHash?: string;
  lastHashes?: string[];
  maxItems?: number;
  userAgent?: string;
  delayMs?: number;
  proxyHost?: string;
  proxyPort?: number;
  proxyUsername?: string;
  proxyPassword?: string;
  emptyRuns?: number;
  acceptLanguage?: string;
  acceptHeader?: string;
  referer?: string;
  cookieHeader?: string;
  headers?: Record<string, string>;
  /** false — не ходить за полным текстом на страницу вакансии (сайты с антиботом, напр. hh.ru) */
  fetchFullContent?: boolean;
};

type ParsedJob = {
  title: string;
  description?: string;
  company?: string;
  location?: string;
  link?: string;
  tags?: string;
  publishedAt?: Date;
  hash?: string;
  rawContent?: string;
  contentSource?: 'feed' | 'page';
};

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0';
const DEFAULT_ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const DEFAULT_ACCEPT_LANGUAGE = 'en-US,en;q=0.9';
const DEFAULT_MAX_ITEMS = 50;
const DEFAULT_DELAY_MS = 1000;
const HTML_CHALLENGE_MARKERS = [
  'request unsuccessful',
  'incapsula',
  'access denied',
  'verification required',
  'enable javascript',
  'cloudflare',
];
const NON_XML_PREVIEW_LENGTH = 160;
const PAGE_FETCH_TIMEOUT_MS = 35000;
const MIN_FEED_TEXT_LENGTH = 400;
const MAX_RAW_CONTENT_LENGTH = 60000;

export class RssConnector implements SourceConnector {
  private parser: InstanceType<typeof Parser>;

  constructor() {
    this.parser = new Parser({
      customFields: {
        item: [
          ['category', 'categories', { keepArray: true }],
          ['dc:creator', 'creator'],
          ['content:encoded', 'contentEncoded'],
        ],
      },
      xml: {
        // Более толерантный режим парсинга
        normalize: true,
        trim: true,
        ignoreAttributes: false,
        // Игнорируем ошибки парсинга
        ignoreDeclaration: false,
        ignoreInstruction: false,
        ignoreComment: true,
        ignoreText: false,
        ignoreCDATA: false,
        ignoreDoctype: true,
      },
      maxRedirects: 5,
    });
  }

  async fetchNewJobs(ctx: SourceContext): Promise<ParsedJob[]> {
    const meta = (ctx.metadata as RssMetadata) ?? {};
    const feedUrl = meta.feedUrl || ctx.url;
    if (!feedUrl) {
      return [];
    }

    try {
      const feed = await this.fetchFeed(feedUrl, meta) as ParserOutput;
      if (!feed || !feed.items || feed.items.length === 0) {
        return [];
      }

      const lastItemId = meta.lastItemId;
      const seenHashes = new Set(
        Array.isArray(meta.lastHashes) ? (meta.lastHashes as string[]) : [],
      );

      const cutoff = this.buildCutoffDate();
      const maxItems = meta.maxItems ?? DEFAULT_MAX_ITEMS;

      const jobs: ParsedJob[] = [];
      let foundLastItem = false;

      for (const item of feed.items.slice(0, maxItems)) {
        const normalized = this.normalizeItem(item, feedUrl);
        if (!normalized) {
          continue;
        }
        const enriched = await this.attachFullContent(normalized, meta);

        // Проверка на cutoff date
        if (normalized.publishedAt && normalized.publishedAt < cutoff) {
          foundLastItem = true;
          break;
        }

        // Проверка на уже обработанный элемент
        if (lastItemId && normalized.hash === lastItemId) {
          foundLastItem = true;
          break;
        }

        // Дедупликация по хешу
        if (normalized.hash && seenHashes.has(normalized.hash)) {
          continue;
        }

        // Если нашли последний элемент, останавливаемся
        if (lastItemId && this.getItemId(item) === lastItemId) {
          foundLastItem = true;
          break;
        }

        jobs.push(enriched);
      }

      return jobs;
    } catch (error) {
      if (error instanceof ProxyBlockedError) {
        throw error;
      }
      const err = error as Error;
      throw new Error(`Failed to fetch RSS feed: ${err.message}`);
    }
  }

  private async fetchFeed(url: string, meta: RssMetadata): Promise<ParserOutput | null> {
    const userAgent = meta.userAgent ?? DEFAULT_UA;
    const proxyConfig = this.buildProxyConfig(meta);
    const headers = this.buildRequestHeaders(meta, userAgent);

    try {
      const response = await axios.get(url, {
        headers,
        timeout: 30000,
        responseType: 'text',
        // Если прокси не задан, явно выключаем прокси, чтобы не подтягивались HTTP(S)_PROXY из окружения
        proxy: proxyConfig ?? false,
        maxRedirects: 10,
        validateStatus: (status) => status >= 200 && status < 400,
      });

      const rawPayload = response.data as string;
      if (!rawPayload || typeof rawPayload !== 'string') {
        return null;
      }
      const trimmedPayload = rawPayload.trim();
      // Некоторые источники вместо XML возвращают пустой JSON/объект — считаем, что фида нет, без ошибки.
      if (trimmedPayload === '{}' || trimmedPayload === '[]' || trimmedPayload.startsWith('{') || trimmedPayload.startsWith('[')) {
        return { items: [] };
      }

      const contentType = this.normalizeHeaderValue(
        response.headers?.['content-type'] ?? response.headers?.['Content-Type'],
      );
      const challengeMarker = this.detectHtmlChallenge(rawPayload, contentType);
      if (challengeMarker) {
        throw new ProxyBlockedError(403, meta.proxyHost, `challenge:${challengeMarker}`);
      }

      // Предварительная очистка XML
      const cleanedXml = this.removePreXmlContent(rawPayload);
      this.ensureXmlPayload(cleanedXml, rawPayload);
      let xml = cleanedXml;

      // Предварительная очистка XML от некорректных entity
      // Используем более надежный подход: обрабатываем все невалидные случаи использования &
      
      // Шаг 1: Исправляем известные entity без точки с запятой
      const knownEntities = ['amp', 'lt', 'gt', 'quot', 'apos', 'nbsp', 'mdash', 'ndash', 'copy', 'reg'];
      xml = xml.replace(/&([a-zA-Z][a-zA-Z0-9]*)([^;a-zA-Z0-9#&])/g, (match, entity, nextChar) => {
        if (knownEntities.includes(entity.toLowerCase())) {
          return `&${entity};${nextChar}`;
        }
        return match;
      });
      
      // Шаг 2: Временно заменяем все валидные entity на плейсхолдеры
      const validEntityPlaceholders: string[] = [];
      const placeholderPrefix = `__VALID_ENTITY_${Date.now()}_${Math.random().toString(36).substring(7)}_`;
      xml = xml.replace(/&([a-zA-Z][a-zA-Z0-9]*);|&#(\d+);|&#x([0-9a-fA-F]+);/gi, (match) => {
        const placeholder = `${placeholderPrefix}${validEntityPlaceholders.length}__`;
        validEntityPlaceholders.push(match);
        return placeholder;
      });
      
      // Шаг 3: Обрабатываем все оставшиеся & как невалидные и экранируем их
      xml = xml.replace(/&/g, '&amp;');
      
      // Шаг 4: Возвращаем валидные entity обратно (в обратном порядке, чтобы избежать конфликтов)
      for (let index = validEntityPlaceholders.length - 1; index >= 0; index--) {
        xml = xml.replace(`${placeholderPrefix}${index}__`, validEntityPlaceholders[index]);
      }

      // Шаг 5: Очистка от некорректных тегов
      xml = this.cleanMalformedTags(xml);

      try {
        const feed = await this.parser.parseString(xml);
        return feed;
      } catch (parseError) {
        // Если парсинг не удался, пробуем более агрессивную очистку
        const cleanedXml = this.aggressiveXmlCleanup(xml);
        try {
          const feed = await this.parser.parseString(cleanedXml);
          return feed;
        } catch (retryError) {
          // Дополнительный компактный фолбэк: удаляем непечатные символы и повторяем
          try {
            const stripped = this.removePreXmlContent(
              cleanedXml.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/g, ''),
            );
            const feed = await this.parser.parseString(stripped);
            return feed;
          } catch (finalError) {
            // no-op, провалимся в обработку ниже
          }
          const err = parseError as Error;
          // Ручной парс фида на случай, если rss-parser не справился (например, из-за минимальных нарушений)
          const fallbackFeed = this.manualParse(rawPayload || xml);
          if (fallbackFeed) {
            return fallbackFeed;
          }
          if (this.isNonXmlError(err)) {
            const preview = this.buildPayloadPreview(rawPayload ?? xml);
            if (preview) {
              throw new Error(`RSS feed returned non-XML content: ${preview}`);
            }
          }
          throw new Error(`Failed to fetch RSS feed: ${err.message || String(parseError)}`);
        }
      }
    } catch (error) {
      if (error instanceof ProxyBlockedError) {
        throw error;
      }
      const err = error as { response?: { status?: number }; message?: string; code?: string };
      if (err.response?.status === 404) {
        throw new Error(`RSS feed not found: ${url}`);
      }
      if (err.response?.status === 403) {
        throw new ProxyBlockedError(403, meta.proxyHost, 'forbidden');
      }
      if (this.isProxyNetworkError(err)) {
        throw new ProxyBlockedError(err.response?.status ?? 0, meta.proxyHost, err.code ?? err.message);
      }
      throw new Error(`Failed to fetch RSS feed: ${err.message || 'Unknown error'}`);
    }
  }

  private manualParse(xml: string): ParserOutput | null {
    try {
      const $ = load(xml, { xmlMode: true, decodeEntities: false });
      const items: ParserItem[] = [];
      $('item').each((_, el) => {
        const getText = (selector: string) => $(el).find(selector).first().text().trim() || undefined;
        const link = getText('link');
        const guid = getText('guid') || link;
        const title = getText('title');
        const description = getText('description') || getText('content:encoded') || undefined;
        const pubDateRaw = getText('pubDate') || getText('dc\\:date') || undefined;
        const isoDate = pubDateRaw ? new Date(pubDateRaw).toISOString() : undefined;
        const categories = $(el)
          .find('category')
          .toArray()
          .map((c) => $(c).text().trim())
          .filter(Boolean);
        items.push({
          title,
          description,
          link,
          guid,
          pubDate: pubDateRaw,
          isoDate,
          categories: categories.length ? categories : undefined,
          content: description,
        });
      });
      if (items.length === 0) {
        return null;
      }
      return { items };
    } catch {
      return null;
    }
  }

  private normalizeItem(item: ParserItem, feedUrl: string): ParsedJob | null {
    if (!item.title && !item.content && !item.contentSnippet) {
      return null;
    }

    const title = this.extractText(item.title || '');
    const description = this.extractDescription(item);
    const link = this.normalizeLink(item.link || item.guid || '', feedUrl);
    const publishedAt = this.parseDate(item.pubDate || item.isoDate);
    const tags = this.extractTags(item);
    const hash = this.buildHash(item, link || '');

    const job: ParsedJob = {
      title,
      description: description || undefined,
      link: link || undefined,
      tags: tags || undefined,
      publishedAt: publishedAt || undefined,
      hash,
    };
    if (description) {
      job.rawContent = description;
      job.contentSource = 'feed';
    }
    return job;
  }

  private async attachFullContent(job: ParsedJob, meta: RssMetadata): Promise<ParsedJob> {
    const result: ParsedJob = { ...job };
    const snippet = (job.description ?? '').trim();
    if (snippet) {
      result.rawContent = this.truncateRawContent(snippet);
      result.contentSource = result.contentSource ?? 'feed';
    }

    if (!job.link) {
      return result;
    }

    if (meta.fetchFullContent === false) {
      return result;
    }

    if (!this.shouldFetchFullContent(snippet)) {
      return result;
    }

    try {
      const html = await this.fetchOriginalPage(job.link, meta);
      if (!html) {
        return result;
      }
      const text = this.extractMainText(html);
      if (text) {
        result.rawContent = text;
        result.contentSource = 'page';
      }
    } catch (error) {
      // Антибот-заглушка на странице вакансии — не повод останавливать весь источник:
      // сам фид скачался, оставляем сниппет из фида.
      // Если страница не загрузилась, оставляем исходное описание
      return result;
    }

    return result;
  }

  private shouldFetchFullContent(snippet: string): boolean {
    if (!snippet) {
      return true;
    }
    if (snippet.length < MIN_FEED_TEXT_LENGTH) {
      return true;
    }
    if (/https?:\/\//i.test(snippet)) {
      return true;
    }
    if (/\b(click\s+here|apply\s+now|read\s+more)\b/i.test(snippet)) {
      return true;
    }
    return false;
  }

  private async fetchOriginalPage(url: string, meta: RssMetadata): Promise<string | null> {
    const userAgent = meta.userAgent ?? DEFAULT_UA;
    const headers = this.buildRequestHeaders(meta, userAgent);
    const proxyConfig = this.buildProxyConfig(meta);
    try {
      const response = await axios.get<string>(url, {
        headers,
        timeout: PAGE_FETCH_TIMEOUT_MS,
        responseType: 'text',
        maxRedirects: 5,
        proxy: proxyConfig,
        // Некоторые сайты возвращают 4xx/5xx, но нам достаточно кода 200..399
        validateStatus: (status) => status >= 200 && status < 400,
      });
      const html = response.data ?? '';
      const contentType = this.normalizeHeaderValue(
        response.headers?.['content-type'] ?? response.headers?.['Content-Type'],
      );
      const challengeMarker = this.detectHtmlChallenge(html, contentType);
      if (challengeMarker) {
        throw new ProxyBlockedError(response.status ?? 403, meta.proxyHost, `challenge:${challengeMarker}`);
      }
      return html;
    } catch (error) {
      if (error instanceof ProxyBlockedError) {
        throw error;
      }
      if (axios.isAxiosError?.(error)) {
        const status = error.response?.status ?? 0;
        const challengeMarker = error.response?.data
          ? this.detectHtmlChallenge(String(error.response.data), this.normalizeHeaderValue(error.response.headers?.['content-type']))
          : null;
        if (challengeMarker) {
          throw new ProxyBlockedError(status, meta.proxyHost, `challenge:${challengeMarker}`);
        }
        if (status === 403 || status === 401) {
          throw new ProxyBlockedError(status, meta.proxyHost, error.code ?? 'page_forbidden');
        }
      }

      if (this.isProxyNetworkError(error as { code?: string; message?: string })) {
        throw new ProxyBlockedError(0, meta.proxyHost, (error as { code?: string; message?: string }).code ?? 'network_error');
      }
      return null;
    }
  }

  private extractMainText(html: string): string | null {
    if (!html) {
      return null;
    }
    try {
      const $ = load(html);
      $('script, style, noscript, iframe, svg').remove();
      const selectorCandidates = [
        'article',
        'main',
        '[role="main"]',
        '.job',
        '.job-content',
        '.job__content',
        '.job-description',
        '.job__description',
        '.description',
        '#job',
      ];
      for (const selector of selectorCandidates) {
        const section = $(selector).first();
        if (!section || section.length === 0) {
          continue;
        }
        const text = this.normalizeWhitespace(section.text());
        if (text && text.length >= 200) {
          return this.truncateRawContent(text);
        }
      }
      const bodyText = this.normalizeWhitespace($('body').text());
      if (bodyText) {
        return this.truncateRawContent(bodyText);
      }
    } catch {
      const stripped = this.normalizeWhitespace(html.replace(/<[^>]+>/g, ' '));
      if (stripped) {
        return this.truncateRawContent(stripped);
      }
    }
    return null;
  }

  private truncateRawContent(text: string): string {
    if (!text) {
      return '';
    }
    if (text.length <= MAX_RAW_CONTENT_LENGTH) {
      return text;
    }
    return text.slice(0, MAX_RAW_CONTENT_LENGTH);
  }

  private normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  private extractText(html: string): string {
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

  private extractDescription(item: ParserItem): string | null {
    // Приоритет: contentSnippet > content > description (если есть)
    const itemWithDesc = item as ParserItem & { description?: string };
    const text =
      item.contentSnippet ||
      (typeof item.content === 'string' ? item.content : (item.content as { '#text'?: string })?.['#text'] || '') ||
      itemWithDesc.description ||
      '';

    if (!text) {
      return null;
    }

    // Если это HTML, извлекаем текст
    if (text.includes('<') || text.includes('&')) {
      try {
        const $ = load(text);
        return $.text().trim() || null;
      } catch {
        // Если не удалось распарсить, возвращаем как есть
        return text.trim() || null;
      }
    }

    return text.trim() || null;
  }

  private normalizeLink(link: string, feedUrl: string): string | null {
    if (!link) {
      return null;
    }

    try {
      // Если это абсолютный URL
      if (link.startsWith('http://') || link.startsWith('https://')) {
        return link;
      }

      // Если это относительный URL, делаем его абсолютным
      const baseUrl = new URL(feedUrl);
      return new URL(link, baseUrl).toString();
    } catch {
      return link;
    }
  }

  private parseDate(dateStr: string | undefined): Date | null {
    if (!dateStr) {
      return null;
    }

    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        return null;
      }
      return date;
    } catch {
      return null;
    }
  }

  private extractTags(item: ParserItem): string | null {
    const categories: string[] = [];

    // RSS категории
    if (item.categories && Array.isArray(item.categories)) {
      categories.push(...item.categories.map((c: unknown) => String(c).trim()));
    } else if (item.categories) {
      categories.push(String(item.categories).trim());
    }

    // Atom категории (tags)
    if ((item as { tags?: Array<{ term?: string }> }).tags) {
      const tags = (item as { tags: Array<{ term?: string }> }).tags;
      categories.push(...tags.map((t) => (t.term || '').trim()).filter(Boolean));
    }

    if (categories.length === 0) {
      return null;
    }

    return categories.join(', ');
  }

  private getItemId(item: ParserItem): string {
    // Приоритет: guid > id > link
    return item.guid || (item as { id?: string }).id || item.link || '';
  }

  private buildHash(item: ParserItem, link: string): string {
    const id = this.getItemId(item);
    const title = item.title || '';
    const pubDate = item.pubDate || item.isoDate || '';

    // Генерируем хеш на основе уникальных идентификаторов
    const hashInput = `${id}|${link}|${title}|${pubDate}`;
    return crypto.createHash('sha256').update(hashInput).digest('hex').substring(0, 16);
  }

  private buildProxyConfig(meta: RssMetadata): { host: string; port: number; protocol: string; auth?: { username: string; password: string } } | undefined {
    if (!meta.proxyHost || !meta.proxyPort) {
      return undefined;
    }

    return {
      host: meta.proxyHost,
      port: meta.proxyPort,
      auth:
        meta.proxyUsername && meta.proxyPassword
          ? {
              username: meta.proxyUsername,
              password: meta.proxyPassword,
            }
          : undefined,
      protocol: 'http',
    };
  }

  private buildRequestHeaders(meta: RssMetadata, userAgent: string): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': userAgent,
      Accept: meta.acceptHeader ?? DEFAULT_ACCEPT,
      'Accept-Language': meta.acceptLanguage ?? DEFAULT_ACCEPT_LANGUAGE,
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      'Upgrade-Insecure-Requests': '1',
    };

    if (meta.referer) {
      headers['Referer'] = meta.referer;
    }
    if (meta.cookieHeader) {
      headers['Cookie'] = meta.cookieHeader;
    }

    if (meta.headers) {
      for (const [key, value] of Object.entries(meta.headers)) {
        if (typeof value === 'string' && value.trim()) {
          headers[key] = value;
        }
      }
    }

    return headers;
  }

  private buildCutoffDate(): Date {
    // Возвращаем дату 30 дней назад для фильтрации старых постов
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date;
  }

  private removePreXmlContent(xml: string): string {
    // Удаляем BOM (Byte Order Mark) и другие невидимые символы в начале
    xml = xml.replace(/^[\uFEFF\u200B-\u200D\u2060]+/, '');
    
    // Агрессивно удаляем все символы перед первым символом <
    // Это самый надежный способ - находим первый < и удаляем все до него
    const firstBracket = xml.indexOf('<');
    if (firstBracket > 0) {
      xml = xml.substring(firstBracket);
    } else if (firstBracket === -1) {
      // Если вообще нет символа <, возвращаем пустую строку
      return '';
    }
    
    // Удаляем ведущие пробелы и переносы строк только если XML не начинается с декларации
    // XML декларация должна начинаться с <?xml без пробелов перед ней
    const trimmed = xml.trimStart();
    if (trimmed.startsWith('<?xml')) {
      // Если есть XML декларация, оставляем как есть (уже обрезали до <)
      return xml;
    } else {
      // Если нет XML декларации, удаляем ведущие пробелы
      return trimmed;
    }
  }

  private cleanMalformedTags(xml: string): string {
    // Удаляем теги с некорректными символами в именах тегов (не в содержимом)
    // Теги не могут содержать < или > в своем имени
    xml = xml.replace(/<[\/]?[^>]*[<>][^>]*>/g, '');

    // Удаляем теги, которые содержат управляющие символы в именах
    xml = xml.replace(/<[^>]*[\x00-\x08\x0B-\x0C\x0E-\x1F][^>]*>/g, '');

    return xml;
  }

  private aggressiveXmlCleanup(xml: string): string {
    // Более агрессивная очистка для проблемных фидов
    
    // Сначала еще раз удаляем текст перед XML (на случай если он появился снова)
    xml = this.removePreXmlContent(xml);
    
    // Сохраняем XML декларацию, если она есть
    let xmlDeclaration = '';
    const declarationMatch = xml.match(/^<\?xml[^>]*\?>/i);
    if (declarationMatch) {
      xmlDeclaration = declarationMatch[0];
      xml = xml.substring(declarationMatch[0].length);
    }
    
    // Удаляем комментарии, которые могут содержать некорректный XML
    xml = xml.replace(/<!--[\s\S]*?-->/g, '');
    
    // Удаляем обработчики инструкций, которые могут быть некорректными (кроме XML декларации)
    xml = xml.replace(/<\?[^>]*\?>/g, '');
    
    // Удаляем DOCTYPE, который может быть некорректным
    xml = xml.replace(/<!DOCTYPE[^>]*>/gi, '');
    
    // Экранируем некорректные символы < и > в содержимом тегов
    // Находим содержимое между > и < и экранируем в нем некорректные символы
    xml = xml.replace(/>([^<]*<[^>]*>[^<]*)</g, (match) => {
      // Если между > и < есть текст с некорректными символами, экранируем их
      // Но сохраняем валидные теги
      return match.replace(/([^<>]*?)(<[^>]+>)([^<>]*?)/g, (m, before, tag, after) => {
        // Экранируем < и > в тексте до и после тега
        const cleanBefore = before.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const cleanAfter = after.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return cleanBefore + tag + cleanAfter;
      });
    });
    
    // Удаляем теги с пробелами в начале имени
    xml = xml.replace(/<[\/]?\s+[^>]*>/g, '');
    
    // Удаляем теги, которые содержат управляющие символы
    xml = xml.replace(/<[^>]*[\x00-\x08\x0B-\x0C\x0E-\x1F][^>]*>/g, '');
    
    // Удаляем теги с некорректными символами в именах
    xml = xml.replace(/<[\/]?[^>]*[<>][^>]*>/g, '');

    // Возвращаем XML декларацию в начало, если она была
    return xmlDeclaration ? xmlDeclaration + '\n' + xml : xml;
  }

  private ensureXmlPayload(xml: string, rawPayload?: string): void {
    if (!xml || !xml.trim()) {
      const preview = this.buildPayloadPreview(rawPayload);
      if (preview) {
        throw new Error(`RSS feed returned non-XML content: ${preview}`);
      }
      throw new Error('RSS feed returned empty response');
    }

    const trimmed = xml.trimStart();
    if (trimmed.startsWith('<')) {
      return;
    }

    const cleaned = this.removePreXmlContent(trimmed);
    if (cleaned.startsWith('<')) {
      return;
    }

    const firstTagIndex = trimmed.indexOf('<');
    if (firstTagIndex > 0) {
      const candidate = trimmed.slice(firstTagIndex);
      if (candidate.startsWith('<')) {
        return;
      }
    }

    const preview = this.buildPayloadPreview(cleaned || trimmed || rawPayload);

    throw new Error(
      `RSS feed returned non-XML content${preview ? `: ${preview}` : ''}`,
    );
  }

  private buildPayloadPreview(payload?: string | null): string | null {
    if (!payload) {
      return null;
    }
    const trimmed = payload.trim();
    if (!trimmed) {
      return null;
    }
    return trimmed
      .slice(0, NON_XML_PREVIEW_LENGTH)
      .replace(/\s+/g, ' ')
      .trim();
  }

  private detectHtmlChallenge(xml: string, contentType?: string): string | null {
    if (!xml) {
      return null;
    }

    const lower = xml.trim().toLowerCase();
    const looksLikeHtml = lower.startsWith('<!doctype html') || lower.startsWith('<html');
    const isHtmlContent = typeof contentType === 'string' && contentType.toLowerCase().includes('text/html');
    if (!looksLikeHtml && !isHtmlContent) {
      return null;
    }

    for (const marker of HTML_CHALLENGE_MARKERS) {
      if (lower.includes(marker)) {
        return marker;
      }
    }

    if (isHtmlContent) {
      return 'html_response';
    }

    return null;
  }

  private normalizeHeaderValue(value: unknown): string | undefined {
    if (!value) {
      return undefined;
    }
    if (Array.isArray(value)) {
      return value.join(';');
    }
    return String(value);
  }

  private isNonXmlError(err: Error): boolean {
    const msg = err.message?.toLowerCase() ?? '';
    return msg.includes('non-whitespace before first tag') || msg.includes('text data outside of root node');
  }

  private isProxyNetworkError(err: { code?: string; message?: string }): boolean {
    const code = err.code?.toUpperCase();
    if (code) {
      const transientCodes = new Set([
        'ECONNRESET',
        'ECONNREFUSED',
        'ECONNABORTED',
        'ETIMEDOUT',
        'ESOCKETTIMEDOUT',
        'EHOSTUNREACH',
        'ENETUNREACH',
        'EPIPE',
        'EPROTO',
      ]);
      if (transientCodes.has(code)) {
        return true;
      }
    }
    const message = (err.message ?? '').toLowerCase();
    if (!message) {
      return false;
    }
    return (
      message.includes('tls') ||
      message.includes('wrong version number') ||
      message.includes('unable to verify the first certificate') ||
      message.includes('self signed certificate') ||
      message.includes('network socket disconnected') ||
      message.includes('timeout')
    );
  }
}
