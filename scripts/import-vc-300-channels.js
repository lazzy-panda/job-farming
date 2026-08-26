/*
  Import Telegram channels from vc.ru article:
  https://vc.ru/hr/2295219-300-telegram-kanalov-s-vakansiyami

  Usage:
    DATABASE_URL=file:./dev.db node scripts/import-vc-300-channels.js
*/

const axios = require('axios');
const { decode } = require('html-entities');
const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const { load } = require('cheerio');

const ARTICLE_URL = 'https://vc.ru/hr/2295219-300-telegram-kanalov-s-vakansiyami';
const TELEGRAM_HOST = 'https://t.me/';
const USER_AGENT = 'JobFarmBot/1.0 (+local)';

const http = axios.create({
  headers: { 'User-Agent': USER_AGENT },
  timeout: 30000,
  maxRedirects: 5,
  validateStatus: () => true,
});

function normalizeSlug(raw) {
  const v = (raw ?? '').toString().trim();
  if (!v) return null;
  const slug = v.replace(/^@/, '').trim();
  if (!slug) return null;
  const lower = slug.toLowerCase();
  if (lower.startsWith('+')) return null;
  if (lower.startsWith('joinchat')) return null;
  if (lower === 's') return null;
  if (!/^[a-zA-Z0-9_]{3,64}$/.test(slug)) return null;
  return slug;
}

function extractSlugFromTelegramUrl(url) {
  const u = (url ?? '').toString().trim();
  if (!u) return null;
  try {
    const parsed = new URL(u.startsWith('http') ? u : `${TELEGRAM_HOST}${u}`);
    const parts = parsed.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
    if (parts.length === 0) return null;
    const first = parts[0].toLowerCase() === 's' ? parts[1] : parts[0];
    return normalizeSlug(first);
  } catch {
    return null;
  }
}

function extractVcRedirectTarget(href) {
  const h = (href ?? '').toString();
  const m = /to=([^"&]+)/i.exec(h);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

function cleanText(raw) {
  const withoutTags = (raw ?? '').toString().replace(/<[^>]+>/g, '');
  return decode(withoutTags).replace(/\s+/g, ' ').trim();
}

function extractCandidatesFromHtml(pageUrl, html) {
  const candidates = new Map(); // slug -> { slug, url, name, sources[] }
  const $ = load(html);

  const add = (slug, nameHint) => {
    const s = normalizeSlug(slug);
    if (!s) return;
    if (candidates.has(s)) {
      const prev = candidates.get(s);
      if (!prev.sources.includes(pageUrl)) prev.sources.push(pageUrl);
      return;
    }
    candidates.set(s, {
      slug: s,
      url: `${TELEGRAM_HOST}${s}`,
      name: (nameHint ?? s).toString().trim() || s,
      sources: [pageUrl],
    });
  };

  // 1) anchors with t.me links
  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') ?? '';
    const text = cleanText($(el).text());

    if (/t\.me\//i.test(href)) {
      const slug = extractSlugFromTelegramUrl(href);
      if (slug) add(slug, text);
      return;
    }

    if (/api\.vc\.ru\//i.test(href) && /to=/.test(href)) {
      const target = extractVcRedirectTarget(href);
      if (target && /t\.me\//i.test(target)) {
        const slug = extractSlugFromTelegramUrl(target);
        if (slug) add(slug, text);
      }
    }
  });

  // 2) raw occurrences in text/html: https://t.me/...
  const urlRe = /https?:\/\/t\.me\/(?:s\/)?([a-zA-Z0-9_]{3,64})/g;
  let m;
  while ((m = urlRe.exec(html)) !== null) {
    add(m[1], m[1]);
  }

  // 3) raw @mentions in text
  const atRe = /(^|[\s(])@([a-zA-Z0-9_]{3,64})/g;
  while ((m = atRe.exec(html)) !== null) {
    add(m[2], m[2]);
  }

  return Array.from(candidates.values());
}

async function fetchPage(url) {
  const resp = await http.get(url, { responseType: 'text' });
  if (resp.status < 200 || resp.status >= 400) {
    throw new Error(`Failed to fetch ${url}: status=${resp.status}`);
  }
  return resp.data;
}

function parseTelegramProfile(html) {
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
      title: title?.trim() || null,
      avatar: avatar?.trim() || null,
    };
  } catch {
    return { title: null, avatar: null };
  }
}

async function probeChannel(slug) {
  try {
    const resp = await http.get(`https://t.me/s/${slug}`, {
      responseType: 'text',
      maxRedirects: 0,
      timeout: 10000,
    });
    if (resp.status !== 200) {
      return { open: false, status: resp.status, title: null, avatar: null };
    }
    const profile = parseTelegramProfile(resp.data);
    return { open: true, status: resp.status, title: profile.title, avatar: profile.avatar };
  } catch (error) {
    return { open: false, status: 0, title: null, avatar: null, error: error.message };
  }
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function createPool(concurrency) {
  let active = 0;
  const queue = [];
  async function run(fn) {
    if (active >= concurrency) await new Promise((r) => queue.push(r));
    active += 1;
    try {
      return await fn();
    } finally {
      active = Math.max(0, active - 1);
      const next = queue.shift();
      if (next) next();
    }
  }
  return { run };
}

async function main() {
  const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
  const adapter = new PrismaBetterSqlite3({ url: dbUrl });
  const prisma = new PrismaClient({ adapter });

  console.log(`[import-vc-300] fetching article: ${ARTICLE_URL}`);
  const html = await fetchPage(ARTICLE_URL);
  const candidates = extractCandidatesFromHtml(ARTICLE_URL, html);
  console.log(`[import-vc-300] foundCandidates=${candidates.length}`);

  if (candidates.length === 0) {
    console.log('[import-vc-300] No candidates found. Exiting.');
    await prisma.$disconnect();
    return;
  }

  console.log(`[import-vc-300] probing channels (concurrency=6)...`);
  const pool = createPool(6);
  const probed = [];
  let idx = 0;
  for (const batch of chunk(candidates, 40)) {
    await Promise.all(
      batch.map((c) =>
        pool.run(async () => {
          const r = await probeChannel(c.slug);
          probed.push({ ...c, ...r });
          idx += 1;
          if (idx % 50 === 0) {
            console.log(`[import-vc-300] probeProgress=${idx}/${candidates.length}`);
          }
        }),
      ),
    );
  }

  const open = probed.filter((c) => c.open);
  const closed = probed.filter((c) => !c.open);

  console.log(`[import-vc-300] open=${open.length} closedOrInviteOnly=${closed.length}`);

  let created = 0;
  let updated = 0;
  let skippedExisting = 0;

  try {
    for (const c of open) {
      const url = `${TELEGRAM_HOST}${c.slug}`;
      const existing = await prisma.source.findFirst({ where: { url } });
      const metadata = {
        importedFrom: [ARTICLE_URL],
        importedAt: new Date().toISOString(),
        telegramSlug: c.slug,
        telegramTitle: c.title ?? c.name,
        telegramAvatar: c.avatar ?? null,
      };

      if (existing) {
        const currentMeta = (existing.metadata ?? {}) || {};
        const merged = {
          ...currentMeta,
          ...metadata,
          importedFrom: Array.from(
            new Set([
              ...(Array.isArray(currentMeta.importedFrom) ? currentMeta.importedFrom : []),
              ARTICLE_URL,
            ]),
          ),
        };
        const needsUpdate =
          (existing.name ?? '') !== (c.title ?? c.name) ||
          JSON.stringify(currentMeta) !== JSON.stringify(merged);
        if (needsUpdate) {
          await prisma.source.update({
            where: { id: existing.id },
            data: {
              name: c.title ?? c.name,
              metadata: merged,
            },
          });
          updated += 1;
        } else {
          skippedExisting += 1;
        }
        continue;
      }

      await prisma.source.create({
        data: {
          name: c.title ?? c.name,
          sourceType: 'telegram',
          url,
          metadata,
        },
      });
      created += 1;
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log(
    `[import-vc-300] DONE candidates=${candidates.length} open=${open.length} created=${created} updated=${updated} skippedExisting=${skippedExisting} closed=${closed.length}`,
  );

  if (closed.length > 0) {
    console.log('\n[import-vc-300] skipped (no public web view):');
    closed
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .slice(0, 50)
      .forEach((c) => console.log(`- ${c.slug} (status=${c.status})`));
    if (closed.length > 50) {
      console.log(`... and ${closed.length - 50} more`);
    }
  }
}

main().catch((err) => {
  console.error('[import-vc-300] FAILED', err);
  process.exitCode = 1;
});
