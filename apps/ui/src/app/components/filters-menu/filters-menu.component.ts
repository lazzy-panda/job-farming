import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';
import { Source } from '@job-farm/shared-models';

@Component({
  standalone: true,
  selector: 'app-filters-menu',
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    MatTooltipModule,
    OverlayModule,
  ],
  templateUrl: './filters-menu.component.html',
  styleUrl: './filters-menu.component.scss',
})
export class FiltersMenuComponent {
  @Input() public sources: Source[] = [];
  @Input() public filters: { status: string; sourceId: string } = { status: '', sourceId: '' };
  @Output() public apply = new EventEmitter<void>();

  public open = false;

  public readonly overlayPositions: ConnectedPosition[] = [
    {
      originX: 'end',
      originY: 'bottom',
      overlayX: 'end',
      overlayY: 'top',
      offsetY: 8,
    },
    {
      originX: 'start',
      originY: 'bottom',
      overlayX: 'start',
      overlayY: 'top',
      offsetY: 8,
    },
  ];
}

