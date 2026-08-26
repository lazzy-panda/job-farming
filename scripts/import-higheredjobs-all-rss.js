/*
  Импортирует ВСЕ RSS ленты с higheredjobs.com/rss/ в базу данных
  Извлекает прямые ссылки со страницы
  
  Usage:
    DATABASE_URL=file:./dev.db node scripts/import-higheredjobs-all-rss.js
*/

const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const { load } = require('cheerio');

const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
process.env.DATABASE_URL = dbUrl;
let prisma;

async function initPrismaClient() {
  const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
  const adapter = new PrismaBetterSqlite3({ url: dbUrl });
  const client = new PrismaClient({ adapter });
  await client.$queryRawUnsafe('SELECT 1;');
  return client;
}

async function fetchPage(url, extraHeaders = {}) {
  const isJinaMirror = url.includes('r.jina.ai');
  const headers = isJinaMirror
    ? {
        'User-Agent': 'curl/8.6.0',
        Accept: '*/*',
      }
    : {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      };
  const finalHeaders = { ...headers, ...extraHeaders };
  const response = await axios.get(url, { headers: finalHeaders, timeout: 30000, maxRedirects: 5 });
  return response.data;
}

function containsBlockPage(html) {
  if (!html) return true;
  const markers = [
    'Pardon Our Interruption',
    '_Incapsula_Resource',
    'Request unsuccessful',
    'Reference ID',
  ];
  return markers.some((token) => html.includes(token));
}

function extractLinksFromContent(content) {
  const rssLinks = new Set();

  const normalizeLink = (raw) => {
    if (!raw) return null;
    const lower = raw.toLowerCase();
    if (!lower.includes('higheredjobs.com')) {
      return null;
    }
    const httpsIndex = raw.lastIndexOf('https://www.higheredjobs.com');
    const httpIndex = raw.lastIndexOf('http://www.higheredjobs.com');
    const startIndex = httpsIndex !== -1 ? httpsIndex : httpIndex;
    if (startIndex === -1) {
      return null;
    }
    let clean = raw.slice(startIndex);
    clean = clean.replace(/\\]+$/, '');
    clean = clean.replace(/\)+$/, '');
    clean = clean.replace(/[,.;]+$/, '');
    if (!clean.startsWith('http')) {
      clean = `https://${clean.replace(/^\/+/, '')}`;
    }
    const normalized = clean.replace(/\/+$/, '/');
    if (normalized === 'https://www.higheredjobs.com/rss/') {
      return null;
    }
    return clean;
  };

  if (/<a\b/i.test(content)) {
    const $ = load(content);
    $('a[href]').each((_i, elem) => {
      const href = normalizeLink($(elem).attr('href'));
      if (
        href &&
        href.includes('higheredjobs.com') &&
        (href.includes('rss') || href.includes('feed') || href.endsWith('.xml'))
      ) {
        rssLinks.add(href);
      }
    });
  }

  const absolutePattern = /https?:\/\/[^\s"'<>]+/gi;
  const absoluteMatches = content.match(absolutePattern);
  if (absoluteMatches) {
    absoluteMatches.forEach((link) => {
      const normalized = normalizeLink(link);
      if (
        normalized &&
        normalized.includes('higheredjobs.com') &&
        (normalized.includes('rss') || normalized.includes('feed') || normalized.endsWith('.xml'))
      ) {
        rssLinks.add(normalized);
      }
    });
  }

  const pathPattern = /\/rss\/[^\s"'<>]+/gi;
  const pathMatches = content.match(pathPattern);
  if (pathMatches) {
    pathMatches.forEach((path) => {
      const normalized =
        path.startsWith('/')
          ? `https://www.higheredjobs.com${path}`
          : `https://www.higheredjobs.com/${path}`;
      rssLinks.add(normalized.replace(/[),.]+$/, ''));
    });
  }

  return Array.from(rssLinks).filter(
    (link) =>
      link.includes('higheredjobs.com') &&
      !['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].some((ext) =>
        link.toLowerCase().endsWith(ext),
      ) &&
      (link.includes('rss') || link.includes('feed') || link.includes('jobs.cfm') || link.endsWith('.xml')),
  );
}

async function fetchRssLinks() {
  const primaryUrl = 'https://www.higheredjobs.com/rss/';
  let html = null;

  try {
    html = await fetchPage(primaryUrl);
  } catch (primaryError) {
    console.warn('Не удалось загрузить основную страницу, пробуем зеркало:', primaryError.message);
  }

  if (!html || containsBlockPage(html)) {
    try {
    html = await fetchPage('https://r.jina.ai/https://www.higheredjobs.com/rss/');
  } catch (fallbackError) {
    console.error('Не удалось загрузить fallback-страницу:', fallbackError.message);
    html = null;
    }
  }

  if (!html) {
    return [];
  }

  return extractLinksFromContent(html);
}

async function main() {
  prisma = await initPrismaClient();
  console.log('Получение списка RSS лент с https://www.higheredjobs.com/rss/...\n');
  
  const rssLinks = await fetchRssLinks();
  
  if (rssLinks.length === 0) {
    console.log('Не удалось получить список RSS лент со страницы.');
    console.log('Попробуйте проверить доступность сайта или добавить ссылки вручную.');
    await prisma.$disconnect();
    return;
  }
  
  console.log(`Найдено ${rssLinks.length} RSS лент:\n`);
  rssLinks.forEach((link, i) => {
    console.log(`${i + 1}. ${link}`);
  });
  console.log('\n');
  
  let added = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const url of rssLinks) {
    try {
      // Проверяем, существует ли уже такой источник
      const existing = await prisma.source.findFirst({
        where: {
          url: url,
          sourceType: 'rss',
        },
      });
      
      if (existing) {
        console.log(`⏭  Пропущен (уже существует): ${url}`);
        skipped++;
        continue;
      }
      
      // Генерируем имя из URL
      const urlObj = new URL(url);
      const params = new URLSearchParams(urlObj.search);
      let name = 'HigherEdJobs';
      
      // Пытаемся извлечь информацию из параметров
      const jobCat = params.get('JobCat');
      const jobType = params.get('JobType');
      const workType = params.get('WorkType');
      const state = params.get('State');
      
      const parts = [];
      if (jobCat) {
        const categories = {
          '1': 'Faculty', '2': 'Administrative', '3': 'Executive', '4': 'Staff',
          '5': 'Postdoctoral', '6': 'Graduate Assistant', '7': 'Adjunct',
          '8': 'Internship', '9': 'Fellowship', '10': 'Research', '11': 'Other'
        };
        parts.push(categories[jobCat] || `Category ${jobCat}`);
      }
      if (workType) {
        const workTypes = { '1': 'On Site', '2': 'Remote', '3': 'Hybrid' };
        parts.push(workTypes[workType] || `WorkType ${workType}`);
      }
      if (jobType) {
        const jobTypes = { '1': 'Full Time', '2': 'Part Time', '3': 'Temporary', '4': 'Contract' };
        parts.push(jobTypes[jobType] || `JobType ${jobType}`);
      }
      if (state) {
        parts.push(state);
      }
      
      if (parts.length > 0) {
        name = 'HigherEdJobs - ' + parts.join(' ');
      } else if (url.includes('jobs.cfm') && !url.includes('?')) {
        name = 'HigherEdJobs - All Jobs';
      } else {
        // Используем путь как имя
        const pathParts = urlObj.pathname.split('/').filter(p => p);
        if (pathParts.length > 0) {
          name = 'HigherEdJobs - ' + pathParts[pathParts.length - 1].replace(/\.(rss|xml|cfm)$/, '');
        }
      }
      
      // Создаем новый источник
      await prisma.source.create({
        data: {
          name: name,
          sourceType: 'rss',
          url: url,
          metadata: {},
        },
      });
      
      console.log(`✓ Добавлен: ${name}`);
      added++;
    } catch (error) {
      console.error(`✗ Ошибка при добавлении ${url}:`, error.message);
      errors++;
    }
  }
  
  console.log(`\nГотово!`);
  console.log(`Добавлено: ${added}`);
  console.log(`Пропущено: ${skipped}`);
  console.log(`Ошибок: ${errors}`);
  
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Ошибка:', e);
  process.exit(1);
});
