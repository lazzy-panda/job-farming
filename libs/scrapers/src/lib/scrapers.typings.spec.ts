import { SourceConnector, SourceContext } from './scrapers';

describe('scrapers typings', () => {
  it('allows creating objects that satisfy SourceConnector interface', async () => {
    const connector: SourceConnector = {
      async fetchNewJobs(ctx: SourceContext) {
        return [
          {
            title: `test-${ctx.sourceId}`,
          },
        ];
      },
    };

    const jobs = await connector.fetchNewJobs({
      sourceId: 'source-1',
      sourceType: 'rss',
      url: 'https://example.com',
      metadata: null,
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('test-source-1');
  });
});
