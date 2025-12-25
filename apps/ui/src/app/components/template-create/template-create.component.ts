import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { Template } from '@job-farm/shared-models';

@Component({
  standalone: true,
  selector: 'app-template-create',
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatCardModule,
  ],
  templateUrl: './template-create.component.html',
  styleUrls: ['./template-create.component.scss'],
})
export class TemplateCreateComponent {
  @Input() model: Partial<Template> = { name: '', content: '', channel: 'email' };
  @Output() submit = new EventEmitter<Partial<Template>>();
}


