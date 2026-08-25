import { el, formatDate } from './dom.js';
import { buildShoppingList, tripToText } from '../core/shopping.js';

export function renderShopping(state, actions) {
  if (!state.plan) {
    return el('div', { class: 'card' }, el('p', { class: 'empty' }, '先に献立をつくってください。'));
  }
  const list = buildShoppingList(state.plan, state.settings.shoppingIntervalDays, state.pantry);
  const idx = Math.min(state.ui.tripIndex || 0, list.trips.length - 1);
  const trip = list.trips[idx];

  const body = el('div');
  const root = el('div');

  root.append(el('section', { class: 'card no-print' }, [
    el('h2', {}, '買い出しリスト'),
    el('p', { class: 'sub' },
      `${state.settings.shoppingIntervalDays}日ごと・全${list.trips.length}回。売り場の順に並べてあります。冷蔵庫の在庫は差し引き済みです。`),
    el('div', { class: 'trip-nav' }, list.trips.map((t, i) => el('button', {
      'aria-pressed': i === idx,
      onclick: () => actions.setUi({ tripIndex: i }, true),
    }, `${i + 1}. ${formatDate(t.date)}`))),
  ]));

  body.append(tripCard(state, trip, actions));
  root.append(body);

  if (list.pantryUsed.length) {
    root.append(el('section', { class: 'card no-print' }, [
      el('h2', {}, '冷蔵庫の在庫の扱い'),
      el('table', { class: 'mini' }, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, '食材'), el('th', { class: 'num' }, '在庫'),
          el('th', { class: 'num' }, '献立で使う'), el('th', { class: 'num' }, '残り'),
        ])),
        el('tbody', {}, list.pantryUsed.map((p) => el('tr', {}, [
          el('td', {}, p.name),
          el('td', { class: 'num' }, `${p.startGrams}g`),
          el('td', { class: 'num' }, `${p.usedGrams}g`),
          el('td', { class: 'num' }, p.usedUp
            ? el('span', { class: 'tag good' }, '使い切り')
            : `${p.leftoverGrams}g`),
        ]))),
      ]),
    ]));
  }
  return root;
}

function tripCard(state, trip, actions) {
  const checked = state.checkedItems;
  const warnings = trip.items.filter((i) => i.freshnessNote);

  const card = el('section', { class: 'card' }, [
    el('h2', {}, `${formatDate(trip.date, true)} の買い物`),
    el('p', { class: 'sub' }, `${formatDate(trip.coversUntil)} までの分 ・ ${trip.totalItems}品目`),
    warnings.length ? el('div', { class: 'notice warn' },
      `日持ちが足りない食材が${warnings.length}品あります。買い物の間隔を短くするか、その日の近くで買い足してください。`) : null,
    ...trip.byAisle.map((group) => el('div', { class: 'aisle' }, [
      el('h4', {}, group.label),
      ...group.items.map((it) => shopItem(it, trip.date, checked, actions)),
    ])),
    el('div', { class: 'row no-print', style: 'margin-top:8px' }, [
      el('button', { class: 'btn subtle', onclick: () => window.print() }, '印刷'),
      el('button', {
        class: 'btn subtle',
        onclick: async (e) => {
          await navigator.clipboard.writeText(tripToText(trip));
          e.target.textContent = 'コピーしました';
          setTimeout(() => { e.target.textContent = 'テキストでコピー'; }, 1600);
        },
      }, 'テキストでコピー'),
      el('button', {
        class: 'btn subtle',
        onclick: () => actions.update((s) => {
          trip.items.forEach((it) => { delete s.checkedItems[`${trip.date}:${it.ingredientId}`]; });
        }),
      }, 'チェックを外す'),
    ]),
  ]);
  return card;
}

function shopItem(it, date, checked, actions) {
  const key = `${date}:${it.ingredientId}`;
  const isDone = !!checked[key];
  const used = it.fromPantryGrams + it.fromStockGrams;
  return el('div', { class: `shop-item${isDone ? ' done' : ''}` }, [
    el('input', {
      type: 'checkbox', id: key, checked: isDone,
      onchange: (e) => actions.update((s) => {
        if (e.target.checked) s.checkedItems[key] = true;
        else delete s.checkedItems[key];
      }),
    }),
    el('label', { for: key }, [
      el('span', { class: 'qty' }, `${it.buyUnits}${it.unitName}`),
      ` ${it.name}`,
      el('span', { class: 'sub2' },
        `必要 約${it.needGrams}g${used > 0 ? ` ／ 手持ちから${used}g` : ''}${it.leftoverGrams > 0 ? ` ／ 余り約${it.leftoverGrams}g` : ''}`),
      it.freshnessNote ? el('span', { class: 'note' }, `⚠ ${it.freshnessNote}`) : null,
    ]),
  ]);
}
