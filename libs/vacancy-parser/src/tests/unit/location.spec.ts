import { buildContext } from '../../core/build-context';
import { extractLocation } from '../../extractors/location';

describe('location extractor', () => {
  it('extracts city and country in RU format', () => {
    const ctx = buildContext('Локация: Москва, РФ', {});
    const res = extractLocation(ctx, { enableTraces: false });
    expect(res.location.value.city).toMatch(/Москва|Moscow/);
    expect(res.location.value.country).toBe('Russia');
    expect(res.confidence).toBeGreaterThan(0);
  });

  it('extracts city and country in EN format', () => {
    const ctx = buildContext('Location: Berlin, Germany', {});
    const res = extractLocation(ctx, { enableTraces: false });
    expect(res.location.value.city).toMatch(/Berlin/);
    expect(res.location.value.country).toBe('Germany');
  });

  it('sets relocation and visaSupport flags', () => {
    const ctx = buildContext('Relocation package available. Visa support provided.', {});
    const res = extractLocation(ctx, { enableTraces: false });
    expect(res.location.value.relocation).toBe(true);
    expect(res.location.value.visaSupport).toBe(true);
  });

  it('extracts city alias without explicit country', () => {
    const ctx = buildContext('Office in Тбилиси, гибридный формат', {});
    const res = extractLocation(ctx, { enableTraces: false });
    expect(res.location.value.city).toBe('Tbilisi');
    expect(res.location.value.country).toBe('Georgia');
  });

  it('does not treat tech stack as city/country', () => {
    const ctx = buildContext('Stack: Django, FastAPI', {});
    const res = extractLocation(ctx, { enableTraces: false });
    expect(res.location.value.city).toBeNull();
    expect(res.location.value.country).toBeNull();
  });

  it('does not infer Russia from .ru TLD inside urls', () => {
    const ctx = buildContext('Apply: https://forms.yandex.ru/cloud/123', {});
    const res = extractLocation(ctx, { enableTraces: false });
    expect(res.location.value.country).toBeNull();
  });

  it('does not match РФ inside words like "интерфейс"', () => {
    const ctx = buildContext('Мы делаем удобные интерфейсы для iPhone/iPad', {});
    const res = extractLocation(ctx, { enableTraces: false });
    expect(res.location.value.country).toBeNull();
  });

  it('extracts city and country in parentheses format', () => {
    const ctx = buildContext('Location: Dublin (Ireland)', {});
    const res = extractLocation(ctx, { enableTraces: false });
    expect(res.location.value.city).toBe('Dublin');
    expect(res.location.value.country).toBe('Ireland');
  });

  it('extracts city and country in dash format', () => {
    const ctx = buildContext('Berlin - Germany', {});
    const res = extractLocation(ctx, { enableTraces: false });
    expect(res.location.value.city).toBe('Berlin');
    expect(res.location.value.country).toBe('Germany');
  });

  it('extracts Cyprus country from Cyrillic "Кипр"', () => {
    const ctx = buildContext('Помогают с релокацией на Кипр', {});
    const res = extractLocation(ctx, { enableTraces: false });
    expect(res.location.value.country).toBe('Cyprus');
    expect(res.location.value.relocation).toBe(true);
  });
});
