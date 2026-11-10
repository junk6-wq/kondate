import { el, formatDate, todayISO } from './dom.js';
import { buildShoppingList, tripToText } from '../core/shopping.js';

export function renderShopping(state, actions) {
  if (!state.plan) {
    return el('div', { class: 'card' }, [
      el('p', { class: 'empty' }, '献立をつくると、買い出しリストがここに出ます。'),
      el('div', { class: 'row', style: 'justify-content:center' },
        el('button', { class: 'btn', onclick: () => actions.goto('plan') }, '献立をつくる')),
    ]);
  }
  const list = buildShoppingList(state.plan, state.settings.shoppingIntervalDays, state.pantry);
  const current = currentTripIndex(list.trips);
  const idx = Math.min(state.ui.tripIndex ?? current, list.trips.length - 1);
  const trip = list.trips[idx];
  const root = el('div');

  root.append(el('section', { class: 'card no-print' }, [
    el('h2', {}, '買い出しリスト'),
    el('p', { class: 'sub' },
      `${intervalLabel(state.settings.shoppingIntervalDays)}・全${list.trips.length}回。売り場の順に並べてあります。冷蔵庫の在庫は差し引き済みです。`),
    el('div', { class: 'trip-nav' }, list.trips.map((t, i) => el('button', {
      'aria-pressed': i === idx,
      onclick: () => actions.setUi({ tripIndex: i }, true),
    }, `${i + 1}回目 ${formatDate(t.date)}${i === current ? '（今回）' : ''}`))),
  ]));

  root.append(tripCard(state, trip, actions));

  if (list.pantryUsed.length) {
    root.append(el('details', { class: 'card fold no-print' }, [
      el('summary', {}, '冷蔵庫の在庫の扱い'),
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

/** 今日までに来ている買い物日のうち、いちばん新しい回。まだ始まっていなければ1回目。 */
function currentTripIndex(trips) {
  const today = todayISO();
  let idx = 0;
  trips.forEach((t, i) => { if (t.date <= today) idx = i; });
  return idx;
}

function intervalLabel(days) {
  return days === 7 ? '週1回' : days === 14 ? '2週に1回' : `${days}日に1回`;
}

function tripCard(state, trip, actions) {
  const checked = state.checkedItems;
  const keyOf = (it) => `${trip.date}:${it.ingredientId}`;
  const warnings = trip.items.filter((i) => i.freshnessNote);
  const doneCount = trip.items.filter((it) => checked[keyOf(it)]).length;
  const hideDone = !!state.ui.hideDone;
  const allDone = trip.totalItems > 0 && doneCount === trip.totalItems;

  const groups = trip.byAisle
    .map((group) => ({
      ...group,
      // 買ったものを消すのは「隠す」を選んだときだけ。押した瞬間に行が動くと、
      // 続けて押そうとした隣の行を押し間違える。
      shown: hideDone ? group.items.filter((it) => !checked[keyOf(it)]) : group.items,
    }))
    .filter((group) => group.shown.length);

  return el('section', { class: 'card' }, [
    el('h2', {}, `${formatDate(trip.date, true)} の買い物`),
    el('p', { class: 'sub' }, `${formatDate(trip.coversUntil)} までの分 ・ ${trip.totalItems}品目`),
    el('div', { class: 'progress no-print' }, [
      el('div', { class: 'bar' }, el('i', { style: `width:${trip.totalItems ? (doneCount / trip.totalItems) * 100 : 0}%` })),
      el('span', { class: 'progress-text' }, allDone ? 'ぜんぶ買いました' : `${doneCount} / ${trip.totalItems} 買った`),
      el('button', {
        class: 'btn subtle small', 'aria-pressed': hideDone,
        onclick: () => actions.setUi({ hideDone: !hideDone }),
      }, hideDone ? '買ったものも出す' : '買ったものを隠す'),
    ]),
    warnings.length ? el('div', { class: 'notice warn' },
      `日持ちが足りない食材が${warnings.length}品あります。買い物の間隔を短くするか、その日の近くで買い足してください。`) : null,
    ...groups.map((group) => el('div', { class: 'aisle' }, [
      el('h4', {}, group.label),
      ...group.shown.map((it) => shopItem(it, keyOf(it), !!checked[keyOf(it)], actions)),
    ])),
    hideDone && !groups.length && trip.totalItems
      ? el('p', { class: 'empty' }, 'この回の買い物は終わりです。') : null,
    el('div', { class: 'row no-print', style: 'margin-top:12px' }, [
      el('button', {
        class: 'btn subtle',
        onclick: async (e) => {
          const label = 'テキストでコピー';
          try {
            await navigator.clipboard.writeText(tripToText(trip));
            e.target.textContent = 'コピーしました';
          } catch {
            e.target.textContent = 'コピーできませんでした';
          }
          setTimeout(() => { e.target.textContent = label; }, 1600);
        },
      }, 'テキストでコピー'),
      el('button', { class: 'btn subtle', onclick: () => window.print() }, '印刷'),
      doneCount ? el('button', {
        class: 'btn subtle',
        onclick: () => actions.update((s) => {
          trip.items.forEach((it) => { delete s.checkedItems[keyOf(it)]; });
        }),
      }, 'チェックを全部外す') : null,
    ]),
  ]);
}

// 行のどこを押してもチェックが付くよう、行そのものを label にしている。
function shopItem(it, key, isDone, actions) {
  const used = it.fromPantryGrams + it.fromStockGrams;
  return el('label', { class: `shop-item${isDone ? ' done' : ''}` }, [
    el('input', {
      type: 'checkbox', checked: isDone,
      onchange: (e) => actions.update((s) => {
        if (e.target.checked) s.checkedItems[key] = true;
        else delete s.checkedItems[key];
      }),
    }),
    el('span', { class: 'shop-body' }, [
      el('span', { class: 'shop-name' }, [it.name, el('span', { class: 'qty' }, `${it.buyUnits}${it.unitName}`)]),
      el('span', { class: 'sub2' },
        `必要 約${it.needGrams}g${used > 0 ? ` ／ 手持ちから${used}g` : ''}${it.leftoverGrams > 0 ? ` ／ 余り約${it.leftoverGrams}g` : ''}`),
      it.freshnessNote ? el('span', { class: 'note' }, `⚠ ${it.freshnessNote}`) : null,
    ]),
  ]);
}
