const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

function normalizeUrl(raw) {
  if (!raw) return '';
  let url = raw.trim().toLowerCase();
  url = url.replace(/^https?:\/\//, '');
  url = url.replace(/^www\./, '');
  url = url.replace(/\/+$/, '');
  return url;
}

async function main() {
  const all = await prisma.source.findMany();
  console.log(`Total in DB: ${all.length}`);
  
  const seen = new Set();
  const unique = [];
  for (const s of all) {
    const key = normalizeUrl(s.url ?? '') || s.id;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(s);
    }
  }
  console.log(`Unique after normalization: ${unique.length}`);
  
  const telegram = all.filter(s => s.sourceType === 'telegram');
  const telegramSeen = new Set();
  const telegramUnique = [];
  for (const s of telegram) {
    const key = normalizeUrl(s.url ?? '') || s.id;
    if (!telegramSeen.has(key)) {
      telegramSeen.add(key);
      telegramUnique.push(s);
    }
  }
  console.log(`Telegram unique: ${telegramUnique.length}`);
  
  // Покажем несколько примеров дубликатов
  const urlMap = new Map();
  for (const s of telegram) {
    const key = normalizeUrl(s.url ?? '') || s.id;
    if (!urlMap.has(key)) {
      urlMap.set(key, []);
    }
    urlMap.get(key).push(s);
  }
  
  const duplicates = Array.from(urlMap.entries()).filter(([_, list]) => list.length > 1);
  if (duplicates.length > 0) {
    console.log(`\nFound ${duplicates.length} duplicate URL groups:`);
    duplicates.slice(0, 5).forEach(([key, list]) => {
      console.log(`  ${key}: ${list.length} sources`);
    });
  }
  
  await prisma.$disconnect();
}

main().catch(console.error);
