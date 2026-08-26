/**
 * Загружает HTML вакансий, у которых нет rawContent или слишком короткое описание,
 * вычищает текст и сохраняет его в базу (а при необходимости обновляет description).
 *
 * Usage:
 *   DATABASE_URL="file:./dev.db" node scripts/fetch-missing-raw-content.js --limit=50
 */

const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const axios = require('axios');
const { load } = require('cheerio');
const { loadManualCookiePool } = require('./utils/manual-cookie-pool');

const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
const preferBetterSqlite = dbUrl.startsWith('file:');

function createPrismaClient() {
  if (preferBetterSqlite) {
    try {
      const adapter = new PrismaBetterSqlite3({ url: dbUrl });
      return new PrismaClient({ adapter });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(
        '[fetch-missing-raw-content] failed to init PrismaBetterSqlite3, fallback to datasources:',
        error?.message
      );
    }
  }
  return new PrismaClient({
    datasources: {
      db: { url: dbUrl },
    },
  });
}

const prisma = createPrismaClient();

const DEFAULT_LIMIT = 50;
const DESCRIPTION_MIN_LENGTH = 400;
const MAX_TEXT_LENGTH = 80000;
const FETCH_TIMEOUT = 40000;
const PROXY_ATTEMPTS_PER_REQUEST = Number(process.env.RAW_FETCH_PROXY_ATTEMPTS ?? 3);
const RETRIES_PER_URL = Number(process.env.RAW_FETCH_RETRIES ?? 2);
const GENERIC_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
];
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const manualCookiePoolInfo = loadManualCookiePool({
  defaultRelativePath: 'storage/higheredjobs.cookies.txt',
  label: 'fetch-missing-raw-content',
});
const manualCookiePool = manualCookiePoolInfo.cookies || [];
let manualCookieIndex = 0;
if (manualCookiePool.length) {
  // eslint-disable-next-line no-console
  console.log(
    `[fetch-missing-raw-content] загружено ${manualCookiePool.length} cookie-строк из живой сессии`
  );
}
let genericUserAgentIndex = 0;
let proxyPool = [];
let proxyPickIndex = 0;

function parseArgs(argv) {
  const config = {
    limit: DEFAULT_LIMIT,
  };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));
      if (Number.isFinite(value) && value > 0) {
        config.limit = Math.round(value);
      }
    }
  }
  return config;
}

function pickGenericUserAgent() {
  if (!GENERIC_USER_AGENTS.length) {
    return DEFAULT_USER_AGENT;
  }
  const index = genericUserAgentIndex % GENERIC_USER_AGENTS.length;
  genericUserAgentIndex += 1;
  return GENERIC_USER_AGENTS[index];
}

function pickManualCookie() {
  if (!manualCookiePool.length) {
    return null;
  }
  const cookie = manualCookiePool[manualCookieIndex % manualCookiePool.length];
  manualCookieIndex += 1;
  return cookie;
}

async function loadProxyPool() {
  try {
    proxyPool = await prisma.proxy.findMany({
      where: { active: true },
      orderBy: [{ lastUsedAt: 'asc' }, { updatedAt: 'asc' }],
    });
    proxyPickIndex = 0;
    if (proxyPool.length) {
      // eslint-disable-next-line no-console
      console.log(
        `[fetch-missing-raw-content] подключено ${proxyPool.length} активных прокси из базы`
      );
    } else {
      // eslint-disable-next-line no-console
      console.log('[fetch-missing-raw-content] активных прокси в базе не найдено');
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[fetch-missing-raw-content] не удалось загрузить прокси из базы:', error?.message);
    proxyPool = [];
  }
}

function getNextProxyCandidate() {
  if (!proxyPool.length) {
    return null;
  }
  const proxy = proxyPool[proxyPickIndex % proxyPool.length];
  proxyPickIndex += 1;
  return proxy;
}

function normalizeWhitespace(text) {
  return (text ?? '').toString().replace(/\s+/g, ' ').trim();
}

function truncateText(text) {
  if (!text) {
    return '';
  }
  if (text.length <= MAX_TEXT_LENGTH) {
    return text;
  }
  return text.slice(0, MAX_TEXT_LENGTH);
}

function extractCleanText(html) {
  if (!html) {
    return '';
  }
  try {
    const $ = load(html);
    $('script, style, noscript, iframe, svg').remove();
    const text = $('body').text();
    return truncateText(normalizeWhitespace(text));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[fetch-missing-raw-content] failed to parse HTML, fallback to strip tags:', error?.message);
    const stripped = html.replace(/<[^>]+>/g, ' ');
    return truncateText(normalizeWhitespace(stripped));
  }
}

function buildAxiosConfig(profile) {
  const headers = {
    'User-Agent': profile.userAgent || pickGenericUserAgent(),
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };
  if (profile.cookieHeader) {
    headers.Cookie = profile.cookieHeader;
  }
  const config = {
    timeout: FETCH_TIMEOUT,
    maxRedirects: 5,
    responseType: 'text',
    headers,
  };
  if (profile.proxy) {
    if (profile.proxy.protocol === 'socks5') {
      const { SocksProxyAgent } = require('socks-proxy-agent');
      const agent = new SocksProxyAgent({
        hostname: profile.proxy.host,
        port: profile.proxy.port,
        userId: profile.proxy.username,
        password: profile.proxy.password,
      });
      config.httpAgent = agent;
      config.httpsAgent = agent;
      config.proxy = false;
    } else {
      config.proxy = {
        protocol: profile.proxy.protocol || 'http',
        host: profile.proxy.host,
        port: profile.proxy.port,
        auth:
          profile.proxy.username && profile.proxy.password
            ? { username: profile.proxy.username, password: profile.proxy.password }
            : undefined,
      };
    }
  } else {
    config.proxy = false;
  }
  return config;
}

function createRequestProfile(proxy) {
  const userAgent = proxy?.userAgent || pickGenericUserAgent();
  const cookieHeader = proxy?.cookieHeader || pickManualCookie();
  return {
    proxy: proxy
      ? {
          host: proxy.host,
          port: proxy.port,
          username: proxy.username,
          password: proxy.password,
          protocol: proxy.protocol || 'http',
          id: proxy.id,
        }
      : null,
    userAgent,
    cookieHeader,
  };
}

async function fetchJobPage(url) {
  if (!url) {
    return '';
  }
  const makeAttemptList = () => {
    const attempts = [];
    const proxyAttempts = proxyPool.length
      ? Math.min(PROXY_ATTEMPTS_PER_REQUEST, proxyPool.length)
      : 0;
    for (let i = 0; i < proxyAttempts; i += 1) {
      const proxy = getNextProxyCandidate();
      if (proxy) {
        attempts.push({ proxy });
      }
    }
    attempts.push({ proxy: null });
    return attempts;
  };

  for (let retry = 0; retry < RETRIES_PER_URL; retry += 1) {
    const attempts = makeAttemptList();
    for (const attempt of attempts) {
      const profile = createRequestProfile(attempt.proxy);
      const config = buildAxiosConfig(profile);
      const label = profile.proxy
        ? `proxy ${profile.proxy.host}:${profile.proxy.port}`
        : 'direct';
      try {
        const response = await axios.get(url, config);
        return response.data ?? '';
      } catch (error) {
        const reason =
          error?.response?.status ? `http_${error.response.status}` : error?.code || error?.message;
        // eslint-disable-next-line no-console
        console.warn(
          `[fetch-missing-raw-content] ${label} failed for ${url} (retry ${retry + 1}/${
            RETRIES_PER_URL
          }): ${reason}`,
        );
      }
    }
  }
  return '';
}

function needsFullText(job) {
  const raw = job.rawContent ?? '';
  if (!raw.trim()) {
    return true;
  }
  if (raw.length < DESCRIPTION_MIN_LENGTH / 2) {
    return true;
  }
  const descr = job.description ?? '';
  if (!descr.trim()) {
    return true;
  }
  return descr.length < DESCRIPTION_MIN_LENGTH;
}

async function loadCandidates(limit) {
  const batchSize = Math.min(Math.max(limit * 3, 50), 500);
  let skip = 0;
  const result = [];

  while (result.length < limit) {
    const rows = await prisma.jobPosting.findMany({
      where: {
        link: { not: null },
      },
      orderBy: {
        createdAt: 'desc',
      },
      skip,
      take: batchSize,
    });
    if (rows.length === 0) {
      break;
    }
    for (const job of rows) {
      if (needsFullText(job)) {
        result.push(job);
        if (result.length >= limit) {
          break;
        }
      }
    }
    skip += batchSize;
  }
  return result;
}

function shouldReplaceDescription(job, newText) {
  const current = (job.description ?? '').trim();
  if (!current) {
    return true;
  }
  if (current.length >= DESCRIPTION_MIN_LENGTH) {
    return false;
  }
  return newText.length > current.length;
}

async function processJob(job) {
  const html = await fetchJobPage(job.link);
  if (!html) {
    return { id: job.id, status: 'skip', reason: 'fetch_failed' };
  }
  const clean = extractCleanText(html);
  if (!clean || clean.length < 50) {
    return { id: job.id, status: 'skip', reason: 'content_too_short' };
  }
  const updateData = { rawContent: clean, updatedAt: new Date() };
  if (shouldReplaceDescription(job, clean)) {
    updateData.description = clean;
  }
  await prisma.jobPosting.update({
    where: { id: job.id },
    data: updateData,
  });
  return { id: job.id, status: 'updated', descriptionUpdated: Boolean(updateData.description) };
}

async function main() {
  const { limit } = parseArgs(process.argv);
  await loadProxyPool();
  // eslint-disable-next-line no-console
  console.log(`[fetch-missing-raw-content] looking for ${limit} postings without full text...`);
  const jobs = await loadCandidates(limit);
  if (jobs.length === 0) {
    // eslint-disable-next-line no-console
    console.log('[fetch-missing-raw-content] no candidates found');
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[fetch-missing-raw-content] fetched ${jobs.length} candidates`);

  let processed = 0;
  let updated = 0;
  let descriptionUpdates = 0;

  for (const job of jobs) {
    // eslint-disable-next-line no-console
    console.log(`[fetch-missing-raw-content] processing ${job.id} (${job.link})`);
    // eslint-disable-next-line no-await-in-loop
    const result = await processJob(job);
    processed += 1;
    if (result.status === 'updated') {
      updated += 1;
      if (result.descriptionUpdated) {
        descriptionUpdates += 1;
      }
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        `[fetch-missing-raw-content] skip ${job.id}: ${result.reason ?? 'unknown_reason'}`
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `[fetch-missing-raw-content] done: processed=${processed}, updated=${updated}, descriptionUpdated=${descriptionUpdates}`
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[fetch-missing-raw-content] fatal error', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
