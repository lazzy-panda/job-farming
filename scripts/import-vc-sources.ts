import 'dotenv/config';
import axios from 'axios';
import { decode } from 'html-entities';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { load } from 'cheerio';

const ARTICLE_URL =
  'https://vc.ru/hr/1667886-50-telegram-kanalov-dlya-poiska-udalennoi-raboty-i-vakansii-v-2024-godu';
const TELEGRAM_HOST = 'https://t.me/';

type ChannelCandidate = {
  name: string;
  url: string;
  slug: string;
};

type ChannelStatus = ChannelCandidate & {
  status?: number;
  open: boolean;
  reason?: string;
  title?: string | null;
  avatar?: string | null;
};

const http = axios.create({
  headers: {
    'User-Agent': 'JobFarmBot/1.0 (+https://github.com/)',
  },
  timeout: 15000,
  maxRedirects: 0,
  validateStatus: () => true,
});

async function fetchArticle(): Promise<string> {
  const { data } = await http.get<string>(ARTICLE_URL, { responseType: 'text' });
  return data;
}

function cleanText(raw: string): string {
  const withoutTags = raw.replace(/<[^>]+>/g, '');
  return decode(withoutTags).replace(/\s+/g, ' ').trim();
}

function extractChannels(html: string): ChannelCandidate[] {
  const regex =
    /<a[^>]+href="https:\/\/api\.vc\.ru\/[^"]+to=([^"&]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const map = new Map<string, ChannelCandidate>();
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const target = decodeURIComponent(match[1]);
    if (!target.startsWith('http://t.me') && !target.startsWith('https://t.me')) {
      continue;
    }
    let slug: string;
    try {
      const u = new URL(target.startsWith('http') ? target : `${TELEGRAM_HOST}${target}`);
      slug = u.pathname.replace(/^\/+/, '').split('/')[0];
    } catch {
      continue;
    }
    if (!slug || slug.startsWith('+') || slug.toLowerCase().startsWith('joinchat')) {
      continue;
    }
    const url = `${TELEGRAM_HOST}${slug}`;
    if (map.has(slug)) continue;
    const name = cleanText(match[2]) || slug;
    map.set(slug, { name, url, slug });
  }
  return Array.from(map.values());
}

async function probeChannel(slug: string): Promise<{
  status?: number;
  open: boolean;
  reason?: string;
  title?: string | null;
  avatar?: string | null;
}> {
  try {
    const resp = await http.get(`https://t.me/s/${slug}`);
    if (resp.status === 200) {
      const profile = parseTelegramProfile(resp.data);
      return {
        status: resp.status,
        open: true,
        reason: 'ok',
        title: profile.title ?? null,
        avatar: profile.avatar ?? null,
      };
    }
    return { status: resp.status, open: false, reason: `status ${resp.status}` };
  } catch (error) {
    return { open: false, reason: (error as Error).message };
  }
}

function parseTelegramProfile(html: string): { title?: string; avatar?: string } {
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

async function addSources(openChannels: ChannelStatus[]) {
  const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
  const adapter = new PrismaBetterSqlite3({ url: dbUrl });
  const prisma = new PrismaClient({ adapter });

  const created: string[] = [];

  try {
    for (const channel of openChannels) {
      const existing = await prisma.source.findFirst({ where: { url: channel.url } });
      const metadata = {
        article: ARTICLE_URL,
        telegramSlug: channel.slug,
        telegramTitle: channel.title ?? channel.name,
        telegramAvatar: channel.avatar ?? null,
      };
      if (existing) {
        const currentMeta = (existing.metadata as Record<string, unknown>) ?? {};
        const needsUpdate =
          currentMeta.telegramAvatar !== metadata.telegramAvatar ||
          currentMeta.telegramTitle !== metadata.telegramTitle;
        if (needsUpdate) {
          await prisma.source.update({
            where: { id: existing.id },
            data: {
              name: channel.title ?? channel.name,
              metadata: {
                ...currentMeta,
                ...metadata,
              },
            },
          });
        }
        continue;
      }
      await prisma.source.create({
        data: {
          name: channel.title ?? channel.name,
          sourceType: 'telegram',
          url: channel.url,
          metadata,
        },
      });
      created.push(channel.slug);
    }
  } finally {
    await prisma.$disconnect();
  }
  return created;
}

async function main() {
  console.log('Fetching article…');
  const html = await fetchArticle();
  const candidates = extractChannels(html);
  console.log(`Found ${candidates.length} unique telegram links in article.`);

  const statuses: ChannelStatus[] = [];
  for (const candidate of candidates) {
    const { open, status, reason, title, avatar } = await probeChannel(candidate.slug);
    statuses.push({ ...candidate, open, status, reason, title, avatar });
  }

  const openChannels = statuses.filter((c) => c.open);
  console.log(`Channels with public web view: ${openChannels.length}`);

  const created = await addSources(openChannels);
  console.log(`Inserted ${created.length} new sources.`);

  const skipped = statuses.filter((c) => !c.open);
  if (skipped.length) {
    console.log('\nSkipped channels (no web view or invite only):');
    skipped.forEach((c) => {
      console.log(`- ${c.slug}: ${c.reason}`);
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
