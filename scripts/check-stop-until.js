const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

async function main() {
  const sources = await prisma.source.findMany({
    where: { sourceType: 'telegram' },
    select: { id: true, name: true, url: true, metadata: true },
  });

  const now = new Date();
  const withStopUntil = sources.filter((s) => {
    const meta = (s.metadata ?? {}) || {};
    const stopUntil = meta.stopUntil;
    if (!stopUntil) return false;
    const stopDate = new Date(stopUntil);
    return stopDate > now;
  });

  console.log(`Total Telegram sources: ${sources.length}`);
  console.log(`Sources with active stopUntil: ${withStopUntil.length}`);

  if (withStopUntil.length > 0) {
    console.log('\nBlocked sources:');
    withStopUntil.slice(0, 10).forEach((s) => {
      const meta = (s.metadata ?? {}) || {};
      const stopDate = new Date(meta.stopUntil);
      console.log(`  - ${s.name || s.url}: until ${stopDate.toISOString()}`);
    });
    if (withStopUntil.length > 10) {
      console.log(`  ... and ${withStopUntil.length - 10} more`);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
