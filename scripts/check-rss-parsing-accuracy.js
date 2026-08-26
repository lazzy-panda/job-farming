/*
  Проверяет соответствие исходного текста RSS вакансий и полученного парсингом JSON.
  Сравнивает каждое поле и выявляет ошибки и неточности.

  Usage:
    DATABASE_URL=file:./dev.db node scripts/check-rss-parsing-accuracy.js
    DATABASE_URL=file:./dev.db node scripts/check-rss-parsing-accuracy.js --out=storage/rss-parsing-accuracy.md --limit=100
*/

const { PrismaClient } = require('@prisma/client');
const fs = require('node:fs');
const path = require('node:path');

// Импортируем парсер
const { parseVacancy } = require('../dist/libs/vacancy-parser/src/index.js');

const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
let prisma;
try {
  const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
  const adapter = new PrismaBetterSqlite3({ url: dbUrl });
  prisma = new PrismaClient({ adapter });
} catch (err) {
  console.warn(
    '[check-rss-parsing-accuracy] предупреждение: better-sqlite3 недоступен, используем стандартный драйвер Prisma.',
    err?.message || err,
  );
  prisma = new PrismaClient();
}

function parseArgs(argv) {
  const out = {
    outFile: 'storage/rss-parsing-accuracy.md',
    limit: null,
    minSeverity: 'low', // low, medium, high
  };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--out=')) {
      out.outFile = arg.slice('--out='.length);
    } else if (arg.startsWith('--limit=')) {
      const n = Number(arg.slice('--limit='.length));
      out.limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    } else if (arg.startsWith('--min-severity=')) {
      out.minSeverity = arg.slice('--min-severity='.length);
    }
  }
  return out;
}

function clip(text, maxLen) {
  const s = (text ?? '').toString();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '...';
}

function safeLower(s) {
  return (s ?? '').toString().toLowerCase().trim();
}

function hasAny(text, needles) {
  const v = safeLower(text);
  return needles.some((n) => v.includes(safeLower(n)));
}

function extractTextFromOriginal(originalText, field) {
  // Извлекаем текст, который должен был быть распознан для поля
  const text = safeLower(originalText);
  
  switch (field) {
    case 'company':
      // Ищем паттерны типа "Company: Name" или "at Company" или "Headquarters: Name"
      // Важно: "Headquarters: San Francisco\n    \nURL:" - нужно остановиться до URL
      const companyPatterns = [
        /headquarters\s*:\s*([A-ZА-Я][A-Za-zА-Яа-я0-9\s&'.-]{2,60}?)(?:\s*\n|\s*URL|\s*$)/i,
        /(?:company|компания|организация)[\s:]+([A-ZА-Я][A-Za-zА-Яа-я0-9\s&'.-]{2,60}?)(?:\s*\n|\s*URL|\s*$)/i,
        /(?:at|в|от)\s+([A-ZА-Я][A-Za-zА-Яа-я0-9\s&'.-]{2,60}?)(?:\s*\n|\s*URL|\s*$)/i,
        /^([A-ZА-Я][A-Za-zА-Яа-я0-9\s&'.-]{2,60}?)\s*[:\-–—]/,
      ];
      for (const pattern of companyPatterns) {
        const match = originalText.match(pattern);
        if (match && match[1]) {
          let companyName = match[1].trim();
          // Убираем лишние пробелы и переносы строк
          companyName = companyName.replace(/\s+/g, ' ').trim();
          // Исключаем общие слова и слишком короткие
          const badNames = ['headquarters', 'headquarter', 'hq', 'remote', 'location', 'url'];
          const nameLower = safeLower(companyName);
          if (companyName.length >= 2 && !badNames.includes(nameLower) && !nameLower.startsWith('url')) {
            return companyName;
          }
        }
      }
      break;
      
    case 'salary':
      // Ищем упоминания зарплаты
      const salaryPatterns = [
        /(?:salary|зарплата|compensation|оплата)[\s:]+([0-9,\s]+[$\u20AC\u20BD€£]?)/i,
        /([0-9,\s]+)\s*(?:USD|EUR|RUB|₽|\$|€|£)\s*(?:per|в|за)\s*(?:month|year|месяц|год)/i,
      ];
      for (const pattern of salaryPatterns) {
        const match = originalText.match(pattern);
        if (match && match[1]) {
          return match[1].trim();
        }
      }
      break;
      
    case 'location':
      // Ищем локацию
      const locationPatterns = [
        /(?:location|локация|место)[\s:]+([A-ZА-Я][A-Za-zА-Яа-я\s,.-]{2,60})/i,
        /(?:remote|удален|удалён|onsite|в офисе|hybrid|гибрид)/i,
      ];
      for (const pattern of locationPatterns) {
        const match = originalText.match(pattern);
        if (match && match[1]) {
          return match[1].trim();
        }
      }
      break;
  }
  
  return null;
}

function compareField(originalText, parsedValue, fieldName, fieldConfig) {
  const issues = [];
  const extracted = extractTextFromOriginal(originalText, fieldName);
  
  // Проверка на наличие в исходном тексте, но отсутствие в парсинге
  if (extracted && !parsedValue) {
    issues.push({
      type: `${fieldName}_missed`,
      severity: fieldConfig.severity || 'medium',
      detail: {
        expected: extracted,
        found: null,
        originalContext: clip(originalText, 300),
      },
    });
  }
  
  // Проверка на false positive (определено, но не должно было)
  if (parsedValue && !extracted && fieldConfig.checkFalsePositive) {
    // Для объектов извлекаем основные значения
    let valueStr = '';
    if (typeof parsedValue === 'object' && parsedValue !== null) {
      if (fieldName === 'company' && parsedValue.name) {
        valueStr = String(parsedValue.name);
      } else if (fieldName === 'location' && parsedValue.value) {
        const loc = parsedValue.value;
        valueStr = [loc.city, loc.country].filter(Boolean).join(' ');
      } else if (fieldName === 'salary') {
        const parts = [];
        if (parsedValue.min) parts.push(String(parsedValue.min));
        if (parsedValue.max) parts.push(String(parsedValue.max));
        if (parsedValue.currency) parts.push(String(parsedValue.currency));
        valueStr = parts.join(' ');
      } else {
        valueStr = JSON.stringify(parsedValue);
      }
    } else {
      valueStr = String(parsedValue);
    }
    
    // Проверяем, есть ли в тексте что-то похожее
    if (valueStr && !hasAny(originalText, [valueStr])) {
      // Для некоторых полей делаем более мягкую проверку
      if (fieldName === 'company' && typeof parsedValue === 'object' && parsedValue.name) {
        const companyName = safeLower(parsedValue.name);
        const textLower = safeLower(originalText);
        // Проверяем части названия компании
        const nameParts = companyName.split(/\s+/).filter(p => p.length > 2);
        const hasAnyPart = nameParts.some(part => textLower.includes(part));
        if (!hasAnyPart) {
          issues.push({
            type: `${fieldName}_false_positive`,
            severity: fieldConfig.severity || 'high',
            detail: {
              detected: parsedValue,
              notFoundInText: true,
              originalContext: clip(originalText, 300),
            },
          });
        }
      } else {
        issues.push({
          type: `${fieldName}_false_positive`,
          severity: fieldConfig.severity || 'high',
          detail: {
            detected: parsedValue,
            notFoundInText: true,
            originalContext: clip(originalText, 300),
          },
        });
      }
    }
  }
  
  // Проверка на несоответствие значений
  if (extracted && parsedValue) {
    const extractedLower = safeLower(extracted);
    const parsedStr = typeof parsedValue === 'object'
      ? JSON.stringify(parsedValue)
      : String(parsedValue);
    const parsedLower = safeLower(parsedStr);
    
    if (!parsedLower.includes(extractedLower) && !extractedLower.includes(parsedLower)) {
      issues.push({
        type: `${fieldName}_mismatch`,
        severity: 'medium',
        detail: {
          expected: extracted,
          found: parsedValue,
          originalContext: clip(originalText, 300),
        },
      });
    }
  }
  
  return issues;
}

function analyzeParsingAccuracy(job, parsed) {
  const issues = [];
  const fullText = `${job.title}\n${job.description || ''}`;
  
  // Специальные проверки для title (не используем общую функцию, т.к. title берется из pageTitle)
  const parsedTitle = parsed?.title?.value || parsed?.title;
  const parsedTitleRaw = parsed?.title?.raw;
  
  if (parsedTitle && job.title) {
    const titleLower = safeLower(job.title);
    const parsedTitleLower = safeLower(parsedTitle);
    
    // Проверка на обрезанный заголовок (когда парсер взял только часть)
    if (parsedTitleLower.length < titleLower.length - 5) {
      // Проверяем, является ли parsed title частью оригинального
      if (titleLower.includes(parsedTitleLower) && parsedTitleLower.length < 15) {
        issues.push({
          type: 'title_truncated',
          severity: 'high',
          detail: {
            original: job.title,
            parsed: parsedTitle,
            raw: parsedTitleRaw,
            reason: 'Parsed title is truncated (too short and part of original)',
          },
        });
      }
    }
    
    // Проверка на несоответствие (когда title вообще другой)
    if (!titleLower.includes(parsedTitleLower) && !parsedTitleLower.includes(titleLower)) {
      // Проверяем, может быть парсер взял title из description
      const descLower = safeLower(job.description || '');
      if (descLower.includes(parsedTitleLower)) {
        issues.push({
          type: 'title_from_description',
          severity: 'medium',
          detail: {
            original: job.title,
            parsed: parsedTitle,
            reason: 'Title extracted from description instead of pageTitle',
          },
        });
      } else {
        issues.push({
          type: 'title_mismatch',
          severity: 'high',
          detail: {
            original: job.title,
            parsed: parsedTitle,
            reason: 'Title does not match original',
          },
        });
      }
    }
  } else if (!parsedTitle && job.title && job.title.length > 5) {
    // Title не распознан, хотя есть в исходных данных
    issues.push({
      type: 'title_missed',
      severity: 'high',
      detail: {
        original: job.title,
        parsed: null,
        reason: 'Title not extracted from pageTitle',
      },
    });
  }
  
  // Конфигурация полей для проверки (без title)
  const fieldsToCheck = {
    company: {
      severity: 'high',
      checkFalsePositive: true,
    },
    salary: {
      severity: 'high',
      checkFalsePositive: false, // Проверяем отдельно в специальной функции
    },
    location: {
      severity: 'medium',
      checkFalsePositive: true,
    },
    employment: {
      severity: 'medium',
      checkFalsePositive: true,
    },
    workFormat: {
      severity: 'medium',
      checkFalsePositive: true,
    },
    experience: {
      severity: 'low',
      checkFalsePositive: false,
    },
    tech: {
      severity: 'low',
      checkFalsePositive: false,
    },
    contacts: {
      severity: 'high',
      checkFalsePositive: false,
    },
  };
  
  // Проверяем каждое поле
  for (const [fieldName, config] of Object.entries(fieldsToCheck)) {
    const parsedValue = parsed[fieldName];
    const fieldIssues = compareField(fullText, parsedValue, fieldName, config);
    issues.push(...fieldIssues);
  }
  
  // 2. Проверка компании
  const companyName = parsed?.company?.name;
  
  // Ищем "Headquarters: Name" в тексте (останавливаемся до URL или переноса строки)
  const headquartersMatch = fullText.match(/headquarters\s*:\s*([A-ZА-Я][A-Za-zА-Яа-я0-9\s&'.-]{2,60}?)(?:\s*\n|\s*URL|\s*$)/i);
  let expectedCompany = null;
  if (headquartersMatch && headquartersMatch[1]) {
    expectedCompany = headquartersMatch[1].trim().replace(/\s+/g, ' ');
    // Исключаем общие слова
    const badNames = ['headquarters', 'headquarter', 'hq', 'remote', 'location', 'url'];
    if (badNames.includes(safeLower(expectedCompany)) || expectedCompany.length < 2) {
      expectedCompany = null;
    }
  }
  
  if (companyName) {
    // Проверяем, что название компании не является общим словом
    const badCompanyNames = ['headquarters', 'headquarter', 'hq', 'company', 'компания', 'remote'];
    if (badCompanyNames.includes(safeLower(companyName))) {
      issues.push({
        type: 'company_generic_name',
        severity: 'high',
        detail: {
          detected: companyName,
          expected: expectedCompany,
          reason: 'Generic company name detected',
        },
      });
    } else if (expectedCompany && safeLower(companyName) !== safeLower(expectedCompany)) {
      // Проверяем, соответствует ли распознанное название компании тому, что указано в "Headquarters"
      const companyLower = safeLower(companyName);
      const expectedLower = safeLower(expectedCompany);
      if (!companyLower.includes(expectedLower) && !expectedLower.includes(companyLower)) {
        issues.push({
          type: 'company_mismatch_with_headquarters',
          severity: 'high',
          detail: {
            detected: companyName,
            expected: expectedCompany,
            reason: 'Company name does not match Headquarters field',
          },
        });
      }
    }
  } else if (expectedCompany) {
    // Компания не распознана, но есть в "Headquarters"
    issues.push({
      type: 'company_missed_from_headquarters',
      severity: 'high',
      detail: {
        expected: expectedCompany,
        reason: 'Company name in Headquarters field not extracted',
      },
    });
  }
  
  // 3. Проверка зарплаты
  const salary = parsed?.salary;
  if (salary) {
    const min = salary.min !== null && salary.min !== undefined ? Number(salary.min) : null;
    const max = salary.max !== null && salary.max !== undefined ? Number(salary.max) : null;
    const currency = salary.currency;
    
    // Если есть конкретные суммы (min или max), проверяем их наличие в тексте
    if (min !== null || max !== null) {
      // Проверка на годы вместо зарплаты
      if (min !== null && max !== null && min >= 1900 && min <= 2100 && max >= 1900 && max <= 2100) {
        if (!hasAny(fullText, ['salary', 'compensation', 'pay', 'rate', '$', '€', '₽', 'usd', 'eur', 'rub'])) {
          issues.push({
            type: 'salary_year_false_positive',
            severity: 'high',
            detail: {
              detected: { min, max, currency },
              reason: 'Looks like years, not salary',
            },
          });
        }
      }
      
      // Проверяем, есть ли сумма в тексте
      const hasSalaryInText = hasAny(fullText, [
        String(min || max),
        String(max || min),
        'salary', 'compensation', 'pay', 'rate', 'зарплат', 'оплат'
      ]);
      
      if (!hasSalaryInText && (min !== null || max !== null)) {
        issues.push({
          type: 'salary_amount_not_found',
          severity: 'medium',
          detail: {
            detected: { min, max, currency },
            reason: 'Salary amount detected but not found in text',
          },
        });
      }
    } else if (currency && currency !== 'UNKNOWN' && currency !== null) {
      // Только валюта без суммы - это не false positive, а просто неполные данные
      // Не добавляем проблему, так как валюта могла быть определена из контекста
    }
  }
  
  // 4. Проверка локации
  const location = parsed?.location?.value;
  if (location) {
    const city = location.city || '';
    const country = location.country || '';
    
    // Проверка на tech tokens в локации
    const techTokens = ['django', 'fastapi', 'nestjs', 'node', 'react', 'angular', 'vue', 'python', 'java'];
    if (hasAny(city, techTokens) || hasAny(country, techTokens)) {
      issues.push({
        type: 'location_tech_token_false_positive',
        severity: 'high',
        detail: {
          city,
          country,
          reason: 'Tech token detected in location',
        },
      });
    }
  }
  
  // 5. Проверка контактов
  const contacts = parsed?.contacts;
  const emails = Array.isArray(contacts?.emails) ? contacts.emails : [];
  const telegram = Array.isArray(contacts?.telegram) ? contacts.telegram : [];
  
  // Проверяем, не пропущены ли контакты в тексте
  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const telegramRegex = /(^|\s)@([a-zA-Z0-9_]{3,32})\b/;
  
  const hasEmailInText = emailRegex.test(fullText);
  const hasTelegramInText = telegramRegex.test(fullText);
  
  if (hasEmailInText && emails.length === 0) {
    issues.push({
      type: 'contacts_email_missed',
      severity: 'high',
      detail: {
        foundInText: true,
        detected: 0,
      },
    });
  }
  
  if (hasTelegramInText && telegram.length === 0) {
    issues.push({
      type: 'contacts_telegram_missed',
      severity: 'medium',
      detail: {
        foundInText: true,
        detected: 0,
      },
    });
  }
  
  // 6. Проверка confidence
  const confidence = parsed?.confidence;
  if (confidence) {
    const lowConfidenceFields = Object.entries(confidence)
      .filter(([key, value]) => key !== 'total' && typeof value === 'number' && value < 0.3)
      .map(([key]) => key);
    
    if (lowConfidenceFields.length > 0) {
      issues.push({
        type: 'low_confidence',
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
  
  const severityOrder = { high: 3, medium: 2, low: 1, info: 0 };
  const minSeverityLevel = severityOrder[args.minSeverity] || 0;
  
  console.log('Получаем RSS источники...');
  const rssSources = await prisma.source.findMany({
    where: { sourceType: 'rss' },
    select: { id: true, name: true, url: true },
  });
  
  console.log(`Найдено ${rssSources.length} RSS источников`);
  
  console.log('Получаем все вакансии...');
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
  
  console.log(`Всего вакансий в БД: ${allJobs.length}`);
  
  // Фильтруем RSS вакансии
  const rssJobs = allJobs.filter((job) => {
    return job.source?.sourceType === 'rss';
  });
  
  console.log(`RSS вакансий после фильтрации: ${rssJobs.length}`);
  
  if (args.limit) {
    rssJobs.splice(args.limit);
    console.log(`Ограничено до ${args.limit} вакансий`);
  }
  
  const allIssues = [];
  let processed = 0;
  let parseErrors = 0;
  
  console.log('\nАнализируем вакансии...');
  
  for (const job of rssJobs) {
    processed += 1;
    if (processed % 50 === 0) {
      console.log(`Обработано ${processed}/${rssJobs.length}...`);
    }
    
    const fullText = `${job.title}\n${job.description || ''}`;
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
      parseErrors += 1;
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
        originalText: clip(fullText, 500),
        parsed: null,
      });
      continue;
    }
    
    const issues = analyzeParsingAccuracy(job, parsed);
    
    // Фильтруем по минимальной серьезности
    const filteredIssues = issues.filter(issue => 
      (severityOrder[issue.severity] || 0) >= minSeverityLevel
    );
    
    if (filteredIssues.length > 0) {
      allIssues.push({
        jobId: job.id,
        jobTitle: job.title,
        jobLink: job.link,
        sourceName: job.source?.name || 'unknown',
        originalText: clip(fullText, 1000),
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
        issues: filteredIssues,
      });
    }
  }
  
  console.log(`\nОбработано: ${processed} вакансий`);
  console.log(`Ошибок парсинга: ${parseErrors}`);
  console.log(`Вакансий с проблемами: ${allIssues.length}`);
  
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
      });
      severityCounts[issue.severity] = (severityCounts[issue.severity] || 0) + 1;
    }
  }
  
  // Формируем отчет
  const lines = [];
  lines.push('# Проверка точности парсинга RSS вакансий\n');
  lines.push(`**Дата анализа:** ${new Date().toISOString()}\n`);
  lines.push(`**Всего RSS вакансий:** ${rssJobs.length}`);
  lines.push(`**Обработано:** ${processed}`);
  lines.push(`**Ошибок парсинга:** ${parseErrors}`);
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
    
    // Показываем первые 10 примеров
    for (let i = 0; i < Math.min(10, examples.length); i++) {
      const ex = examples[i];
      lines.push(`#### Пример ${i + 1}\n`);
      lines.push(`- **ID:** ${ex.jobId}`);
      lines.push(`- **Название:** ${ex.jobTitle || '—'}`);
      lines.push(`- **Источник:** ${ex.sourceName}`);
      lines.push(`- **Ссылка:** ${ex.jobLink || '—'}`);
      lines.push(`- **Детали:** \`${JSON.stringify(ex.detail, null, 2)}\`\n`);
    }
    
    if (examples.length > 10) {
      lines.push(`*... и еще ${examples.length - 10} примеров*\n`);
    }
    lines.push('---\n');
  }
  
  // Детальные примеры
  lines.push('\n## Детальные примеры (первые 20)\n');
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
    if (jobIssue.parsed) {
      lines.push('**Результат парсинга:**\n');
      lines.push('```json');
      lines.push(JSON.stringify(jobIssue.parsed, null, 2));
      lines.push('```\n');
    }
    lines.push('**Найденные проблемы:**\n');
    for (const issue of jobIssue.issues) {
      lines.push(`- **[${issue.severity}]** ${issue.type}: ${JSON.stringify(issue.detail, null, 2)}`);
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
  console.log(`\nОтчет сохранен: ${outPath}`);
  console.log(`Всего проблем: ${Object.values(issuesByType).reduce((sum, arr) => sum + arr.length, 0)}`);
  
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('[check-rss-parsing-accuracy] ОШИБКА', e);
  process.exitCode = 1;
  process.exit(1);
});
