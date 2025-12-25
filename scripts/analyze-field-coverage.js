/*
  Analyze field coverage from storage/parser-compare.txt

  Output:
    - storage/field-coverage-report.json
    - storage/field-coverage-report.txt

  Usage:
    node scripts/analyze-field-coverage.js --in=storage/parser-compare.txt
*/

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

function parseArgs(argv) {
  const out = {
    input: 'storage/parser-compare.txt',
    outJson: 'storage/field-coverage-report.json',
    outTxt: 'storage/field-coverage-report.txt',
    maxExamplesPerIssue: 15,
  };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--in=')) out.input = arg.slice('--in='.length);
    if (arg.startsWith('--out-json=')) out.outJson = arg.slice('--out-json='.length);
    if (arg.startsWith('--out-txt=')) out.outTxt = arg.slice('--out-txt='.length);
    if (arg.startsWith('--max-examples=')) {
      const n = Number(arg.slice('--max-examples='.length));
      if (Number.isFinite(n) && n > 0) out.maxExamplesPerIssue = Math.floor(n);
    }
  }
  return out;
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

function isEmptyString(v) {
  return (v ?? '').toString().trim().length === 0;
}

function isEmptyArray(v) {
  return !Array.isArray(v) || v.length === 0;
}

function analyzeParsed(parsed) {
  const issues = [];

  const titleValue = parsed?.title?.value ?? null;
  const salaryMin = parsed?.salary?.min ?? null;
  const salaryMax = parsed?.salary?.max ?? null;
  const contacts = parsed?.contacts ?? null;
  const employmentTypes = parsed?.employment?.types ?? null;
  const workFormat = parsed?.workFormat?.value ?? null;
  const location = parsed?.location?.value ?? null;
  const techAll = parsed?.tech?.all ?? null;
  const spokenRequired = parsed?.languages?.required ?? null;
  const benefits = parsed?.benefits ?? null;
  const companyName = parsed?.company?.name ?? null;

  // Core fields that должны быть почти всегда (хотя бы title)
  if (titleValue === null) issues.push({ type: 'title_null' });

  // Salary: treat as missing if both min/max null
  if (salaryMin === null && salaryMax === null) issues.push({ type: 'salary_missing' });

  // Contacts: missing if all lists empty
  const hasAnyContact =
    (contacts?.emails?.length ?? 0) > 0 ||
    (contacts?.phones?.length ?? 0) > 0 ||
    (contacts?.telegram?.length ?? 0) > 0 ||
    (contacts?.urls?.length ?? 0) > 0;
  if (!hasAnyContact) issues.push({ type: 'contacts_missing' });

  if (isEmptyArray(employmentTypes)) issues.push({ type: 'employment_missing' });
  if (!workFormat || workFormat === 'unknown') issues.push({ type: 'work_format_missing' });

  const city = location?.city ?? null;
  const country = location?.country ?? null;
  if (!city && !country) issues.push({ type: 'location_missing' });

  if (isEmptyArray(techAll)) issues.push({ type: 'tech_missing' });
  if (isEmptyArray(spokenRequired)) issues.push({ type: 'languages_missing' });
  if (isEmptyArray(benefits)) issues.push({ type: 'benefits_missing' });
  if (isEmptyString(companyName)) issues.push({ type: 'company_missing' });

  // warnings from parser itself
  const warnings = Array.isArray(parsed?.meta?.warnings) ? parsed.meta.warnings : [];
  for (const w of warnings) issues.push({ type: `warn:${w}` });

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

  let current = null; // {id, meta, original, parsedLines}
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
      if (line.startsWith('--- ') || line.startsWith('===== JOB ')) {
        mode = 'none';
      } else {
        current.original += line + '\n';
      }
      continue;
    }

    if (mode === 'parsed') {
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

  const totals = {
    input: inputPath,
    jobsTotal: jobs.length,
    jobsWithText: jobs.filter((j) => j.originalText.length > 0).length,
  };

  const counts = new Map(); // issueType -> count
  const examples = new Map(); // issueType -> examples[]

  for (const job of jobs) {
    if (!job.parsed) continue;
    // анализируем только вакансии с текстом — иначе это скорее проблема скрейпа
    if (job.originalText.length === 0) continue;
    const issues = analyzeParsed(job.parsed);
    for (const issue of issues) {
      const t = issue.type;
      counts.set(t, (counts.get(t) ?? 0) + 1);
      if (!examples.has(t)) examples.set(t, []);
      const arr = examples.get(t);
      if (arr.length < args.maxExamplesPerIssue) {
        arr.push({
          id: job.id,
          link: job.meta?.link ?? null,
          metaTitle: job.meta?.title ?? null,
          parsedTitle: job.parsed?.title?.value ?? null,
          warning: t.startsWith('warn:') ? t : null,
          originalClip: clip(job.originalText, 260),
        });
      }
    }
  }

  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const report = {
    ...totals,
    issueTypes: Object.fromEntries(sorted),
    examples: Object.fromEntries(Array.from(examples.entries())),
  };

  fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
  fs.writeFileSync(outJsonPath, JSON.stringify(report, null, 2), 'utf8');

  let txt = '';
  txt += `[analyze-field-coverage] input=${inputPath}\n`;
  txt += `[analyze-field-coverage] jobsTotal=${totals.jobsTotal} jobsWithText=${totals.jobsWithText}\n\n`;
  txt += '## Issue types (sorted by count, only jobs with non-empty text)\n';
  for (const [t, c] of sorted) txt += `- ${t}: ${c}\n`;
  txt += '\n## Examples (top)\n';
  for (const [t, c] of sorted.slice(0, 12)) {
    txt += `\n### ${t} (${c})\n`;
    for (const ex of report.examples[t] ?? []) {
      txt += `- id=${ex.id} title=${clip(ex.metaTitle, 110)} parsedTitle=${clip(ex.parsedTitle, 120)} link=${ex.link ?? ''}\n`;
    }
  }
  fs.writeFileSync(outTxtPath, txt, 'utf8');

  console.log(`[analyze-field-coverage] wrote ${outJsonPath} and ${outTxtPath}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[analyze-field-coverage] FAILED', err);
  process.exitCode = 1;
});

