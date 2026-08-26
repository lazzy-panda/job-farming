const fs = require('node:fs');
const path = require('node:path');

function normalizeHeaderValue(value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase().startsWith('cookie:')) {
    return trimmed.slice(trimmed.indexOf(':') + 1).trim();
  }
  return trimmed;
}

function flattenCookieObjects(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  const pairs = [];
  for (const entry of items) {
    if (entry && typeof entry === 'object' && 'name' in entry && 'value' in entry) {
      const name = String(entry.name ?? '').trim();
      const value = String(entry.value ?? '').trim();
      if (name) {
        pairs.push(`${name}=${value}`);
      }
    } else if (typeof entry === 'string') {
      const normalized = normalizeHeaderValue(entry);
      if (normalized) {
        pairs.push(normalized);
      }
    }
  }
  if (!pairs.length) {
    return [];
  }
  return [pairs.join('; ')];
}

function parseCookieJson(jsonPayload) {
  if (!jsonPayload) {
    return [];
  }
  if (Array.isArray(jsonPayload)) {
    if (jsonPayload.every((item) => typeof item === 'string')) {
      return jsonPayload.map(normalizeHeaderValue).filter(Boolean);
    }
    const flattened = flattenCookieObjects(jsonPayload);
    if (flattened.length) {
      return flattened;
    }
  }
  if (
    typeof jsonPayload === 'object' &&
    jsonPayload !== null &&
    Array.isArray(jsonPayload.cookies)
  ) {
    return parseCookieJson(jsonPayload.cookies);
  }
  return [];
}

function parseCookieText(contents) {
  if (!contents) {
    return [];
  }
  const normalized = contents.replace(/\r/g, '');
  const lines = normalized.split('\n');
  const cookies = [];
  let buffer = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line === '---') {
      if (buffer.length) {
        const header = normalizeHeaderValue(buffer.join(' '));
        if (header) {
          cookies.push(header);
        }
        buffer = [];
      }
      continue;
    }
    buffer.push(line);
  }
  if (buffer.length) {
    const header = normalizeHeaderValue(buffer.join(' '));
    if (header) {
      cookies.push(header);
    }
  }
  return cookies;
}

function resolveCookieFilePath(repoRoot, relativePath) {
  if (!relativePath) {
    return path.join(repoRoot, 'storage', 'higheredjobs.cookies.txt');
  }
  return path.isAbsolute(relativePath)
    ? relativePath
    : path.join(repoRoot, relativePath);
}

function loadManualCookiePool(options = {}) {
  const repoRoot = path.join(__dirname, '..', '..');
  const envPath =
    process.env.HIGHEREDJOBS_COOKIE_FILE ||
    process.env.HIGHERED_COOKIE_FILE ||
    process.env.HJ_COOKIE_FILE;
  const defaultPath = options.defaultRelativePath
    ? resolveCookieFilePath(repoRoot, options.defaultRelativePath)
    : path.join(repoRoot, 'storage', 'higheredjobs.cookies.txt');
  const targetPath = envPath
    ? resolveCookieFilePath(repoRoot, envPath)
    : defaultPath;

  if (!fs.existsSync(targetPath)) {
    if (options.log !== false) {
      console.log(
        `[cookie-pool] Файл с cookies не найден (${path.relative(repoRoot, targetPath)}).`,
      );
    }
    return { cookies: [], filePath: null };
  }

  const raw = fs.readFileSync(targetPath, 'utf8');
  if (!raw.trim()) {
    console.warn(
      `[cookie-pool] Файл ${path.relative(
        repoRoot,
        targetPath,
      )} пуст — cookie-строки не загружены.`,
    );
    return { cookies: [], filePath: targetPath };
  }

  let cookies = [];
  const trimmed = raw.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      cookies = parseCookieJson(parsed);
    } catch (error) {
      console.warn(
        `[cookie-pool] Не удалось распарсить JSON (${error?.message || error}). Пытаемся разобрать как текст.`,
      );
    }
  }
  if (!cookies.length) {
    cookies = parseCookieText(raw);
  }

  if (!cookies.length) {
    console.warn(
      `[cookie-pool] В файле ${path.relative(
        repoRoot,
        targetPath,
      )} не найдено ни одной cookie-строки.`,
    );
    return { cookies: [], filePath: targetPath };
  }

  const uniqueCookies = Array.from(new Set(cookies));
  if (options.log !== false) {
    console.log(
      `[cookie-pool] Загружено ${uniqueCookies.length} cookie-стр${uniqueCookies.length === 1 ? 'о' : 'оки'} из ${path.relative(
        repoRoot,
        targetPath,
      )}.`,
    );
  }

  return { cookies: uniqueCookies, filePath: targetPath };
}

module.exports = {
  loadManualCookiePool,
};

