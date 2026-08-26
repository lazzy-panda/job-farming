/*
  Убирает источники, не относящиеся к 12-недельному плану (трек А: DM/РП, RU-рынок):
  удаляет все источники, кроме помеченных metadata.plan=true (см. seed-plan-sources.js),
  вместе с их вакансиями.

  Вакансии из воронки (status shortlisted/applied или с откликами) не трогаем —
  их источники остаются.

  Usage:
    DATABASE_URL=file:./dev.db node scripts/remove-irrelevant-sources.js
    DATABASE_URL=file:./dev.db node scripts/remove-irrelevant-sources.js --dry-run
*/

const { PrismaClient } = require('@prisma/client');

const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
process.env.DATABASE_URL = dbUrl;
const dryRun = process.argv.includes('--dry-run');

async function initPrismaClient() {
  const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
  const adapter = new PrismaBetterSqlite3({ url: dbUrl });
  const client = new PrismaClient({ adapter });
  await client.$queryRawUnsafe('SELECT 1;');
  return client;
}

function isPlanSource(source) {
  const meta = source.metadata;
  return Boolean(meta && typeof meta === 'object' && meta.plan === true);
}

async function main() {
  const prisma = await initPrismaClient();
  try {
    const sources = await prisma.source.findMany();
    const targets = sources.filter((s) => !isPlanSource(s));
    console.log(`sources total=${sources.length} plan=${sources.length - targets.length} to-remove=${targets.length}`);

    let removedSources = 0;
    let removedJobs = 0;
    let keptProtected = 0;

    for (const source of targets) {
      const protectedCount = await prisma.jobPosting.count({
        where: {
          sourceId: source.id,
          OR: [{ status: { in: ['shortlisted', 'applied'] } }, { applications: { some: {} } }],
        },
      });
      if (protectedCount > 0) {
        keptProtected += 1;
        console.log(`keep (protected jobs=${protectedCount}): [${source.sourceType}] ${source.name}`);
        continue;
      }
      if (dryRun) {
        removedSources += 1;
        continue;
      }
      const jobs = await prisma.jobPosting.deleteMany({ where: { sourceId: source.id } });
      await prisma.source.delete({ where: { id: source.id } });
      removedJobs += jobs.count;
      removedSources += 1;
    }

    console.log(
      `${dryRun ? '[dry-run] ' : ''}done: removed sources=${removedSources} jobs=${removedJobs} kept-protected=${keptProtected}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
