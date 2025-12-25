import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';

@Component({
  standalone: true,
  selector: 'app-pagination',
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatSelectModule],
  templateUrl: './pagination.component.html',
  styleUrls: ['./pagination.component.scss'],
})
export class PaginationComponent {
  @Input() total = 0;
  @Input() pageIndex = 0;
  @Input() pageSize = 20;
  @Input() pageSizeOptions: number[] = [20, 50, 100];
  @Output() pageChange = new EventEmitter<{ pageIndex: number; pageSize: number }>();

  get totalPages(): number {
    return this.total === 0 ? 1 : Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  get startItem(): number {
    if (this.total === 0) {
      return 0;
    }
    return this.pageIndex * this.pageSize + 1;
  }

  get endItem(): number {
    if (this.total === 0) {
      return 0;
    }
    return Math.min(this.total, (this.pageIndex + 1) * this.pageSize);
  }

  previous() {
    if (this.pageIndex > 0) {
      this.emitChange(this.pageIndex - 1, this.pageSize);
    }
  }

  next() {
    if (this.pageIndex < this.totalPages - 1) {
      this.emitChange(this.pageIndex + 1, this.pageSize);
    }
  }

  changePageSize(size: number) {
    this.emitChange(0, size);
  }

  selectPage(page: number) {
    this.emitChange(page - 1, this.pageSize);
  }

  private emitChange(pageIndex: number, pageSize: number) {
    this.pageChange.emit({ pageIndex, pageSize });
  }

  get displayedPages(): Array<number | 'ellipsis'> {
    const total = this.totalPages;
    const current = this.pageIndex + 1;

    if (total <= 7) {
      return Array.from({ length: total }, (_, idx) => idx + 1);
    }

    const candidates = new Set<number>();
    candidates.add(1);
    candidates.add(total);
    candidates.add(current);
    candidates.add(Math.max(1, current - 1));
    candidates.add(Math.min(total, current + 1));
    candidates.add(Math.max(1, current - 2));
    candidates.add(Math.min(total, current + 2));

    const sorted = Array.from(candidates)
      .filter((val) => val >= 1 && val <= total)
      .sort((a, b) => a - b);

    const pages: Array<number | 'ellipsis'> = [];
    let previous: number | null = null;
    for (const value of sorted) {
      if (previous !== null && value - previous > 1) {
        pages.push('ellipsis');
      }
      pages.push(value);
      previous = value;
    }

    return pages;
  }

  trackPage(index: number, page: number | 'ellipsis') {
    return typeof page === 'number' ? page : `ellipsis-${index}`;
  }
}
