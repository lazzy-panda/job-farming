import { buildContext } from '../../core/build-context';
import { extractSalary } from '../../extractors/salary';

describe('salary extractor', () => {
  it('extracts range with currency and k', () => {
    const ctx = buildContext('ЗП: 120-150k ₽ на руки', {});
    const res = extractSalary(ctx, { strict: false, enableTraces: false });
    expect(res.salary.min).toBe(120000);
    expect(res.salary.max).toBe(150000);
    expect(res.salary.currency).toBe('RUB');
    expect(res.salary.salaryType).toBe('net');
    expect(res.confidence).toBeGreaterThan(0.5);
  });

  it('extracts from/to', () => {
    const ctx = buildContext('Salary from 3000 to 5000 EUR per month', {});
    const res = extractSalary(ctx, { strict: false, enableTraces: false });
    expect(res.salary.min).toBe(3000);
    expect(res.salary.max).toBe(5000);
    expect(res.salary.currency).toBe('EUR');
    expect(res.salary.period).toBe('month');
  });

  it('does not confuse experience range with salary', () => {
    const ctx = buildContext('Experience: 3-5 years. Great team.', {});
    const res = extractSalary(ctx, { strict: false, enableTraces: false });
    expect(res.salary.min).toBeNull();
    expect(res.salary.max).toBeNull();
    expect(res.confidence).toBe(0);
    expect(res.warnings).toContain('salary_not_found');
  });

  it('does not confuse schedule time with salary', () => {
    const ctx = buildContext('График 9:00-18:00, 5/2. Оклад обсуждается.', {});
    const res = extractSalary(ctx, { strict: false, enableTraces: false });
    expect(res.salary.min).toBeNull();
    expect(res.salary.max).toBeNull();
  });

  it('does not confuse percent with salary', () => {
    const ctx = buildContext('Бонус 5-10% по результатам квартала', {});
    const res = extractSalary(ctx, { strict: false, enableTraces: false });
    expect(res.salary.min).toBeNull();
  });

  it('does not treat \"since 2013\" as salary', () => {
    const ctx = buildContext('Since 2013 we build products. Remote.', {});
    const res = extractSalary(ctx, { strict: false, enableTraces: false });
    expect(res.salary.min).toBeNull();
    expect(res.salary.max).toBeNull();
    expect(res.warnings).toContain('salary_not_found');
  });

  it('uses currency from section when not in window', () => {
    const ctx = buildContext('Salary: 3000 - 4000 per month\\nCurrency: USD', {});
    const res = extractSalary(ctx, { strict: false, enableTraces: false });
    expect(res.salary.min).toBe(3000);
    expect(res.salary.max).toBe(4000);
    expect(res.salary.currency).toBe('USD');
  });

  it('detects period per hour', () => {
    const ctx = buildContext('Оплата $50 per hour', {});
    const res = extractSalary(ctx, { strict: false, enableTraces: false });
    expect(res.salary.min).toBe(50);
    expect(res.salary.period).toBe('hour');
    expect(res.salary.currency).toBe('USD');
  });

  it('parses EU thousand separators for annual EUR', () => {
    const ctx = buildContext('Compensation: €65.000 - €80.000 p.a. (gross)', {});
    const res = extractSalary(ctx, { strict: false, enableTraces: false });
    expect(res.salary.min).toBe(65000);
    expect(res.salary.max).toBe(80000);
    expect(res.salary.currency).toBe('EUR');
    expect(res.salary.period).toBe('year');
    expect(res.salary.salaryType).toBe('gross');
  });

  it('treats RUR as RUB', () => {
    const ctx = buildContext('HR-менеджер 60 000 – 120 000 RUR', {});
    const res = extractSalary(ctx, { strict: true, enableTraces: false });
    expect(res.salary.min).toBe(60000);
    expect(res.salary.max).toBe(120000);
    expect(res.salary.currency).toBe('RUB');
    expect(res.salary.period).toBe('month');
  });

  it('detects currency when only "зарплата в евро" is present (no amounts)', () => {
    const ctx = buildContext('Зарплата в евро. Помогают с релокацией.', {});
    const res = extractSalary(ctx, { strict: true, enableTraces: false });
    expect(res.salary.min).toBeNull();
    expect(res.salary.max).toBeNull();
    expect(res.salary.currency).toBe('EUR');
    expect(res.warnings).toContain('salary_currency_only');
  });

  it('does not drop hourly rates below 50', () => {
    const ctx = buildContext('Rate: £35/hour', {});
    const res = extractSalary(ctx, { strict: false, enableTraces: false });
    expect(res.salary.min).toBe(35);
    expect(res.salary.currency).toBe('GBP');
    expect(res.salary.period).toBe('hour');
  });

  it('maps kr currency using defaultCountry hint (SE)', () => {
    const ctx = buildContext('Salary: 60 000 kr per month', { defaultCountry: 'SE' });
    const res = extractSalary(ctx, { strict: false, enableTraces: false });
    expect(res.salary.min).toBe(60000);
    expect(res.salary.currency).toBe('SEK');
    expect(res.salary.period).toBe('month');
  });

  it('parses PLN with zł', () => {
    const ctx = buildContext('Salary: 18 000 zł net per month', {});
    const res = extractSalary(ctx, { strict: false, enableTraces: false });
    expect(res.salary.min).toBe(18000);
    expect(res.salary.currency).toBe('PLN');
    expect(res.salary.salaryType).toBe('net');
    expect(res.salary.period).toBe('month');
  });
});
