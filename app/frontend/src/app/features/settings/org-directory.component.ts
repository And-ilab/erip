import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DirectoryUser, OrganizationOption, Role, ServiceOrganizationOption } from '../../core/models';

interface UserDraft {
  last_name: string;
  first_name: string;
  middle_name: string;
  username: string;
  password: string;
  email: string;
  role: Role;
  can_approve: boolean;
  contour: 'billing' | 'supplier';
  service_organizations: number[];
}

@Component({
  selector: 'app-org-draft-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>Новая организация</h2>
    <mat-dialog-content class="form">
      <mat-form-field><mat-label>Код схемы АИС</mat-label><input matInput [(ngModel)]="schema" maxlength="30" /></mat-form-field>
      <mat-form-field><mat-label>Наименование</mat-label><input matInput [(ngModel)]="name" /></mat-form-field>
      @if (error) { <p class="err">{{ error }}</p> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Отмена</button>
      <button mat-flat-button color="primary" (click)="save()">Создать</button>
    </mat-dialog-actions>
  `,
  styles: `
    .form { display: flex; flex-direction: column; min-width: 360px; }
    .err { color: var(--erip-danger); margin: 0; }
  `,
})
export class OrgDraftDialog {
  private readonly ref = inject(MatDialogRef<OrgDraftDialog, { schema_name: string; name: string }>);
  protected schema = '';
  protected name = '';
  protected error = '';

  protected save(): void {
    const schema = this.schema.trim();
    const name = this.name.trim();
    if (!schema || !name) {
      this.error = 'Укажите код схемы и наименование';
      return;
    }
    this.ref.close({ schema_name: schema, name });
  }
}

@Component({
  selector: 'app-user-draft-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>Новый пользователь</h2>
    <mat-dialog-content class="form">
      <div class="line">
        <mat-form-field><mat-label>Фамилия</mat-label><input matInput [(ngModel)]="lastName" /></mat-form-field>
        <mat-form-field><mat-label>Имя</mat-label><input matInput [(ngModel)]="firstName" /></mat-form-field>
        <mat-form-field><mat-label>Отчество</mat-label><input matInput [(ngModel)]="middleName" /></mat-form-field>
      </div>
      <div class="line">
        <mat-form-field><mat-label>Логин</mat-label><input matInput [(ngModel)]="username" /></mat-form-field>
        <mat-form-field><mat-label>Пароль</mat-label><input matInput type="password" [(ngModel)]="password" /></mat-form-field>
      </div>
      <mat-form-field><mat-label>E-mail</mat-label><input matInput [(ngModel)]="email" /></mat-form-field>
      <div class="line">
        <mat-form-field><mat-label>Роль</mat-label>
          <mat-select [(ngModel)]="role">
            @for (item of data.roles; track item.id) { <mat-option [value]="item.id">{{ item.label }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-form-field><mat-label>Контур</mat-label>
          <mat-select [(ngModel)]="contour" [disabled]="role !== 'specialist'">
            <mat-option value="billing">Начисляющая организация</mat-option>
            <mat-option value="supplier">Поставщик услуг</mat-option>
          </mat-select>
        </mat-form-field>
      </div>
      @if (role === 'specialist') {
        <label class="hint"><input type="checkbox" [(ngModel)]="canApprove" /> Согласует: может пропустить мероприятие или этап</label>
      }
      @if (role === 'specialist' && contour === 'supplier') {
        <p class="hint">Поставщик видит только отмеченные организации. Пустой список даёт пустой реестр.</p>
        <div class="services">
          @for (item of data.services; track item.id) {
            <label><input type="checkbox" [checked]="services.includes(item.id)" (change)="toggleService(item.id, $event)" /> {{ item.short_name }}</label>
          }
        </div>
      }
      @if (error) { <p class="err">{{ error }}</p> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Отмена</button>
      <button mat-flat-button color="primary" (click)="save()">Создать</button>
    </mat-dialog-actions>
  `,
  styles: `
    .form { display: flex; flex-direction: column; min-width: 480px; }
    .line { display: flex; gap: 8px; }
    .line mat-form-field { flex: 1; }
    .hint, .err { margin: 0 0 8px; font-size: 13px; }
    .hint { color: var(--erip-muted); }
    .err { color: var(--erip-danger); }
    .services { display: flex; flex-direction: column; gap: 4px; max-height: 160px; overflow: auto; margin-bottom: 8px; }
  `,
})
export class UserDraftDialog {
  private readonly ref = inject(MatDialogRef<UserDraftDialog, UserDraft>);
  protected readonly data = inject<{ roles: { id: Role; label: string }[]; services: ServiceOrganizationOption[] }>(MAT_DIALOG_DATA);
  protected lastName = '';
  protected firstName = '';
  protected middleName = '';
  protected username = '';
  protected password = '';
  protected email = '';
  protected role: Role = this.data.roles[0]?.id ?? 'specialist';
  protected contour: 'billing' | 'supplier' = 'billing';
  protected canApprove = false;
  protected services: number[] = [];
  protected error = '';

  protected toggleService(id: number, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.services = checked ? [...this.services, id] : this.services.filter((item) => item !== id);
  }

  protected save(): void {
    const username = this.username.trim();
    if (!username || !this.password) {
      this.error = 'Укажите логин и пароль';
      return;
    }
    if (this.password.length < 8) {
      this.error = 'Пароль не короче 8 символов';
      return;
    }
    const contour = this.role === 'specialist' ? this.contour : 'billing';
    if (contour === 'supplier' && !this.services.length) {
      this.error = 'Отметьте хотя бы одну организацию поставщика';
      return;
    }
    this.ref.close({
      last_name: this.lastName.trim(),
      first_name: this.firstName.trim(),
      middle_name: this.middleName.trim(),
      username,
      password: this.password,
      email: this.email.trim(),
      role: this.role,
      can_approve: this.role === 'specialist' && this.canApprove,
      contour,
      service_organizations: contour === 'supplier' ? this.services : [],
    });
  }
}

@Component({
  selector: 'app-org-directory',
  standalone: true,
  imports: [
    FormsModule, MatButtonModule, MatIconModule, MatTooltipModule, MatSnackBarModule, MatDialogModule,
  ],
  template: `
    <div class="bar">
      @if (auth.isSuperadmin()) {
        <button mat-flat-button color="primary" (click)="createOrg()">+ Новая организация</button>
      }
      <p class="crumb">Настройка · Организации и пользователи</p>
      <input class="search" placeholder="Поиск по организации, пользователю, логину" [ngModel]="query()" (ngModelChange)="onSearch($event)" />
    </div>
    <div class="split">
      <aside class="card">
        <header>
          <h2>Организации ({{ orgs().length }})</h2>
          <span>изолированные контуры данных</span>
        </header>
        <div class="orgs">
          @for (org of visibleOrgs(); track org.id) {
            <button type="button" class="org" [class.on]="org.id === selectedId()" (click)="pick(org.id)">
              <span class="org-body">
                <strong>{{ org.name }}</strong>
                <small>{{ people(org.user_count || 0) }} · {{ accounts(org.account_count || 0) }} · лок. администратор: {{ org.local_admin_name || 'не назначен' }}</small>
              </span>
              <span class="status" [class.off]="org.is_active === false">{{ org.is_active === false ? 'отключена' : 'активна' }}</span>
            </button>
          }
        </div>
      </aside>
      <section class="card">
        @if (selected(); as org) {
          <h2>Пользователи — {{ org.name }}</h2>
          <p class="muted">Учётные записи ведутся в разрезе организации. Роль назначается в рамках организации; при блокировке открытые задания, мероприятия и закреплённые счета переходят другому сотруднику той же схемы и того же контура.</p>
          <div class="toolbar">
            <button mat-stroked-button (click)="createUser()">+ Новый пользователь</button>
            <button type="button" class="tab" [class.on]="tab() === 'users'" (click)="tab.set('users')">Пользователи</button>
            <button type="button" class="tab" [class.on]="tab() === 'rights'" (click)="tab.set('rights')">Группы прав</button>
            <span class="grow"></span>
            <button mat-stroked-button (click)="exportUsers()">Экспорт</button>
          </div>
          @if (tab() === 'users') {
            <div class="list-pane">
              <table>
                <thead>
                  <tr><th>Пользователь</th><th>Логин</th><th>Роль</th><th>Статус</th><th>Последний вход</th><th></th></tr>
                </thead>
                <tbody>
                  @for (user of users(); track user.id) {
                    <tr>
                      <td class="who">
                        <span class="face" [class]="'face t' + (user.id % 5)">{{ initials(user) }}</span>
                        {{ user.registry_name || user.username }}
                      </td>
                      <td>{{ user.username }}</td>
                      <td>
                        <span class="role" [class]="roleClass(user)">{{ roleLabel(user) }}</span>
                        @if (user.role === 'specialist' && canToggle(user)) {
                          <button mat-button type="button" (click)="toggleApprove(user)">{{ user.can_approve ? 'Снять согласование' : 'Дать согласование' }}</button>
                        }
                      </td>
                      <td><span class="status" [class.off]="!user.is_active">{{ user.is_active ? 'активен' : 'заблокирован' }}</span></td>
                      <td>{{ when(user.last_login) }}</td>
                      <td>
                        @if (canToggle(user)) {
                          <button mat-icon-button type="button" (click)="toggle(user)" [matTooltip]="user.is_active ? 'Заблокировать' : 'Вернуть доступ'">
                            <mat-icon>{{ user.is_active ? 'block' : 'lock_open' }}</mat-icon>
                          </button>
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="6" class="muted">В этой организации нет пользователей по текущему поиску.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <div class="rights">
              @for (item of rights; track item.title) {
                <article>
                  <h3>{{ item.title }}</h3>
                  <p>{{ item.text }}</p>
                </article>
              }
            </div>
          }
        } @else {
          <p class="muted">Организаций в контуре нет.</p>
        }
      </section>
    </div>
  `,
  styles: `
    .bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
    .crumb { margin: 0; color: var(--erip-muted); flex: 1; }
    .search {
      min-width: 280px; border: 1px solid var(--erip-border); border-radius: 8px; padding: 8px 12px; font: inherit; background: #fff;
    }
    .split { display: grid; grid-template-columns: 320px 1fr; gap: 16px; align-items: start; }
    .card { background: #fff; border: 1px solid var(--erip-border); border-radius: 12px; padding: 14px 16px; }
    aside header { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
    h2, h3 { margin: 0; color: var(--erip-primary-dark); }
    aside header span, .muted { color: var(--erip-muted); font-size: 13px; }
    .muted { margin: 6px 0 0; }
    .orgs { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; max-height: calc(100vh - 280px); overflow: auto; }
    .org {
      display: flex; gap: 8px; align-items: flex-start; text-align: left; border: 1px solid var(--erip-border);
      background: #fff; border-radius: 10px; padding: 10px; cursor: pointer; font: inherit;
    }
    .org.on { border-color: var(--erip-primary); background: var(--erip-primary-soft); }
    .org-body { display: flex; flex-direction: column; gap: 4px; flex: 1; }
    .org small { color: var(--erip-muted); }
    .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 12px 0; }
    .grow { flex: 1; }
    .tab { border: 1px solid var(--erip-border); background: #fff; border-radius: 8px; padding: 6px 10px; cursor: pointer; font: inherit; }
    .tab.on { background: var(--erip-primary); color: #fff; border-color: var(--erip-primary); }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--erip-border); font-size: 13px; vertical-align: middle; }
    th { color: var(--erip-muted); }
    .who { display: flex; align-items: center; gap: 8px; }
    .role {
      display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600;
      background: #e8f1fb; color: #1d4ed8;
      &.admin { background: #e6eff3; color: var(--erip-primary); }
      &.supplier { background: #ffedd5; color: #c2410c; }
      &.observer { background: #f3f4f6; color: #4b5563; }
      &.root { background: #ede9fe; color: #6d28d9; }
    }
    .status {
      display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; white-space: nowrap;
      background: #dcfce7; color: #15803d;
      &.off { background: #fee2e2; color: #b91c1c; }
    }
    .rights { display: flex; flex-direction: column; gap: 10px; }
    .rights article { border: 1px solid var(--erip-border); border-radius: 10px; padding: 10px 12px; }
    .rights p { margin: 4px 0 0; }
    @media (max-width: 980px) { .split { grid-template-columns: 1fr; } }
  `,
})
export class OrgDirectoryComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly snack = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  protected readonly auth = inject(AuthService);

  protected readonly orgs = signal<OrganizationOption[]>([]);
  protected readonly users = signal<DirectoryUser[]>([]);
  protected readonly selectedId = signal<number | null>(null);
  protected readonly query = signal('');
  protected readonly tab = signal<'users' | 'rights'>('users');
  protected readonly rights = [
    { title: 'Суперадминистратор', text: 'Все схемы. Меняет границы групп, рейтинг, организации и любых пользователей.' },
    { title: 'Локальный администратор', text: 'Пользователи своей схемы, сценарии и печатные формы схемы. Границы групп задаёт суперадминистратор.' },
    { title: 'Специалист', text: 'Реестр, карточки и задания внутри мероприятий своей схемы. Мероприятие вне сценария и пропуск этапа — только если включено согласование.' },
    { title: 'Специалист поставщика', text: 'Только услуги, где его организация назначена поставщиком. Пустой список поставщика оставляет реестр пустым.' },
    { title: 'Наблюдатель', text: 'Просмотр данных своей схемы без изменений.' },
  ];

  ngOnInit(): void {
    this.loadOrgs();
  }

  protected selected(): OrganizationOption | null {
    return this.orgs().find((org) => org.id === this.selectedId()) ?? null;
  }

  protected visibleOrgs(): OrganizationOption[] {
    const q = this.query().trim().toLowerCase();
    const rows = this.orgs();
    if (!q) return rows;
    const matched = rows.filter((org) =>
      [org.name, org.schema_name, org.local_admin_name].some((value) => (value || '').toLowerCase().includes(q)),
    );
    return matched.length ? matched : rows;
  }

  protected people(count: number): string {
    return `${this.format(count)} ${this.plural(count, 'пользователь', 'пользователя', 'пользователей')}`;
  }

  protected accounts(count: number): string {
    return `${this.format(count)} ЛС`;
  }

  protected initials(user: DirectoryUser): string {
    const name = user.registry_name || user.username;
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');
  }

  protected roleLabel(user: DirectoryUser): string {
    if (user.role === 'specialist' && user.can_approve) {
      return user.contour === 'supplier' ? 'Специалист поставщика с согласованием' : 'Специалист с согласованием';
    }
    if (user.role === 'specialist' && user.contour === 'supplier') return 'Специалист поставщика';
    return {
      superadmin: 'Суперадминистратор',
      local_admin: 'Локальный администратор',
      specialist: 'Специалист',
      observer: 'Наблюдатель',
    }[user.role];
  }

  protected roleClass(user: DirectoryUser): string {
    if (user.role === 'specialist' && user.contour === 'supplier') return 'role supplier';
    if (user.role === 'local_admin') return 'role admin';
    if (user.role === 'observer') return 'role observer';
    if (user.role === 'superadmin') return 'role root';
    return 'role';
  }

  protected when(value: string | null): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  protected canToggle(user: DirectoryUser): boolean {
    if (user.id === this.auth.me()?.id) return false;
    if (this.auth.isSuperadmin()) return true;
    return user.role === 'specialist' || user.role === 'observer';
  }

  protected onSearch(value: string): void {
    this.query.set(value);
    const visible = this.visibleOrgs();
    if (this.selectedId() != null && !visible.some((org) => org.id === this.selectedId())) {
      this.selectedId.set(visible[0]?.id ?? null);
    }
    this.loadUsers();
  }

  protected pick(id: number): void {
    this.selectedId.set(id);
    this.tab.set('users');
    this.loadUsers();
  }

  protected createOrg(): void {
    this.dialog.open(OrgDraftDialog).afterClosed().subscribe((draft) => {
      if (!draft) return;
      this.api.createOrganization(draft.schema_name, draft.name).subscribe({
        next: (org) => {
          this.snack.open('Организация создана', 'OK', { duration: 2000 });
          this.loadOrgs(org.id);
        },
        error: (err) => this.snack.open(errorMessage(err), 'OK'),
      });
    });
  }

  protected createUser(): void {
    const org = this.selected();
    if (!org) return;
    this.api.serviceOrganizations(org.id).subscribe({
      next: (page) => {
        this.dialog.open(UserDraftDialog, {
          data: { roles: this.creatableRoles(), services: page.results },
          width: '560px',
        }).afterClosed().subscribe((draft: UserDraft | undefined) => {
          if (!draft) return;
          this.api.saveUser({ ...draft, organization: org.id }).subscribe({
            next: () => {
              this.snack.open('Пользователь создан', 'OK', { duration: 2000 });
              this.loadOrgs(org.id);
            },
            error: (err) => this.snack.open(errorMessage(err), 'OK'),
          });
        });
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected toggleApprove(user: DirectoryUser): void {
    this.api.saveUser({ id: user.id, can_approve: !user.can_approve }).subscribe({
      next: () => {
        this.snack.open(user.can_approve ? 'Согласование снято' : 'Специалист может пропускать этапы', 'OK', { duration: 2000 });
        this.loadUsers();
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected toggle(user: DirectoryUser): void {
    const name = user.registry_name || user.username;
    const question = user.is_active
      ? `Заблокировать ${name}? Открытые задания, мероприятия и закреплённые счета перейдут другому сотруднику схемы.`
      : `Вернуть доступ ${name}?`;
    if (!window.confirm(question)) return;
    this.api.saveUser({ id: user.id, is_active: !user.is_active }).subscribe({
      next: () => {
        this.snack.open(user.is_active ? 'Пользователь заблокирован' : 'Доступ возвращён', 'OK', { duration: 2000 });
        this.loadUsers();
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  protected exportUsers(): void {
    const rows = this.users();
    const lines = [
      ['Пользователь', 'Логин', 'Роль', 'Статус', 'Последний вход'],
      ...rows.map((user) => [
        user.registry_name || user.username,
        user.username,
        this.roleLabel(user),
        user.is_active ? 'активен' : 'заблокирован',
        this.when(user.last_login),
      ]),
    ];
    const csv = lines.map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(';')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'users.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  private creatableRoles(): { id: Role; label: string }[] {
    const roles: { id: Role; label: string }[] = [
      { id: 'specialist', label: 'Специалист' },
      { id: 'observer', label: 'Наблюдатель' },
    ];
    if (this.auth.isSuperadmin()) roles.unshift({ id: 'local_admin', label: 'Локальный администратор' });
    return roles;
  }

  private loadOrgs(prefer?: number): void {
    this.api.organizations().subscribe({
      next: (page) => {
        this.orgs.set(page.results);
        const visible = this.visibleOrgs();
        const current = prefer ?? this.selectedId();
        this.selectedId.set(visible.find((org) => org.id === current)?.id ?? visible[0]?.id ?? null);
        this.loadUsers();
      },
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  private loadUsers(): void {
    const org = this.selectedId();
    if (org == null) {
      this.users.set([]);
      return;
    }
    this.api.directoryUsers({ organization: org, search: this.userQuery() }).subscribe({
      next: (page) => this.users.set(page.results),
      error: (err) => this.snack.open(errorMessage(err), 'OK'),
    });
  }

  private userQuery(): string {
    const q = this.query().trim();
    const org = this.selected();
    if (!q || !org) return '';
    const orgHit = [org.name, org.schema_name, org.local_admin_name].some((value) =>
      (value || '').toLowerCase().includes(q.toLowerCase()),
    );
    return orgHit ? '' : q;
  }

  private format(value: number): string {
    return new Intl.NumberFormat('ru-RU').format(value);
  }

  private plural(count: number, one: string, few: string, many: string): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }
}
