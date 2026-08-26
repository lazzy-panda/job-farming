import axios from 'axios';
import { createHash } from 'node:crypto';
import { SourceConnector, SourceContext } from '../scrapers';

/**
 * Читает посты публичной страницы или группы Facebook через обычную веб-версию.
 *
 * Facebook рендерит данные постов в embedded-JSON внутри HTML (для залогиненной
 * сессии), поэтому коннектору НУЖНЫ cookies живой сессии пользователя:
 * metadata.cookieHeader (сервис подкладывает их из файла storage/facebook.cookies.txt).
 * Без cookies группа/страница отдаёт login-стену — коннектор кидает ошибку
 * facebook_login_required.
 *
 * Извлечение нарочно консервативное: ищем пары post_id → message.text в embedded
 * JSON. Разметка Facebook меняется; если пары перестанут находиться, коннектор
 * вернёт пустой список (empty run), а не мусор.
 */

type FacebookPost = {
  title: string;
  description?: string;
  link?: string;
  publishedAt?: Date;
  hash?: string;
  channel?: string;
};

type FacebookMetadata = {
  cookieHeader?: string;
  userAgent?: string;
  maxPosts?: number;
};

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const DEFAULT_MAX_POSTS = 30;
/** Окно поиска текста поста после его post_id в embedded JSON */
const PAIR_WINDOW = 12000;

export class FacebookConnector implements SourceConnector {
  async fetchNewJobs(ctx: SourceContext): Promise<FacebookPost[]> {
    const url = (ctx.url ?? '').trim();
    if (!url) {
      return [];
    }
    const meta = (ctx.metadata as FacebookMetadata) ?? {};
    const cookieHeader = (meta.cookieHeader ?? '').trim();
    if (!cookieHeader) {
      throw new Error('facebook_cookies_required');
    }

    const response = await axios.get<string>(url, {
      headers: {
        'User-Agent': meta.userAgent || DEFAULT_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8',
        Cookie: cookieHeader.replace(/^Cookie:\s*/i, ''),
      },
      timeout: 30000,
      responseType: 'text',
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const html = response.data ?? '';
    const finalUrl = (response.request?.res?.responseUrl as string | undefined) ?? url;
    if (/\/login|checkpoint/i.test(finalUrl) || /login_form|loginform/i.test(html)) {
      throw new Error('facebook_login_required');
    }

    const maxPosts = meta.maxPosts && meta.maxPosts > 0 ? meta.maxPosts : DEFAULT_MAX_POSTS;
    const posts = this.extractPosts(html, url).slice(0, maxPosts);
    return posts;
  }

  private extractPosts(html: string, baseUrl: string): FacebookPost[] {
    const results: FacebookPost[] = [];
    const seenTexts = new Set<string>();
    const channel = this.channelLabel(baseUrl);

    const idPattern = /"post_id":"(\d{6,})"/g;
    let match: RegExpExecArray | null;
    while ((match = idPattern.exec(html)) !== null) {
      const postId = match[1];
      const window = html.slice(match.index, match.index + PAIR_WINDOW);
      const text = this.firstMessageText(window);
      if (!text) {
        continue;
      }
      const normalized = text.trim();
      if (normalized.length < 40 || seenTexts.has(normalized)) {
        continue;
      }
      seenTexts.add(normalized);

      const creation = /"creation_time":(\d{10})/.exec(window);
      results.push({
        title: this.buildTitle(normalized),
        description: normalized,
        link: this.buildPostLink(baseUrl, postId),
        publishedAt: creation ? new Date(Number(creation[1]) * 1000) : undefined,
        hash: this.hashText(normalized),
        channel,
      });
    }

    // Фолбэк: тексты без распознанного post_id (структура сменилась) — с хэш-ссылкой
    if (results.length === 0) {
      const textPattern = /"message":\{"text":"((?:\\.|[^"\\])+)"/g;
      while ((match = textPattern.exec(html)) !== null) {
        const text = this.unescapeJson(match[1]).trim();
        if (text.length < 40 || seenTexts.has(text)) {
          continue;
        }
        seenTexts.add(text);
        const hash = this.hashText(text);
        results.push({
          title: this.buildTitle(text),
          description: text,
          link: `${baseUrl.replace(/\/+$/, '')}?jf_post=${hash.slice(0, 12)}`,
          hash,
          channel,
        });
      }
    }

    return results;
  }

  private firstMessageText(window: string): string | null {
    const m = /"message":\{"text":"((?:\\.|[^"\\])+)"/.exec(window);
    return m ? this.unescapeJson(m[1]) : null;
  }

  private unescapeJson(raw: string): string {
    try {
      return JSON.parse(`"${raw}"`) as string;
    } catch {
      return raw.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\//g, '/');
    }
  }

  private buildTitle(text: string): string {
    const firstLine = text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    const title = firstLine ?? text;
    return title.length > 140 ? `${title.slice(0, 140)}…` : title;
  }

  private buildPostLink(baseUrl: string, postId: string): string {
    const groupMatch = /facebook\.com\/(groups\/[^/?#]+)/i.exec(baseUrl);
    if (groupMatch) {
      return `https://www.facebook.com/${groupMatch[1]}/posts/${postId}/`;
    }
    return `https://www.facebook.com/${postId}`;
  }

  private channelLabel(baseUrl: string): string {
    const m = /facebook\.com\/(?:groups\/)?([^/?#]+)/i.exec(baseUrl);
    return m ? `facebook/${m[1]}` : 'facebook';
  }

  private hashText(text: string): string {
    return createHash('sha1').update(text).digest('hex');
  }
}
