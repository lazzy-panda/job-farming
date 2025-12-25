import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Settings } from '@job-farm/shared-models';
import { Prisma } from '@prisma/client';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<Settings | null> {
    const res = await this.prisma.settings.findUnique({ where: { id: 1 } });
    return res ? this.mapSettings(res) : null;
  }

  async upsert(data: Record<string, unknown>): Promise<Settings> {
    const payload = (data ?? {}) as Prisma.InputJsonValue;
    const saved = await this.prisma.settings.upsert({
      where: { id: 1 },
      update: { data: payload },
      create: { id: 1, data: payload },
    });
    return this.mapSettings(saved);
  }

  private mapSettings(s: { id: number; updatedAt: Date; data: unknown }): Settings {
    return {
      id: s.id,
      updatedAt: s.updatedAt.toISOString(),
      data: (s.data as Record<string, unknown>) ?? {},
    };
  }
}

