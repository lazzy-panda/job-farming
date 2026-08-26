import { Injectable, signal } from '@angular/core';

interface ConfirmRequest {
  text: string;
  resolve: (value: boolean) => void;
}

@Injectable({ providedIn: 'root' })
export class JfConfirmService {
  readonly current = signal<ConfirmRequest | null>(null);

  ask(text: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.current.set({ text, resolve });
    });
  }

  answer(value: boolean): void {
    const request = this.current();
    if (request) {
      this.current.set(null);
      request.resolve(value);
    }
  }
}
