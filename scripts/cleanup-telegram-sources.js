/*
  Помечает телеграм-источники как неактивные, если долго нет новых сообщений
  или скраппинг не выполнялся слишком давно.

  Usage:
    DATABASE_URL=file:./dev.db node scripts/cleanup-telegram-sources.js \
      --max-empty=40 --max-age-days=30 --cooldown-hours=168
*/

const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

function parseArgs(argv) {
  const args = {
    maxEmpty: Number(process.env.CLEAN_MAX_EMPTY ?? 40),
    maxAgeDays: Number(process.env.CLEAN_MAX_AGE_DAYS ?? 30),
    cooldownHours: Number(process.env.CLEAN_INACTIVE_COOLDOWN_HOURS ?? 24 * 7),
  };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--max-empty=')) {
      args.maxEmpty = Number(arg.slice('--max-empty='.length)) || args.maxEmpty;
    } else if (arg.startsWith('--max-age-days=')) {
      args.maxAgeDays = Number(arg.slice('--max-age-days='.length)) || args.maxAgeDays;
    } else if (arg.startsWith('--cooldown-hours=')) {
      args.cooldownHours = Number(arg.slice('--cooldown-hours='.length)) || args.cooldownHours;
    }
  }
  return args;
}

async function main() {
  const { maxEmpty, maxAgeDays, cooldownHours } = parseArgs(process.argv);
  const sources = await prisma.source.findMany({
    where: { sourceType: 'telegram' },
    select: { id: true, name: true, metadata: true },
  });

  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
  const cooldownMs = cooldownHours > 0 ? cooldownHours * 60 * 60 * 1000 : 0;
  let updated = 0;

  for (const source of sources) {
    const metadata = (source.metadata ?? {}) as Record<string, unknown>;
    const emptyRuns = typeof metadata.emptyRuns === 'number' ? metadata.emptyRuns : 0;
    const lastScrapedAt = metadata.lastScrapedAt ? new Date(metadata.lastScrapedAt as string) : null;
    const inactive = metadata.inactive === true;
    if (inactive) {
      continue;
    }

    const tooManyEmpty = maxEmpty > 0 && emptyRuns >= maxEmpty;
    const tooOld = maxAgeDays > 0 && (!lastScrapedAt || lastScrapedAt < cutoff);
    if (!tooManyEmpty && !tooOld) {
      continue;
    }

    metadata.inactive = true;
    metadata.inactiveReason = tooManyEmpty ? 'cleanup_empty_runs' : 'cleanup_idle';
    if (cooldownMs > 0) {
      metadata.inactiveUntil = new Date(Date.now() + cooldownMs).toISOString();
    }
    await prisma.source.update({
      where: { id: source.id },
      data: { metadata },
    });
    updated += 1;
    console.log(
      `• ${source.id} (${source.name}) -> inactive (${metadata.inactiveReason}, emptyRuns=${emptyRuns || 0}, lastScraped=${metadata.lastScrapedAt || 'n/a'})`,
    );
  }

  console.log(`\nИтого отключено: ${updated}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Ошибка при очистке телеграм-источников:', err);
  process.exitCode = 1;
});
