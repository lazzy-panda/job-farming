/*
  Parse a curated set of English/EU job posting samples (templates/examples)
  and print: meta -> original text -> parsed JSON.

  Why: validate EN + Europe parsing on realistic structures.

  Usage:
    npx nx build vacancy-parser
    node scripts/parse-web-samples.js --out=storage/parser-compare-web-en.txt
*/

const DEFAULT_OUT = 'storage/parser-compare-web-en.txt';

function parseArgs(argv) {
  const out = { outFile: DEFAULT_OUT };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--out=')) {
      out.outFile = arg.slice('--out='.length);
    }
  }
  return out;
}

function formatBlock(meta, original, parsed) {
  return (
    `\n\n===== JOB ${meta.id} =====\n` +
    `META: ${JSON.stringify(meta)}\n` +
    `\n--- ORIGINAL TEXT ---\n` +
    `${(original ?? '').trim()}\n` +
    `\n--- PARSED JSON ---\n` +
    `${JSON.stringify(parsed, null, 2)}\n` +
    `===== /JOB ${meta.id} =====\n`
  );
}

function buildSamples() {
  return [
    {
      id: 'web-en-001',
      title: 'Software Engineer',
      source: 'template: software engineer job description',
      link: 'https://example.com/templates/software-engineer',
      opts: { currencyHint: 'EUR', defaultCountry: 'DE' },
      text: `
Job Title: Software Engineer
Location: Berlin - Germany
Employment Type: Full-time

Job Summary:
We are seeking a skilled Software Engineer to design, develop, and maintain software applications.

Responsibilities:
- Design, develop, and test software applications.
- Troubleshoot and debug issues in existing code.
- Participate in code reviews.

Requirements:
- 2+ years of experience.
- Proficiency in Python and TypeScript.

Compensation:
€65.000 - €80.000 p.a. (gross)

Benefits:
- Health insurance
- Paid time off

How to apply:
Send your CV to jobs@company.example.
`,
    },
    {
      id: 'web-en-002',
      title: 'DevOps Engineer',
      source: 'template: devops engineer job description',
      link: 'https://example.com/templates/devops-engineer',
      opts: { currencyHint: 'CHF', defaultCountry: 'CH' },
      text: `
DevOps Engineer
Location: Zurich, Switzerland

The role:
Build and maintain CI/CD pipelines, automate infrastructure, and improve reliability.

Requirements:
- Experience with Terraform and Kubernetes

Compensation:
CHF 110’000 - 130’000 p.a.

Apply:
https://example.ch/careers,
`,
    },
    {
      id: 'web-en-003',
      title: 'Data Engineer',
      source: 'template: data engineer job description',
      link: 'https://example.com/templates/data-engineer',
      opts: { currencyHint: 'GBP', defaultCountry: 'GB' },
      text: `
Job Title: Data Engineer
Location: London (UK)

Responsibilities:
- Build data pipelines.
- Ensure data quality.

Requirements:
- Strong SQL.
- Experience with Spark or Kafka.

Salary:
£75,000 - £95,000 per year (gross)

Benefits:
- Pension plan
- Private medical insurance

How to apply:
Email: hiring@data.example
`,
    },
    {
      id: 'web-en-004',
      title: 'Backend Engineer (EU only)',
      source: 'example: EU-only remote job posting',
      link: 'https://example.com/posts/backend-eu-only',
      opts: { currencyHint: 'EUR', defaultCountry: 'NL' },
      text: `
Backend Engineer
Remote (EU only)

What you’ll do:
- Build APIs in Node.js.
- Maintain PostgreSQL schemas.

Requirements:
- 3+ years of experience.

Compensation:
€500 per day

Contact:
@hiring_team
`,
    },
    {
      id: 'web-en-005',
      title: 'Fullstack Developer (Poland)',
      source: 'example: PLN salary format',
      link: 'https://example.com/posts/fullstack-pl',
      opts: { defaultCountry: 'PL' },
      text: `
Fullstack Developer
Location: Warsaw, Poland

Responsibilities:
- Build web apps with React and Node.js.

Salary:
18 000 zł net per month

How to apply:
Send portfolio to team@pl.example.
`,
    },
    {
      id: 'web-en-006',
      title: 'QA Engineer (Sweden)',
      source: 'example: SEK with kr',
      link: 'https://example.com/posts/qa-se',
      opts: { defaultCountry: 'SE' },
      text: `
QA Engineer
Location: Stockholm, Sweden

Responsibilities:
- Write test cases.
- Automate regression tests.

Salary:
60 000 kr per month

Benefits:
- Flexible hours
- Remote-friendly
`,
    },
    {
      id: 'web-en-007',
      title: 'Accountant',
      source: 'template: accountant + EU salary',
      link: 'https://example.com/templates/accountant',
      opts: { currencyHint: 'RON', defaultCountry: 'RO' },
      text: `
Accountant
Location: Bucharest (Romania)

Responsibilities:
- Monthly close
- VAT reporting

Requirements:
- 3+ years of experience

Salary:
RON 12.000 - 15.000 per month

How to apply:
Apply at https://example.ro/apply.
`,
    },
  ];
}

async function main() {
  const args = parseArgs(process.argv);
  const fs = await import('node:fs');
  const path = await import('node:path');

  const outPath = path.isAbsolute(args.outFile) ? args.outFile : path.join(process.cwd(), args.outFile);

  const parser = require('./../dist/libs/vacancy-parser/src/index.js');
  const samples = buildSamples();

  const header = `[parse-web-samples] samples=${samples.length}\n`;
  fs.writeFileSync(outPath, header, 'utf8');

  for (const s of samples) {
    const meta = {
      id: s.id,
      title: s.title,
      company: null,
      publishedAt: null,
      sourceId: s.source,
      link: s.link,
    };

    const parsed = parser.parseVacancy(s.text, {
      strict: true,
      pageTitle: s.title,
      sourceUrl: s.link,
      debug: false,
      ...(s.opts ?? {}),
    });

    fs.appendFileSync(outPath, formatBlock(meta, s.text, parsed), 'utf8');
  }

  fs.appendFileSync(outPath, `\n[parse-web-samples] DONE\n`, 'utf8');
  console.log(`[parse-web-samples] wrote ${outPath}`);
}

main().catch((e) => {
  console.error('[parse-web-samples] FAILED', e);
  process.exitCode = 1;
});
