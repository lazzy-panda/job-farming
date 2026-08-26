import { CommonModule } from '@angular/common';
import { Component, HostListener, inject } from '@angular/core';
import { JfConfirmService } from './confirm.service';

@Component({
  standalone: true,
  selector: 'app-confirm-dialog',
  imports: [CommonModule],
  templateUrl: './confirm-dialog.component.html',
  styleUrls: ['./confirm-dialog.component.scss'],
})
export class ConfirmDialogComponent {
  readonly confirm = inject(JfConfirmService);

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.confirm.current()) {
      this.confirm.answer(false);
    }
  }
}
