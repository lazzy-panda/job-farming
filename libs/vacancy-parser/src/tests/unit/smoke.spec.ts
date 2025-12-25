import { parseVacancy } from '../../parse-vacancy';

describe('parseVacancy smoke', () => {
  it('handles empty text', () => {
    const res = parseVacancy('', { strict: true });
    expect(res.meta.warnings).toContain('empty_text');
  });

  it('handles very long text', () => {
    const text = 'A'.repeat(200_000) + '\nRequirements: TypeScript\nContacts: a@b.com';
    const res = parseVacancy(text, { strict: true });
    expect(res).toBeTruthy();
    expect(Array.isArray(res.meta.warnings)).toBe(true);
  });

  it('handles garbage characters', () => {
    const text = '\u0000\u0001\u0002 !!! ### \n @test_user \n $3000-5000';
    const res = parseVacancy(text, { strict: true });
    expect(res).toBeTruthy();
  });

  it('adds warning and truncates multi-vacancy dumps', () => {
    const longBlock = 'Условия: ' + 'A'.repeat(500) + '\\n';
    const text =
      `Python разработчик\\n${longBlock}` +
      `Менеджер проекта\\n${longBlock}` +
      'Понравились вакансии? — да — нет\\n--- Разместить вакансию';
    const res = parseVacancy(text, { strict: true });
    expect(res.meta.warnings).toContain('input_truncated');
  });

  it('does not break emails and does not infer country from .ru in urls', () => {
    const text = 'Apply: https://forms.yandex.ru/cloud/123 Email: jobs2@example.com';
    const res = parseVacancy(text, { strict: true });
    expect(res.contacts.emails).toContain('jobs2@example.com');
    expect(res.location.value.country).toBeNull();
  });

  it('fixes glued title+salary and extracts title', () => {
    const text = 'Junior веб-дизайнер90 000 RUBБез опыта / Удаленно';
    const res = parseVacancy(text, { strict: true });
    expect(res.title.value).toBe('Junior веб-дизайнер');
    expect(res.salary.min).toBe(90000);
    expect(res.salary.currency).toBe('RUB');
  });
});
