/*
  Analyze parser output file storage/parser-compare.txt
  and collect likely mismatches / anomalies.

  Output:
    - storage/parser-compare-report.json
    - storage/parser-compare-report.txt

  Usage:
    node scripts/analyze-parser-compare.js --in=storage/parser-compare.txt
*/

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

function parseArgs(argv) {
  const out = {
    input: 'storage/parser-compare.txt',
    outJson: 'storage/parser-compare-report.json',
    outTxt: 'storage/parser-compare-report.txt',
    maxExamplesPerType: 20,
  };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--in=')) out.input = arg.slice('--in='.length);
    if (arg.startsWith('--out-json=')) out.outJson = arg.slice('--out-json='.length);
    if (arg.startsWith('--out-txt=')) out.outTxt = arg.slice('--out-txt='.length);
    if (arg.startsWith('--max-examples=')) {
      const n = Number(arg.slice('--max-examples='.length));
      if (Number.isFinite(n) && n > 0) out.maxExamplesPerType = Math.floor(n);
    }
  }
  return out;
}

function safeLower(s) {
  return (s ?? '').toString().toLowerCase();
}

function hasAny(text, needles) {
  const v = safeLower(text);
  return needles.some((n) => v.includes(n));
}

function hasSalaryKeywords(text) {
  return hasAny(text, [
    'salary',
    'compensation',
    'pay',
    'rate',
    'заработ',
    'оплат',
    'оклад',
    'руб',
    '₽',
    '$',
    '€',
    '£',
    'usd',
    'eur',
    'gbp',
  ]);
}

function detectCurrencyMention(text) {
  const v = safeLower(text);
  if (v.includes('₽') || v.includes(' руб') || v.includes('руб.')) return 'RUB';
  if (v.includes('$') || v.includes(' usd')) return 'USD';
  if (v.includes('€') || v.includes(' eur')) return 'EUR';
  if (v.includes('£') || v.includes(' gbp')) return 'GBP';
  if (v.includes(' chf')) return 'CHF';
  if (v.includes(' sek')) return 'SEK';
  if (v.includes(' nok')) return 'NOK';
  if (v.includes(' dkk')) return 'DKK';
  return null;
}

function clip(text, maxLen) {
  const s = (text ?? '').toString();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '...';
}

function normalizeUrl(url) {
  const u = (url ?? '').toString().trim();
  if (!u) return null;
  return u;
}

function analyzeJob(job) {
  const issues = [];

  const original = job.originalText;
  const parsed = job.parsed;

  const salary = parsed?.salary ?? null;
  const title = parsed?.title ?? null;
  const contacts = parsed?.contacts ?? null;
  const location = parsed?.location?.value ?? null;
  const metaWarnings = parsed?.meta?.warnings ?? [];

  // 1) Salary false positives (e.g. year 2013 as salary)
  const min = salary?.min ?? null;
  const max = salary?.max ?? null;
  const currency = salary?.currency ?? null;
  if (min !== null || max !== null) {
    const a = Number(min ?? max);
    const b = Number(max ?? min);
    const y1 = Number.isFinite(a) && a >= 1900 && a <= 2100;
    const y2 = Number.isFinite(b) && b >= 1900 && b <= 2100;
    const kw = hasSalaryKeywords(original);
    if ((y1 && y2) && !kw) {
      issues.push({
        type: 'salary_false_positive_year',
        detail: { min, max, currency, hint: 'looks like year but no salary keywords in text' },
      });
    }
  }

  // 2) Salary currency unknown but original mentions a currency
  const mentioned = detectCurrencyMention(original);
  if ((min !== null || max !== null) && (currency === 'UNKNOWN' || currency === null) && mentioned) {
    issues.push({
      type: 'salary_currency_unknown_but_mentioned',
      detail: { min, max, currency, mentioned },
    });
  }

  // 3) salary_not_found but min/max present
  if (metaWarnings.includes('salary_not_found') && (min !== null || max !== null)) {
    issues.push({
      type: 'warning_salary_not_found_but_has_values',
      detail: { min, max, currency },
    });
  }

  // 4) Title is null but raw is long or looks like whole text
  const titleValue = title?.value ?? null;
  const titleRaw = title?.raw ?? null;
  const rawLen = (titleRaw ?? '').toString().length;
  if (titleValue === null && rawLen >= 140) {
    issues.push({
      type: 'title_glued_or_too_long_raw',
      detail: { rawLen, rawPreview: clip(titleRaw, 160) },
    });
  }

  // 5) Telegram hashtag garbage in title raw
  if (titleRaw && /^\s*(?:#\S+\s*){2,}/.test(titleRaw)) {
    issues.push({
      type: 'title_starts_with_hashtags',
      detail: { rawPreview: clip(titleRaw, 180) },
    });
  }

  // 6) Location looks like tech tokens (Django/FastAPI/etc)
  const city = (location?.city ?? '').toString();
  const country2 = (location?.country ?? '').toString();
  const badLocTokens = ['django', 'fastapi', 'nestjs', 'node', 'react', 'angular', 'vue', 'kafka', 'docker', 'gitlab', 'github'];
  if (hasAny(city, badLocTokens) || hasAny(country2, badLocTokens)) {
    issues.push({
      type: 'location_false_positive_tech_tokens',
      detail: { city, country: country2 },
    });
  }

  // 6b) Location is a common non-location word (EN section labels, generic tokens)
  const badLocWords = [
    'years',
    'year',
    'working',
    'hours',
    'experience',
    'benefits',
    'requirements',
    'responsibilities',
    'salary',
    'compensation',
    'offer',
    'retirement',
    'pto',
    'bonus',
    'k',
    'ote',
  ];
  const cityLower = safeLower(city).trim();
  const countryLower = safeLower(country2).trim();
  if (badLocWords.includes(cityLower) || badLocWords.includes(countryLower)) {
    issues.push({
      type: 'location_false_positive_common_words',
      detail: { city, country: country2 },
    });
  }

  // 7) URL parsing: URLs with trailing comma/paren
  const urls = Array.isArray(contacts?.urls) ? contacts.urls : [];
  const badUrls = urls.filter((u) => /[),.;:]$/.test((u ?? '').toString().trim()));
  if (badUrls.length > 0) {
    issues.push({
      type: 'contacts_urls_trailing_punct',
      detail: { badUrls: badUrls.slice(0, 10) },
    });
  }

  // 8) No contacts but original has obvious email/telegram
  const emails = Array.isArray(contacts?.emails) ? contacts.emails : [];
  const telegram = Array.isArray(contacts?.telegram) ? contacts.telegram : [];
  const originalHasEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(original);
  const originalHasAt = /(^|\s)@([a-zA-Z0-9_]{3,32})\b/.test(original);
  if ((emails.length === 0 && telegram.length === 0) && (originalHasEmail || originalHasAt)) {
    issues.push({
      type: 'contacts_missed_obvious',
      detail: { originalHasEmail, originalHasAt },
    });
  }

  // 9) Mixed/multi-vacancy content heuristic
  // Keep this heuristic strict; long Telegram posts with hashtags are common and aren't "multi-vacancy dumps".
  const multiMarkers = [
    'понравились вакансии',
    'разместить вакансию',
  ];
  const hasMulti = hasAny(original, multiMarkers) && original.length > 900;
  // If parser detected and truncated the input, don't count it as mismatch.
  const handledMulti =
    Array.isArray(metaWarnings) &&
    (metaWarnings.includes('input_truncated') || metaWarnings.includes('multi_vacancy_detected'));
  if (hasMulti && !handledMulti) {
    issues.push({
      type: 'original_text_looks_like_multi_vacancy_dump',
      detail: { length: original.length },
    });
  }

  return issues;
}

function addIssue(stats, issue, example) {
  if (!stats.counts[issue.type]) {
    stats.counts[issue.type] = 0;
    stats.examples[issue.type] = [];
  }
  stats.counts[issue.type] += 1;
  const arr = stats.examples[issue.type];
  if (arr.length < stats.maxExamplesPerType) {
    arr.push(example);
  }
}

async function main() {
  const args = parseArgs(process.argv);

  const inPath = path.isAbsolute(args.input) ? args.input : path.join(process.cwd(), args.input);
  const outJson = path.isAbsolute(args.outJson) ? args.outJson : path.join(process.cwd(), args.outJson);
  const outTxt = path.isAbsolute(args.outTxt) ? args.outTxt : path.join(process.cwd(), args.outTxt);

  if (!fs.existsSync(inPath)) {
    throw new Error(`Input file not found: ${inPath}`);
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(inPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  const stats = {
    maxExamplesPerType: args.maxExamplesPerType,
    counts: {},
    examples: {},
    totals: { jobs: 0, jobsWithIssues: 0, issues: 0 },
  };

  let state = 'idle';
  let current = null;
  let originalLines = [];
  let parsedLines = [];

  function flushCurrent() {
    if (!current) return;

    const originalText = originalLines.join('\n').trim();
    const parsedText = parsedLines.join('\n').trim();
    let parsed = null;
    try {
      parsed = parsedText ? JSON.parse(parsedText) : null;
    } catch (e) {
      const example = {
        jobId: current.id,
        title: current.title,
        link: current.link,
        error: String(e && e.message ? e.message : e),
        parsedPreview: clip(parsedText, 400),
      };
      addIssue(stats, { type: 'parsed_json_invalid' }, example);
      stats.totals.jobs += 1;
      stats.totals.jobsWithIssues += 1;
      stats.totals.issues += 1;
      current = null;
      originalLines = [];
      parsedLines = [];
      return;
    }

    const job = {
      ...current,
      originalText,
      parsed,
    };

    const issues = analyzeJob(job);
    stats.totals.jobs += 1;
    if (issues.length > 0) {
      stats.totals.jobsWithIssues += 1;
    }
    for (const issue of issues) {
      stats.totals.issues += 1;
      addIssue(
        stats,
        issue,
        {
          jobId: job.id,
          title: job.title,
          link: job.link,
          issue: issue.type,
          detail: issue.detail,
          originalPreview: clip(job.originalText, 280),
          parsedPreview: {
            title: job.parsed?.title,
            salary: job.parsed?.salary,
            location: job.parsed?.location,
            contacts: job.parsed?.contacts,
            meta: job.parsed?.meta,
          },
        },
      );
    }

    current = null;
    originalLines = [];
    parsedLines = [];
  }

  for await (const line of rl) {
    if (line.startsWith('===== JOB ')) {
      flushCurrent();
      state = 'meta';
      const id = line.replace('===== JOB ', '').replace(' =====', '').trim();
      current = { id, title: null, link: null };
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith('META: ')) {
      try {
        const meta = JSON.parse(line.slice('META: '.length));
        current.title = meta.title ?? null;
        current.link = meta.link ?? null;
      } catch {
        // ignore
      }
      continue;
    }

    if (line.trim() === '--- ORIGINAL TEXT ---') {
      state = 'original';
      continue;
    }

    if (line.trim() === '--- PARSED JSON ---') {
      state = 'parsed';
      continue;
    }

    if (line.startsWith('===== /JOB ')) {
      flushCurrent();
      state = 'idle';
      continue;
    }

    if (state === 'original') {
      originalLines.push(line);
    } else if (state === 'parsed') {
      parsedLines.push(line);
    }
  }

  flushCurrent();

  fs.writeFileSync(outJson, JSON.stringify(stats, null, 2), 'utf8');

  // Human-readable report
  const lines = [];
  lines.push(`[analyze-parser-compare] input=${inPath}`);
  lines.push(`[analyze-parser-compare] jobs=${stats.totals.jobs} jobsWithIssues=${stats.totals.jobsWithIssues} issues=${stats.totals.issues}`);
  lines.push('');

  const sortedTypes = Object.entries(stats.counts)
    .sort((a, b) => b[1] - a[1]);

  lines.push('## Issue types (sorted by count)');
  for (const [type, count] of sortedTypes) {
    lines.push(`- ${type}: ${count}`);
  }

  lines.push('');
  lines.push('## Examples');
  for (const [type, count] of sortedTypes) {
    lines.push('');
    lines.push(`### ${type} (${count})`);
    const ex = stats.examples[type] ?? [];
    for (const item of ex) {
      lines.push('---');
      lines.push(`jobId=${item.jobId}`);
      lines.push(`title=${item.title ?? ''}`);
      lines.push(`link=${normalizeUrl(item.link) ?? ''}`);
      lines.push(`detail=${JSON.stringify(item.detail)}`);
      lines.push(`originalPreview=${item.originalPreview}`);
    }
  }

  fs.writeFileSync(outTxt, lines.join('\n'), 'utf8');

  // eslint-disable-next-line no-console
  console.log(`[analyze-parser-compare] wrote ${outJson} and ${outTxt}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[analyze-parser-compare] FAILED', e);
  process.exitCode = 1;
});
