import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Application, ApplicationStatus } from '@job-farm/shared-models';

interface CreateApplicationDto {
  jobPostingId: string;
  channel: string;
  status?: string;
  notes?: string;
}

type UpdateApplicationDto = Partial<CreateApplicationDto>;

@Injectable()
export class ApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<Application[]> {
    return this.prisma.application.findMany().then((apps) => apps.map((a) => this.mapApplication(a)));
  }

  create(dto: CreateApplicationDto): Promise<Application> {
    return this.prisma.application
      .create({
        data: {
          jobPostingId: dto.jobPostingId,
          channel: dto.channel,
          status: dto.status ?? 'pending',
          notes: dto.notes,
        },
      })
      .then((a) => this.mapApplication(a));
  }

  async update(id: string, dto: UpdateApplicationDto): Promise<Application> {
    try {
      const updated = await this.prisma.application.update({
        where: { id },
        data: dto,
      });
      return this.mapApplication(updated);
    } catch {
      throw new NotFoundException('Application not found');
    }
  }

  async remove(id: string): Promise<Application> {
    try {
      const deleted = await this.prisma.application.delete({ where: { id } });
      return this.mapApplication(deleted);
    } catch {
      throw new NotFoundException('Application not found');
    }
  }

  private mapApplication(a: {
    id: string;
    jobPostingId: string;
    channel: string;
    status: string;
    sentAt: Date | null;
    notes: string | null;
    createdAt: Date;
  }): Application {
    return {
      id: a.id,
      jobPostingId: a.jobPostingId,
      channel: a.channel,
      status: (a.status as ApplicationStatus) ?? 'pending',
      sentAt: a.sentAt ? a.sentAt.toISOString() : '',
      notes: a.notes ?? null,
      createdAt: a.createdAt.toISOString(),
    };
  }
}
