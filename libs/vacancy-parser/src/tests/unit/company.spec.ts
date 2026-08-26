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

  it('ignores camelCase tech tokens at the end of a line', () => {
    const ctx = buildContext('Stack: TypeScript, NestJS', {});
    const res = extractCompany(ctx, { enableTraces: false });
    expect(res.company.name).toBeNull();
  });

  it('extracts glued company only when it is at the end of the sentence', () => {
    const ctx = buildContext('Finance / Data AnalystSTARTRIBE LTD\nМосква', {});
    const res = extractCompany(ctx, { enableTraces: false });
    expect(res.company.name).toBe('STARTRIBE');
  });

  it('does not treat trailing tech tokens as glued company', () => {
    const ctx = buildContext('Senior Backend Developer TypeScript', {});
    const res = extractCompany(ctx, { enableTraces: false });
    expect(res.company.name).toBeNull();
  });

  it('extracts company from intro sentence with article', () => {
    const text =
      'Die medatixx GmbH & Co. KG ist gemeinsam mit ihrem Tochterunternehmen I-Motion GmbH ein führender Anbieter von Software.';
    const ctx = buildContext(text, {});
    const res = extractCompany(ctx, { enableTraces: false });
    expect(res.company.name).toBe('medatixx GmbH & Co. KG');
  });
});
