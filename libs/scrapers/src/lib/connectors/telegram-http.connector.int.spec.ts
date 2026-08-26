import axios from 'axios';
import { TelegramHttpConnector } from './telegram-http.connector';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TelegramHttpConnector integration-like pagination', () => {
  const connector = new TelegramHttpConnector();

  it('stops pagination when hits old messageId', async () => {
    const page1 = `
      <div class="tgme_widget_message" data-post="channel/12">
        <time datetime="2025-12-17T10:00:00+00:00"></time>
        <div class="tgme_widget_message_text">Fresh</div>
      </div>
    `;
    const page2 = `
      <div class="tgme_widget_message" data-post="channel/5">
        <time datetime="2025-12-10T10:00:00+00:00"></time>
        <div class="tgme_widget_message_text">Old</div>
      </div>
    `;
    mockedAxios.get.mockResolvedValueOnce({ data: page1 });
    mockedAxios.get.mockResolvedValueOnce({ data: page2 });

    const jobs = await connector.fetchNewJobs({
      sourceId: 's1',
      sourceType: 'telegram',
      url: 'https://t.me/s/channel',
      metadata: { lastMessageId: 10, maxPages: 2, delayMs: 0, jitterMs: 0 },
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0].messageId).toBe(12);
  });
});
