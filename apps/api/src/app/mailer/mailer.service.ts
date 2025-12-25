import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import nodemailer from 'nodemailer';

interface SendEmailDto {
  to: string;
  subject?: string;
  body?: string;
  templateId?: string;
}

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(private readonly prisma: PrismaService) {}

  private getTransport() {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT
      ? Number(process.env.SMTP_PORT)
      : undefined;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const secure = process.env.SMTP_SECURE === 'true';

    if (!host || !port || !user || !pass) {
      this.logger.warn('SMTP creds not set, mailer in noop mode');
      return null;
    }

    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
  }

  async sendEmail(dto: SendEmailDto) {
    const transport = this.getTransport();
    let content = dto.body ?? '';

    if (dto.templateId) {
      const template = await this.prisma.template.findUnique({
        where: { id: dto.templateId },
      });
      if (template?.content) {
        content = template.content;
      }
    }

    if (!transport) {
      this.logger.log(
        `NOOP mail to=${dto.to} subject="${dto.subject ?? ''}" body="${content}"`,
      );
      return { accepted: [], rejected: [], noop: true };
    }

    const info = await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: dto.to,
      subject: dto.subject ?? 'Job application',
      text: content,
    });

    return {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
    };
  }
}

