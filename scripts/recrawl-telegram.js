/*
  Сбрасывает позицию чтения у всех telegram-источников (lastMessageId/lastHashes/
  emptyRuns/stopUntil/inactive), чтобы следующий скрейп перечитал историю каналов
  за весь 14-дневный cutoff. Дубликаты не создаются: вставка отфильтрует уже
  существующие ссылки.

  Usage:
    DATABASE_URL=file:./dev.db node scripts/recrawl-telegram.js
*/

const { PrismaClient } = require('@prisma/client');

const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
process.env.DATABASE_URL = dbUrl;

async function main() {
  const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: dbUrl }) });
  try {
    const sources = await prisma.source.findMany({ where: { sourceType: 'telegram' } });
    for (const source of sources) {
      const meta = { ...(source.metadata || {}) };
      delete meta.lastMessageId;
      delete meta.lastHashes;
      delete meta.stopUntil;
      delete meta.lastError;
      delete meta.inactive;
      delete meta.inactiveReason;
      delete meta.inactiveUntil;
      meta.emptyRuns = 0;
      meta.blockStrikes = 0;
      await prisma.source.update({ where: { id: source.id }, data: { metadata: meta } });
      console.log(`reset: ${source.name}`);
    }
    console.log(`done: ${sources.length} telegram sources reset`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
