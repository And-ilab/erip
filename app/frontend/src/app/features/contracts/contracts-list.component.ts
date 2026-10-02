import { DecimalPipe } from '@angular/common';
import { Component, HostListener, OnInit, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { Router } from '@angular/router';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import { ApiService, errorMessage } from '../../core/api.service';
import { CalendarBoardComponent, CalendarDraft, CalendarMode } from '../calendar/calendar-board.component';
import { AuthService } from '../../core/auth.service';
import {
  AccountService,
  CalendarEvent,
  ContractPerson,
  ContractSummary,
  DebtorCategory,
  MessageTemplate,
  SavedFilter,
  ServiceChoice,
} from '../../core/models';

type CustomField = 'group' | 'category' | 'stage' | 'billing';

@Component({
  selector: 'app-contracts-list',
  standalone: true,
  imports: [
    DecimalPipe, ReactiveFormsModule, MatTableModule, MatPaginatorModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatButtonModule, CalendarBoardComponent,
  ],
  template: `
    <div class="registry">
      <div class="control">
        <span class="crumb">Реестр договоров</span>
        <div class="search-wrap" (click)="$event.stopPropagation()">
          <div class="search" (click)="panelOpen.set(true)">
            @if (groups.value.length) {
              <button type="button" class="fchip" (click)="clearGroups($event)">Группа: {{ groups.value.join(', ') }} ×</button>
            }
            @if (category.value) {
              <button type="button" class="fchip" (click)="clearCategory($event)">Категория: {{ categoryLabel(category.value) }} ×</button>
            }
            @if (stage.value) {
              <button type="button" class="fchip" (click)="clearStage($event)">Этап: {{ stageLabel(stage.value) }} ×</button>
            }
            @if (billing.value) {
              <button type="button" class="fchip" (click)="clearBilling($event)">Организация: {{ billing.value }} ×</button>
            }
            @if (groupBy.value) {
              <button type="button" class="fchip" (click)="clearGroupByChip($event)">Группировать по: {{ groupByLabel(groupBy.value) }} ×</button>
            }
            <input
              [formControl]="search"
              placeholder="Поиск по ФИО, номеру ЛС, услуге, ИН, УНП…"
              (focus)="panelOpen.set(true)"
            />
            <button type="button" class="chevron" aria-label="Фильтры" [attr.aria-expanded]="panelOpen()" (click)="togglePanel($event)">▾</button>
          </div>
          @if (panelOpen()) {
            <div class="search-panel" role="dialog" aria-label="Фильтры реестра договоров">
              <div class="col">
                <div class="col-title">Фильтры</div>
                <div class="sub">Группа задолженности</div>
                <div class="pills">
                  @for (g of groupNumbers; track g) {
                    <button type="button" class="pill" [class.on]="groups.value.includes(g)" (click)="toggleGroup(g)">{{ g }}</button>
                  }
                </div>
                <div class="sub">Категория</div>
                @for (item of categories(); track item.id) {
                  <button type="button" class="menu-item" [class.on]="category.value === '' + item.id" (click)="setCategory(item.id)">{{ item.name }}</button>
                }
                <div class="sub">Этап</div>
                @for (item of stages; track item.id) {
                  <button type="button" class="menu-item" [class.on]="stage.value === item.id" (click)="setStage(item.id)">{{ item.label }}</button>
                }
                @if (auth.showServiceOrg()) {
                  <div class="sub">Обслуживающая организация</div>
                  <div class="save-row">
                    <input [formControl]="billing" placeholder="Название или код" (click)="$event.stopPropagation()" />
                  </div>
                }
                <button type="button" class="menu-add" (click)="customOpen.set(true)">+ Добавить пользовательский фильтр</button>
              </div>
              <div class="col">
                <div class="col-title">Группировать по</div>
                @for (item of groupChoices; track item.id) {
                  <button type="button" class="menu-item" [class.on]="groupBy.value === item.id" (click)="setGroupBy(item.id)">{{ item.label }}</button>
                }
              </div>
              <div class="col">
                <div class="col-title">Избранное</div>
                <div class="save-row">
                  <input [formControl]="filterName" placeholder="Имя фильтра" (click)="$event.stopPropagation()" />
                  <button type="button" (click)="remember()">Сохранить</button>
                </div>
                @for (item of saved(); track item.id) {
                  <button type="button" class="menu-item" (click)="apply(item)">★ {{ item.name }}</button>
                }
                @if (!saved().length) {
                  <p class="empty">Сохранённых наборов пока нет</p>
                }
              </div>
            </div>
          }
        </div>
        <div class="views">
          <button type="button" class="view-btn wide" [class.on]="view() === 'persons'" (click)="showPersons()">Лица</button>
          <button type="button" class="view-btn wide" [class.on]="view() === 'services'" (click)="showServices()">Услуги</button>
          <button type="button" class="view-btn" [class.on]="view() === 'kanban'" title="Канбан" (click)="showKanban()">▦</button>
          <button type="button" class="view-btn" [class.on]="view() === 'calendar'" title="Календарь" (click)="showCalendar()">▤</button>
        </div>
      </div>

      <div class="body">
        @if (summary(); as s) {
          <p class="hint">
            Лицевых счетов с задолженностью: <b>{{ s.ls_count }}</b>.
            Долг {{ s.principal | number: '1.2-2' }}, пеня {{ s.penalty | number: '1.2-2' }}.
            Мероприятия:
            @for (item of s.measures; track item.kind) { {{ item.kind }} {{ item.total }}; }
          </p>
        }
        @if (dial(); as rule) {
          <p class="hint">
            Обзвон: с {{ rule.dial_mobile_from_day }}-го числа и в выходные — только мобильный.
            @if (rule.dial_mobile_from_hour != null) {
              Часы только мобильного: {{ rule.dial_mobile_from_hour }}–{{ rule.dial_mobile_to_hour }}.
            }
          </p>
        }
        @if (auth.isSuperadmin()) {
          <div class="filters">
            <mat-form-field><mat-label>День месяца</mat-label><input matInput type="number" [formControl]="dialDay" /></mat-form-field>
            <mat-form-field><mat-label>Час с</mat-label><input matInput type="number" [formControl]="dialFrom" /></mat-form-field>
            <mat-form-field><mat-label>Час до</mat-label><input matInput type="number" [formControl]="dialTo" /></mat-form-field>
            <button mat-stroked-button (click)="saveDial()">Сохранить правило обзвона</button>
          </div>
        }
        @if (error()) { <p class="status-failed">{{ error() }}</p> }
        @if (view() === 'persons') {
          <table mat-table [dataSource]="persons()">
            <ng-container matColumnDef="payer"><th mat-header-cell *matHeaderCellDef>Должник</th><td mat-cell *matCellDef="let r">{{ r.payer }}</td></ng-container>
            <ng-container matColumnDef="payer_identifier"><th mat-header-cell *matHeaderCellDef>ИН</th><td mat-cell *matCellDef="let r">{{ r.payer_identifier }}</td></ng-container>
            <ng-container matColumnDef="payer_unp"><th mat-header-cell *matHeaderCellDef>УНП</th><td mat-cell *matCellDef="let r">{{ r.payer_unp }}</td></ng-container>
            <ng-container matColumnDef="ls_count"><th mat-header-cell *matHeaderCellDef>ЛС с долгом</th><td mat-cell *matCellDef="let r">{{ r.ls_count }}</td></ng-container>
            <ng-container matColumnDef="principal"><th mat-header-cell *matHeaderCellDef>Долг</th><td mat-cell *matCellDef="let r">{{ r.principal | number: '1.2-2' }}</td></ng-container>
            <ng-container matColumnDef="penalty"><th mat-header-cell *matHeaderCellDef>Пеня</th><td mat-cell *matCellDef="let r">{{ r.penalty | number: '1.2-2' }}</td></ng-container>
            <ng-container matColumnDef="earliest"><th mat-header-cell *matHeaderCellDef>Ранний период</th><td mat-cell *matCellDef="let r">{{ r.earliest }}</td></ng-container>
            <ng-container matColumnDef="category"><th mat-header-cell *matHeaderCellDef>Категория</th><td mat-cell *matCellDef="let r">{{ r.category }}</td></ng-container>
            <tr mat-header-row *matHeaderRowDef="personColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: personColumns" class="clickable-row" (click)="open(row.sample_id)"></tr>
          </table>
          <mat-paginator [length]="total()" [pageSize]="50" (page)="pageChanged($event)" />
        }
        @if (view() === 'services') {
          <table mat-table [dataSource]="rows()">
            <ng-container matColumnDef="payer"><th mat-header-cell *matHeaderCellDef>Должник</th><td mat-cell *matCellDef="let r">{{ r.payer }}</td></ng-container>
            <ng-container matColumnDef="payer_identifier"><th mat-header-cell *matHeaderCellDef>ИН</th><td mat-cell *matCellDef="let r">{{ r.payer_identifier }}</td></ng-container>
            <ng-container matColumnDef="payer_unp"><th mat-header-cell *matHeaderCellDef>УНП</th><td mat-cell *matCellDef="let r">{{ r.payer_unp }}</td></ng-container>
            <ng-container matColumnDef="account_number"><th mat-header-cell *matHeaderCellDef>ЛС</th><td mat-cell *matCellDef="let r">{{ r.account_number }}</td></ng-container>
            <ng-container matColumnDef="service_name"><th mat-header-cell *matHeaderCellDef>Услуга</th><td mat-cell *matCellDef="let r">{{ r.service_name }}</td></ng-container>
            <ng-container matColumnDef="shot_name"><th mat-header-cell *matHeaderCellDef>Поставщик</th><td mat-cell *matCellDef="let r">{{ r.shot_name }}</td></ng-container>
            <ng-container matColumnDef="billing_provider"><th mat-header-cell *matHeaderCellDef>Обслуживающая организация</th><td mat-cell *matCellDef="let r">{{ r.billing_provider }}</td></ng-container>
            <ng-container matColumnDef="schema_label"><th mat-header-cell *matHeaderCellDef>Схема</th><td mat-cell *matCellDef="let r">{{ r.schema_label }}</td></ng-container>
            <ng-container matColumnDef="balance_out"><th mat-header-cell *matHeaderCellDef>Долг</th><td mat-cell *matCellDef="let r">{{ r.balance_out | number: '1.2-2' }}</td></ng-container>
            <ng-container matColumnDef="balance_mulct_out"><th mat-header-cell *matHeaderCellDef>Пеня</th><td mat-cell *matCellDef="let r">{{ r.balance_mulct_out | number: '1.2-2' }}</td></ng-container>
            <ng-container matColumnDef="debt_started_on"><th mat-header-cell *matHeaderCellDef>Возникновение</th><td mat-cell *matCellDef="let r">{{ r.debt_started_on }}</td></ng-container>
            <ng-container matColumnDef="effective_group"><th mat-header-cell *matHeaderCellDef>Группа</th><td mat-cell *matCellDef="let r">{{ r.effective_group }}</td></ng-container>
            <ng-container matColumnDef="category_name"><th mat-header-cell *matHeaderCellDef>Категория</th><td mat-cell *matCellDef="let r">{{ r.category_name }}</td></ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns" class="clickable-row" (click)="open(row.id)"></tr>
          </table>
          <mat-paginator [length]="total()" [pageSize]="50" (page)="pageChanged($event)" />
        }
        @if (view() === 'kanban') {
          <div class="k-board">
            @for (column of kanban(); track column.stage) {
              <section class="k-col" [class.drop]="dropStage() === column.stage" [attr.data-stage]="column.stage"
                       (dragover)="allowDrop($event, column.stage)" (dragleave)="clearDrop(column.stage)" (drop)="dropOnStage($event, column.stage)">
                <h3><span>{{ column.title }}</span><b>{{ column.total }}</b></h3>
                @for (card of column.cards; track card.sample_id) {
                  <article class="k-card g{{ card.debt_group ?? 0 }}" [class.picked]="isSelected(card.sample_id)"
                           [draggable]="canMove()" (dragstart)="startCard($event, card)" (click)="openCard($event, card)">
                    <div class="name">{{ card.payer || 'Без наименования' }}</div>
                    @if (canMove()) {
                      <button type="button" class="more" aria-label="Сменить этап" (click)="toggleStage($event, card.sample_id)">
                        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2.5h4.5V7M13.2 2.8 7.2 8.8M7 3.5H3.5v9h9V9" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>
                      </button>
                    }
                    @if (stageMenu() === card.sample_id) {
                      <div class="stage-menu" (click)="$event.stopPropagation()">
                        @for (item of stages; track item.id) {
                          <button type="button" [class.on]="column.stage === item.id" (click)="move(card, item.id)">{{ item.label }}</button>
                        }
                      </div>
                    }
                    <div class="line">{{ personId(card) }} · {{ card.ls_count }} ЛС · {{ card.service_count || 1 }} усл.</div>
                    @if (card.service_name) {
                      <div class="line">{{ card.service_name }}</div>
                    }
                    @if (card.address) {
                      <div class="line">{{ street(card.address) }}</div>
                    }
                    <div class="group-line">
                      <span class="letter">{{ card.debt_group || '—' }}</span>
                      <span>Группа {{ card.debt_group || '—' }}@if (card.category) { · {{ card.category }} }</span>
                    </div>
                    <div class="money">{{ money(card.principal) }} р. <small>+ пени {{ money(card.penalty) }} р.</small></div>
                    <div class="foot"><span class="when">{{ cardMark(card) }}</span></div>
                  </article>
                }
              </section>
            }
          </div>
        }
        @if (view() === 'calendar') {
          <app-calendar-board
            [events]="events()" [from]="spanFrom" [mode]="calendarMode" [canCreate]="auth.canWrite()"
            [supplier]="auth.me()?.contour === 'supplier'" [templates]="templates()" [serviceChoices]="serviceChoices()"
            (modeChange)="calendarMode = $event" (spanChange)="setSpan($event)" (openEvent)="openCalendarEvent($event)"
            (createEvent)="submitCalendar($event)" (filters)="panelOpen.set(true)" />
        }
        @if (view() === 'grouped') {
          <table mat-table [dataSource]="groupsRows()">
            <ng-container matColumnDef="value"><th mat-header-cell *matHeaderCellDef>Значение</th><td mat-cell *matCellDef="let r">{{ r.value }}</td></ng-container>
            <ng-container matColumnDef="accounts"><th mat-header-cell *matHeaderCellDef>ЛС</th><td mat-cell *matCellDef="let r">{{ r.accounts }}</td></ng-container>
            <ng-container matColumnDef="debt"><th mat-header-cell *matHeaderCellDef>Долг</th><td mat-cell *matCellDef="let r">{{ r.debt | number: '1.2-2' }}</td></ng-container>
            <ng-container matColumnDef="penalty"><th mat-header-cell *matHeaderCellDef>Пеня</th><td mat-cell *matCellDef="let r">{{ r.penalty | number: '1.2-2' }}</td></ng-container>
            <tr mat-header-row *matHeaderRowDef="groupColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: groupColumns"></tr>
          </table>
        }
      </div>

      @if (customOpen()) {
        <div class="backdrop" (click)="customOpen.set(false)">
          <div class="dialog" (click)="$event.stopPropagation()" role="dialog" aria-label="Пользовательский фильтр">
            <h3>Добавить пользовательский фильтр</h3>
            <p class="hint">Одно условие: группа, категория, этап{{ auth.showServiceOrg() ? ' или обслуживающая организация' : '' }}.</p>
            <div class="filters">
              <mat-form-field>
                <mat-label>Поле</mat-label>
                <mat-select [formControl]="customField">
                  <mat-option value="group">Группа задолженности</mat-option>
                  <mat-option value="category">Категория</mat-option>
                  <mat-option value="stage">Этап воронки</mat-option>
                  @if (auth.showServiceOrg()) {
                    <mat-option value="billing">Обслуживающая организация</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              @if (customField.value === 'billing') {
                <mat-form-field>
                  <mat-label>Название или код</mat-label>
                  <input matInput [formControl]="customValue" />
                </mat-form-field>
              } @else {
                <mat-form-field>
                  <mat-label>Значение</mat-label>
                  <mat-select [formControl]="customValue">
                    @if (customField.value === 'group') {
                      @for (g of groupNumbers; track g) { <mat-option [value]="'' + g">Группа {{ g }}</mat-option> }
                    }
                    @if (customField.value === 'category') {
                      @for (item of categories(); track item.id) { <mat-option [value]="'' + item.id">{{ item.name }}</mat-option> }
                    }
                    @if (customField.value === 'stage') {
                      @for (item of stages; track item.id) { <mat-option [value]="item.id">{{ item.label }}</mat-option> }
                    }
                  </mat-select>
                </mat-form-field>
              }
            </div>
            <div class="dialog-actions">
              <button mat-flat-button color="primary" type="button" (click)="addCustom()">Добавить</button>
              <button mat-stroked-button type="button" (click)="customOpen.set(false)">Отмена</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .control {
      display: flex; align-items: center; gap: 12px; height: 52px; padding: 0 16px;
      background: #f7f9fb; border-bottom: 1px solid var(--erip-border);
    }
    .crumb { color: var(--erip-muted); font-size: 13px; white-space: nowrap; }
    .search-wrap { position: relative; flex: 1; min-width: 0; }
    .search {
      display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 8px;
      background: #fff; border: 1px solid #d8dce0; border-radius: 4px;
    }
    .search input {
      flex: 1; min-width: 80px; border: 0; outline: none; background: transparent;
      font: inherit; font-size: 13px; color: #1f2933;
    }
    .fchip {
      border: 0; background: var(--erip-primary-soft); color: var(--erip-primary);
      border-radius: 3px; font-size: 12px; padding: 2px 8px; cursor: pointer; white-space: nowrap;
    }
    .chevron { border: 0; background: transparent; color: var(--erip-muted); cursor: pointer; font-size: 12px; padding: 4px; }
    .search-panel {
      position: absolute; z-index: 30; top: calc(100% + 4px); left: 0;
      display: grid; grid-template-columns: 1.2fr .9fr .9fr; width: min(860px, 100%);
      background: #fff; border: 1px solid var(--erip-border); border-radius: 6px;
      box-shadow: 0 8px 24px rgba(16, 42, 67, .16); max-height: 70vh;
    }
    .col { padding: 8px 0 12px; min-width: 0; overflow: auto; }
    .col + .col { border-left: 1px solid var(--erip-border); }
    .col-title {
      padding: 6px 16px 8px; font-size: 11px; font-weight: 700; letter-spacing: .04em;
      text-transform: uppercase; color: var(--erip-muted);
    }
    .sub { padding: 4px 16px; font-size: 12px; color: var(--erip-muted); }
    .pills { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 16px 8px; }
    .pill, .menu-item, .menu-add, .save-row button, .view-btn { font: inherit; cursor: pointer; }
    .pill {
      min-width: 28px; height: 28px; padding: 0 8px; border: 1px solid var(--erip-border); border-radius: 4px;
      background: #fff; color: #1f2933;
    }
    .pill.on, .menu-item.on { background: var(--erip-primary-soft); color: var(--erip-primary); font-weight: 600; border-color: transparent; }
    .menu-item, .menu-add {
      display: block; width: 100%; text-align: left; border: 0; background: transparent;
      padding: 6px 16px; font-size: 13px; color: #1f2933;
    }
    .menu-item:hover, .menu-add:hover, .pill:hover { background: #f3f6f8; }
    .menu-add { color: var(--erip-link); }
    .save-row { display: flex; gap: 6px; padding: 0 12px 8px; }
    .save-row input {
      flex: 1; min-width: 0; height: 30px; border: 1px solid var(--erip-border); border-radius: 4px; padding: 0 8px; font: inherit;
    }
    .save-row button {
      height: 30px; padding: 0 10px; border: 0; border-radius: 4px; background: var(--erip-primary); color: #fff; font-size: 13px;
    }
    .empty { margin: 4px 16px; font-size: 12px; color: var(--erip-muted); }
    .view-btn {
      height: 32px; border: 1px solid #d8dce0; border-radius: 4px; background: #fff; color: #374151; width: 32px; font-size: 14px;
    }
    .view-btn.wide { width: auto; padding: 0 10px; font-size: 13px; }
    .view-btn.on { background: var(--erip-primary); color: #fff; border-color: var(--erip-primary); }
    .views { display: flex; gap: 4px; }
    .hint { margin: 0 0 8px; font-size: 13px; color: var(--erip-muted); }
    .body { padding: 16px 24px; }
    .k-board { display: flex; gap: 14px; overflow: auto; align-items: flex-start; padding-bottom: 12px; }
    .k-col { width: 268px; flex: 0 0 268px; }
    .k-col h3 {
      display: flex; justify-content: space-between; align-items: baseline; gap: 8px;
      margin: 0 0 8px; padding: 0 2px 6px; border-bottom: 3px solid #cbd5e1;
      font-size: 13px; font-weight: 600; color: #243140;
    }
    .k-col h3 b { font-weight: 600; color: #8b95a1; }
    .k-col[data-stage="new"] h3 { border-bottom-color: #1f9d55; }
    .k-col[data-stage="prevention"] h3 { border-bottom-color: #2563eb; }
    .k-col[data-stage="warning"] h3 { border-bottom-color: #e0a106; }
    .k-col[data-stage="disconnect"] h3 { border-bottom-color: #f08c2e; }
    .k-col[data-stage="enforcement"] h3 { border-bottom-color: #e53935; }
    .k-col[data-stage="court"] h3 { border-bottom-color: #8e2430; }
    .k-col[data-stage="closed"] h3 { border-bottom-color: #9ca3af; }
    .k-col.drop { outline: 2px dashed var(--erip-primary); outline-offset: 2px; border-radius: 8px; }
    .k-card {
      position: relative; background: #fff; border: 1px solid #e6ebf0; border-left: 3px solid #cbd5e1; border-radius: 8px;
      padding: 10px 12px 8px; margin-bottom: 8px; cursor: pointer; box-shadow: 0 1px 2px rgba(16, 42, 67, .06);
    }
    .k-card[draggable="true"] { cursor: grab; }
    .k-card:hover { box-shadow: 0 2px 8px rgba(16, 42, 67, .12); }
    .k-card.picked { background: #e7f4f1; }
    .k-card .name { padding-right: 18px; }
    .k-card .more {
      position: absolute; top: 8px; right: 8px; width: 18px; height: 18px; padding: 0; border: 0;
      background: transparent; color: #9aa3ad; cursor: pointer;
    }
    .k-card .more svg { width: 14px; height: 14px; display: block; }
    .stage-menu {
      position: absolute; z-index: 5; top: 28px; right: 8px; min-width: 180px; padding: 4px;
      background: #fff; border: 1px solid var(--erip-border); border-radius: 6px;
      box-shadow: 0 8px 20px rgba(16, 42, 67, .16);
    }
    .stage-menu button {
      display: block; width: 100%; text-align: left; border: 0; background: transparent;
      padding: 6px 8px; font: inherit; font-size: 12px; border-radius: 4px; cursor: pointer;
    }
    .stage-menu button.on, .stage-menu button:hover { background: #f3f6f8; }
    .k-card.g1 { border-left-color: #1f9d55; } .k-card.g2 { border-left-color: #c8962e; }
    .k-card.g3 { border-left-color: #ef6c00; } .k-card.g4 { border-left-color: #e53935; }
    .k-card.g5 { border-left-color: #c62828; } .k-card.g6 { border-left-color: #7f1d1d; }
    .k-card .name { font-weight: 700; font-size: 14px; line-height: 1.25; color: #1f2933; }
    .k-card .line, .k-card .when { margin-top: 3px; font-size: 12px; color: #6b7280; }
    .k-card .group-line { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 12px; font-weight: 600; }
    .k-card .letter {
      width: 18px; height: 18px; border-radius: 50%; color: #fff; font-size: 11px; font-weight: 700;
      display: grid; place-items: center; background: #9ca3af;
    }
    .k-card.g1 .group-line { color: #1f9d55; } .k-card.g1 .letter { background: #1f9d55; }
    .k-card.g2 .group-line { color: #a16207; } .k-card.g2 .letter { background: #c8962e; }
    .k-card.g3 .group-line { color: #ef6c00; } .k-card.g3 .letter { background: #ef6c00; }
    .k-card.g4 .group-line { color: #e53935; } .k-card.g4 .letter { background: #e53935; }
    .k-card.g5 .group-line { color: #c62828; } .k-card.g5 .letter { background: #c62828; }
    .k-card.g6 .group-line { color: #7f1d1d; } .k-card.g6 .letter { background: #7f1d1d; }
    .k-card .money { margin-top: 6px; font-size: 13px; font-weight: 700; }
    .k-card .money small { font-weight: 400; color: #6b7280; }
    .muted { color: var(--erip-muted); font-size: 12px; }
    .backdrop {
      position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center;
      background: rgba(20, 40, 55, .35);
    }
    .dialog { width: min(560px, calc(100vw - 32px)); background: #fff; border-radius: 8px; padding: 20px; box-shadow: 0 12px 32px rgba(16, 42, 67, .2); }
    .dialog h3 { margin: 0 0 8px; color: var(--erip-primary-dark); }
    .dialog-actions { display: flex; gap: 8px; margin-top: 8px; }
  `,
})
export class ContractsListComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  protected readonly groupNumbers = [1, 2, 3, 4, 5, 6];
  protected readonly stages = [
    { id: 'new', label: 'Новый должник' },
    { id: 'prevention', label: 'Автообзвон/уведомления' },
    { id: 'warning', label: 'Предупреждение вручено' },
    { id: 'disconnect', label: 'Отключение услуг' },
    { id: 'enforcement', label: 'Испол. надпись / иск' },
    { id: 'court', label: 'ОПИ' },
    { id: 'closed', label: 'Не должник' },
  ];
  protected readonly groupOptions = [
    { id: 'debt_group', label: 'Группа' },
    { id: 'provider', label: 'Поставщик' },
    { id: 'billing', label: 'Обслуживающая организация' },
    { id: 'category', label: 'Категория' },
  ];
  protected readonly personColumns = [
    'payer', 'payer_identifier', 'payer_unp', 'ls_count', 'principal', 'penalty', 'earliest', 'category',
  ];
  protected readonly columns = this.serviceColumns();
  protected readonly groupChoices = this.contractGroupChoices();
  protected readonly groupColumns = ['value', 'accounts', 'debt', 'penalty'];
  protected readonly view = signal<'persons' | 'services' | 'kanban' | 'calendar' | 'grouped'>('persons');
  protected readonly panelOpen = signal(false);
  protected readonly customOpen = signal(false);
  protected readonly persons = signal<ContractPerson[]>([]);
  protected readonly rows = signal<AccountService[]>([]);
  protected readonly kanban = signal<{ stage: string; title: string; total: number; cards: ContractPerson[] }[]>([]);
  protected readonly events = signal<CalendarEvent[]>([]);
  protected readonly groupsRows = signal<{ value: string; accounts: number; debt: string | null; penalty: string | null }[]>([]);
  protected readonly summary = signal<ContractSummary | null>(null);
  protected readonly dial = signal<{ dial_mobile_from_day: number; dial_mobile_from_hour: number | null; dial_mobile_to_hour: number | null } | null>(null);
  protected readonly categories = signal<DebtorCategory[]>([]);
  protected readonly saved = signal<SavedFilter[]>([]);
  protected readonly total = signal(0);
  protected readonly error = signal('');
  protected readonly stageMenu = signal<number | null>(null);
  protected readonly dropStage = signal<string | null>(null);
  protected readonly selected = signal<Set<number>>(new Set());
  private cardDragged = false;
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly groups = new FormControl<number[]>([], { nonNullable: true });
  protected readonly category = new FormControl('', { nonNullable: true });
  protected readonly stage = new FormControl('', { nonNullable: true });
  protected readonly billing = new FormControl('', { nonNullable: true });
  protected readonly filterName = new FormControl('', { nonNullable: true });
  protected readonly groupBy = new FormControl('', { nonNullable: true });
  protected readonly customField = new FormControl<CustomField>('group', { nonNullable: true });
  protected readonly customValue = new FormControl('', { nonNullable: true });
  protected readonly dialDay = new FormControl(25, { nonNullable: true });
  protected readonly dialFrom = new FormControl<number | null>(null);
  protected readonly dialTo = new FormControl<number | null>(null);
  protected spanFrom = monthStart();
  protected spanTo = monthEnd();
  protected calendarMode: CalendarMode = 'month';
  protected readonly templates = signal<MessageTemplate[]>([]);
  protected readonly serviceChoices = signal<ServiceChoice[]>([]);
  private page = 1;

  @HostListener('document:click')
  protected closeSearch(): void {
    this.panelOpen.set(false);
    this.stageMenu.set(null);
  }

  ngOnInit(): void {
    this.search.valueChanges.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => this.reload());
    this.groups.valueChanges.subscribe(() => this.reload());
    this.category.valueChanges.subscribe(() => this.reload());
    this.stage.valueChanges.subscribe(() => this.reload());
    this.billing.valueChanges.pipe(debounceTime(300)).subscribe(() => this.reload());
    this.groupBy.valueChanges.subscribe((value) => {
      if (value) this.showGrouped();
      else if (this.view() === 'grouped') this.showPersons();
    });
    this.customField.valueChanges.subscribe(() => this.customValue.setValue(''));
    this.api.categories().subscribe((page) => this.categories.set(page.results));
    this.api.savedFilters('contracts').subscribe((page) => this.saved.set(page.results));
    this.api.dialSettings().subscribe((rule) => {
      this.dial.set(rule);
      this.dialDay.setValue(rule.dial_mobile_from_day);
      this.dialFrom.setValue(rule.dial_mobile_from_hour);
      this.dialTo.setValue(rule.dial_mobile_to_hour);
    });
    this.reload();
  }

  private serviceColumns(): string[] {
    const columns = ['payer', 'payer_identifier', 'payer_unp', 'account_number', 'service_name'];
    if (this.auth.showSupplier()) columns.push('shot_name');
    if (this.auth.showServiceOrg()) columns.push('billing_provider');
    if (this.auth.showSchema()) columns.push('schema_label');
    columns.push('balance_out', 'balance_mulct_out', 'debt_started_on', 'effective_group', 'category_name');
    return columns;
  }

  private contractGroupChoices(): { id: string; label: string }[] {
    return this.groupOptions.filter((item) => {
      if (item.id === 'provider') return this.auth.showSupplier();
      if (item.id === 'billing') return this.auth.showServiceOrg();
      return true;
    });
  }

  stageLabel(id: string): string {
    return this.stages.find((item) => item.id === id)?.label ?? id;
  }

  categoryLabel(id: string): string {
    return this.categories().find((item) => String(item.id) === id)?.name ?? id;
  }

  groupByLabel(id: string): string {
    return this.groupOptions.find((item) => item.id === id)?.label ?? id;
  }

  togglePanel(event: Event): void {
    event.stopPropagation();
    this.panelOpen.update((open) => !open);
  }

  toggleGroup(group: number): void {
    const current = this.groups.value;
    const next = current.includes(group) ? current.filter((item) => item !== group) : [...current, group].sort((a, b) => a - b);
    this.groups.setValue(next);
  }

  setCategory(id: number): void {
    const value = String(id);
    this.category.setValue(this.category.value === value ? '' : value);
  }

  setStage(id: string): void {
    this.stage.setValue(this.stage.value === id ? '' : id);
  }

  setGroupBy(id: string): void {
    this.groupBy.setValue(this.groupBy.value === id ? '' : id);
  }

  clearGroups(event: Event): void {
    event.stopPropagation();
    this.groups.setValue([]);
  }

  clearCategory(event: Event): void {
    event.stopPropagation();
    this.category.setValue('');
  }

  clearStage(event: Event): void {
    event.stopPropagation();
    this.stage.setValue('');
  }

  clearBilling(event: Event): void {
    event.stopPropagation();
    this.billing.setValue('');
  }

  clearGroupByChip(event: Event): void {
    event.stopPropagation();
    this.groupBy.setValue('');
  }

  addCustom(): void {
    const value = this.customValue.value.trim();
    if (!value) return;
    if (this.customField.value === 'group') {
      const group = Number(value);
      if (!this.groups.value.includes(group)) this.toggleGroup(group);
    }
    if (this.customField.value === 'category') this.category.setValue(value);
    if (this.customField.value === 'stage') this.stage.setValue(value);
    if (this.customField.value === 'billing') this.billing.setValue(value);
    this.customOpen.set(false);
  }

  pageChanged(event: PageEvent): void {
    this.page = event.pageIndex + 1;
    this.reload();
  }

  protected money(value: string | null): string {
    const number = Number(value ?? 0);
    if (Number.isNaN(number)) return '0,00';
    return number.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  open(id: number): void {
    this.router.navigate(['/contracts', id]);
  }

  protected canMove(): boolean {
    const me = this.auth.me();
    return !!me && me.role !== 'observer' && me.contour !== 'supplier';
  }

  protected isSelected(id: number): boolean {
    return this.selected().has(id);
  }

  protected startCard(event: DragEvent, card: ContractPerson): void {
    if (!this.canMove()) {
      event.preventDefault();
      return;
    }
    this.cardDragged = true;
    const cards = this.selected().has(card.sample_id) ? [...this.selected()] : [card.sample_id];
    event.dataTransfer?.setData('text/plain', cards.join(','));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    event.stopPropagation();
  }

  protected allowDrop(event: DragEvent, stage: string): void {
    if (!this.canMove()) return;
    event.preventDefault();
    this.dropStage.set(stage);
  }

  protected clearDrop(stage: string): void {
    if (this.dropStage() === stage) this.dropStage.set(null);
  }

  protected dropOnStage(event: DragEvent, stage: string): void {
    event.preventDefault();
    this.dropStage.set(null);
    if (!this.canMove()) return;
    const raw = event.dataTransfer?.getData('text/plain') || '';
    const sampleIds = raw.split(',').map((part) => Number(part)).filter((id) => id > 0);
    const accountIds = this.accountIds(sampleIds);
    if (accountIds.length) this.moveAccounts(accountIds, stage);
  }

  protected openCard(event: MouseEvent, card: ContractPerson): void {
    if (this.cardDragged) {
      this.cardDragged = false;
      return;
    }
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      event.stopPropagation();
      const next = new Set(this.selected());
      if (next.has(card.sample_id)) next.delete(card.sample_id);
      else next.add(card.sample_id);
      this.selected.set(next);
      return;
    }
    this.open(card.sample_id);
  }

  protected toggleStage(event: Event, id: number): void {
    event.stopPropagation();
    this.stageMenu.update((open) => open === id ? null : id);
  }

  move(card: ContractPerson, stage: string): void {
    this.moveAccounts(card.account_ids || [], stage);
  }

  private accountIds(sampleIds: number[]): number[] {
    const wanted = new Set(sampleIds);
    const ids = new Set<number>();
    for (const column of this.kanban()) {
      for (const card of column.cards) {
        if (!wanted.has(card.sample_id)) continue;
        for (const id of card.account_ids || []) ids.add(id);
      }
    }
    return [...ids];
  }

  private moveAccounts(ids: number[], stage: string): void {
    this.stageMenu.set(null);
    if (!ids.length) return;
    this.api.contractStage(ids, stage).subscribe({
      next: () => {
        this.selected.set(new Set());
        this.showKanban();
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  showPersons(): void {
    this.dropGrouping();
    this.view.set('persons');
    this.reload();
  }

  showServices(): void {
    this.dropGrouping();
    this.view.set('services');
    this.reload();
  }

  showKanban(): void {
    this.dropGrouping();
    this.view.set('kanban');
    this.api.contractKanban(this.query()).subscribe({
      next: (columns) => this.kanban.set(columns),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  showCalendar(): void {
    this.dropGrouping();
    this.view.set('calendar');
    if (!this.templates().length) {
      this.api.templates({ is_active: true, page_size: 200 }).subscribe((page) => this.templates.set(page.results));
      this.api.serviceChoices().subscribe((page) => this.serviceChoices.set(page.results));
    }
    this.api.contractCalendar({ date_from: this.spanFrom, date_to: this.spanTo }, this.query()).subscribe({
      next: (rows) => this.events.set(rows),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  showGrouped(): void {
    this.view.set('grouped');
    this.api.contractGrouped({ ...this.query(), group_by: this.groupBy.value }).subscribe({
      next: (rows) => this.groupsRows.set(rows),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  setSpan(span: { from: string; to: string }): void {
    this.spanFrom = span.from;
    this.spanTo = span.to;
    if (this.view() === 'calendar') this.showCalendar();
  }

  protected openCalendarEvent(event: CalendarEvent): void {
    if (event.measure_id) this.router.navigate(['/measures', event.measure_id]);
    else if (event.contract_id) this.router.navigate(['/contracts', event.contract_id]);
    else if (event.account_id) this.router.navigate(['/accounts', event.account_id]);
  }

  protected submitCalendar(draft: CalendarDraft): void {
    const body: Record<string, unknown> = { kind: draft.kind, due_on: draft.date, started_on: draft.date };
    if (draft.template_name) body['template_name'] = draft.template_name;
    if (draft.catalog_service_ids) body['catalog_service_ids'] = draft.catalog_service_ids;
    if (draft.channel) body['channel'] = draft.channel;
    if (draft.time_from) {
      body['time_from'] = draft.time_from;
      body['time_to'] = draft.time_to;
      body['days'] = draft.days;
    }
    if (draft.scenario_name) body['scenario_name'] = draft.scenario_name;
    if (draft.assignee) body['assignee'] = draft.assignee;
    this.api.contractEvent(body, this.query()).subscribe({
      next: () => this.showCalendar(),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  protected personId(card: ContractPerson): string {
    if (card.payer_identifier) return `ИН ${card.payer_identifier}`;
    if (card.payer_unp) return `УНП ${card.payer_unp}`;
    return 'без ИН';
  }

  protected cardMark(card: ContractPerson): string {
    if (card.due_on) return `срок ${card.due_on}`;
    if (card.earliest) return `долг с ${card.earliest}`;
    return 'срок не задан';
  }

  protected street(address: string): string {
    const lower = address.toLowerCase();
    const marks = ['ул.', 'ул ', 'пр-т', 'пр.', 'просп', 'пер.', 'б-р', 'тракт', 'пл.', 'ш.'];
    let cut = -1;
    for (const mark of marks) {
      const index = lower.indexOf(mark);
      if (index >= 0 && (cut < 0 || index < cut)) cut = index;
    }
    return (cut >= 0 ? address.slice(cut) : address).replace(/\s+/g, ' ').trim();
  }

  remember(): void {
    const name = this.filterName.value.trim();
    if (!name) return;
    this.api.saveFilter({
      name,
      target: 'contracts',
      query: { ...this.query(), group_by: this.groupBy.value },
    }).subscribe({
      next: () => {
        this.filterName.setValue('');
        this.api.savedFilters('contracts').subscribe((page) => this.saved.set(page.results));
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  apply(item: SavedFilter): void {
    const query = item.query;
    this.search.setValue(String(query['search'] ?? ''), { emitEvent: false });
    this.category.setValue(String(query['debtor_category'] ?? ''), { emitEvent: false });
    this.stage.setValue(String(query['funnel_stage'] ?? ''), { emitEvent: false });
    this.billing.setValue(String(query['billing_provider'] ?? ''), { emitEvent: false });
    const raw = String(query['debt_group__in'] ?? '');
    this.groups.setValue(raw ? raw.split(',').map(Number).filter((item) => item > 0) : [], { emitEvent: false });
    this.groupBy.setValue(String(query['group_by'] ?? ''), { emitEvent: false });
    this.panelOpen.set(false);
    if (this.groupBy.value) this.showGrouped();
    else this.reload();
  }

  saveDial(): void {
    this.api.saveDialSettings({
      dial_mobile_from_day: this.dialDay.value,
      dial_mobile_from_hour: this.dialFrom.value,
      dial_mobile_to_hour: this.dialTo.value,
    }).subscribe({
      next: (rule) => this.dial.set(rule),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  private dropGrouping(): void {
    if (this.groupBy.value) this.groupBy.setValue('', { emitEvent: false });
  }

  private reload(): void {
    const params = { ...this.query(), page: this.page, page_size: 50 };
    this.api.contractSummary(this.query()).subscribe({
      next: (row) => this.summary.set(row),
      error: (e) => this.error.set(errorMessage(e)),
    });
    if (this.view() === 'kanban') {
      this.showKanban();
      return;
    }
    if (this.view() === 'calendar') {
      this.showCalendar();
      return;
    }
    if (this.groupBy.value || this.view() === 'grouped') {
      this.showGrouped();
      return;
    }
    if (this.view() === 'persons') {
      this.api.contractPersons(params).subscribe({
        next: (result) => {
          this.persons.set(result.results);
          this.total.set(result.count);
          this.error.set('');
        },
        error: (e) => this.error.set(errorMessage(e)),
      });
    }
    if (this.view() === 'services') {
      this.api.contracts(params).subscribe({
        next: (result) => {
          this.rows.set(result.results);
          this.total.set(result.count);
          this.error.set('');
        },
        error: (e) => this.error.set(errorMessage(e)),
      });
    }
  }

  private query(): Record<string, string | number | null> {
    return {
      search: this.search.value,
      debt_group__in: this.groups.value.join(','),
      debtor_category: this.category.value,
      funnel_stage: this.stage.value,
      billing_provider: this.billing.value,
    };
  }
}

function monthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function monthEnd(): string {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}
