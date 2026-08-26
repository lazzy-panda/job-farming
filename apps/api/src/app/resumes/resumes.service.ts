import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Resume, ResumeStats } from '@job-farm/shared-models';

interface CreateResumeDto {
  name: string;
  title: string;
  content: string;
  notes?: string;
  isDefault?: boolean;
}

type UpdateResumeDto = Partial<CreateResumeDto>;

@Injectable()
export class ResumesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<Resume[]> {
    return this.prisma.resume
      .findMany({ orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }] })
      .then((rows) => rows.map((r) => this.mapResume(r)));
  }

  async findDefault(): Promise<Resume | null> {
    const row = await this.prisma.resume.findFirst({ where: { isDefault: true } });
    return row ? this.mapResume(row) : null;
  }

  async create(dto: CreateResumeDto): Promise<Resume> {
    const name = (dto.name ?? '').trim();
    const title = (dto.title ?? '').trim();
    if (!name || !title || !(dto.content ?? '').trim()) {
      throw new BadRequestException('Нужны name, title и content');
    }
    const count = await this.prisma.resume.count();
    const makeDefault = dto.isDefault ?? count === 0;
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        if (makeDefault) {
          await tx.resume.updateMany({ data: { isDefault: false } });
        }
        return tx.resume.create({
          data: {
            name,
            title,
            content: dto.content,
            notes: dto.notes?.trim() || null,
            isDefault: makeDefault,
          },
        });
      });
      return this.mapResume(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('Резюме с таким именем уже существует');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateResumeDto): Promise<Resume> {
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.content !== undefined) data.content = dto.content;
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        if (dto.isDefault === true) {
          await tx.resume.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
        }
        return tx.resume.update({ where: { id }, data });
      });
      return this.mapResume(updated);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('Резюме с таким именем уже существует');
      }
      throw new NotFoundException('Resume not found');
    }
  }

  async remove(id: string): Promise<Resume> {
    try {
      const deleted = await this.prisma.resume.delete({ where: { id } });
      return this.mapResume(deleted);
    } catch {
      throw new NotFoundException('Resume not found');
    }
  }

  /** Отклики/ответы/собесы в разрезе версии резюме — для A/B недель 5–6 */
  async stats(): Promise<ResumeStats[]> {
    const rows = await this.prisma.application.findMany({
      where: { resumeVersion: { not: null } },
      select: { resumeVersion: true, repliedAt: true, interviewAt: true, status: true },
    });
    const byVersion = new Map<string, ResumeStats>();
    for (const row of rows) {
      const version = row.resumeVersion as string;
      const entry =
        byVersion.get(version) ?? { resumeVersion: version, sent: 0, replied: 0, interviews: 0 };
      entry.sent += 1;
      if (row.repliedAt || ['replied', 'interview', 'offer'].includes(row.status)) {
        entry.replied += 1;
      }
      if (row.interviewAt || ['interview', 'offer'].includes(row.status)) {
        entry.interviews += 1;
      }
      byVersion.set(version, entry);
    }
    return Array.from(byVersion.values()).sort((a, b) => b.sent - a.sent);
  }

  private mapResume(r: {
    id: string;
    name: string;
    title: string;
    content: string;
    notes: string | null;
    isDefault: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): Resume {
    return {
      id: r.id,
      name: r.name,
      title: r.title,
      content: r.content,
      notes: r.notes,
      isDefault: r.isDefault,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
