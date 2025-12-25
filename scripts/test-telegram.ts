import { TelegramHttpConnector } from '@job-farm/scrapers';

async function run() {
  const connector = new TelegramHttpConnector();
  const jobs = await connector.fetchNewJobs({
    sourceId: 'test',
    sourceType: 'telegram',
    url: 'https://t.me/jobsincyprus',
    metadata: {},
  });
  console.log(`Fetched ${jobs.length} jobs`);
  console.log(jobs.slice(0, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
