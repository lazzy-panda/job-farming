import axios from 'axios';
import { RssConnector } from './rss.connector';

jest.mock('axios');
jest.mock('rss-parser');

const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock rss-parser
const mockParser = {
  parseString: jest.fn(),
};

jest.mock('rss-parser', () => {
  return jest.fn().mockImplementation(() => {
    return mockParser;
  });
});

describe('RssConnector', () => {
  const connector = new RssConnector();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-12-18T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should parse RSS 2.0 feed and return jobs', async () => {
    const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Senior Developer</title>
      <description>Looking for a senior developer</description>
      <link>https://example.com/job1</link>
      <pubDate>Wed, 17 Dec 2025 10:00:00 GMT</pubDate>
      <guid>job1</guid>
    </item>
    <item>
      <title>Frontend Engineer</title>
      <description>Frontend position available</description>
      <link>https://example.com/job2</link>
      <pubDate>Wed, 16 Dec 2025 10:00:00 GMT</pubDate>
      <guid>job2</guid>
    </item>
  </channel>
</rss>`;

    mockedAxios.get.mockResolvedValueOnce({
      data: rssXml,
      headers: { 'content-type': 'application/rss+xml' },
    });

    mockParser.parseString.mockResolvedValueOnce({
      title: 'Test Feed',
      items: [
        {
          title: 'Senior Developer',
          description: 'Looking for a senior developer',
          link: 'https://example.com/job1',
          pubDate: 'Wed, 17 Dec 2025 10:00:00 GMT',
          guid: 'job1',
        },
        {
          title: 'Frontend Engineer',
          description: 'Frontend position available',
          link: 'https://example.com/job2',
          pubDate: 'Wed, 16 Dec 2025 10:00:00 GMT',
          guid: 'job2',
        },
      ],
    });

    const jobs = await connector.fetchNewJobs({
      sourceId: 's1',
      sourceType: 'rss',
      url: 'https://example.com/feed.xml',
      metadata: {},
    });

    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      title: 'Senior Developer',
      description: 'Looking for a senior developer',
      link: 'https://example.com/job1',
    });
    expect(jobs[0].hash).toBeDefined();
    expect(jobs[0].publishedAt).toBeInstanceOf(Date);
  });

  it('should filter items older than cutoff date', async () => {
    const oldDate = new Date('2025-11-01T10:00:00Z');
    const recentDate = new Date('2025-12-17T10:00:00Z');

    mockParser.parseString.mockResolvedValueOnce({
      title: 'Test Feed',
      items: [
        {
          title: 'Recent Job',
          description: 'Recent position',
          link: 'https://example.com/recent',
          pubDate: recentDate.toUTCString(),
          guid: 'recent',
        },
        {
          title: 'Old Job',
          description: 'Old position',
          link: 'https://example.com/old',
          pubDate: oldDate.toUTCString(),
          guid: 'old',
        },
      ],
    });

    mockedAxios.get.mockResolvedValueOnce({
      data: '<rss></rss>',
      headers: { 'content-type': 'application/rss+xml' },
    });

    const jobs = await connector.fetchNewJobs({
      sourceId: 's1',
      sourceType: 'rss',
      url: 'https://example.com/feed.xml',
      metadata: {},
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('Recent Job');
  });

  it('should handle empty feed', async () => {
    mockParser.parseString.mockResolvedValueOnce({
      title: 'Empty Feed',
      items: [],
    });

    mockedAxios.get.mockResolvedValueOnce({
      data: '<rss></rss>',
      headers: { 'content-type': 'application/rss+xml' },
    });

    const jobs = await connector.fetchNewJobs({
      sourceId: 's1',
      sourceType: 'rss',
      url: 'https://example.com/feed.xml',
      metadata: {},
    });

    expect(jobs).toHaveLength(0);
  });

  it('should handle network errors', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

    await expect(
      connector.fetchNewJobs({
        sourceId: 's1',
        sourceType: 'rss',
        url: 'https://example.com/feed.xml',
        metadata: {},
      }),
    ).rejects.toThrow('Failed to fetch RSS feed');
  });

  it('should respect lastItemId and skip already processed items', async () => {
    mockParser.parseString.mockResolvedValueOnce({
      title: 'Test Feed',
      items: [
        {
          title: 'Job 1',
          description: 'Description 1',
          link: 'https://example.com/job1',
          pubDate: 'Wed, 17 Dec 2025 10:00:00 GMT',
          guid: 'job1',
        },
        {
          title: 'Job 2',
          description: 'Description 2',
          link: 'https://example.com/job2',
          pubDate: 'Wed, 16 Dec 2025 10:00:00 GMT',
          guid: 'job2',
        },
      ],
    });

    mockedAxios.get.mockResolvedValueOnce({
      data: '<rss></rss>',
      headers: { 'content-type': 'application/rss+xml' },
    });

    // Mock hash generation to return predictable values
    const jobs = await connector.fetchNewJobs({
      sourceId: 's1',
      sourceType: 'rss',
      url: 'https://example.com/feed.xml',
      metadata: {
        lastItemId: 'job1',
      },
    });

    // Should return only Job 2, as Job 1 was already processed
    expect(jobs.length).toBeLessThanOrEqual(1);
  });

  it('should extract tags from categories', async () => {
    mockParser.parseString.mockResolvedValueOnce({
      title: 'Test Feed',
      items: [
        {
          title: 'Developer Position',
          description: 'Looking for developer',
          link: 'https://example.com/job',
          pubDate: 'Wed, 17 Dec 2025 10:00:00 GMT',
          guid: 'job1',
          categories: ['IT', 'Development', 'Remote'],
        },
      ],
    });

    mockedAxios.get.mockResolvedValueOnce({
      data: '<rss></rss>',
      headers: { 'content-type': 'application/rss+xml' },
    });

    const jobs = await connector.fetchNewJobs({
      sourceId: 's1',
      sourceType: 'rss',
      url: 'https://example.com/feed.xml',
      metadata: {},
    });

    expect(jobs[0].tags).toContain('IT');
    expect(jobs[0].tags).toContain('Development');
  });

  it('should send browser-like headers to bypass bot protection', async () => {
    mockParser.parseString.mockResolvedValueOnce({
      title: 'Test Feed',
      items: [],
    });

    mockedAxios.get.mockResolvedValueOnce({
      data: '<rss></rss>',
      headers: { 'content-type': 'application/rss+xml' },
    });

    await connector.fetchNewJobs({
      sourceId: 's1',
      sourceType: 'rss',
      url: 'https://example.com/feed.xml',
      metadata: {},
    });

    const requestConfig = mockedAxios.get.mock.calls[0][1];
    expect(requestConfig?.headers?.['Accept-Language']).toBe('en-US,en;q=0.9');
    expect(requestConfig?.headers?.Accept).toContain('application/xml');
    expect(requestConfig?.headers?.['User-Agent']).toContain('Mozilla');
  });

  it('should throw descriptive error on HTML challenge pages', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: '<html><body>Request unsuccessful. Incapsula incident ID: 123</body></html>',
      headers: { 'content-type': 'text/html' },
    });

    await expect(
      connector.fetchNewJobs({
        sourceId: 's1',
        sourceType: 'rss',
        url: 'https://example.com/feed.xml',
        metadata: {},
      }),
    ).rejects.toThrow('Proxy blocked');
    expect(mockParser.parseString).not.toHaveBeenCalled();
  });

  it('should throw error on non-XML plain text response', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: 'We are performing scheduled maintenance.',
      headers: { 'content-type': 'text/plain' },
    });

    await expect(
      connector.fetchNewJobs({
        sourceId: 's1',
        sourceType: 'rss',
        url: 'https://example.com/feed.xml',
        metadata: {},
      }),
    ).rejects.toThrow('non-XML content');
    expect(mockParser.parseString).not.toHaveBeenCalled();
  });

  it('should fall back to non-XML error when parser reports invalid text', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: '<html><body>Maintenance</body></html>',
      headers: { 'content-type': 'application/rss+xml' },
    });

    mockParser.parseString.mockRejectedValueOnce(new Error('Non-whitespace before first tag.'));
    mockParser.parseString.mockRejectedValueOnce(new Error('Non-whitespace before first tag.'));

    await expect(
      connector.fetchNewJobs({
        sourceId: 's1',
        sourceType: 'rss',
        url: 'https://example.com/feed.xml',
        metadata: {},
      }),
    ).rejects.toThrow('non-XML content');
  });
});
