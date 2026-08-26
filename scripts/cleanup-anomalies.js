/* Быстрая чистка БД от мусора:
 * - резюме (по хештегам #резюме/#cv/#resume, вводкам "всем привет/меня зовут/ищу работу")
 * - псевдолокации (Java/OOP и др.)
 * - подозрительно низкие зарплаты (< 500 EUR/USD/GBP/CHF/... per month/year/day)
 * - слишком короткие описания (< 150 символов)
 *
 * Usage:
 *   DATABASE_URL=file:./dev.db node scripts/cleanup-anomalies.js
 */

const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

const MIN_DESCRIPTION_LEN = Number(process.env.MIN_DESCRIPTION_LEN ?? 150);
const LOW_SALARY_THRESHOLD = Number(process.env.LOW_SALARY_THRESHOLD ?? 500);

function isResume(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  if (/#\s*(резюме|cv|resume)/i.test(t)) return true;
  if (/\b(всем\s+привет|привет\s+всем|hello\s+everyone|hi\s+all)\b/i.test(t)) return true;
  if (/\b(меня\s+зовут|my\s+name\s+is)\b/i.test(t)) return true;
  if (/\b(ищу\s+работу|ищу\s+позицию|looking\s+for\s+work|seeking\s+position|open\s+to\s+opportunities)\b/i.test(t))
    return true;
  return false;
}

function hasFakeLocation(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  return /\b(java|oop)\b/.test(t);
}

function hasLowSalary(title, description) {
  const text = `${title}\n${description ?? ''}`.toLowerCase();
  // грубый детект: числа до 4 знаков + валюта
  const re = /(\d{2,4})\s*(eur|usd|gbp|chf|aud|cad|pln|czk|uah|kzt|byn|rub|rur|₽|\$|€|£)/i;
  const m = re.exec(text);
  if (!m) return false;
  const val = Number(m[1]);
  return !Number.isNaN(val) && val < LOW_SALARY_THRESHOLD;
}

async function main() {
  const anomalies = [];

  // 1) Резюме
  const resumePosts = await prisma.jobPosting.findMany({
    where: {
      OR: [
        { title: { contains: '#резюме' } },
        { description: { contains: '#резюме' } },
        { title: { contains: '#resume' } },
        { description: { contains: '#resume' } },
        { title: { contains: '#cv' } },
        { description: { contains: '#cv' } },
      ],
    },
    select: { id: true, title: true, description: true, link: true },
  });
  resumePosts.forEach((p) => anomalies.push({ type: 'resume', ...p }));

  // 2) Короткие описания
  const shortPosts = await prisma.jobPosting.findMany({
    where: {
      OR: [
        { description: { lt: '' } }, // пустые
        { rawContent: { lt: '' } },
      ],
    },
    select: { id: true, title: true, description: true, rawContent: true, link: true },
  });
  const shortFiltered = shortPosts.filter((p) => {
    const text = (p.rawContent || p.description || '').trim();
    return text.length < MIN_DESCRIPTION_LEN;
  });
  shortFiltered.forEach((p) => anomalies.push({ type: 'short', ...p }));

  // 3) Псевдолокации
  const fakeLocationPosts = await prisma.jobPosting.findMany({
    where: {
      OR: [
        { location: { contains: 'Java' } },
        { location: { contains: 'OOP' } },
      ],
    },
    select: { id: true, title: true, description: true, location: true, link: true },
  });
  fakeLocationPosts.forEach((p) => anomalies.push({ type: 'fake_location', ...p }));

  // 4) Низкая зарплата
  const lowSalaryPosts = await prisma.jobPosting.findMany({
    where: {
      OR: [{ title: { contains: 'EUR' } }, { description: { contains: 'EUR' } }],
    },
    select: { id: true, title: true, description: true, link: true },
  });
  lowSalaryPosts
    .filter((p) => hasLowSalary(p.title, p.description))
    .forEach((p) => anomalies.push({ type: 'low_salary', ...p }));

  // Удаляем дубли по id
  const seen = new Set();
  const uniq = anomalies.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  if (!uniq.length) {
    console.log('No anomalies found');
    return;
  }

  console.log(`Found ${uniq.length} anomalies. Deleting...`);
  for (const a of uniq) {
    try {
      await prisma.jobPosting.delete({ where: { id: a.id } });
      console.log(`deleted ${a.type}: ${a.id} ${a.link || ''}`);
    } catch (err) {
      console.warn(`failed to delete ${a.id}: ${err?.message || err}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
