/*
  Очищает stopUntil для всех Telegram источников, разблокируя их для скрапинга.

  Usage:
    DATABASE_URL=file:./dev.db node scripts/clear-stop-until.js
*/

const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Fetching all Telegram sources...');
  const sources = await prisma.source.findMany({
    where: { sourceType: 'telegram' },
    select: { id: true, name: true, url: true, metadata: true },
  });

  console.log(`Found ${sources.length} Telegram sources`);

  let cleared = 0;
  let skipped = 0;

  for (const source of sources) {
    const metadata = (source.metadata ?? {}) || {};
    const stopUntil = metadata.stopUntil;

    if (!stopUntil) {
      skipped += 1;
      continue;
    }

    const stopUntilDate = new Date(stopUntil);
    const now = new Date();

    // Удаляем stopUntil из metadata
    const updatedMetadata = { ...metadata };
    delete updatedMetadata.stopUntil;
    delete updatedMetadata.lastError; // Также очищаем lastError

    await prisma.source.update({
      where: { id: source.id },
      data: {
        metadata: updatedMetadata,
      },
    });

    cleared += 1;
    console.log(
      `  ✓ Cleared stopUntil for ${source.name || source.url} (was until ${stopUntilDate.toISOString()})`,
    );
  }

  console.log(`\nDone: cleared ${cleared}, skipped ${skipped} (no stopUntil)`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
