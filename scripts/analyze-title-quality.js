/*
  Analyze title extraction quality from storage/parser-compare.txt

  Output:
    - storage/title-quality-report.json
    - storage/title-quality-report.txt

  Usage:
    node scripts/analyze-title-quality.js --in=storage/parser-compare.txt
*/

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
parseArgs.call(
)
function parseArgs(argv) {
  const out = {
    input: 'storage/parser-compare.txt',
    outJson: 'storage/title-quality-report.json',
    outTxt: 'storage/title-quality-report.txt',
    maxExamplesPerType: 25,
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

function clip(text, maxLen) {
  const s = (text ?? '').toString();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '...';
}

function countBracesDelta(line) {
  let d = 0;
  for (const ch of line) {
    if (ch === '{') d += 1;
    if (ch === '}') d -= 1;
  }
  return d;
}

function looksWorkFormatOnly(title) {
  const t = (title ?? '').toString().trim();
  if (!t) return false;
  const workFormatTokensRe =
    /(удал[её]нк[\p{L}]*(?:а|о|е)?|удал[её]нно|remote|remotely|hybrid|onsite|on[-\s]*site|office|в\s+офисе|офис|part[-\s]*time|full[-\s]*time|парт[-\s]*тайм|фулл[-\s]*тайм|частичн[\p{L}]*\s+занятост[\p{L}]*|полн[\p{L}]*\s+занятост[\p{L}]*)/giu;
  const leftovers = t
    .toLowerCase()
    .replace(workFormatTokensRe, ' ')
    .replace(/[^a-zа-яё]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return !leftovers;
}

function titleHasSalaryArtifacts(title) {
  const t = safeLower(title);
  if (!t) return false;
  return (
    /(\d{2,}\s*(?:₽|\$|€|usd|eur|rub|gbp|chf|pln|sek|nok|dkk|ron|bgn))/i.test(t) ||
    /\b(руб|r u b|usd|eur|salary|compensation|заработ|оклад|оплат)\b/i.test(t)
  );
}

function titleHasSectionArtifacts(title) {
  const t = safeLower(title);
  if (!t) return false;
  return /\b(требовани|обязанност|услови|о проекте|мы предлагаем|что мы предлагаем|responsibilities|requirements|benefits|about the project)\b/i.test(
    t,
  );
}

function titleLooksTooLong(title) {
  return ((title ?? '').toString().trim().length || 0) > 80;
}

function titleHasUrl(title) {
  return /https?:\/\//i.test((title ?? '').toString());
}

function makeIssue(type, detail) {
  return { type, detail };
}

function analyzeTitle(job) {
  const issues = [];
  const title = job.parsed?.title ?? null;
  const titleValue = title?.value ?? null;
  const role = title?.role ?? 'unknown';
  const raw = title?.raw ?? null;

  if (!titleValue) {
    // role might be detected but value is null -> we still want a value
    issues.push(makeIssue('title_null', { role, raw: clip(raw, 180) }));
    return issues;
  }

  const v = titleValue.toString();

  if (looksWorkFormatOnly(v)) {
    issues.push(makeIssue('title_workformat_only', { value: v, role }));
  }
  if (titleLooksTooLong(v)) {
    issues.push(makeIssue('title_too_long', { value: clip(v, 220), len: v.length, role }));
  }
  if (titleHasSalaryArtifacts(v)) {
    issues.push(makeIssue('title_contains_salary', { value: clip(v, 220), role }));
  }
  if (titleHasSectionArtifacts(v)) {
    issues.push(makeIssue('title_contains_section_words', { value: clip(v, 220), role }));
  }
  if (titleHasUrl(v)) {
    issues.push(makeIssue('title_contains_url', { value: clip(v, 220), role }));
  }
  return issues;
}

async function main() {
  const args = parseArgs(process.argv);
  const inputPath = path.resolve(args.input);
  const outJsonPath = path.resolve(args.outJson);
  const outTxtPath = path.resolve(args.outTxt);

  const rl = readline.createInterface({
    input: fs.createReadStream(inputPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  const jobs = [];

  /** @type {{ id: string|null, meta: any, original: string, parsedLines: string[] } | null} */
  let current = null;
  let mode = 'none'; // none | original | parsed
  let parsedDepth = 0;
  let parsedStarted = false;

  function finalizeCurrent() {
    if (!current) return;
    let parsed = null;
    try {
      const raw = current.parsedLines.join('\n').trim();
      if (raw) parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    jobs.push({
      id: current.id,
      meta: current.meta,
      originalText: current.original.trim(),
      parsed,
    });
    current = null;
    mode = 'none';
    parsedDepth = 0;
    parsedStarted = false;
  }

  for await (const line of rl) {
    if (line.startsWith('===== JOB ')) {
      finalizeCurrent();
      const id = line.replace(/^===== JOB\s+/, '').replace(/\s*=====\s*$/, '').trim();
      current = { id: id || null, meta: null, original: '', parsedLines: [] };
      continue;
    }
    if (!current) continue;

    if (line.startsWith('META:')) {
      const raw = line.slice('META:'.length).trim();
      try {
        current.meta = JSON.parse(raw);
      } catch {
        current.meta = { raw };
      }
      continue;
    }
    if (line.startsWith('--- ORIGINAL TEXT ---')) {
      mode = 'original';
      continue;
    }
    if (line.startsWith('--- PARSED JSON ---')) {
      mode = 'parsed';
      continue;
    }

    if (mode === 'original') {
      // parse-all-vacancies separates blocks by markers; we keep until the next marker
      if (line.startsWith('--- ') || line.startsWith('===== JOB ')) {
        mode = 'none';
      } else {
        current.original += line + '\n';
      }
      continue;
    }

    if (mode === 'parsed') {
      // JSON is pretty printed; collect between first '{' and matched braces
      if (!parsedStarted) {
        if (line.trim().startsWith('{')) {
          parsedStarted = true;
          parsedDepth = 0;
        } else {
          continue;
        }
      }
      current.parsedLines.push(line);
      parsedDepth += countBracesDelta(line);
      if (parsedStarted && parsedDepth === 0) {
        mode = 'none';
      }
      continue;
    }
  }

  finalizeCurrent();

  const report = {
    input: inputPath,
    jobs: jobs.length,
    issues: [],
    issueTypes: {},
    examples: {},
  };

  for (const job of jobs) {
    const issues = analyzeTitle(job);
    if (!issues.length) continue;
    report.issues.push({
      id: job.id,
      meta: { title: job.meta?.title ?? null, link: job.meta?.link ?? null, sourceId: job.meta?.sourceId ?? null },
      issues,
      title: job.parsed?.title ?? null,
      originalTextClip: clip(job.originalText, 260),
    });
    for (const issue of issues) {
      report.issueTypes[issue.type] = (report.issueTypes[issue.type] ?? 0) + 1;
      if (!report.examples[issue.type]) report.examples[issue.type] = [];
      if (report.examples[issue.type].length < args.maxExamplesPerType) {
        report.examples[issue.type].push({
          id: job.id,
          metaTitle: job.meta?.title ?? null,
          link: job.meta?.link ?? null,
          parsedTitle: job.parsed?.title ?? null,
          issue: issue.detail,
          originalTextClip: clip(job.originalText, 320),
        });
      }
    }
  }

  fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
  fs.writeFileSync(outJsonPath, JSON.stringify(report, null, 2), 'utf8');

  const sortedTypes = Object.entries(report.issueTypes).sort((a, b) => b[1] - a[1]);
  let txt = '';
  txt += `[analyze-title-quality] input=${inputPath}\n`;
  txt += `[analyze-title-quality] jobs=${report.jobs} jobsWithIssues=${report.issues.length} issues=${sortedTypes.reduce((s, [, c]) => s + c, 0)}\n\n`;
  txt += '## Issue types (sorted by count)\n';
  for (const [t, c] of sortedTypes) txt += `- ${t}: ${c}\n`;
  txt += '\n## Examples\n';
  for (const [t] of sortedTypes) {
    txt += `\n### ${t}\n`;
    for (const ex of report.examples[t] ?? []) {
      txt += `\n- id=${ex.id}\n`;
      txt += `  metaTitle=${clip(ex.metaTitle, 120)}\n`;
      txt += `  link=${ex.link ?? ''}\n`;
      txt += `  parsedTitle=${clip(ex.parsedTitle?.value ?? '', 160)} role=${ex.parsedTitle?.role ?? ''}\n`;
      txt += `  issue=${JSON.stringify(ex.issue)}\n`;
      txt += `  original=${clip(ex.originalTextClip, 220)}\n`;
    }
  }
  fs.writeFileSync(outTxtPath, txt, 'utf8');

  console.log(`[analyze-title-quality] wrote ${outJsonPath} and ${outTxtPath}`);
  console.log(
    `[analyze-title-quality] jobs=${report.jobs} jobsWithIssues=${report.issues.length} issueTypes=${sortedTypes.length}`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[analyze-title-quality] FAILED', err);
  process.exitCode = 1;
});

