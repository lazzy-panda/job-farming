import { buildContext } from '../../core/build-context';
import { extractContacts } from '../../extractors/contacts';

describe('contacts extractor', () => {
  it('extracts email', () => {
    const ctx = buildContext('Пишите на hr@example.com', {});
    const res = extractContacts(ctx, false);
    expect(res.contacts.emails).toEqual(['hr@example.com']);
    expect(res.confidence).toBeGreaterThan(0);
  });

  it('extracts telegram handle', () => {
    const ctx = buildContext('Контакт: @hire_me', {});
    const res = extractContacts(ctx, false);
    expect(res.contacts.telegram).toEqual(['@hire_me']);
  });

  it('extracts url and normalizes www', () => {
    const ctx = buildContext('Apply: www.example.com/jobs', {});
    const res = extractContacts(ctx, false);
    expect(res.contacts.urls).toEqual(['https://www.example.com/jobs']);
  });

  it('trims trailing punctuation from urls', () => {
    const ctx = buildContext('Form: https://forms.yandex.ru/cloud/abc/Marin,', {});
    const res = extractContacts(ctx, false);
    expect(res.contacts.urls).toEqual(['https://forms.yandex.ru/cloud/abc/Marin']);
  });

  it('extracts RU phone and formats E.164', () => {
    const ctx = buildContext('Телефон: +7 (999) 123-45-67', {});
    const res = extractContacts(ctx, false);
    expect(res.contacts.phones).toEqual(['+79991234567']);
  });
});
