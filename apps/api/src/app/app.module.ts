import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { JobPostingsModule } from './job-postings/job-postings.module';
import { SourcesModule } from './sources/sources.module';
import { ApplicationsModule } from './applications/applications.module';
import { TemplatesModule } from './templates/templates.module';
import { ProxiesModule } from './proxies/proxies.module';
import { SettingsModule } from './settings/settings.module';
import { ScheduleModule } from '@nestjs/schedule';
import { CleanupModule } from './cleanup/cleanup.module';
import { HealthModule } from './health/health.module';
import { ProxyManagerModule } from './proxy-manager/proxy-manager.module';
import { MailerModule } from './mailer/mailer.module';
import { MessengerModule } from './messenger/messenger.module';
import { VacancyParseModule } from '../vacancy-parse/vacancy-parse.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    JobPostingsModule,
    SourcesModule,
    ApplicationsModule,
    TemplatesModule,
    ProxiesModule,
    SettingsModule,
    CleanupModule,
    HealthModule,
    ProxyManagerModule,
    MailerModule,
    MessengerModule,
    VacancyParseModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
