import { buildContext } from '../../core/build-context';
import { extractCompany } from '../../extractors/company';

describe('company extractor', () => {
  it('extracts explicit company label', () => {
    const ctx = buildContext('Компания: Acme Corp\nОписание: ...', {});
    const res = extractCompany(ctx, { enableTraces: false });
    expect(res.company.name).toBe('Acme Corp');
    expect(res.confidence).toBeGreaterThan(0);
  });

  it('extracts inline company label in the same line', () => {
    const ctx = buildContext('Вакансия: IT Support Manager Компания: Kwaaka Локация: Удалённо', {});
    const res = extractCompany(ctx, { enableTraces: false });
    expect(res.company.name).toBe('Kwaaka');
  });

  it('extracts company from "в <Company>:" pattern in title', () => {
    const ctx = buildContext('Product Manager (Web) в AIBY: Можно работать удалённо', {});
    const res = extractCompany(ctx, { enableTraces: false });
    expect(res.company.name).toBe('AIBY');
  });

  it('does not hallucinate company', () => {
    const ctx = buildContext('We are a fast growing team. Join us!', {});
    const res = extractCompany(ctx, { enableTraces: false });
    expect(res.company.name).toBeNull();
    expect(res.confidence).toBe(0);
  });
});
