export type DocumentLang = 'ru' | 'en' | 'mixed' | 'unknown';

export type MoneyCurrency =
  | 'RUB'
  | 'USD'
  | 'EUR'
  | 'GBP'
  | 'CHF'
  | 'SEK'
  | 'NOK'
  | 'DKK'
  | 'CZK'
  | 'HUF'
  | 'UAH'
  | 'KZT'
  | 'BYN'
  | 'PLN'
  | 'RON'
  | 'BGN'
  | 'GEL'
  | 'AMD'
  | 'AZN'
  | 'TRY'
  | 'ILS'
  | 'CNY'
  | 'JPY'
  | 'KRW'
  | 'INR'
  | 'UNKNOWN';

export type MoneyPeriod = 'hour' | 'day' | 'week' | 'month' | 'year' | 'project' | 'unknown';

export type SalaryType = 'gross' | 'net' | 'unknown';

export type EmploymentType =
  | 'full_time'
  | 'part_time'
  | 'contract'
  | 'b2b'
  | 'freelance'
  | 'internship'
  | 'temporary'
  | 'unknown';

export type WorkFormat = 'remote' | 'hybrid' | 'onsite' | 'unknown';

export type LanguageLevel =
  | 'A1'
  | 'A2'
  | 'B1'
  | 'B2'
  | 'C1'
  | 'C2'
  | 'basic'
  | 'intermediate'
  | 'upper_intermediate'
  | 'advanced'
  | 'native'
  | 'unknown';

export type BenefitCategory =
  | 'insurance'
  | 'vacation'
  | 'sick_leave'
  | 'parental_leave'
  | 'retirement'
  | 'equipment'
  | 'learning'
  | 'bonus'
  | 'stock'
  | 'gym'
  | 'flexible'
  | 'remote'
  | 'relocation'
  | 'visa'
  | 'other';

export type Role =
  | 'backend_developer'
  | 'frontend_developer'
  | 'fullstack_developer'
  | 'mobile_developer'
  | 'ios_developer'
  | 'android_developer'
  | 'qa_engineer'
  | 'automation_qa'
  | 'manual_qa'
  | 'devops_engineer'
  | 'sre'
  | 'data_engineer'
  | 'data_scientist'
  | 'ml_engineer'
  | 'product_manager'
  | 'project_manager'
  | 'business_analyst'
  | 'system_analyst'
  | 'ux_ui_designer'
  | 'product_designer'
  | 'graphic_designer'
  | 'support_engineer'
  | 'security_engineer'
  | 'solutions_architect'
  | 'architect'
  | 'cto'
  | 'team_lead'
  | 'tech_lead'
  | 'scrum_master'
  | 'hr_recruiter'
  | 'sales_manager'
  | 'marketing_manager'
  | 'content_manager'
  | 'copywriter'
  | 'accountant'
  | 'lawyer'
  | 'unknown';

export interface RuleTrace {
  extractor: string;
  ruleId: string;
  section: string;
  snippet: string;
  scoreDelta: number;
}

export interface ParseOptions {
  pageTitle?: string;
  sourceUrl?: string;
  debug?: boolean;
  strict?: boolean;
  /**
   * Optional hint for phone parsing (ISO 3166-1 alpha-2, e.g. "US", "DE", "GB", "RU").
   * Keeps RU support; improves EU/US validity when numbers are local-format.
   */
  defaultCountry?: string;
  /**
   * Optional hint when currency is omitted in text (e.g. some EU/US sources).
   */
  currencyHint?: MoneyCurrency;
}

export interface ParsedContacts {
  emails: string[];
  phones: string[];
  telegram: string[];
  urls: string[];
}

export interface ParsedSalary {
  min: number | null;
  max: number | null;
  currency: MoneyCurrency;
  period: MoneyPeriod;
  salaryType: SalaryType;
  raw: string | null;
}

export interface ParsedEmployment {
  types: EmploymentType[];
}

export interface ParsedWorkFormat {
  value: WorkFormat;
}

export interface ParsedSchedule {
  patterns: string[];
  hoursPerWeek: number | null;
  hasNightShifts: boolean;
  hasWeekends: boolean;
  isFlexible: boolean;
}

export interface LocationInfo {
  city: string | null;
  country: string | null;
  relocation: boolean;
  visaSupport: boolean;
}

export interface ParsedLocation {
  value: LocationInfo;
}

export interface ParsedTitle {
  value: string | null;
  role: Role;
  level: 'intern' | 'junior' | 'middle' | 'senior' | 'lead' | 'principal' | 'unknown';
  specialization: string[];
  raw: string | null;
}

export interface ParsedExperience {
  minYears: number | null;
  maxYears: number | null;
}

export interface ParsedTech {
  must: string[];
  plus: string[];
  all: string[];
}

export interface ParsedLanguages {
  required: Array<{ language: string; level: LanguageLevel }>;
  plus: Array<{ language: string; level: LanguageLevel }>;
}

export interface InterviewInfo {
  steps: string[];
  hasTestTask: boolean;
}

export interface ParsedCompany {
  name: string | null;
}

export interface ParseResult {
  title: ParsedTitle;
  salary: ParsedSalary;
  contacts: ParsedContacts;
  employment: ParsedEmployment;
  workFormat: ParsedWorkFormat;
  schedule: ParsedSchedule;
  location: ParsedLocation;
  experience: ParsedExperience;
  tech: ParsedTech;
  languages: ParsedLanguages;
  benefits: BenefitCategory[];
  interview: InterviewInfo;
  company: ParsedCompany;
  confidence: {
    title: number;
    salary: number;
    contacts: number;
    employment: number;
    workFormat: number;
    schedule: number;
    location: number;
    experience: number;
    tech: number;
    languages: number;
    benefits: number;
    interview: number;
    company: number;
    total: number;
  };
  meta: {
    lang: DocumentLang;
    warnings: string[];
    traces?: RuleTrace[];
    sourceUrl: string | null;
    timingMs: number;
  };
}
