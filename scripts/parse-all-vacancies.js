/*
  Runs all job postings through vacancy parser and prints:
  job meta -> original text -> parsed JSON.

  Usage:
    node scripts/parse-all-vacancies.js
    API_BASE=http://127.0.0.1:3000/api node scripts/parse-all-vacancies.js --limit=50 --concurrency=3 --out=out.txt
*/

const DEFAULT_API_BASE = 'http://127.0.0.1:3000/api';

function parseArgs(argv) {
  const out = {
    apiBase: process.env.API_BASE || DEFAULT_API_BASE,
    limit: null,
    concurrency: 3,
    outFile: null,
    includeEmpty: false,
    localParse: false,
  };

  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--api=')) {
      out.apiBase = arg.slice('--api='.length);
    } else if (arg.startsWith('--limit=')) {
      const n = Number(arg.slice('--limit='.length));
      out.limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    } else if (arg.startsWith('--concurrency=')) {
      const n = Number(arg.slice('--concurrency='.length));
      out.concurrency = Number.isFinite(n) && n > 0 ? Math.min(10, Math.floor(n)) : 3;
    } else if (arg.startsWith('--out=')) {
      out.outFile = arg.slice('--out='.length);
    } else if (arg === '--include-empty') {
      out.includeEmpty = true;
    } else if (arg === '--local') {
      out.localParse = true;
    }
  }

  return out;
}

async function fetchJson(url, init) {
  const res = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init && init.headers ? init.headers : {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status} ${res.statusText} for ${url}${body ? `\n${body}` : ''}`);
    err.status = res.status;
    throw err;
  }
  return await res.json();
}

async function loadAllJobs(apiBase, limit) {
  const take = 200;
  let skip = 0;
  const all = [];

  // API returns plain array
  while (true) {
    const url = `${apiBase}/job-postings?skip=${skip}&take=${take}`;
    const batch = await fetchJson(url, { method: 'GET' });
    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }
    all.push(...batch);
    skip += batch.length;

    if (limit && all.length >= limit) {
      return all.slice(0, limit);
    }

    if (batch.length < take) {
      break;
    }
  }

  return all;
}

function buildParsePayload(job) {
  const text = (job.description ?? '').trim();
  return {
    text,
    pageTitle: job.title ?? undefined,
    sourceUrl: job.link ?? undefined,
    debug: false,
  };
}

function formatBlock(job, parsed) {
  const meta = {
    id: job.id ?? null,
    title: job.title ?? null,
    company: job.company ?? null,
    publishedAt: job.publishedAt ?? null,
    sourceId: job.sourceId ?? null,
    link: job.link ?? null,
  };
  const original = (job.description ?? '').trim();

  return (
    `\n\n===== JOB ${meta.id} =====\n` +
    `META: ${JSON.stringify(meta)}\n` +
    `\n--- ORIGINAL TEXT ---\n` +
    `${original}\n` +
    `\n--- PARSED JSON ---\n` +
    `${JSON.stringify(parsed, null, 2)}\n` +
    `===== /JOB ${meta.id} =====\n`
  );
}

function createPool(concurrency) {
  let active = 0;
  const queue = [];

  async function run(fn) {
    if (active >= concurrency) {
      await new Promise((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await fn();
    } finally {
      active = Math.max(0, active - 1);
      const next = queue.shift();
      if (next) next();
    }
  }

  return { run };
}

async function main() {
  const args = parseArgs(process.argv);

  const fs = args.outFile ? await import('node:fs') : null;
  const localParser = args.localParse
    ? require('./../dist/libs/vacancy-parser/src/index.js')
    : null;

  const jobs = await loadAllJobs(args.apiBase, args.limit);
  const pool = createPool(args.concurrency);

  const header = `[parse-all-vacancies] apiBase=${args.apiBase} jobs=${jobs.length} concurrency=${args.concurrency} includeEmpty=${args.includeEmpty} localParse=${args.localParse}\n`;
  if (args.outFile) {
    fs.writeFileSync(args.outFile, header, 'utf8');
  } else {
    process.stdout.write(header);
  }

  let parsedCount = 0;
  let skippedEmpty = 0;

  const tasks = jobs.map((job, idx) =>
    pool.run(async () => {
      const text = (job.description ?? '').trim();
      if (!text && !args.includeEmpty) {
        skippedEmpty += 1;
        return;
      }

      let parsed;
      try {
        const payload = buildParsePayload(job);
        if (args.localParse) {
          parsed = localParser.parseVacancy(payload.text, {
            strict: true,
            pageTitle: payload.pageTitle,
            sourceUrl: payload.sourceUrl,
            debug: false,
          });
        } else {
          parsed = await fetchJson(`${args.apiBase}/vacancies/parse`, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
        }
      } catch (e) {
        parsed = {
          meta: {
            warnings: ['parse_request_failed'],
            error: String(e && e.message ? e.message : e),
          },
        };
      }

      parsedCount += 1;

      const block = formatBlock(job, parsed);
      if (args.outFile) {
        fs.appendFileSync(args.outFile, block, 'utf8');
      } else {
        process.stdout.write(block);
      }

      if ((idx + 1) % 50 === 0) {
        const progress = `[parse-all-vacancies] progress=${idx + 1}/${jobs.length} parsed=${parsedCount} skippedEmpty=${skippedEmpty}\n`;
        if (args.outFile) {
          fs.appendFileSync(args.outFile, progress, 'utf8');
        } else {
          process.stdout.write(progress);
        }
      }
    }),
  );

  await Promise.all(tasks);

  const footer = `\n[parse-all-vacancies] DONE parsed=${parsedCount} skippedEmpty=${skippedEmpty}\n`;
  if (args.outFile) {
    fs.appendFileSync(args.outFile, footer, 'utf8');
  } else {
    process.stdout.write(footer);
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[parse-all-vacancies] FAILED', e);
  process.exitCode = 1;
});
