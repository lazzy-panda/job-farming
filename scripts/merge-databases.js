const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const path = require('path');

// Основная база данных (prisma/dev.db)
const mainDbUrl = 'file:' + path.resolve(__dirname, '../prisma/dev.db');
const mainAdapter = new PrismaBetterSqlite3({ url: mainDbUrl });
const mainPrisma = new PrismaClient({ adapter: mainAdapter });

// Старая база данных (dev.db в корне)
const oldDbUrl = 'file:' + path.resolve(__dirname, '../dev.db');
const oldAdapter = new PrismaBetterSqlite3({ url: oldDbUrl });
const oldPrisma = new PrismaClient({ adapter: oldAdapter });

async function main() {
  console.log('Открываем базы данных...\n');

  // Получаем данные из старой базы
  console.log('Читаем данные из старой базы...');
  const oldSources = await oldPrisma.source.findMany();
  const oldJobPostings = await oldPrisma.jobPosting.findMany();
  
  console.log(`Найдено в старой базе: ${oldSources.length} источников, ${oldJobPostings.length} вакансий\n`);

  // Объединяем Source
  console.log('Объединяем Source...');
  let sourceCount = 0;
  for (const source of oldSources) {
    try {
      await mainPrisma.source.upsert({
        where: { id: source.id },
        update: {},
        create: {
          id: source.id,
          name: source.name,
          sourceType: source.sourceType,
          url: source.url,
          metadata: source.metadata,
          createdAt: source.createdAt,
          updatedAt: source.updatedAt,
        },
      });
      sourceCount++;
    } catch (e) {
      // Игнорируем ошибки
    }
  }
  console.log(`Добавлено ${sourceCount} источников`);

  // Объединяем JobPosting
  console.log('Объединяем JobPosting...');
  let jobCount = 0;
  for (const job of oldJobPostings) {
    try {
      await mainPrisma.jobPosting.upsert({
        where: { id: job.id },
        update: {},
        create: {
          id: job.id,
          title: job.title,
          description: job.description,
          company: job.company,
          location: job.location,
          link: job.link,
          status: job.status,
          tags: job.tags,
          publishedAt: job.publishedAt,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          sourceId: job.sourceId,
        },
      });
      jobCount++;
    } catch (e) {
      // Игнорируем ошибки
    }
  }
  console.log(`Добавлено ${jobCount} вакансий`);

  // Проверяем результаты
  const finalSourceCount = await mainPrisma.source.count();
  const finalJobCount = await mainPrisma.jobPosting.count();

  console.log(`\nИтоговые результаты:`);
  console.log(`Source: ${finalSourceCount}`);
  console.log(`JobPosting: ${finalJobCount}`);

  await mainPrisma.$disconnect();
  await oldPrisma.$disconnect();

  console.log('\nОбъединение завершено!');
}

main().catch((err) => {
  console.error('Ошибка:', err);
  process.exit(1);
});

