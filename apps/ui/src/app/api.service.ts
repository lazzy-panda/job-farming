import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import {
  Application,
  JobPosting,
  Source,
  Template,
} from '@job-farm/shared-models';

const API_BASE = 'http://127.0.0.1:3000/api';

export interface VacancyParseRequest {
  text: string;
  pageTitle?: string;
  sourceUrl?: string;
  debug?: boolean;
}

// UI should not depend on vacancy-parser library code (Node-only require() exists there).
// Keep a minimal DTO type for displaying/logging parse results from API.
export interface VacancyParseResult {
  title?: unknown;
  salary?: unknown;
  contacts?: unknown;
  employment?: unknown;
  workFormat?: unknown;
  schedule?: unknown;
  location?: unknown;
  experience?: unknown;
  tech?: unknown;
  languages?: unknown;
  benefits?: unknown;
  interview?: unknown;
  company?: unknown;
  confidence?: unknown;
  meta?: { warnings?: string[]; lang?: string; timingMs?: number; sourceUrl?: string | null; traces?: unknown[] };
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private readonly http: HttpClient) {}

  getJobPostings(params?: {
    skip?: number;
    take?: number;
    sourceId?: string;
    status?: string;
  }) {
    let httpParams = new HttpParams();
    if (params?.skip !== undefined) httpParams = httpParams.set('skip', params.skip);
    if (params?.take !== undefined) httpParams = httpParams.set('take', params.take);
    if (params?.sourceId) httpParams = httpParams.set('sourceId', params.sourceId);
    if (params?.status) httpParams = httpParams.set('status', params.status);
    return this.http.get<JobPosting[]>(`${API_BASE}/job-postings`, {
      params: httpParams,
    });
  }

  createJobPosting(payload: Partial<JobPosting>) {
    return this.http.post<JobPosting>(`${API_BASE}/job-postings`, payload);
  }

  runScrape() {
    return this.http.post<{ status: string }>(`${API_BASE}/job-postings/scrape`, {});
  }

  deleteJobPosting(id: string) {
    return this.http.delete<JobPosting>(`${API_BASE}/job-postings/${id}`);
  }

  getSources() {
    return this.http.get<Source[]>(`${API_BASE}/sources`);
  }

  getTemplates() {
    return this.http.get<Template[]>(`${API_BASE}/templates`);
  }

  createApplication(payload: Partial<Application>) {
    return this.http.post<Application>(`${API_BASE}/applications`, payload);
  }

  createSource(payload: Partial<Source>) {
    return this.http.post<Source>(`${API_BASE}/sources`, payload);
  }

  deleteSource(id: string) {
    return this.http.delete<Source>(`${API_BASE}/sources/${id}`);
  }

  createTemplate(payload: Partial<Template>) {
    return this.http.post<Template>(`${API_BASE}/templates`, payload);
  }

  getSettings() {
    return this.http.get<Record<string, string | number> | null>(`${API_BASE}/settings`);
  }

  saveSettings(data: Record<string, unknown>) {
    return this.http.post(`${API_BASE}/settings`, data);
  }

  parseVacancy(payload: VacancyParseRequest) {
    return this.http.post<VacancyParseResult>(`${API_BASE}/vacancies/parse`, payload);
  }
}
