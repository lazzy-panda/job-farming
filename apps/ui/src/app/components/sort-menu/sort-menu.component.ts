import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';

export type SortMode = 'date_desc' | 'date_asc' | 'company';

@Component({
  standalone: true,
  selector: 'app-sort-menu',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    OverlayModule,
  ],
  templateUrl: './sort-menu.component.html',
  styleUrl: './sort-menu.component.scss',
})
export class SortMenuComponent {
  @Input() public sortMode: SortMode = 'date_desc';
  @Output() public sortChange = new EventEmitter<SortMode>();

  public open = false;

  public readonly sortOptions: Array<{
    value: SortMode;
    label: string;
    caption: string;
  }> = [
    { value: 'date_desc', label: 'Новые сначала', caption: 'Последние публикации сверху' },
    { value: 'date_asc', label: 'Старые сначала', caption: 'Хронологический порядок' },
    { value: 'company', label: 'По компании A-Z', caption: 'Сортировка по названию' },
  ];

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

  public onSortSelect(value: SortMode): void {
    this.sortChange.emit(value);
    this.open = false;
  }
}
