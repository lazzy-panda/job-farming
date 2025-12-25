/*
  Обновляет названия Telegram-источников, извлекая их из метаданных или HTML.

  Usage:
    DATABASE_URL=file:./prisma/dev.db node scripts/update-source-names.js
*/

const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const { load } = require('cheerio');

const dbUrl = process.env.DATABASE_URL || 'file:./prisma/dev.db';
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

const USER_AGENT = 'Mozilla/5.0 (compatible; JobFarmBot/1.0; +https://job.farm)';

function extractTelegramSlug(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    const parts = parsed.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
    if (parts.length === 0) return null;
    const first = parts[0].toLowerCase() === 's' ? parts[1] : parts[0];
    return first?.replace(/^@/, '').trim() || null;
  } catch {
    return null;
  }
}

function parseTelegramProfile(html) {
  try {
    const $ = load(html);
    let title =
      $('meta[property="og:title"]').attr('content')?.trim() ||
      $('.tgme_page_title span').first().text()?.trim() ||
      $('.tgme_page_title').first().text()?.trim() ||
      $('h1.tgme_page_title').first().text()?.trim() ||
      null;
    
    if (title) {
      title = title.replace(/^Telegram:\s*/i, '').trim();
      if (title.includes('t.me/')) {
        const match = title.match(/t\.me\/([^/\s]+)/);
        if (match && match[1]) {
          title = match[1].replace(/^s\//, '').trim();
        }
      }
    }
    
    return { title: title || undefined };
  } catch {
    return {};
  }
}

async function fetchChannelName(url) {
  const slug = extractTelegramSlug(url);
  if (!slug) return null;
  
  try {
    const probeUrl = `https://t.me/s/${slug}`;
    const response = await axios.get(probeUrl, {
      headers: { 'user-agent': USER_AGENT },
      maxRedirects: 10,
      validateStatus: () => true,
      responseType: 'text',
      timeout: 10000,
    });
    
    if (response.status !== 200) {
      return null;
    }
    
    const profile = parseTelegramProfile(response.data);
    return profile.title || slug;
  } catch {
    return slug; // Fallback to slug if fetch fails
  }
}

async function main() {
  console.log('Fetching all Telegram sources...');
  const sources = await prisma.source.findMany({
    where: { sourceType: 'telegram' },
    select: { id: true, name: true, url: true, metadata: true },
  });

  console.log(`Found ${sources.length} Telegram sources\n`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const source of sources) {
    const metadata = (source.metadata ?? {}) || {};
    const currentName = source.name?.trim();
    const url = source.url;
    
    // Проверяем, нужно ли обновлять название
    // Если название = URL или содержит "t.me", нужно обновить
    const needsUpdate = 
      !currentName ||
      currentName === url ||
      currentName.includes('t.me/') ||
      currentName.startsWith('https://');
    
    if (!needsUpdate) {
      skipped += 1;
      continue;
    }

    let newName = null;
    
    // Сначала пробуем взять из метаданных
    const telegramTitle = metadata.telegramTitle;
    if (telegramTitle && typeof telegramTitle === 'string' && telegramTitle.trim()) {
      newName = telegramTitle.trim();
    } else {
      // Если в метаданных нет, извлекаем slug из URL
      const slug = extractTelegramSlug(url);
      if (slug) {
        // Пробуем получить название из HTML
        const fetchedName = await fetchChannelName(url);
        newName = fetchedName || slug;
      } else {
        newName = url;
      }
    }

    if (!newName || newName === currentName) {
      skipped += 1;
      continue;
    }

    try {
      await prisma.source.update({
        where: { id: source.id },
        data: { name: newName },
      });
      
      updated += 1;
      console.log(`  ✓ Updated ${source.id}: "${currentName}" → "${newName}"`);
      
      // Небольшая задержка, чтобы не перегружать Telegram
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      errors += 1;
      console.error(`  ✗ Error updating ${source.id}:`, error.message);
    }
  }

  console.log(`\nDone: updated ${updated}, skipped ${skipped}, errors ${errors}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
