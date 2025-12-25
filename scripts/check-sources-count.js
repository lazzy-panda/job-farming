const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

const dbUrl = process.env.DATABASE_URL || 'file:./prisma/dev.db';
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

async function main() {
  const telegramCount = await prisma.source.count({ where: { sourceType: 'telegram' } });
  const totalCount = await prisma.source.count();
  console.log(`Telegram sources: ${telegramCount}`);
  console.log(`Total sources: ${totalCount}`);
  await prisma.$disconnect();
}

main().catch(console.error);
