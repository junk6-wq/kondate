import { el, field, formatDate, todayISO } from './dom.js';
import { INGREDIENTS, getIngredient } from '../data/ingredients.js';
import { RECIPE_BY_ID } from '../data/recipes.js';
import { replanWithPantry, parseISO, toISO, addDays } from '../core/planner.js';
import { SLOT_LABELS } from '../core/report.js';

export function renderPantry(state, actions) {
  const root = el('div');

  root.append(el('section', { class: 'card' }, [
    el('h2', {}, '冷蔵庫にあるもの'),
    el('p', { class: 'sub' },
      '入力すると、直近の献立を「それを使い切る」方向に組み直します。先の予定と買い物リストは動かしません。'),
    pantryEditor(state, actions),
  ]));

  if (state.plan) root.append(replanCard(state, actions));
  if (state.ui.replanResult) root.append(resultCard(state.ui.replanResult, state));
  return root;
}

function pantryEditor(state, actions) {
  const wrap = el('div');
  const list = el('div', { class: 'pantry-list' });

  const draw = () => {
    list.replaceChildren(...state.pantry.map((item, i) => el('div', { class: 'pantry-row' }, [
      el('span', {}, getIngredient(item.ingredientId).name),
      el('input', {
        type: 'number', min: 1, value: item.grams, title: 'グラム',
        onchange: (e) => actions.update((s) => { s.pantry[i].grams = Number(e.target.value); }),
      }),
      el('input', {
        type: 'date', value: item.expiresOn || '', title: '賞味・消費期限',
        onchange: (e) => actions.update((s) => { s.pantry[i].expiresOn = e.target.value || null; }),
      }),
      el('button', {
        class: 'btn subtle', style: 'padding:4px 8px',
        onclick: () => actions.update((s) => { s.pantry.splice(i, 1); }),
      }, '×'),
    ])));
    if (!state.pantry.length) list.append(el('p', { class: 'sub' }, 'まだ登録がありません。'));
  };
  draw();

  const picker = el('select', {}, [
    el('option', { value: '' }, '食材を選ぶ…'),
    ...INGREDIENTS.map((i) => el('option', { value: i.id }, i.name)),
  ]);
  const amount = el('input', { type: 'number', min: 1, value: 100, style: 'width:90px' });
  const unitHint = el('span', { class: 'sub' }, '');
  const expires = el('input', { type: 'date', value: '' });

  picker.addEventListener('change', () => {
    const ing = INGREDIENTS.find((i) => i.id === picker.value);
    if (!ing) { unitHint.textContent = ''; return; }
    amount.value = ing.unitG;
    unitHint.textContent = `1${ing.unitName} ≒ ${ing.unitG}g ／ 日持ちの目安 ${ing.keepDays}日`;
    if (!expires.value) expires.value = toISO(addDays(parseISO(todayISO()), Math.min(ing.keepDays, 14)));
  });

  wrap.append(list, el('div', { class: 'row', style: 'margin-top:12px' }, [
    field('食材', picker),
    field('分量(g)', amount),
    field('期限', expires),
    el('button', {
      class: 'btn ghost',
      onclick: () => {
        if (!picker.value) return;
        const id = picker.value;
        actions.update((s) => {
          s.pantry.push({
            ingredientId: id,
            grams: Number(amount.value) || 100,
            expiresOn: expires.value || null,
          });
        });
      },
    }, '+ 追加'),
  ]), el('p', { class: 'sub', style: 'margin:6px 0 0' }, unitHint));
  return wrap;
}

function replanCard(state, actions) {
  const daysSelect = el('select', {}, [
    el('option', { value: 3 }, '3日'),
    el('option', { value: 5 }, '5日'),
    el('option', { value: 7, selected: true }, '7日'),
    el('option', { value: 10 }, '10日'),
  ]);
  const fromInput = el('input', {
    type: 'date',
    value: state.ui.replanFrom || latestStart(state),
    min: state.plan.startDate,
  });

  return el('section', { class: 'card' }, [
    el('h2', {}, '直近の献立を組み直す'),
    el('p', { class: 'sub' },
      '期限が近いものから先に使う順で割り当てます。全期間を作り直さないのは、先の予定と買い物リストが毎回変わると計画が立てられなくなるためです。'),
    el('div', { class: 'row' }, [
      field('いつから', fromInput),
      field('何日ぶん', daysSelect),
      el('button', {
        class: 'btn',
        disabled: state.pantry.length === 0,
        onclick: () => {
          const result = replanWithPantry(
            state.plan, state.pantry, fromInput.value, Number(daysSelect.value),
          );
          actions.update((s) => {
            s.plan = result.plan;
            s.ui.replanResult = { changes: result.changes, leftovers: result.leftovers, from: fromInput.value };
            s.ui.replanFrom = fromInput.value;
          });
        },
      }, '在庫にあわせて組み直す'),
    ]),
    state.pantry.length === 0
      ? el('p', { class: 'sub', style: 'margin-top:8px' }, '先に冷蔵庫の中身を登録してください。')
      : null,
  ]);
}

function resultCard(result, state) {
  const changed = result.changes;
  const leftovers = result.leftovers.filter((l) => !l.usedUp);
  return el('section', { class: 'card' }, [
    el('h2', {}, '組み直しの結果'),
    changed.length === 0
      ? el('p', { class: 'sub' }, '差し替えはありませんでした。もとの献立ですでに在庫を使い切れます。')
      : el('div', {}, [
        el('p', { class: 'sub' }, `${changed.length}品を差し替えました。`),
        ...changed.map((c) => el('div', { class: 'change' }, [
          `${formatDate(c.date)} ${SLOT_LABELS[c.slot] || c.slot}：`,
          el('span', { class: 'from' }, RECIPE_BY_ID.get(c.from).name),
          ' → ',
          el('span', { class: 'to' }, RECIPE_BY_ID.get(c.to).name),
        ])),
      ]),
    el('h4', { style: 'margin:16px 0 6px;font-size:13px' }, '在庫の使い切り見込み'),
    el('table', { class: 'mini' }, [
      el('thead', {}, el('tr', {}, [
        el('th', {}, '食材'), el('th', { class: 'num' }, '登録量'),
        el('th', { class: 'num' }, '期間内に使う'), el('th', {}, '判定'),
      ])),
      el('tbody', {}, result.leftovers.map((l) => el('tr', {}, [
        el('td', {}, l.name),
        el('td', { class: 'num' }, `${l.grams}g`),
        el('td', { class: 'num' }, `${l.consumedGrams}g`),
        el('td', {}, l.usedUp
          ? el('span', { class: 'tag good' }, '使い切れる')
          : el('span', { class: 'tag warn' }, `${l.leftoverGrams}g 残る`)),
      ]))),
    ]),
    leftovers.length
      ? el('p', { class: 'sub', style: 'margin-top:8px' },
        '残るものがあります。組み直す日数を増やすか、その食材を使う献立を「見直す」から選んでください。使い切れないものを使い切れると言っても仕方がないので、そのまま出しています。')
      : null,
  ]);
}

function latestStart(state) {
  const today = todayISO();
  return state.plan.daysOut.some((d) => d.date >= today) ? today : state.plan.startDate;
}
