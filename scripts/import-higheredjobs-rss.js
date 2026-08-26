/*
  Импортирует RSS ленты с higheredjobs.com в базу данных
  
  Usage:
    DATABASE_URL=file:./dev.db node scripts/import-higheredjobs-rss.js
*/

const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

// Список RSS лент с higheredjobs.com
const rssFeeds = [
  // Основные категории
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm', name: 'HigherEdJobs - All Jobs' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?JobCat=1', name: 'HigherEdJobs - Faculty' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?JobCat=2', name: 'HigherEdJobs - Administrative' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?JobCat=3', name: 'HigherEdJobs - Executive' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?JobCat=4', name: 'HigherEdJobs - Staff' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?JobCat=5', name: 'HigherEdJobs - Postdoctoral' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?JobCat=6', name: 'HigherEdJobs - Graduate Assistant' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?JobCat=7', name: 'HigherEdJobs - Adjunct' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?JobCat=8', name: 'HigherEdJobs - Internship' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?JobCat=9', name: 'HigherEdJobs - Fellowship' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?JobCat=10', name: 'HigherEdJobs - Research' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?JobCat=11', name: 'HigherEdJobs - Other' },
  
  // По типам работы
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?JobType=1', name: 'HigherEdJobs - Full Time' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?JobType=2', name: 'HigherEdJobs - Part Time' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?JobType=3', name: 'HigherEdJobs - Temporary' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?JobType=4', name: 'HigherEdJobs - Contract' },
  
  // По формату работы
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?WorkType=1', name: 'HigherEdJobs - On Site' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?WorkType=2', name: 'HigherEdJobs - Remote' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?WorkType=3', name: 'HigherEdJobs - Hybrid' },
  
  // Популярные штаты (US)
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?State=CA', name: 'HigherEdJobs - California' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?State=NY', name: 'HigherEdJobs - New York' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?State=TX', name: 'HigherEdJobs - Texas' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?State=FL', name: 'HigherEdJobs - Florida' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?State=IL', name: 'HigherEdJobs - Illinois' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?State=MA', name: 'HigherEdJobs - Massachusetts' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?State=PA', name: 'HigherEdJobs - Pennsylvania' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?State=NC', name: 'HigherEdJobs - North Carolina' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?State=WA', name: 'HigherEdJobs - Washington' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?State=GA', name: 'HigherEdJobs - Georgia' },
  
  // Комбинации: Remote + категории
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?JobCat=1&WorkType=2', name: 'HigherEdJobs - Faculty Remote' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?JobCat=2&WorkType=2', name: 'HigherEdJobs - Administrative Remote' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?JobCat=3&WorkType=2', name: 'HigherEdJobs - Executive Remote' },
  { url: 'https://www.higheredjobs.com/rss/jobs.cfm?JobCat=4&WorkType=2', name: 'HigherEdJobs - Staff Remote' },
];

async function main() {
  console.log('Импорт RSS лент с higheredjobs.com...\n');
  
  let added = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const feed of rssFeeds) {
    try {
      // Проверяем, существует ли уже такой источник
      const existing = await prisma.source.findFirst({
        where: {
          url: feed.url,
          sourceType: 'rss',
        },
      });
      
      if (existing) {
        console.log(`⏭  Пропущен (уже существует): ${feed.name}`);
        skipped++;
        continue;
      }
      
      // Создаем новый источник
      await prisma.source.create({
        data: {
          name: feed.name,
          sourceType: 'rss',
          url: feed.url,
          metadata: {},
        },
      });
      
      console.log(`✓ Добавлен: ${feed.name}`);
      added++;
    } catch (error) {
      console.error(`✗ Ошибка при добавлении ${feed.name}:`, error.message);
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

