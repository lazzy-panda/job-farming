import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ResumesService } from '../resumes/resumes.service';
import {
  Application,
  ApplicationKind,
  ApplicationStatus,
  FunnelStats,
  JobPosting,
  JobStatus,
  SCORE_POINTS,
} from '@job-farm/shared-models';

interface CreateApplicationDto {
  jobPostingId: string;
  channel: string;
  status?: string;
  kind?: string;
  resumeVersion?: string;
  notes?: string;
}

type UpdateApplicationDto = Partial<CreateApplicationDto>;

const FOLLOWUP_AFTER_DAYS = 3;

type ApplicationRow = {
  id: string;
  jobPostingId: string;
  channel: string;
  status: string;
  kind: string;
  resumeVersion: string | null;
  sentAt: Date | null;
  repliedAt: Date | null;
  interviewAt: Date | null;
  notes: string | null;
  createdAt: Date;
  jobPosting?: {
    id: string;
    title: string;
    description: string | null;
    rawContent: string | null;
    company: string | null;
    location: string | null;
    link: string | null;
    status: string;
    tags: string | null;
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    sourceId: string | null;
  } | null;
};

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resumes: ResumesService,
  ) {}

  findAll(): Promise<Application[]> {
    return this.prisma.application
      .findMany({ include: { jobPosting: true }, orderBy: { sentAt: 'desc' } })
      .then((apps) => apps.map((a) => this.mapApplication(a)));
  }

  async create(dto: CreateApplicationDto): Promise<Application> {
    const kind: ApplicationKind = dto.kind === 'adapted' ? 'adapted' : 'template';
    const scoreType = kind === 'adapted' ? 'application_adapted' : 'application_template';

    // Если версия резюме не указана — штампуем текущим дефолтным резюме (для A/B-статистики)
    let resumeVersion = dto.resumeVersion?.trim() || null;
    if (!resumeVersion) {
      resumeVersion = (await this.resumes.findDefault())?.name ?? null;
    }

    const job = await this.prisma.jobPosting.findUnique({
      where: { id: dto.jobPostingId },
      select: { title: true, company: true },
    });

    const [created] = await this.prisma.$transaction([
      this.prisma.application.create({
        data: {
          jobPostingId: dto.jobPostingId,
          channel: dto.channel,
          status: dto.status ?? 'sent',
          kind,
          resumeVersion,
          notes: dto.notes,
        },
      }),
      this.prisma.jobPosting.update({
        where: { id: dto.jobPostingId },
        data: { status: 'applied' },
      }),
    ]);

    await this.prisma.scoreEvent.create({
      data: {
        type: scoreType,
        points: SCORE_POINTS[scoreType],
        note: [job?.title, job?.company].filter(Boolean).join(' — ') || null,
        applicationId: created.id,
      },
    });

    return this.mapApplication(created);
  }

  async update(id: string, dto: UpdateApplicationDto): Promise<Application> {
    const current = await this.prisma.application.findUnique({
      where: { id },
      include: { jobPosting: { select: { title: true, company: true } } },
    });
    if (!current) {
      throw new NotFoundException('Application not found');
    }

    const data: Record<string, unknown> = { ...dto };
    const nextStatus = dto.status;
    if (nextStatus === 'replied' && !current.repliedAt) {
      data.repliedAt = new Date();
    }
    if (nextStatus === 'interview' && !current.interviewAt) {
      data.interviewAt = new Date();
      // Ответ и собеседование могли прийти одним сообщением
      if (!current.repliedAt) {
        data.repliedAt = new Date();
      }
    }

    const updated = await this.prisma.application.update({ where: { id }, data });

    // Собеседование — 8 очков, один раз на отклик
    if (nextStatus === 'interview' && !current.interviewAt) {
      const existing = await this.prisma.scoreEvent.findFirst({
        where: { applicationId: id, type: 'interview' },
      });
      if (!existing) {
        await this.prisma.scoreEvent.create({
          data: {
            type: 'interview',
            points: SCORE_POINTS.interview,
            note:
              [current.jobPosting?.title, current.jobPosting?.company]
                .filter(Boolean)
                .join(' — ') || null,
            applicationId: id,
          },
        });
      }
    }

    return this.mapApplication(updated);
  }

  async remove(id: string): Promise<Application> {
    try {
      const deleted = await this.prisma.application.delete({ where: { id } });
      return this.mapApplication(deleted);
    } catch {
      throw new NotFoundException('Application not found');
    }
  }

  /** Отклики без ответа старше 3 дней — кандидаты на фоллоу-ап */
  followups(): Promise<Application[]> {
    const cutoff = new Date(Date.now() - FOLLOWUP_AFTER_DAYS * 24 * 60 * 60 * 1000);
    return this.prisma.application
      .findMany({
        where: {
          status: { in: ['pending', 'sent'] },
          repliedAt: null,
          sentAt: { lt: cutoff },
        },
        include: { jobPosting: true },
        orderBy: { sentAt: 'asc' },
      })
      .then((apps) => apps.map((a) => this.mapApplication(a)));
  }

  /** Накопленная воронка для чекпоинтов плана */
  async stats(): Promise<FunnelStats> {
    const [
      applicationsTotal,
      applicationsAdapted,
      replied,
      interviews,
      offers,
      rejected,
      manualCounts,
    ] = await Promise.all([
      this.prisma.application.count(),
      this.prisma.application.count({ where: { kind: 'adapted' } }),
      this.prisma.application.count({
        where: {
          OR: [{ repliedAt: { not: null } }, { status: { in: ['replied', 'interview', 'offer'] } }],
        },
      }),
      this.prisma.application.count({
        where: { OR: [{ interviewAt: { not: null } }, { status: { in: ['interview', 'offer'] } }] },
      }),
      this.prisma.application.count({ where: { status: 'offer' } }),
      this.prisma.application.count({ where: { status: 'rejected' } }),
      this.prisma.scoreEvent.groupBy({
        by: ['type'],
        _count: { _all: true },
        where: { type: { in: ['touch', 'call', 'post', 'artifact'] } },
      }),
    ]);

    const manual: Record<string, number> = {};
    for (const row of manualCounts) {
      manual[row.type] = row._count._all;
    }

    return {
      applicationsTotal,
      applicationsAdapted,
      applicationsTemplate: applicationsTotal - applicationsAdapted,
      replied,
      interviews,
      offers,
      rejected,
      touches: manual['touch'] ?? 0,
      calls: manual['call'] ?? 0,
      posts: manual['post'] ?? 0,
      artifacts: manual['artifact'] ?? 0,
    };
  }

  private mapApplication(a: ApplicationRow): Application {
    return {
      id: a.id,
      jobPostingId: a.jobPostingId,
      channel: a.channel,
      status: (a.status as ApplicationStatus) ?? 'pending',
      kind: (a.kind as ApplicationKind) ?? 'template',
      resumeVersion: a.resumeVersion ?? null,
      sentAt: a.sentAt ? a.sentAt.toISOString() : '',
      repliedAt: a.repliedAt ? a.repliedAt.toISOString() : null,
      interviewAt: a.interviewAt ? a.interviewAt.toISOString() : null,
      notes: a.notes ?? null,
      createdAt: a.createdAt.toISOString(),
      jobPosting: a.jobPosting ? this.mapJobPosting(a.jobPosting) : null,
    };
  }

  private mapJobPosting(job: NonNullable<ApplicationRow['jobPosting']>): JobPosting {
    return {
      id: job.id,
      title: job.title,
      description: job.description,
      rawContent: job.rawContent,
      company: job.company,
      location: job.location,
      link: job.link,
      status: (job.status as JobStatus) ?? 'new',
      tags: job.tags,
      publishedAt: job.publishedAt ? job.publishedAt.toISOString() : null,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      sourceId: job.sourceId,
    };
  }
}
