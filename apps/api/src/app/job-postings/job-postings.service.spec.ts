import { Test, TestingModule } from '@nestjs/testing';
import { JobPostingsService } from './job-postings.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProxyManagerService } from '../proxy-manager/proxy-manager.service';

describe('JobPostingsService', () => {
  let service: JobPostingsService;
  const prismaMock = {
    jobPosting: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    },
  };
  const proxyManagerMock = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobPostingsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ProxyManagerService, useValue: proxyManagerMock },
      ],
    }).compile();

    service = module.get<JobPostingsService>(JobPostingsService);
  });

  it('returns empty list when no jobs', async () => {
    const res = await service.findAll();
    expect(res).toEqual([]);
    expect(prismaMock.jobPosting.findMany).toHaveBeenCalled();
  });
});

