const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

function normalizeUrl(raw) {
  let v = (raw ?? '').trim().toLowerCase();
  v = v.replace(/^https?:\/\//, '');
  v = v.replace(/^www\./, '');
  v = v.replace(/^t\.me\/s\//, 't.me/');
  v = v.replace(/\/+$/, '');
  return v;
}

async function main() {
  const all = await prisma.source.findMany();
  console.log(`Total in DB: ${all.length}`);
  
  const seen = new Map();
  const deduped = [];
  
  for (const s of all) {
    const key = normalizeUrl(s.url ?? '') || s.id;
    if (!seen.has(key)) {
      seen.set(key, []);
      deduped.push(s);
    }
    seen.get(key).push(s);
  }
  
  console.log(`After deduplication: ${deduped.length}`);
  
  // Найдем группы с несколькими источниками
  const groups = Array.from(seen.entries()).filter(([_, list]) => list.length > 1);
  console.log(`\nGroups with multiple sources: ${groups.length}`);
  
  if (groups.length > 0) {
    console.log('\nFirst 10 duplicate groups:');
    groups.slice(0, 10).forEach(([key, list]) => {
      console.log(`\n  ${key} (${list.length} sources):`);
      list.forEach(s => {
        console.log(`    - ${s.id}: ${s.url} (${s.name})`);
      });
    });
  }
  
  await prisma.$disconnect();
}

main().catch(console.error);
