import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { Source } from '@job-farm/shared-models';

@Component({
  standalone: true,
  selector: 'app-job-filters',
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatButtonModule,
    MatMenuModule,
    MatIconModule,
  ],
  templateUrl: './job-filters.component.html',
  styleUrls: ['./job-filters.component.scss'],
})
export class JobFiltersComponent {
  @Input() sources: Source[] = [];
  @Input() filters: { status: string; sourceId: string } = { status: '', sourceId: '' };
  @Output() apply = new EventEmitter<void>();
}


