/*
  Очищает старые блокировки (stopUntil) для Telegram источников, которые уже истекли или скоро истекат.
  Также можно очистить все блокировки принудительно.

  Usage:
    DATABASE_URL=file:./dev.db node scripts/clear-old-telegram-blocks.js
    DATABASE_URL=file:./dev.db node scripts/clear-old-telegram-blocks.js --force
    DATABASE_URL=file:./dev.db node scripts/clear-old-telegram-blocks.js --hours=1
*/

const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

const args = process.argv.slice(2);
const force = args.includes('--force');
const hoursArg = args.find((a) => a.startsWith('--hours='));
const hoursThreshold = hoursArg ? Number(hoursArg.split('=')[1]) : null;

async function main() {
  console.log('Fetching all Telegram sources...');
  const sources = await prisma.source.findMany({
    where: { sourceType: 'telegram' },
    select: { id: true, name: true, url: true, metadata: true },
  });

  console.log(`Found ${sources.length} Telegram sources`);

  let cleared = 0;
  let skipped = 0;
  const now = new Date();

  for (const source of sources) {
    const metadata = (source.metadata ?? {}) || {};
    const stopUntil = metadata.stopUntil;

    if (!stopUntil) {
      skipped += 1;
      continue;
    }

    const stopUntilDate = new Date(stopUntil);
    const hoursUntil = (stopUntilDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    // Очищаем если:
    // 1. --force - принудительно очистить все
    // 2. Блокировка уже истекла (stopUntilDate < now)
    // 3. Осталось меньше часов, чем указано в --hours=
    const shouldClear =
      force ||
      stopUntilDate < now ||
      (hoursThreshold !== null && hoursUntil <= hoursThreshold);

    if (!shouldClear) {
      skipped += 1;
      continue;
    }

    // Удаляем stopUntil из metadata
    const updatedMetadata = { ...metadata };
    delete updatedMetadata.stopUntil;
    // Также очищаем lastError, если это была блокировка
    if (metadata.lastError && (metadata.lastError.includes('proxy_block') || metadata.lastError === 'no_new_many_runs')) {
      delete updatedMetadata.lastError;
    }

    await prisma.source.update({
      where: { id: source.id },
      data: {
        metadata: updatedMetadata,
      },
    });

    cleared += 1;
    const status = stopUntilDate < now ? 'expired' : `expires in ${hoursUntil.toFixed(1)}h`;
    console.log(
      `  ✓ Cleared stopUntil for ${source.name || source.url} (was ${status})`,
    );
  }

  console.log(`\nDone: cleared ${cleared}, skipped ${skipped} (no stopUntil or not expired)`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
