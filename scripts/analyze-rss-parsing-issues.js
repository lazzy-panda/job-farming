/*
  Анализирует все RSS вакансии в базе, сравнивает исходный текст с результатом парсинга
  и определяет все недочеты и некорректные значения.

  Usage:
    DATABASE_URL=file:./dev.db node scripts/analyze-rss-parsing-issues.js
    DATABASE_URL=file:./dev.db node scripts/analyze-rss-parsing-issues.js --out=storage/rss-parsing-issues.md
*/

const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
const { load } = require('cheerio');

// Импортируем парсер локально
const { parseVacancy } = require('../dist/libs/vacancy-parser/src/index.js');

const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });
const MIN_TEXT_LENGTH_FOR_ANALYSIS = 400;
const PAGE_FETCH_TIMEOUT = 30000;
const MAX_FETCHED_TEXT_LENGTH = 60000;
const FALLBACK_USER_AGENT =
  'JobFarmParserAudit/1.0 (+https://github.com/kirill/job_farm; rss analyzer)';
const fetchedContentCache = new Map();

function parseArgs(argv) {
  const out = {
    outFile: 'storage/rss-parsing-issues.md',
    limit: null,
  };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--out=')) {
      out.outFile = arg.slice('--out='.length);
    } else if (arg.startsWith('--limit=')) {
      const n = Number(arg.slice('--limit='.length));
      out.limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
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

function clip(text, maxLen) {
  const s = (text ?? '').toString();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '...';
}

function normalizeWhitespace(text) {
  return (text ?? '').toString().replace(/\s+/g, ' ').trim();
}

function truncateText(text) {
  if (!text) {
    return '';
  }
  if (text.length <= MAX_FETCHED_TEXT_LENGTH) {
    return text;
  }
  return text.slice(0, MAX_FETCHED_TEXT_LENGTH);
}

function extractTextFromHtml(html) {
  if (!html) {
    return '';
  }
  try {
    const $ = load(html);
    $('script, style, noscript, iframe, svg').remove();
    const text = $('body').text();
    return truncateText(normalizeWhitespace(text));
  } catch {
    const stripped = html.replace(/<[^>]+>/g, ' ');
    return truncateText(normalizeWhitespace(stripped));
  }
}

async function fetchJobPage(url) {
  if (!url) {
    return '';
  }
  if (fetchedContentCache.has(url)) {
    return fetchedContentCache.get(url);
  }
  try {
    const response = await axios.get(url, {
      timeout: PAGE_FETCH_TIMEOUT,
      maxRedirects: 5,
      responseType: 'text',
      headers: {
        'User-Agent': FALLBACK_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const html = response.data ?? '';
    const text = extractTextFromHtml(html);
    fetchedContentCache.set(url, text);
    return text;
  } catch (error) {
    fetchedContentCache.set(url, '');
    // eslint-disable-next-line no-console
    console.warn('[analyze-rss-parsing-issues] failed to fetch page', url, error?.message);
    return '';
  }
}

async function resolveJobContent(job) {
  const baseText = normalizeWhitespace(job.rawContent || job.description || '');
  if (baseText.length >= MIN_TEXT_LENGTH_FOR_ANALYSIS || !job.link) {
    return baseText;
  }
  const fetched = await fetchJobPage(job.link);
  if (fetched && fetched.length >= MIN_TEXT_LENGTH_FOR_ANALYSIS) {
    return fetched;
  }
  return fetched || baseText;
}

function analyzeJob(job, parsed) {
  const issues = [];
  const original = (job.description ?? '').trim();
  const title = job.title ?? '';

  // Объединяем title и description для анализа
  const fullText = `${title}\n${original}`;

  // 1. Employment type issues
  const employmentTypes = parsed?.employment?.types ?? [];
  if (employmentTypes.includes('internship')) {
    // Проверяем, действительно ли это стажировка
    const hasInternshipKeywords = hasAny(fullText, ['internship', 'intern', 'стажировк']);
    const hasSeniorKeywords = hasAny(fullText, ['senior', 'lead', 'head of', 'director', 'manager']);
    const hasFullTimeKeywords = hasAny(fullText, ['full-time', 'full time', 'полная занятость']);
    
    if (hasSeniorKeywords || hasFullTimeKeywords) {
      issues.push({
        type: 'employment_wrong_type_internship',
        severity: 'high',
        detail: {
          detected: 'internship',
          reason: hasSeniorKeywords ? 'has senior/lead keywords' : 'has full-time keywords',
          employmentTypes,
        },
      });
    }
  }

  // 2. Company name issues
  const companyName = parsed?.company?.name ?? null;
  if (companyName) {
    // Проверяем на "Headquarters" как false positive
    if (safeLower(companyName).includes('headquarters') || safeLower(companyName).includes('headquarter') || safeLower(companyName) === 'hq') {
      issues.push({
        type: 'company_name_headquarters_false_positive',
        severity: 'high',
        detail: {
          detected: companyName,
          title,
          originalPreview: clip(original, 200),
        },
      });
    }
    
    // Проверяем, что название компании не обрезано
    const titleHasCompany = title.includes(companyName);
    if (titleHasCompany) {
      // Проверяем, есть ли более полное название в заголовке
      const companyMatch = title.match(/^([A-Z][A-Za-z0-9\s&'.-]{2,60})\s*[:\-–—]/);
      if (companyMatch && companyMatch[1] && companyMatch[1] !== companyName) {
        issues.push({
          type: 'company_name_truncated',
          severity: 'medium',
          detail: {
            detected: companyName,
            fullName: companyMatch[1],
            title,
          },
        });
      }
    }
    
    // Проверяем, есть ли URL с доменом, который можно использовать как название компании
    const urlMatch = original.match(/url\s*:\s*https?:\/\/(?:www\.)?([a-z0-9][a-z0-9-]{1,40}\.[a-z]{2,})/i);
    if (urlMatch && urlMatch[1]) {
      const domainName = urlMatch[1].split('.')[0];
      const domainCapitalized = domainName.charAt(0).toUpperCase() + domainName.slice(1);
      if (safeLower(companyName) !== safeLower(domainCapitalized) && !safeLower(companyName).includes(safeLower(domainName))) {
        issues.push({
          type: 'company_name_missed_from_url',
          severity: 'medium',
          detail: {
            detected: companyName,
            possibleFromUrl: domainCapitalized,
            url: urlMatch[0],
          },
        });
      }
    }
  } else {
    // Проверяем, есть ли название компании в заголовке, но не распознано
    const companyMatch = title.match(/^([A-Z][A-Za-z0-9\s&'.-]{2,60})\s*[:\-–—]/);
    if (companyMatch) {
      issues.push({
        type: 'company_name_missed',
        severity: 'high',
        detail: {
          possibleName: companyMatch[1],
          title,
        },
      });
    }
    
    // Проверяем URL для извлечения названия компании
    const urlMatch = original.match(/url\s*:\s*https?:\/\/(?:www\.)?([a-z0-9][a-z0-9-]{1,40}\.[a-z]{2,})/i);
    if (urlMatch && urlMatch[1]) {
      const domainName = urlMatch[1].split('.')[0];
      const domainCapitalized = domainName.charAt(0).toUpperCase() + domainName.slice(1);
      issues.push({
        type: 'company_name_missed_from_url',
        severity: 'high',
        detail: {
          possibleFromUrl: domainCapitalized,
          url: urlMatch[0],
        },
      });
    }
  }

  // 3. Salary issues
  const salary = parsed?.salary ?? null;
  const min = salary?.min ?? null;
  const max = salary?.max ?? null;
  const currency = salary?.currency ?? null;
  const period = salary?.period ?? null;

  // Проверяем на false positives (годы вместо зарплаты)
  if (min !== null || max !== null) {
    const a = Number(min ?? max);
    const b = Number(max ?? min);
    const looksLikeYear = (val) => Number.isFinite(val) && val >= 1900 && val <= 2100;
    if (looksLikeYear(a) && looksLikeYear(b) && !hasAny(original, ['salary', 'compensation', 'pay', 'rate', '$', '€', '₽', 'usd', 'eur', 'rub'])) {
      issues.push({
        type: 'salary_false_positive_year',
        severity: 'high',
        detail: { min, max, currency, period },
      });
    }
  }

  // Проверяем, что валюта определена, если есть сумма
  if ((min !== null || max !== null) && (currency === 'UNKNOWN' || currency === null)) {
    const hasCurrency = hasAny(original, ['$', '€', '₽', 'usd', 'eur', 'rub', 'gbp', '£']);
    if (hasCurrency) {
      issues.push({
        type: 'salary_currency_unknown_but_mentioned',
        severity: 'medium',
        detail: { min, max, currency, period },
      });
    }
  }

  // 4. Location issues
  const location = parsed?.location?.value ?? null;
  if (location) {
    const city = location.city ?? '';
    const country = location.country ?? '';
    
    // Проверяем на Iceland как false positive (часто определяется по слову "is")
    if (country === 'Iceland') {
      const hasIcelandKeywords = hasAny(fullText, ['iceland', 'reykjavik', 'исландия', 'рейкьявик']);
      if (!hasIcelandKeywords) {
        issues.push({
          type: 'location_false_positive_iceland',
          severity: 'high',
          detail: {
            country,
            reason: 'Iceland detected but no Iceland keywords found in text',
            textPreview: clip(fullText, 300),
          },
        });
      }
    }
    
    // Проверяем на tech tokens в location
    const badLocTokens = ['django', 'fastapi', 'nestjs', 'node', 'react', 'angular', 'vue', 'kafka', 'docker', 'gitlab', 'github', 'python', 'java', 'javascript'];
    if (hasAny(city, badLocTokens) || hasAny(country, badLocTokens)) {
      issues.push({
        type: 'location_false_positive_tech_tokens',
        severity: 'high',
        detail: { city, country },
      });
    }

    // Проверяем на общие слова
    const badLocWords = ['years', 'year', 'working', 'hours', 'experience', 'benefits', 'requirements', 'responsibilities', 'salary', 'compensation'];
    if (badLocWords.includes(safeLower(city).trim()) || badLocWords.includes(safeLower(country).trim())) {
      issues.push({
        type: 'location_false_positive_common_words',
        severity: 'high',
        detail: { city, country },
      });
    }
  }

  // 5. Title issues
  const parsedTitle = parsed?.title?.value ?? null;
  const titleRaw = parsed?.title?.raw ?? null;
  
  // Проверяем на обрезанный заголовок (например, "reative" вместо "AI Creative Operator")
  if (parsedTitle && parsedTitle.length < 10 && titleRaw && titleRaw.length > parsedTitle.length + 10) {
    // Проверяем, не является ли обрезанный заголовок частью более длинного
    const titleLower = safeLower(parsedTitle);
    const originalLower = safeLower(fullText);
    if (originalLower.includes(titleLower) && originalLower.indexOf(titleLower) > 0) {
      // Находим контекст вокруг обрезанного заголовка
      const contextStart = Math.max(0, originalLower.indexOf(titleLower) - 30);
      const contextEnd = Math.min(originalLower.length, originalLower.indexOf(titleLower) + parsedTitle.length + 50);
      const context = fullText.slice(contextStart, contextEnd);
      
      issues.push({
        type: 'title_truncated',
        severity: 'high',
        detail: {
          detected: parsedTitle,
          rawTitle: titleRaw,
          originalTitle: title,
          context: clip(context, 200),
        },
      });
    }
  }
  
  if (!parsedTitle && titleRaw && titleRaw.length > 140) {
    issues.push({
      type: 'title_too_long_or_glued',
      severity: 'medium',
      detail: {
        rawLength: titleRaw.length,
        rawPreview: clip(titleRaw, 200),
      },
    });
  }
  
  // Проверяем на обрезание по "About the Role"
  if (parsedTitle && hasAny(original, ['about the role', 'о роли']) && parsedTitle.length < title.length) {
    const aboutIndex = safeLower(original).indexOf('about the role');
    if (aboutIndex > 0 && aboutIndex < 100) {
      issues.push({
        type: 'title_cut_by_about_the_role',
        severity: 'medium',
        detail: {
          detected: parsedTitle,
          originalTitle: title,
          aboutIndex,
        },
      });
    }
  }

  // 6. Contacts issues
  const contacts = parsed?.contacts ?? null;
  const emails = Array.isArray(contacts?.emails) ? contacts.emails : [];
  const telegram = Array.isArray(contacts?.telegram) ? contacts.telegram : [];
  const urls = Array.isArray(contacts?.urls) ? contacts.urls : [];

  // Проверяем, не пропущены ли контакты
  const originalHasEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(original);
  const originalHasAt = /(^|\s)@([a-zA-Z0-9_]{3,32})\b/.test(original);
  if ((emails.length === 0 && telegram.length === 0) && (originalHasEmail || originalHasAt)) {
    issues.push({
      type: 'contacts_missed',
      severity: 'medium',
      detail: {
        originalHasEmail,
        originalHasAt,
        detectedEmails: emails.length,
        detectedTelegram: telegram.length,
      },
    });
  }

  // Проверяем URLs с trailing punctuation
  const badUrls = urls.filter((u) => /[),.;:]$/.test((u ?? '').toString().trim()));
  if (badUrls.length > 0) {
    issues.push({
      type: 'contacts_urls_trailing_punct',
      severity: 'low',
      detail: { badUrls: badUrls.slice(0, 5) },
    });
  }

  // 7. Work format issues
  const workFormat = parsed?.workFormat?.value ?? null;
  if (workFormat === 'unknown') {
    const hasRemote = hasAny(fullText, ['remote', 'удален', 'удалён', 'work from home', 'wfh']);
    const hasOnsite = hasAny(fullText, ['onsite', 'on-site', 'in office', 'в офисе']);
    const hasHybrid = hasAny(fullText, ['hybrid', 'гибрид']);
    
    if (hasRemote || hasOnsite || hasHybrid) {
      issues.push({
        type: 'work_format_unknown_but_mentioned',
        severity: 'medium',
        detail: {
          hasRemote,
          hasOnsite,
          hasHybrid,
        },
      });
    }
  }

  // 8. Experience issues
  const experience = parsed?.experience ?? null;
  const expMin = experience?.minYears ?? null;
  const expMax = experience?.maxYears ?? null;
  
  if (expMin === null && expMax === null) {
    // Проверяем, есть ли упоминание опыта в тексте
    const hasExperienceKeywords = hasAny(fullText, ['years of experience', 'лет опыта', 'опыт работы', 'experience required']);
    if (hasExperienceKeywords) {
      issues.push({
        type: 'experience_missed',
        severity: 'medium',
        detail: {
          hasKeywords: hasExperienceKeywords,
        },
      });
    }
  }

  // 9. Tech stack issues
  const tech = parsed?.tech ?? null;
  const techAll = Array.isArray(tech?.all) ? tech.all : [];
  const techMust = Array.isArray(tech?.must) ? tech.must : [];
  
  // Проверяем, есть ли упоминание технологий, но они не распознаны
  const commonTech = ['react', 'angular', 'vue', 'node', 'python', 'java', 'typescript', 'javascript', 'docker', 'kubernetes', 'aws', 'figma', 'sketch'];
  const mentionedTech = commonTech.filter((t) => hasAny(fullText, [t]));
  if (mentionedTech.length > 0 && techAll.length === 0) {
    issues.push({
      type: 'tech_stack_missed',
      severity: 'low',
      detail: {
        mentionedTech: mentionedTech.slice(0, 5),
        detectedTech: techAll.length,
      },
    });
  }

  // 10. Meta warnings
  const warnings = Array.isArray(parsed?.meta?.warnings) ? parsed.meta.warnings : [];
  if (warnings.length > 0) {
    issues.push({
      type: 'parser_warnings',
      severity: 'info',
      detail: {
        warnings,
      },
    });
  }

  // 11. Confidence issues
  const confidence = parsed?.confidence ?? null;
  if (confidence) {
    const lowConfidenceFields = Object.entries(confidence)
      .filter(([key, value]) => key !== 'total' && typeof value === 'number' && value < 0.5)
      .map(([key]) => key);
    
    if (lowConfidenceFields.length > 0) {
      issues.push({
        type: 'low_confidence_fields',
        severity: 'info',
        detail: {
          fields: lowConfidenceFields,
          confidence,
        },
      });
    }
  }

  return issues;
}

async function main() {
  const args = parseArgs(process.argv);

  console.log('Fetching RSS sources...');
  const rssSources = await prisma.source.findMany({
    where: { sourceType: 'rss' },
    select: { id: true, name: true, url: true },
  });

  console.log(`Found ${rssSources.length} RSS sources`);

  // Получаем все вакансии с источниками
  console.log('Fetching all job postings with sources...');
  const allJobs = await prisma.jobPosting.findMany({
    include: {
      source: {
        select: {
          id: true,
          sourceType: true,
          name: true,
          url: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  console.log(`Total jobs in DB: ${allJobs.length}`);

  // Фильтруем RSS вакансии
  const rssJobs = allJobs.filter((job) => {
    const sourceType = job.source?.sourceType;
    return sourceType === 'rss';
  });
  
  console.log(`RSS jobs after filtering: ${rssJobs.length}`);
  
  if (args.limit) {
    rssJobs.splice(args.limit);
  }

  console.log(`Found ${rssJobs.length} RSS job postings`);

  console.log(`Found ${rssJobs.length} RSS job postings`);

  const allIssues = [];
  let processed = 0;

  for (const job of rssJobs) {
    processed += 1;
    if (processed % 10 === 0) {
      console.log(`Processing ${processed}/${rssJobs.length}...`);
    }

    const resolvedContent = await resolveJobContent(job);
    const fullText = `${job.title}\n${resolvedContent || ''}`;
    if (!fullText.trim()) {
      continue;
    }

    let parsed;
    try {
      parsed = parseVacancy(fullText, {
        pageTitle: job.title,
        sourceUrl: job.link || undefined,
        strict: false,
        debug: false,
      });
    } catch (error) {
      allIssues.push({
        jobId: job.id,
        jobTitle: job.title,
        jobLink: job.link,
        sourceName: job.source?.name || 'unknown',
        error: String(error?.message || error),
        issues: [{
          type: 'parse_error',
          severity: 'high',
          detail: { error: String(error?.message || error) },
        }],
      });
      continue;
    }

    const issues = analyzeJob(job, parsed);
    if (issues.length > 0) {
      allIssues.push({
        jobId: job.id,
        jobTitle: job.title,
        jobLink: job.link,
        sourceName: job.source?.name || 'unknown',
        originalText: clip(fullText, 500),
        parsed: {
          title: parsed.title,
          company: parsed.company,
          salary: parsed.salary,
          location: parsed.location,
          employment: parsed.employment,
          workFormat: parsed.workFormat,
          experience: parsed.experience,
          tech: parsed.tech,
          contacts: parsed.contacts,
          confidence: parsed.confidence,
          warnings: parsed.meta?.warnings || [],
        },
        issues,
      });
    }
  }

  console.log(`Found ${allIssues.length} jobs with issues out of ${rssJobs.length} total`);

  // Группируем по типам проблем
  const issuesByType = {};
  const severityCounts = { high: 0, medium: 0, low: 0, info: 0 };

  for (const jobIssue of allIssues) {
    for (const issue of jobIssue.issues) {
      if (!issuesByType[issue.type]) {
        issuesByType[issue.type] = [];
      }
      issuesByType[issue.type].push({
        jobId: jobIssue.jobId,
        jobTitle: jobIssue.jobTitle,
        jobLink: jobIssue.jobLink,
        sourceName: jobIssue.sourceName,
        severity: issue.severity,
        detail: issue.detail,
        originalPreview: jobIssue.originalText,
      });
      severityCounts[issue.severity] = (severityCounts[issue.severity] || 0) + 1;
    }
  }

  // Формируем markdown отчет
  const lines = [];
  lines.push('# Анализ проблем парсинга RSS вакансий\n');
  lines.push(`**Дата анализа:** ${new Date().toISOString()}\n`);
  lines.push(`**Всего вакансий:** ${rssJobs.length}`);
  lines.push(`**Вакансий с проблемами:** ${allIssues.length}`);
  lines.push(`**Всего проблем:** ${Object.values(issuesByType).reduce((sum, arr) => sum + arr.length, 0)}\n`);

  lines.push('## Статистика по серьезности\n');
  lines.push(`- **Высокая:** ${severityCounts.high}`);
  lines.push(`- **Средняя:** ${severityCounts.medium}`);
  lines.push(`- **Низкая:** ${severityCounts.low}`);
  lines.push(`- **Информация:** ${severityCounts.info}\n`);

  lines.push('## Типы проблем (отсортировано по количеству)\n');
  const sortedTypes = Object.entries(issuesByType)
    .sort((a, b) => b[1].length - a[1].length);

  for (const [type, examples] of sortedTypes) {
    const severity = examples[0]?.severity || 'unknown';
    lines.push(`### ${type} (${examples.length}) [${severity}]\n`);
    lines.push(`**Количество:** ${examples.length}\n`);
    
    // Показываем первые 5 примеров
    for (let i = 0; i < Math.min(5, examples.length); i++) {
      const ex = examples[i];
      lines.push(`#### Пример ${i + 1}\n`);
      lines.push(`- **ID вакансии:** ${ex.jobId}`);
      lines.push(`- **Название:** ${ex.jobTitle || '—'}`);
      lines.push(`- **Источник:** ${ex.sourceName}`);
      lines.push(`- **Ссылка:** ${ex.jobLink || '—'}`);
      lines.push(`- **Серьезность:** ${ex.severity}`);
      lines.push(`- **Детали:** \`${JSON.stringify(ex.detail)}\``);
      lines.push(`- **Превью текста:** ${ex.originalPreview}\n`);
    }
    
    if (examples.length > 5) {
      lines.push(`*... и еще ${examples.length - 5} примеров*\n`);
    }
    lines.push('---\n');
  }

  // Детальные примеры для каждой вакансии с проблемами
  lines.push('\n## Детальные примеры вакансий с проблемами\n');
  for (let i = 0; i < Math.min(20, allIssues.length); i++) {
    const jobIssue = allIssues[i];
    lines.push(`### Вакансия ${i + 1}: ${jobIssue.jobTitle || 'Без названия'}\n`);
    lines.push(`- **ID:** ${jobIssue.jobId}`);
    lines.push(`- **Источник:** ${jobIssue.sourceName}`);
    lines.push(`- **Ссылка:** ${jobIssue.jobLink || '—'}\n`);
    lines.push('**Исходный текст:**\n');
    lines.push('```');
    lines.push(jobIssue.originalText);
    lines.push('```\n');
    lines.push('**Результат парсинга:**\n');
    lines.push('```json');
    lines.push(JSON.stringify(jobIssue.parsed, null, 2));
    lines.push('```\n');
    lines.push('**Найденные проблемы:**\n');
    for (const issue of jobIssue.issues) {
      lines.push(`- **[${issue.severity}]** ${issue.type}: ${JSON.stringify(issue.detail)}`);
    }
    lines.push('\n---\n');
  }

  if (allIssues.length > 20) {
    lines.push(`\n*... и еще ${allIssues.length - 20} вакансий с проблемами*\n`);
  }

  // Сохраняем отчет
  const outPath = path.isAbsolute(args.outFile) ? args.outFile : path.join(process.cwd(), args.outFile);
  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`\nReport written to: ${outPath}`);
  console.log(`Total issues found: ${Object.values(issuesByType).reduce((sum, arr) => sum + arr.length, 0)}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('[analyze-rss-parsing-issues] FAILED', e);
  process.exitCode = 1;
  process.exit(1);
});

