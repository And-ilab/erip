import { Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ApiService, ClaimCase, Named, errorMessage } from '../../core/api.service';

@Component({
  selector: 'app-claims-board',
  standalone: true,
  imports: [RouterLink, MatCardModule, MatButtonModule, MatSnackBarModule],
  template: `
    <div class="page">
      <h2>Взыскание</h2>
      <p class="muted">Дело юриста по лицевому счёту. Отправка в БНП и сервисы ОПИ на показе — заглушки, это видно на карточке.</p>
      @if (error()) { <p class="error">{{ error() }}</p> }
      <div class="board">
        @for (stage of stages(); track stage.id) {
          <section class="column">
            <h3>{{ stage.label }} <span>{{ column(stage.id).length }}</span></h3>
            @for (card of column(stage.id); track card.id) {
              <a class="card" [routerLink]="['/claims', card.id]">
                <b>{{ card.client_account }}</b>
                <span>{{ card.short_fio }}</span>
                <small>{{ card.acts_count }} акт. ОПИ</small>
              </a>
            }
          </section>
        }
      </div>
    </div>
  `,
  styles: `
    h2 { margin: 0 0 4px; color: var(--erip-primary-dark); }
    .board { display: flex; gap: 12px; overflow-x: auto; align-items: flex-start; padding-bottom: 12px; }
    .column { width: 220px; flex: 0 0 220px; background: #f4f7f8; border-radius: 8px; padding: 8px; }
    .column h3 { margin: 0 0 8px; font-size: 13px; display: flex; justify-content: space-between; }
    .card { display: flex; flex-direction: column; gap: 2px; background: #fff; border-radius: 8px; padding: 8px; margin-bottom: 8px; text-decoration: none; color: inherit; border-top: 3px solid var(--erip-primary); }
    .card small { color: var(--erip-muted, #607d8b); }
    .error { color: #b00020; }
  `,
})
export class ClaimsBoardComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);

  protected readonly stages = signal<Named[]>([]);
  protected readonly cards = signal<ClaimCase[]>([]);
  protected readonly error = signal('');

  ngOnInit(): void {
    const account = this.route.snapshot.queryParamMap.get('account');
    if (account) {
      this.api.openClaim(Number(account)).subscribe({
        next: (row) => this.router.navigate(['/claims', row.id]),
        error: (err) => this.snack.open(errorMessage(err), 'OK'),
      });
    }
    this.reload();
  }

  protected column(stage: string): ClaimCase[] {
    return this.cards().filter((card) => card.stage === stage);
  }

  private reload(): void {
    this.api.claims().subscribe({
      next: (page) => {
        this.stages.set(page.stages);
        this.cards.set(page.results);
      },
      error: (err) => this.error.set(errorMessage(err)),
    });
  }
}
