import axios from 'axios';
import { load } from 'cheerio';
import { SourceConnector, SourceContext } from '../scrapers';
import * as crypto from 'crypto';
import { ProxyBlockedError } from '../errors';

type TelegramMetadata = {
  channels?: string[];
  lastMessageId?: number;
  maxPages?: number;
  userAgent?: string;
  cookieHeader?: string;
  delayMs?: number;
  jitterMs?: number;
  proxyHost?: string;
  proxyPort?: number;
  proxyUsername?: string;
  proxyPassword?: string;
  max429Retry?: number;
  backoffMs?: number;
  lastHashes?: string[];
  emptyRuns?: number;
};

type ParsedJob = {
  title: string;
  description?: string;
  company?: string;
  location?: string;
  link?: string;
  tags?: string;
  publishedAt?: Date;
  messageId?: number;
  channel?: string;
  attachments?: string[];
  hash?: string;
};

const DEFAULT_MAX_PAGES = 3;
const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0';
const DEFAULT_DELAY_MS = 500;
const DEFAULT_JITTER_MS = 300;
const DEFAULT_BACKOFF_MS = 3000;
const DEFAULT_MAX_429_RETRY = 5;

export class TelegramHttpConnector implements SourceConnector {
  async fetchNewJobs(ctx: SourceContext): Promise<ParsedJob[]> {
    const meta = (ctx.metadata as TelegramMetadata) ?? {};
    const channels = this.resolveChannels(ctx, meta);
    if (!channels.length) {
      return [];
    }

    const jobs: ParsedJob[] = [];
    const cutoff = this.buildCutoffDate();

    for (const channel of channels) {
      const lastSeen = meta.lastMessageId ?? 0;
      const maxPages = meta.maxPages ?? DEFAULT_MAX_PAGES;
      const delayMs = meta.delayMs ?? DEFAULT_DELAY_MS;
      const jitterMs = meta.jitterMs ?? DEFAULT_JITTER_MS;

      // t.me/s отдаёт сообщения от старых к новым; идём от новых к старым
      // и уходим вглубь истории через ?before=<minId>, пока не упрёмся в
      // lastSeen / cutoff / конец истории.
      let beforeId: number | null = null;
      for (let page = 1; page <= maxPages; page += 1) {
        const html = await this.fetchPage(channel, beforeId, meta);
        if (!html) {
          break;
        }

        const parsed = this.parsePage(html, channel, lastSeen, cutoff);
        jobs.push(...parsed.newJobs);

        if (parsed.stop || parsed.minId === null || parsed.minId <= 1) {
          break;
        }
        if (beforeId !== null && parsed.minId >= beforeId) {
          // страница не продвинулась назад — конец истории
          break;
        }
        beforeId = parsed.minId;
        await this.waitWithJitter(delayMs, jitterMs);
      }
    }

    return jobs;
  }

  private resolveChannels(ctx: SourceContext, meta: TelegramMetadata): string[] {
    if (meta.channels?.length) {
      return meta.channels;
    }
    if (ctx.url) {
      const matched = ctx.url.match(/t\.me\/(?:s\/)?([^/?#]+)/i);
      if (matched?.[1]) {
        return [matched[1]];
      }
    }
    return [];
  }

  private buildCutoffDate(): Date {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);
    return cutoff;
  }

  private async fetchPage(
    channel: string,
    beforeId: number | null,
    meta: TelegramMetadata,
  ): Promise<string> {
    const url = beforeId
      ? `https://t.me/s/${channel}?before=${beforeId}`
      : `https://t.me/s/${channel}`;
    const max429 = meta.max429Retry ?? DEFAULT_MAX_429_RETRY;
    const backoff = meta.backoffMs ?? DEFAULT_BACKOFF_MS;
    for (let attempt = 0; attempt <= max429; attempt += 1) {
      try {
        const headers: Record<string, string> = {
          'user-agent': meta.userAgent ?? DEFAULT_UA,
        };
        if (meta.cookieHeader) {
          headers['Cookie'] = meta.cookieHeader;
        }
        const res = await axios.get(url, {
          headers,
          timeout: 10000,
          proxy: meta.proxyHost && meta.proxyPort
            ? {
                host: meta.proxyHost,
                port: meta.proxyPort,
                protocol: 'https',
                auth:
                  meta.proxyUsername && meta.proxyPassword
                    ? {
                        username: meta.proxyUsername,
                        password: meta.proxyPassword,
                      }
                    : undefined,
              }
            : undefined,
        });
        return res.data as string;
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 429 && attempt < max429) {
          await this.waitWithJitter(backoff, backoff);
          continue;
        }
        if (status === 403 || status === 429) {
          throw new ProxyBlockedError(status ?? 0, meta.proxyHost);
        }
        return '';
      }
    }
    return '';
  }

  private parsePage(
    html: string,
    channel: string,
    lastSeen: number,
    cutoff: Date,
  ): { newJobs: ParsedJob[]; stop: boolean; minId: number | null } {
    const $ = load(html);
    // На странице сообщения идут от старых к новым — обрабатываем от новых к старым,
    // чтобы корректно останавливаться на lastSeen/cutoff, не теряя свежие посты.
    const elements = $('.tgme_widget_message').toArray().reverse();
    const newJobs: ParsedJob[] = [];
    let stop = false;
    let minId: number | null = null;

    for (const el of elements) {
      const dataPost = $(el).attr('data-post');
      if (!dataPost) continue;

      const [, idStr] = dataPost.split('/');
      const messageId = Number(idStr);
      if (!messageId || Number.isNaN(messageId)) continue;

      minId = minId === null ? messageId : Math.min(minId, messageId);

      if (messageId <= lastSeen) {
        stop = true;
        break;
      }

      const timeAttr =
        $(el).find('time[datetime]').first().attr('datetime') ??
        $(el).find('.tgme_widget_message_date time[datetime]').first().attr('datetime') ??
        null;
      const publishedAt = timeAttr ? new Date(timeAttr) : undefined;
      if (publishedAt && publishedAt < cutoff) {
        stop = true;
        break;
      }

      // Извлекаем текст с сохранением пробелов между элементами
      // Проблема: cheerio .text() склеивает текст из соседних элементов без пробелов
      // Решение: добавляем пробелы между элементами перед извлечением текста
      const textElement = $(el).find('.tgme_widget_message_text').clone();
      // Заменяем <br> на переносы строк
      textElement.find('br').replaceWith('\n');
      // Заменяем блочные элементы на переносы строк
      textElement.find('div, p').each((__, elem) => {
        $(elem).replaceWith(`\n${$(elem).text()}\n`);
      });
      // Добавляем пробелы между inline элементами, чтобы не склеивать слова
      // Находим все текстовые узлы и элементы, добавляем пробелы между ними
      const html = textElement.html() || '';
      // Заменяем закрывающий тег + открывающий тег на закрывающий тег + пробел + открывающий тег
      // Это добавит пробелы между соседними элементами
      const withSpaces = html
        .replace(/(<\/[^>]+>)(<[^/][^>]*>)/g, '$1 $2') // Между закрывающим и открывающим тегом
        .replace(/([^>\s])(<[^/][^>]*>)/g, '$1 $2') // Перед открывающим тегом, если нет пробела
        .replace(/(<\/[^>]+>)([^<\s])/g, '$1 $2'); // После закрывающего тега, если нет пробела
      const tempEl = $('<div>').html(withSpaces);
      const rawText = tempEl.text().trim();
      const normalizedText = this.normalizeText(rawText);
      const links: string[] = [];
      $(el)
        .find('.tgme_widget_message_text a')
        .each((__, linkEl) => {
          const href = $(linkEl).attr('href');
          if (href) links.push(href);
        });
      const hashtags: string[] = [];
      $(el)
        .find('.tgme_widget_message_text a')
        .each((__, linkEl) => {
          const href = $(linkEl).attr('href');
          if (href?.startsWith('https://t.me/s/hashtag/') || href?.startsWith('tg://search_hashtag')) {
            const tag = $(linkEl).text();
            if (tag) hashtags.push(tag);
          }
        });

      const attachments = links.filter((l) => this.isHttpLink(l) && !this.isHashtagLink(l));
      const title = this.buildTitle(normalizedText);
      const hash = this.hashText(normalizedText);
      const job: ParsedJob = {
        title,
        description: normalizedText,
        company: undefined,
        location: undefined,
        link: links[0] ?? `https://t.me/${channel}/${messageId}`,
        tags: hashtags.length ? hashtags.join(', ') : undefined,
        publishedAt,
        messageId,
        channel,
        attachments,
        hash,
      };
      newJobs.push(job);
    }

    return { newJobs, stop, minId };
  }

  private buildTitle(text: string): string {
    if (!text) return 'Вакансия';
    const firstLine = text.split('\n').find((line) => line.trim().length > 0);
    return (firstLine ?? 'Вакансия').slice(0, 120);
  }

  private normalizeText(text: string): string {
    const withoutEmoji = text.replace(/\p{Extended_Pictographic}/gu, '');
    // Сохраняем переносы строк, но нормализуем множественные пробелы
    // Заменяем множественные пробелы на один, но сохраняем переносы строк
    const normalized = withoutEmoji
      .replace(/[ \t]+/g, ' ') // Множественные пробелы/табы -> один пробел
      .replace(/\n{3,}/g, '\n\n') // Множественные переносы -> два переноса
      .trim();
    return normalized;
  }

  private hashText(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  private isHttpLink(href: string): boolean {
    return /^https?:\/\//i.test(href);
  }

  private isHashtagLink(href: string): boolean {
    return href.startsWith('https://t.me/s/hashtag/') || href.startsWith('tg://search_hashtag');
  }

  private async waitWithJitter(delayMs: number, jitterMs: number): Promise<void> {
    const jitter = Math.floor(Math.random() * (jitterMs + 1));
    const ms = Math.max(0, delayMs + jitter);
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
