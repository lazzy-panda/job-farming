/*
  Проверяет прокси из базы (таблица Proxy) и обновляет их статус.

  Usage:
    DATABASE_URL=file:./dev.db node scripts/verify-proxies.js
*/

const axios = require('axios');
const { execSync, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const repoRoot = path.join(__dirname, '..');
const dbFile = process.env.DATABASE_PATH || 'dev.db';
const dbPath = path.isAbsolute(dbFile) ? dbFile : path.join(repoRoot, dbFile);
const tmpDir = path.join(repoRoot, 'tmp');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

const TEST_URL = process.env.PROXY_TEST_URL || 'https://httpbin.org/ip';
const TIMEOUT_MS = Number(process.env.PROXY_TEST_TIMEOUT_MS ?? 5000);
const MAX_CONCURRENCY = Number(process.env.PROXY_TEST_CONCURRENCY ?? 10);

async function testProxy(proxy) {
  const isSocks = proxy.protocol === 'socks5';
  const axiosConfig = {
    timeout: TIMEOUT_MS,
    headers: proxy.userAgent ? { 'User-Agent': proxy.userAgent } : undefined,
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
      host: proxy.host,
      port: proxy.port,
      protocol: proxy.protocol || 'http',
      auth:
        proxy.username && proxy.password
          ? { username: proxy.username, password: proxy.password }
          : undefined,
    };
  }
  try {
    const response = await axios.get(TEST_URL, axiosConfig);

    if (response.status >= 200 && response.status < 400) {
      return { ok: true, status: `ok:${response.status}` };
    }

    return { ok: false, status: `bad_status:${response.status}` };
  } catch (error) {
    const message =
      (error?.response?.status && `http_${error.response.status}`) ||
      error?.code ||
      error?.message ||
      'unknown_error';
    return { ok: false, status: `error:${message}` };
  }
}

function loadProxies() {
  const query =
    'SELECT id, host, port, protocol, username, password, userAgent FROM "Proxy" ORDER BY createdAt ASC;';
  const cmd = `sqlite3 -json ${JSON.stringify(dbPath)} ${JSON.stringify(query)}`;
  const raw = execSync(cmd, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'inherit'],
  })
    .toString('utf-8')
    .trim();
  if (!raw) {
    return [];
  }
  return JSON.parse(raw);
}

function escapeSql(value) {
  return value.replace(/'/g, "''");
}

async function main() {
  const proxies = loadProxies();
  if (!proxies.length) {
    console.log('В таблице Proxy нет записей.');
    return;
  }

  console.log(`Проверяем ${proxies.length} прокси...`);
  let success = 0;
  let failed = 0;

  const statements = [];
  const tasks = [];

  const worker = async (proxy) => {
    const result = await testProxy(proxy);
    const data = {
      active: result.ok ? 1 : 0,
      lastStatus: escapeSql(result.status.slice(0, 120)),
      lastCheckedAt: new Date().toISOString(),
    };

    statements.push(
      `UPDATE "Proxy" SET active=${data.active}, lastStatus='${data.lastStatus}', lastCheckedAt='${data.lastCheckedAt}' WHERE id='${escapeSql(
        proxy.id,
      )}';`,
    );

    if (result.ok) {
      success += 1;
      console.log(`✓ ${proxy.host}:${proxy.port} (${result.status})`);
    } else {
      failed += 1;
      console.log(`✗ ${proxy.host}:${proxy.port} (${result.status})`);
    }
  };

  const running = [];
  for (const proxy of proxies) {
    const task = worker(proxy).finally(() => {
      const idx = running.indexOf(task);
      if (idx >= 0) running.splice(idx, 1);
    });
    running.push(task);
    if (running.length >= MAX_CONCURRENCY) {
      await Promise.race(running);
    }
  }
  await Promise.all(running);

  const sqlFile = path.join(tmpDir, `update_proxies_${Date.now()}.sql`);
  fs.writeFileSync(sqlFile, statements.join('\n'));
  spawnSync('sqlite3', [dbPath, `.read ${sqlFile}`], {
    stdio: 'inherit',
    cwd: repoRoot,
  });
  fs.unlinkSync(sqlFile);

  console.log(`Готово. Рабочих: ${success}, нерабочих: ${failed}.`);
}

main().catch((err) => {
  console.error('Ошибка при проверке прокси:', err);
  process.exitCode = 1;
});
