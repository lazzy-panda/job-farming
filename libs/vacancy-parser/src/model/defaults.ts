import type { ParseResult } from './types';

export function defaultParseResult(): ParseResult {
  return {
    title: {
      value: null,
      role: 'unknown',
      level: 'unknown',
      specialization: [],
      raw: null,
    },
    salary: {
      min: null,
      max: null,
      currency: 'UNKNOWN',
      period: 'unknown',
      salaryType: 'unknown',
      raw: null,
    },
    contacts: {
      emails: [],
      phones: [],
      telegram: [],
      urls: [],
    },
    employment: {
      types: [],
    },
    workFormat: {
      value: 'unknown',
    },
    schedule: {
      patterns: [],
      hoursPerWeek: null,
      hasNightShifts: false,
      hasWeekends: false,
      isFlexible: false,
    },
    location: {
      value: {
        city: null,
        country: null,
        relocation: false,
        visaSupport: false,
      },
    },
    experience: {
      minYears: null,
      maxYears: null,
    },
    tech: {
      must: [],
      plus: [],
      all: [],
    },
    languages: {
      required: [],
      plus: [],
    },
    benefits: [],
    interview: {
      steps: [],
      hasTestTask: false,
    },
    company: {
      name: null,
    },
    confidence: {
      title: 0,
      salary: 0,
      contacts: 0,
      employment: 0,
      workFormat: 0,
      schedule: 0,
      location: 0,
      experience: 0,
      tech: 0,
      languages: 0,
      benefits: 0,
      interview: 0,
      company: 0,
      total: 0,
    },
    meta: {
      lang: 'unknown',
      warnings: [],
      sourceUrl: null,
      timingMs: 0,
    },
  };
}
