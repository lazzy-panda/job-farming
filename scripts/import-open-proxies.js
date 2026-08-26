/*
  Загружает публичные HTTP(S) прокси-списки, проверяет работоспособность и сохраняет
  минимум 100 рабочих прокси в таблицу Proxy. Для каждого прокси подбирается «человеческий»
  User-Agent и, если возможно, подготавливается cookie-header с сайта higheredjobs.com.

  Usage:
    DATABASE_URL=file:./dev.db node scripts/import-open-proxies.js
    (при необходимости можно переопределить переменные окружения:
      MIN_WORKING_PROXIES, PROXY_TEST_CONCURRENCY, PROXY_COOKIE_CONCURRENCY)
*/

const axios = require('axios');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const { loadManualCookiePool } = require('./utils/manual-cookie-pool');

const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

const GENERIC_USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0',
  'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 12_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
];
const DEFAULT_GENERIC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const PROXY_USER_AGENT_PROFILES = [
  {
    label: 'chrome_win10',
    seed: 13,
    build(seed) {
      const major = seededRange(seed + 1, 118, 134);
      const build = seededRange(seed + 5, 4200, 5900);
      const patch = seededRange(seed + 9, 50, 140);
      return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.${build}.${patch} Safari/537.36`;
    },
  },
  {
    label: 'chrome_linux',
    seed: 21,
    build(seed) {
      const major = seededRange(seed + 2, 118, 133);
      const build = seededRange(seed + 6, 4100, 5600);
      const patch = seededRange(seed + 10, 45, 120);
      return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.${build}.${patch} Safari/537.36`;
    },
  },
  {
    label: 'chrome_mac',
    seed: 37,
    build(seed) {
      const major = seededRange(seed + 3, 119, 132);
      const build = seededRange(seed + 7, 4200, 5600);
      const patch = seededRange(seed + 11, 40, 130);
      const minor = seededRange(seed + 15, 0, 6);
      return `Mozilla/5.0 (Macintosh; Intel Mac OS X 13_${minor}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.${build}.${patch} Safari/537.36`;
    },
  },
  {
    label: 'edge_win11',
    seed: 55,
    build(seed) {
      const major = seededRange(seed + 4, 119, 133);
      const build = seededRange(seed + 8, 4300, 6000);
      const patch = seededRange(seed + 12, 50, 120);
      return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.${build}.${patch} Safari/537.36 Edg/${major}.0.${build}.${patch}`;
    },
  },
  {
    label: 'firefox_win',
    seed: 77,
    build(seed) {
      const major = seededRange(seed + 5, 118, 132);
      const minor = seededRange(seed + 9, 0, 2);
      return `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${major}.${minor}) Gecko/20100101 Firefox/${major}.${minor}`;
    },
  },
  {
    label: 'firefox_linux',
    seed: 91,
    build(seed) {
      const major = seededRange(seed + 6, 118, 132);
      const minor = seededRange(seed + 10, 0, 2);
      return `Mozilla/5.0 (X11; Linux x86_64; rv:${major}.${minor}) Gecko/20100101 Firefox/${major}.${minor}`;
    },
  },
  {
    label: 'safari_mac',
    seed: 111,
    build(seed) {
      const versionMajor = seededRange(seed + 7, 16, 18);
      const versionMinor = seededRange(seed + 11, 0, 6);
      const osMinor = seededRange(seed + 13, 0, 6);
      return `Mozilla/5.0 (Macintosh; Intel Mac OS X 14_${osMinor}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${versionMajor}.${versionMinor} Safari/605.1.15`;
    },
  },
];

const assignedProxyUserAgents = new Set();

function seededRandomFraction(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function seededRange(seed, min, max) {
  if (min >= max) {
    return min;
  }
  const fraction = seededRandomFraction(seed);
  return Math.floor(fraction * (max - min + 1)) + min;
}

function getGenericUserAgent(index = 0) {
  if (!GENERIC_USER_AGENTS.length) {
    return DEFAULT_GENERIC_UA;
  }
  return GENERIC_USER_AGENTS[index % GENERIC_USER_AGENTS.length];
}

function pickProxyUserAgent(index) {
  let attempt = 0;
  while (attempt < PROXY_USER_AGENT_PROFILES.length * 4) {
    const profile =
      PROXY_USER_AGENT_PROFILES[(index + attempt) % PROXY_USER_AGENT_PROFILES.length];
    const seed = index * 97 + attempt * 53 + profile.seed;
    const userAgent = profile.build(seed);
    if (!assignedProxyUserAgents.has(userAgent)) {
      assignedProxyUserAgents.add(userAgent);
      return { userAgent, source: `profile:${profile.label}` };
    }
    attempt += 1;
  }
  const fallback = `${getGenericUserAgent(index)} (${Date.now()}-${index})`;
  assignedProxyUserAgents.add(fallback);
  return { userAgent: fallback, source: 'profile:fallback' };
}

const PROXY_SOURCES = [
  { url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt', label: 'TheSpeedX/http' },
  { url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/https.txt', label: 'TheSpeedX/https' },
  { url: 'https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt', label: 'roosterkid/HTTPS_RAW' },
  { url: 'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/https.txt', label: 'ShiftyTR/https' },
  { url: 'https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies.txt', label: 'jetkai/online' },
  { url: 'https://raw.githubusercontent.com/mmpx12/proxy-list/master/http.txt', label: 'mmpx12/http' },
  { url: 'https://raw.githubusercontent.com/almroot/proxylist/master/list.txt', label: 'almroot/list' },
  { url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt', label: 'monosans/http' },
  { url: 'https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/https/https.txt', label: 'KangProxy/https' },
  { url: 'https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/http/http.txt', label: 'KangProxy/http' },
  { url: 'https://raw.githubusercontent.com/opsxcq/proxy-list/master/list.txt', label: 'opsxcq/list' },
  { url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt', label: 'TheSpeedX/socks5', protocol: 'socks5' },
  { url: 'https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/socks5/socks5.txt', label: 'KangProxy/socks5', protocol: 'socks5' },
  { url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt', label: 'monosans/socks5', protocol: 'socks5' },
  { url: 'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt', label: 'hookzof/socks5', protocol: 'socks5' },
  { url: 'https://raw.githubusercontent.com/roosterkid/openproxylist/main/SOCKS5_RAW.txt', label: 'roosterkid/SOCKS5_RAW', protocol: 'socks5' },
  { url: 'https://raw.githubusercontent.com/proxylist-to/proxy-list/main/socks5.txt', label: 'proxylist-to/socks5', protocol: 'socks5' },
  { url: 'https://raw.githubusercontent.com/zevtyardt/proxy-list/main/socks5.txt', label: 'zevtyardt/socks5', protocol: 'socks5' },
  { url: 'https://raw.githubusercontent.com/hyperbeats/proxy-list/main/socks5.txt', label: 'hyperbeats/socks5', protocol: 'socks5' },
  { url: 'https://raw.githubusercontent.com/UptimerBot/proxy-list/master/proxies/socks5.txt', label: 'UptimerBot/socks5', protocol: 'socks5' },
  { url: 'https://raw.githubusercontent.com/rdavydov/proxy-list/main/proxies/socks5.txt', label: 'rdavydov/socks5', protocol: 'socks5' },
  { url: 'https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/socks5.txt', label: 'ALIILAPRO/socks5', protocol: 'socks5' },
  { url: 'https://raw.githubusercontent.com/ErcinDedeoglu/proxies/main/proxies/socks5.txt', label: 'ErcinDedeoglu/socks5', protocol: 'socks5' },
  { url: 'https://raw.githubusercontent.com/yemixzy/proxy-list/master/proxy-list/data/socks5.txt', label: 'yemixzy/socks5', protocol: 'socks5' },
  { url: 'https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES/master/socks5.txt', label: 'Zaeem20/socks5', protocol: 'socks5' },
  { url: 'https://www.proxy-list.download/api/v1/get?type=socks5', label: 'proxy-list.download/socks5', protocol: 'socks5' },
  { url: 'https://api.proxyscrape.com/?request=getproxies&proxytype=socks5&timeout=10000&country=all&ssl=all&anonymity=all', label: 'proxyscrape/socks5', protocol: 'socks5' },
  { url: 'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks5.txt', label: 'ShiftyTR/socks5', protocol: 'socks5' },
];

const MANUAL_PROXY_FILE = process.env.PROXY_MANUAL_FILE || 'storage/manual-proxies.txt';
const MIN_WORKING_PROXIES = Number(process.env.MIN_WORKING_PROXIES ?? 100);
const MAX_PROXY_CANDIDATES = Number(process.env.MAX_PROXY_CANDIDATES ?? 8000);
const TEST_URL = process.env.PROXY_TEST_URL || 'https://api.ipify.org?format=json';
const COOKIE_ORIGIN_URL = process.env.PROXY_COOKIE_URL || 'https://www.higheredjobs.com/';
const TEST_TIMEOUT_MS = Number(process.env.PROXY_TEST_TIMEOUT_MS ?? 8000);
const MAX_TEST_CONCURRENCY = Number(process.env.PROXY_TEST_CONCURRENCY ?? 20);
const MAX_COOKIE_CONCURRENCY = Number(process.env.PROXY_COOKIE_CONCURRENCY ?? 5);
const manualCookiePoolInfo = loadManualCookiePool({
  defaultRelativePath: 'storage/higheredjobs.cookies.txt',
  label: 'import-open-proxies',
});
const MANUAL_COOKIE_POOL = manualCookiePoolInfo.cookies || [];
if (MANUAL_COOKIE_POOL.length) {
  console.log(
    `Будут использованы ${MANUAL_COOKIE_POOL.length} cookie-стр${MANUAL_COOKIE_POOL.length === 1 ? 'ока' : 'ок'} из живой сессии.`,
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSourceList(source) {
  try {
    const randomIndex = GENERIC_USER_AGENTS.length
      ? Math.floor(Math.random() * GENERIC_USER_AGENTS.length)
      : 0;
    const response = await axios.get(source.url, {
      timeout: 15000,
      headers: {
        'User-Agent': getGenericUserAgent(randomIndex),
        Accept: 'text/plain',
      },
    });
    console.log(`• ${source.label}: загружено ${response.data.length} байт`);
    return response.data;
  } catch (error) {
    console.warn(`• ${source.label}: не удалось загрузить (${(error && error.message) || error})`);
    return '';
  }
}

function parseProxyLine(line) {
  if (!line) return null;
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }
  const protocolMatch = trimmed.match(/^([a-z0-9]+):\/\//i);
  const protocol = protocolMatch ? protocolMatch[1].toLowerCase() : null;
  let clean = trimmed.replace(/^[a-z0-9]+:\/\//i, '');
  if (clean.includes(' ')) {
    clean = clean.split(' ').pop();
  }
  const parts = clean.split('@');
  const hostPortPart = parts.pop();
  if (!hostPortPart) {
    return null;
  }

  let username;
  let password;
  if (parts.length) {
    const creds = parts.join('@');
    const sepIndex = creds.indexOf(':');
    if (sepIndex > 0) {
      username = creds.slice(0, sepIndex);
      password = creds.slice(sepIndex + 1);
    }
  }

  let host = hostPortPart;
  let portStr;
  if (hostPortPart.startsWith('[')) {
    const closing = hostPortPart.indexOf(']');
    if (closing > 0) {
      host = hostPortPart.slice(0, closing + 1);
      portStr = hostPortPart.slice(closing + 1);
      if (portStr.startsWith(':')) {
        portStr = portStr.slice(1);
      }
    }
  }
  if (!portStr) {
    const lastColon = hostPortPart.lastIndexOf(':');
    if (lastColon === -1) {
      return null;
    }
    host = hostPortPart.slice(0, lastColon);
    portStr = hostPortPart.slice(lastColon + 1);
  }

  if (!host || !portStr) {
    return null;
  }
  const port = Number(portStr);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return null;
  }

  let extra = null;
  const restSeparator = host.indexOf(' ');
  if (restSeparator !== -1) {
    extra = host.slice(restSeparator + 1);
    host = host.slice(0, restSeparator);
  }
  if (extra && !username) {
    const extraParts = extra.split(':');
    if (extraParts.length >= 2) {
      [username, password] = [extraParts[0], extraParts.slice(1).join(':')];
    }
  }

  return {
    host: host.trim(),
    port,
    username: username?.trim() || null,
    password: password?.trim() || null,
    protocol: protocol
      ? protocol === 'socks5'
        ? 'socks5'
        : protocol === 'https'
          ? 'https'
          : 'http'
      : null,
  };
}

function parseCandidateList(rawData, defaultProtocol = 'http') {
  const candidates = [];
  const lines = rawData.split(/\r?\n/);
  for (const line of lines) {
    const proxy = parseProxyLine(line);
    if (proxy?.host && proxy.port) {
      if (!proxy.protocol) {
        proxy.protocol = defaultProtocol;
      }
      candidates.push(proxy);
    }
  }
  return candidates;
}

function dedupeCandidates(candidates) {
  const byKey = new Map();
  for (const proxy of candidates) {
    const key = `${proxy.protocol || 'http'}://${proxy.host}:${proxy.port}`;
    if (!byKey.has(key)) {
      byKey.set(key, proxy);
    }
  }
  return Array.from(byKey.values());
}

function loadManualProxies() {
  if (!MANUAL_PROXY_FILE) return [];
  if (!fs.existsSync(MANUAL_PROXY_FILE)) return [];
  try {
    const raw = fs.readFileSync(MANUAL_PROXY_FILE, 'utf8');
    const candidates = parseCandidateList(raw, 'http');
    if (candidates.length) {
      console.log(`• manual file: загружено ${candidates.length} прокси из ${MANUAL_PROXY_FILE}`);
    }
    return candidates;
  } catch (error) {
    console.warn(`• manual file: не удалось прочитать ${MANUAL_PROXY_FILE} (${error?.message || error})`);
    return [];
  }
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

async function testProxy(proxy, userAgent) {
  const isSocks = proxy.protocol === 'socks5';
  const axiosConfig = {
    timeout: TEST_TIMEOUT_MS,
    headers: { 'User-Agent': userAgent },
    validateStatus: (status) => status >= 200 && status < 400,
  };

  if (isSocks) {
    const hostname = proxy.host?.trim();
    if (!hostname || !proxy.port || Number.isNaN(Number(proxy.port))) {
      return { ok: false, status: 'error:invalid_socks_address' };
    }
    try {
      const { SocksProxyAgent } = require('socks-proxy-agent');
      const agent = new SocksProxyAgent({
        hostname,
        port: proxy.port,
        userId: proxy.username,
        password: proxy.password,
      });
      axiosConfig.httpAgent = agent;
      axiosConfig.httpsAgent = agent;
      axiosConfig.proxy = false;
    } catch (error) {
      const message = error?.message || 'socks_agent_error';
      return { ok: false, status: `error:${message}` };
    }
  } else {
    axiosConfig.proxy = {
      protocol: 'http',
      host: proxy.host,
      port: proxy.port,
      auth:
        proxy.username && proxy.password
          ? { username: proxy.username, password: proxy.password }
          : undefined,
    };
  }
  try {
    const response = await axios.get(TEST_URL, axiosConfig);
    const status = `ok:${response.status}`;
    return { ok: true, status };
  } catch (error) {
    const code =
      (error?.response?.status && `http_${error.response.status}`) ||
      error?.code ||
      error?.message ||
      'unknown';
    return { ok: false, status: code };
  }
}

let cachedFallbackCookieHeader = null;

async function fetchFallbackCookieHeader() {
  if (cachedFallbackCookieHeader !== null) {
    return cachedFallbackCookieHeader;
  }
  try {
    const response = await axios.get(COOKIE_ORIGIN_URL, {
      timeout: TEST_TIMEOUT_MS,
      headers: {
        'User-Agent': getGenericUserAgent(0),
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      validateStatus: (status) => status >= 200 && status < 400,
    });
    const rawCookies = response.headers?.['set-cookie'];
    if (Array.isArray(rawCookies) && rawCookies.length) {
      cachedFallbackCookieHeader = rawCookies
        .map((cookie) => cookie.split(';')[0])
        .filter(Boolean)
        .join('; ');
      return cachedFallbackCookieHeader;
    }
  } catch (error) {
    console.warn(
      `Не удалось получить fallback cookie (${error?.message || error}). Cookies будут пустыми.`,
    );
  }
  cachedFallbackCookieHeader = null;
  return cachedFallbackCookieHeader;
}

async function fetchCookieHeader(proxy, userAgent, proxyIndex) {
  if (MANUAL_COOKIE_POOL.length) {
    const manualHeader = MANUAL_COOKIE_POOL[proxyIndex % MANUAL_COOKIE_POOL.length];
    return { header: manualHeader, source: 'browser-export' };
  }
  const isSocks = proxy.protocol === 'socks5';
  const axiosConfig = {
    timeout: TEST_TIMEOUT_MS,
    headers: {
      'User-Agent': userAgent,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    validateStatus: (status) => status >= 200 && status < 400,
  };
  if (isSocks) {
    const { SocksProxyAgent } = require('socks-proxy-agent');
    const agent = new SocksProxyAgent({
      hostname: proxy.host,
      port: proxy.port,
      userId: proxy.username,
      password: proxy.password,
    });
    axiosConfig.httpAgent = agent;
    axiosConfig.httpsAgent = agent;
    axiosConfig.proxy = false;
  } else {
    axiosConfig.proxy = {
      protocol: 'http',
      host: proxy.host,
      port: proxy.port,
      auth:
        proxy.username && proxy.password
          ? { username: proxy.username, password: proxy.password }
          : undefined,
    };
  }
  try {
    const response = await axios.get(COOKIE_ORIGIN_URL, axiosConfig);
    const rawCookies = response.headers?.['set-cookie'];
    if (Array.isArray(rawCookies) && rawCookies.length) {
      const header = rawCookies
        .map((cookie) => cookie.split(';')[0])
        .filter(Boolean)
        .join('; ');
      return { header, source: 'proxy-fetch' };
    }
  } catch (error) {
    const message = error?.message || error;
    console.warn(`  cookie fetch ${proxy.host}:${proxy.port} failed: ${message}`);
  }
  if (cachedFallbackCookieHeader === null) {
    await fetchFallbackCookieHeader();
  }
  return {
    header: cachedFallbackCookieHeader,
    source: cachedFallbackCookieHeader ? 'fallback' : null,
  };
}

async function withConcurrency(items, limit, handler) {
  let index = 0;
  const errors = [];
  const workers = Array.from({ length: limit }).map(async () => {
    for (;;) {
      const currentIndex = index;
      index += 1;
      if (currentIndex >= items.length) {
        break;
      }
      try {
        await handler(items[currentIndex], currentIndex);
      } catch (error) {
        errors.push(error);
      }
      await sleep(5);
    }
  });
  await Promise.all(workers);
  if (errors.length) {
    throw errors[0];
  }
}

async function saveProxy(proxy) {
  const existing = await prisma.proxy.findFirst({
    where: { host: proxy.host, port: proxy.port, protocol: proxy.protocol || 'http' },
  });
  const now = new Date();
  const data = {
    host: proxy.host,
    port: proxy.port,
    protocol: proxy.protocol || 'http',
    username: proxy.username,
    password: proxy.password,
    userAgent: proxy.userAgent,
    userAgentSource: proxy.userAgentSource ?? 'profile_pool',
    userAgentUpdatedAt: proxy.userAgent ? proxy.userAgentUpdatedAt ?? now : null,
    cookieHeader: proxy.cookieHeader ?? null,
    cookieSource:
      proxy.cookieHeader || proxy.cookieSource
        ? proxy.cookieSource ?? 'auto-fetch'
        : null,
    cookieUpdatedAt: proxy.cookieHeader ? proxy.cookieUpdatedAt ?? now : null,
    active: true,
    lastStatus: proxy.lastStatus ?? 'imported',
    lastCheckedAt: now,
  };
  if (existing) {
    await prisma.proxy.update({
      where: { id: existing.id },
      data,
    });
    return existing.id;
  }
  const created = await prisma.proxy.create({ data });
  return created.id;
}

async function main() {
  console.log(`Загружаем публичные прокси (минимум ${MIN_WORKING_PROXIES} рабочих)...`);
  const rawLists = await Promise.all(PROXY_SOURCES.map((source) => fetchSourceList(source)));
  const manualCandidates = loadManualProxies();
  const candidates = dedupeCandidates(
    [
      ...manualCandidates,
      ...rawLists.flatMap((payload, idx) =>
        parseCandidateList(payload, PROXY_SOURCES[idx]?.protocol || 'http'),
      ),
    ],
  );
  console.log(`Всего уникальных кандидатов: ${candidates.length}`);
  if (!candidates.length) {
    throw new Error('Не удалось получить список прокси');
  }
  const randomized = shuffle([...candidates]);
  const limitedCandidates =
    randomized.length > MAX_PROXY_CANDIDATES
      ? randomized.slice(0, MAX_PROXY_CANDIDATES)
      : randomized;
  if (limitedCandidates.length !== candidates.length) {
    console.log(`Ограничиваем проверку первыми ${limitedCandidates.length} прокси (MAX_PROXY_CANDIDATES=${MAX_PROXY_CANDIDATES}).`);
  }

  const working = [];
  await withConcurrency(limitedCandidates, MAX_TEST_CONCURRENCY, async (proxy, index) => {
    if (working.length >= MIN_WORKING_PROXIES * 3) {
      return;
    }
    const { userAgent, source: userAgentSource } = pickProxyUserAgent(index);
    const result = await testProxy(proxy, userAgent);
    if (result.ok) {
      working.push({
        ...proxy,
        userAgent,
        userAgentSource,
        userAgentUpdatedAt: new Date(),
        lastStatus: result.status,
      });
      console.log(`✓ ${proxy.host}:${proxy.port} (${result.status})`);
    } else if (index % 50 === 0) {
      console.log(`✗ ${proxy.host}:${proxy.port} (${result.status})`);
    }
  });

  if (working.length < MIN_WORKING_PROXIES) {
    console.warn(
      `Найдено только ${working.length} рабочих прокси (минимум ${MIN_WORKING_PROXIES}). Будут сохранены все доступные.`,
    );
  } else {
    console.log(`Рабочих прокси: ${working.length}`);
  }

  console.log('Получаем cookie headers для рабочих прокси...');
  await withConcurrency(working, MAX_COOKIE_CONCURRENCY, async (proxy, index) => {
    const { header, source } = await fetchCookieHeader(proxy, proxy.userAgent, index);
    working[index].cookieHeader = header ?? null;
    working[index].cookieSource = source ?? null;
    working[index].cookieUpdatedAt = header ? new Date() : null;
  });

  console.log('Сохраняем проверенные прокси в базу...');
  let saved = 0;
  for (const proxy of working) {
    await saveProxy(proxy);
    saved += 1;
  }
  console.log(`Готово. Сохранено ${saved} прокси.`);
  if (saved < MIN_WORKING_PROXIES) {
    console.warn('⚠ Не удалось достичь минимального количества прокси. Попробуйте повторить скрипт позже.');
  }
}

main()
  .catch((error) => {
    console.error('Ошибка импорта прокси:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
