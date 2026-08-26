/*
  Импортирует все job API из каталога https://publicapi.dev/?query=job&page=1
  и добавляет/обновляет записи источников в БД.

  Пример запуска:
    DATABASE_URL=file:./dev.db node scripts/import-publicapi-job-apis.js
*/

const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

const PUBLIC_API_ROOT = 'https://publicapi.dev';
const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

const SOURCE_TYPE_MAP = {
  'their-stack-s-job-postings-api': 'theirstack',
  'fantastic-jobs-api': 'fantasticjobs',
  'jobdata-api': 'jobdata',
  'techmap-s-job-postings-api': 'techmap',
  'ok-job-api': 'okjob',
  'what-jobs-api': 'whatjobs',
  'usajobs-api': 'usajobs',
  'jobs2careers-api': 'jobs2careers',
  'graph-ql-jobs-api': 'graphqljobs',
  'dev-i-tjobs-uk-api': 'devitjobs',
  'jobicy-api': 'jobicy',
};

async function fetchBuildId() {
  const response = await axios.get(PUBLIC_API_ROOT, {
    headers: { 'User-Agent': 'JobFarmBot/1.0' },
  });
  const html = response.data;
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/,
  );
  if (!match) {
    throw new Error('Не удалось извлечь __NEXT_DATA__');
  }
  const nextData = JSON.parse(match[1]);
  return nextData?.buildId;
}

async function fetchJobApis(buildId) {
  if (!buildId) {
    throw new Error('Пустой buildId');
  }
  const url = `${PUBLIC_API_ROOT}/_next/data/${buildId}/index.json?query=job&page=1`;
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': 'JobFarmBot/1.0' },
  });
  return data?.pageProps?.apis ?? [];
}

function normalizeMetadata(api) {
  return {
    category: api.category ?? null,
    description: api.description ?? null,
    imageUrl: api.imageUrl ?? null,
    publicApiSlug: api.apiSlug ?? null,
    publicApiSource: `${PUBLIC_API_ROOT}/?query=job&page=1`,
  };
}

async function main() {
  const buildId = await fetchBuildId();
  const apis = await fetchJobApis(buildId);
  if (!apis.length) {
    console.warn('Каталог API пуст, ничего не импортируем.');
    return;
  }

  const toProcess = apis
    .map((api) => {
      const sourceType = SOURCE_TYPE_MAP[api.apiSlug];
      return sourceType
        ? {
            name: api.title,
            url: api.link,
            sourceType,
            metadata: normalizeMetadata(api),
          }
        : null;
    })
    .filter((item) => item !== null);

  if (!toProcess.length) {
    console.warn('Нет API с поддерживаемыми типами, импорт пропущен.');
    return;
  }

  const existing = await prisma.source.findMany({
    where: {
      OR: [
        { sourceType: { in: toProcess.map((item) => item.sourceType) } },
        {
          url: {
            in: toProcess
              .map((item) => item.url)
              .filter((u) => typeof u === 'string'),
          },
        },
      ],
    },
    select: { id: true, sourceType: true, url: true },
  });

  const existingTypes = new Set(existing.map((item) => item.sourceType));
  const existingUrls = new Set(
    existing.map((item) => (item.url || '').trim().toLowerCase()),
  );

  let added = 0;
  let skipped = 0;

  for (const item of toProcess) {
    const normalizedUrl = (item.url || '').trim().toLowerCase();
    const typeExists = existingTypes.has(item.sourceType);
    const urlExists = normalizedUrl && existingUrls.has(normalizedUrl);

    if (typeExists || urlExists) {
      skipped += 1;
      continue;
    }

    await prisma.source.create({
      data: {
        name: item.name,
        sourceType: item.sourceType,
        url: item.url,
        metadata: item.metadata,
      },
    });
    added += 1;
  }

  console.log(`Импорт завершён. Добавлено: ${added}, пропущено: ${skipped}.`);
}

main()
  .catch((error) => {
    console.error('Ошибка импорта:', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

