import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly submitted = signal(false);

  protected submit(event: Event): void {
    event.preventDefault();
    this.submitted.set(true);
  }
}
