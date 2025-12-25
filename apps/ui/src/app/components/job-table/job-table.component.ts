import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { JobPosting, Source } from '@job-farm/shared-models';

@Component({
  standalone: true,
  selector: 'app-job-table',
  imports: [CommonModule, MatTableModule, MatButtonModule],
  templateUrl: './job-table.component.html',
  styleUrls: ['./job-table.component.scss'],
})
export class JobTableComponent {
  @Input() jobs: JobPosting[] = [];
  @Input() sources: Source[] = [];
  @Output() open = new EventEmitter<JobPosting>();

  readonly displayedColumns = ['title', 'company', 'status', 'source', 'link', 'actions'];

  getSourceName(job: JobPosting) {
    const src = this.sources.find((s) => s.id === job.sourceId);
    return src?.name ?? '—';
  }

  trackById(_index: number, item: JobPosting) {
    return item.id;
  }
}


