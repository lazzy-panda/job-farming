import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const dbUrl = process.env.DATABASE_URL || 'file:./prisma/dev.db';
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

async function main() {
  const source = await prisma.source.upsert({
    where: { id: 'seed-source' },
    update: {},
    create: {
      id: 'seed-source',
      name: 'Sample Source',
      sourceType: 'site',
      url: 'https://example.com/jobs',
      metadata: { note: 'seed data' },
    },
  });

  await prisma.jobPosting.upsert({
    where: { id: 'seed-job' },
    update: {},
    create: {
      id: 'seed-job',
      title: 'Sample Job',
      description: 'This is a sample seeded job posting.',
      company: 'Example Co',
      location: 'Remote',
      link: 'https://example.com/jobs/1',
      status: 'new',
      tags: 'remote,full-time',
      publishedAt: new Date(),
      sourceId: source.id,
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

