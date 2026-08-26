/*
  Добавляет источники вакансий под 12-недельный план поиска работы (трек А: DM/РП, RU-рынок):
    - RSS hh.ru (Delivery Manager / руководитель проектов / менеджер проектов, Россия, удалёнка)
    - RSS Хабр Карьеры (руководитель проектов, delivery manager)
    - Telegram-каналы вакансий из плана

  API hh.ru (api.hh.ru) с зарубежных IP отдаёт 403, поэтому используется публичный RSS hh.ru.

  Usage:
    DATABASE_URL=file:./dev.db node scripts/seed-plan-sources.js

  Сценарий безопасно переисполнять: существующие источники (по URL) пропускаются.
*/

const { PrismaClient } = require('@prisma/client');

const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
process.env.DATABASE_URL = dbUrl;

async function initPrismaClient() {
  const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
  const adapter = new PrismaBetterSqlite3({ url: dbUrl });
  const client = new PrismaClient({ adapter });
  await client.$queryRawUnsafe('SELECT 1;');
  return client;
}

const HH_RSS_URL =
  'https://hh.ru/search/vacancy/rss?text=' +
  encodeURIComponent('"Delivery Manager" OR "руководитель проектов" OR "менеджер проектов"') +
  '&area=113&schedule=remote&order_by=publication_time';

const SOURCES = [
  {
    name: 'hh.ru — Delivery Manager / РП (удалёнка, РФ)',
    sourceType: 'rss',
    url: HH_RSS_URL,
    // fetchFullContent=false: страницы hh.ru за антиботом, сниппета из фида достаточно
    metadata: {
      description: 'RSS поиска hh.ru под план: DM/руководитель проектов, remote, Россия',
      plan: true,
      fetchFullContent: false,
    },
  },
  {
    name: 'Хабр Карьера — руководитель проектов',
    sourceType: 'rss',
    url:
      'https://career.habr.com/vacancies/rss?q=' +
      encodeURIComponent('руководитель проектов') +
      '&type=all',
    metadata: { description: 'RSS Хабр Карьеры под план: руководитель проектов', plan: true },
  },
  {
    name: 'Хабр Карьера — delivery manager',
    sourceType: 'rss',
    url:
      'https://career.habr.com/vacancies/rss?q=' +
      encodeURIComponent('delivery manager') +
      '&type=all',
    metadata: { description: 'RSS Хабр Карьеры под план: delivery manager', plan: true },
  },
  // Каналы вакансий из плана. @agile_jobs не добавлен: t.me/s/agile_jobs недоступен (302 — канал закрыт или не существует).
  { name: null, sourceType: 'telegram', url: 'https://t.me/projects_jobs_feed', metadata: { plan: true } },
  { name: null, sourceType: 'telegram', url: 'https://t.me/forproducts', metadata: { plan: true } },
  { name: null, sourceType: 'telegram', url: 'https://t.me/job_SA_PM', metadata: { plan: true } },
  { name: null, sourceType: 'telegram', url: 'https://t.me/itpminfo', metadata: { plan: true } },
  // Дополнительные живые каналы с PM/DM/продуктовыми вакансиями (проверены 26.08.2026)
  { name: null, sourceType: 'telegram', url: 'https://t.me/product_jobs', metadata: { plan: true } },
  { name: null, sourceType: 'telegram', url: 'https://t.me/getitrussia', metadata: { plan: true } },
  { name: null, sourceType: 'telegram', url: 'https://t.me/remocate', metadata: { plan: true } },
  { name: null, sourceType: 'telegram', url: 'https://t.me/careerspace', metadata: { plan: true } },
];

async function main() {
  const prisma = await initPrismaClient();
  let created = 0;
  let skipped = 0;
  try {
    for (const src of SOURCES) {
      const existing = await prisma.source.findFirst({ where: { url: src.url } });
      if (existing) {
        skipped += 1;
        console.log(`skip (exists): ${src.url}`);
        continue;
      }
      const slug = src.url.replace(/^https:\/\/t\.me\//, '');
      await prisma.source.create({
        data: {
          name: src.name || slug,
          sourceType: src.sourceType,
          url: src.url,
          metadata: src.metadata,
        },
      });
      created += 1;
      console.log(`created: [${src.sourceType}] ${src.name || slug}`);
    }
    console.log(`done: created=${created} skipped=${skipped}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
