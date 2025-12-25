import { defaultParseResult } from './model/defaults';
import type { ParseOptions, ParseResult } from './model/types';
import { buildContext } from './core/build-context';
import { sanitizeInputText } from './core/sanitize-input';
import { postprocessArrays } from './core/postprocess';
import { applyGuards } from './core/guards';
import { extractContacts } from './extractors/contacts';
import { extractSalary } from './extractors/salary';
import { extractEmployment } from './extractors/employment';
import { extractWorkFormat } from './extractors/work-format';
import { extractSchedule } from './extractors/schedule';
import { extractLocation } from './extractors/location';
import { extractTitle } from './extractors/title';
import { extractExperience } from './extractors/experience';
import { extractTech } from './extractors/tech';
import { extractLanguages } from './extractors/languages';
import { extractBenefits } from './extractors/benefits';
import { extractInterview } from './extractors/interview';
import { extractCompany } from './extractors/company';

export function parseVacancy(text: string, opts: ParseOptions = {}): ParseResult {
  const start = Date.now();
  try {
    const sanitized = sanitizeInputText(text ?? '');
    const ctx = buildContext(sanitized.text, opts);
    const result: ParseResult = defaultParseResult();
    result.meta.sourceUrl = opts.sourceUrl ?? null;
    result.meta.lang = ctx.lang;
    if (sanitized.warnings.length > 0) {
      result.meta.warnings.push(...sanitized.warnings);
    }
    if (ctx.lang === 'unknown') {
      result.meta.warnings.push('lang_unknown');
    }

    if (!sanitized.text?.trim()) {
      result.meta.warnings.push('empty_text');
      result.meta.timingMs = Date.now() - start;
      return result;
    }

    // Extractors (strict order)
    try {
      const contactsRes = extractContacts(ctx, Boolean(opts.debug));
      result.contacts = contactsRes.contacts;
      result.confidence.contacts = contactsRes.confidence;
      result.meta.warnings.push(...contactsRes.warnings);
      ctx.traces.push(...contactsRes.traces);
    } catch (_e) {
      result.meta.warnings.push('contacts_failed');
      result.confidence.contacts = 0;
    }

    try {
      const salaryRes = extractSalary(ctx, { strict: Boolean(opts.strict), enableTraces: Boolean(opts.debug) });
      result.salary = salaryRes.salary;
      result.confidence.salary = salaryRes.confidence;
      result.meta.warnings.push(...salaryRes.warnings);
      ctx.traces.push(...salaryRes.traces);
    } catch (_e) {
      result.meta.warnings.push('salary_failed');
      result.confidence.salary = 0;
    }

    try {
      const employmentRes = extractEmployment(ctx, { enableTraces: Boolean(opts.debug) });
      result.employment = employmentRes.employment;
      result.confidence.employment = employmentRes.confidence;
      result.meta.warnings.push(...employmentRes.warnings);
      ctx.traces.push(...employmentRes.traces);
    } catch (_e) {
      result.meta.warnings.push('employment_failed');
      result.confidence.employment = 0;
    }

    try {
      const workFormatRes = extractWorkFormat(ctx, { enableTraces: Boolean(opts.debug) });
      result.workFormat = workFormatRes.workFormat;
      result.confidence.workFormat = workFormatRes.confidence;
      result.meta.warnings.push(...workFormatRes.warnings);
      ctx.traces.push(...workFormatRes.traces);
    } catch (_e) {
      result.meta.warnings.push('work_format_failed');
      result.confidence.workFormat = 0;
    }

    try {
      const scheduleRes = extractSchedule(ctx, { enableTraces: Boolean(opts.debug) });
      result.schedule = scheduleRes.schedule;
      result.confidence.schedule = scheduleRes.confidence;
      result.meta.warnings.push(...scheduleRes.warnings);
      ctx.traces.push(...scheduleRes.traces);
    } catch (_e) {
      result.meta.warnings.push('schedule_failed');
      result.confidence.schedule = 0;
    }

    try {
      const locationRes = extractLocation(ctx, { enableTraces: Boolean(opts.debug) });
      result.location = locationRes.location;
      result.confidence.location = locationRes.confidence;
      result.meta.warnings.push(...locationRes.warnings);
      ctx.traces.push(...locationRes.traces);
    } catch (_e) {
      result.meta.warnings.push('location_failed');
      result.confidence.location = 0;
    }

    try {
      const titleRes = extractTitle(ctx, { strict: Boolean(opts.strict), enableTraces: Boolean(opts.debug) });
      result.title = titleRes.title;
      result.confidence.title = titleRes.confidence;
      result.meta.warnings.push(...titleRes.warnings);
      ctx.traces.push(...titleRes.traces);
    } catch (_e) {
      result.meta.warnings.push('title_failed');
      result.confidence.title = 0;
    }

    try {
      const expRes = extractExperience(ctx, { enableTraces: Boolean(opts.debug) });
      result.experience = expRes.experience;
      result.confidence.experience = expRes.confidence;
      result.meta.warnings.push(...expRes.warnings);
      ctx.traces.push(...expRes.traces);
    } catch (_e) {
      result.meta.warnings.push('experience_failed');
      result.confidence.experience = 0;
    }

    try {
      const techRes = extractTech(ctx, { enableTraces: Boolean(opts.debug) });
      result.tech = techRes.tech;
      result.confidence.tech = techRes.confidence;
      result.meta.warnings.push(...techRes.warnings);
      ctx.traces.push(...techRes.traces);
    } catch (_e) {
      result.meta.warnings.push('tech_failed');
      result.confidence.tech = 0;
    }

    try {
      const langRes = extractLanguages(ctx, { enableTraces: Boolean(opts.debug) });
      result.languages = langRes.languages;
      result.confidence.languages = langRes.confidence;
      result.meta.warnings.push(...langRes.warnings);
      ctx.traces.push(...langRes.traces);
    } catch (_e) {
      result.meta.warnings.push('languages_failed');
      result.confidence.languages = 0;
    }

    try {
      const benefitsRes = extractBenefits(ctx, { enableTraces: Boolean(opts.debug) });
      result.benefits = benefitsRes.benefits;
      result.confidence.benefits = benefitsRes.confidence;
      result.meta.warnings.push(...benefitsRes.warnings);
      ctx.traces.push(...benefitsRes.traces);
    } catch (_e) {
      result.meta.warnings.push('benefits_failed');
      result.confidence.benefits = 0;
    }

    try {
      const interviewRes = extractInterview(ctx, { enableTraces: Boolean(opts.debug) });
      result.interview = interviewRes.interview;
      result.confidence.interview = interviewRes.confidence;
      result.meta.warnings.push(...interviewRes.warnings);
      ctx.traces.push(...interviewRes.traces);
    } catch (_e) {
      result.meta.warnings.push('interview_failed');
      result.confidence.interview = 0;
    }

    try {
      const companyRes = extractCompany(ctx, { enableTraces: Boolean(opts.debug) });
      result.company = companyRes.company;
      result.confidence.company = companyRes.confidence;
      result.meta.warnings.push(...companyRes.warnings);
      ctx.traces.push(...companyRes.traces);
    } catch (_e) {
      result.meta.warnings.push('company_failed');
      result.confidence.company = 0;
    }

    if (opts.debug) {
      result.meta.traces = ctx.traces;
    }

    postprocessArrays(result);
    applyGuards(result);
    result.confidence.total = Math.max(
      result.confidence.contacts,
      result.confidence.salary,
      result.confidence.employment,
      result.confidence.workFormat,
      result.confidence.schedule,
      result.confidence.location,
      result.confidence.title,
      result.confidence.experience,
      result.confidence.tech,
      result.confidence.languages,
      result.confidence.benefits,
      result.confidence.interview,
      result.confidence.company,
    );
    result.meta.timingMs = Date.now() - start;
    return result;
  } catch (_err) {
    const res = defaultParseResult();
    res.meta.warnings.push('parser_failed');
    res.meta.sourceUrl = opts.sourceUrl ?? null;
    res.meta.timingMs = Date.now() - start;
    return res;
  }
}
