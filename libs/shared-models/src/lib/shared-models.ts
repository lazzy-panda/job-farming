export type SourceType =
  | 'telegram'
  | 'rss'
  | 'linkedin'
  | 'facebook'
  | 'site'
  | 'email'
  | 'other';

export interface Source {
  id: string;
  name: string;
  sourceType: SourceType;
  url?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export type JobStatus = 'new' | 'applied' | 'archived';

export interface JobPosting {
  id: string;
  title: string;
  description?: string | null;
  company?: string | null;
  location?: string | null;
  link?: string | null;
  status: JobStatus;
  tags?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  sourceId?: string | null;
  source?: Source | null;
}

export type ApplicationStatus = 'pending' | 'sent' | 'replied' | 'rejected';

export interface Application {
  id: string;
  jobPostingId: string;
  channel: string;
  status: ApplicationStatus;
  sentAt: string;
  notes?: string | null;
  createdAt: string;
}

export interface Template {
  id: string;
  name: string;
  content: string;
  channel?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  id: number;
  data: Record<string, unknown>;
  updatedAt: string;
}

export interface ProxyRecord {
  id: string;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
  active: boolean;
  lastCheckedAt?: string | null;
  lastStatus?: string | null;
  createdAt: string;
  updatedAt: string;
}
