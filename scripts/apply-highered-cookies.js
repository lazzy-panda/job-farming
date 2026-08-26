/*
  Обновляет cookieHeader у всех активных прокси, используя заранее сохранённые
  cookies из живой браузерной сессии HigherEdJobs.

  Перед запуском подготовьте файл с cookie-строками:
    storage/higheredjobs.cookies.txt — по умолчанию
    или укажите свой путь через HIGHEREDJOBS_COOKIE_FILE

  Формат файла:
    - одна строка "Cookie: name=value; other=value2"
    - либо JSON массив объектов { "name": "...", "value": "..." }
    - разделите наборы cookies строкой "---" если хотите использовать несколько вариантов

  Запуск:
    DATABASE_URL=file:./dev.db node scripts/apply-highered-cookies.js
*/

const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const { loadManualCookiePool } = require('./utils/manual-cookie-pool');

const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

async function main() {
  const { cookies, filePath } = loadManualCookiePool({
    defaultRelativePath: 'storage/higheredjobs.cookies.txt',
    label: 'apply-highered-cookies',
  });
  if (!cookies.length) {
    throw new Error(
      'Файл с cookies пуст или не найден. Укажите путь через HIGHEREDJOBS_COOKIE_FILE и убедитесь, что в нём есть хотя бы одна строка.',
    );
  }

  const proxies = await prisma.proxy.findMany({
    where: { active: true },
    orderBy: [{ lastUsedAt: 'asc' }, { updatedAt: 'asc' }],
  });
  if (!proxies.length) {
    console.log('В базе нет активных прокси — обновлять нечего.');
    return;
  }

  console.log(
    `Обновляем cookies (${cookies.length} строк из ${
      filePath || 'указанного файла'
    }) для ${proxies.length} активных прокси...`,
  );

  const now = new Date();
  let updated = 0;
  for (const [index, proxy] of proxies.entries()) {
    const cookieHeader = cookies[index % cookies.length];
    await prisma.proxy.update({
      where: { id: proxy.id },
      data: {
        cookieHeader,
        cookieSource: 'browser-export',
        cookieUpdatedAt: now,
        updatedAt: now,
      },
    });
    updated += 1;
  }

  console.log(
    `Готово. Обновлены cookies у ${updated} прокси (использовано ${cookies.length} загруженных строк).`,
  );
}

main()
  .catch((error) => {
    console.error('Ошибка при обновлении cookies:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

