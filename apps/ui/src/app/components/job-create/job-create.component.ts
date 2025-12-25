import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { JobPosting } from '@job-farm/shared-models';

@Component({
  standalone: true,
  selector: 'app-job-create',
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatCardModule,
  ],
  templateUrl: './job-create.component.html',
  styleUrls: ['./job-create.component.scss'],
})
export class JobCreateComponent {
  @Input() model: Partial<JobPosting> = { title: '', company: '', link: '', status: 'new' };
  @Output() submit = new EventEmitter<Partial<JobPosting>>();
}


