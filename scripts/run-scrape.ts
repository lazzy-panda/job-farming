import 'reflect-metadata';
import crypto from 'crypto';

if (!(globalThis as Record<string, unknown>).crypto) {
  (globalThis as Record<string, unknown>).crypto = crypto;
}
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../apps/api/src/app/app.module';
import { JobPostingsService } from '../apps/api/src/app/job-postings/job-postings.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(JobPostingsService);
  const result = await service.scrape();
  console.log(result);
  await app.close();
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
