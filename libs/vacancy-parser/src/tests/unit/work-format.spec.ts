import { buildContext } from '../../core/build-context';
import { extractWorkFormat } from '../../extractors/work-format';

describe('workFormat extractor', () => {
  it('detects remote', () => {
    const ctx = buildContext('Работа удаленно (remote)', {});
    const res = extractWorkFormat(ctx, { enableTraces: false });
    expect(res.workFormat.value).toBe('remote');
  });

  it('detects remote from phrasing "Можно работать удалённо"', () => {
    const ctx = buildContext('Можно работать удалённо. Зарплата в валюте.', {});
    const res = extractWorkFormat(ctx, { enableTraces: false });
    expect(res.workFormat.value).toBe('remote');
  });

  it('does not treat remote interview as remote work', () => {
    const ctx = buildContext('Remote interview, onsite work in office', {});
    const res = extractWorkFormat(ctx, { enableTraces: false });
    expect(res.workFormat.value).toBe('onsite');
  });

  it('conflict remote+onsite => hybrid with warning', () => {
    const ctx = buildContext('Remote possible, also office присутствует', {});
    const res = extractWorkFormat(ctx, { enableTraces: false });
    expect(res.workFormat.value).toBe('hybrid');
    expect(res.warnings).toContain('work_format_conflict_remote_onsite');
  });
});
