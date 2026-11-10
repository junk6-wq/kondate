import { el, field, formatDate, todayISO } from './dom.js';
import { searchIngredients } from '../data/yomi.js';
import { INGREDIENTS, getIngredient, AISLES, AISLE_ORDER } from '../data/ingredients.js';
import { RECIPE_BY_ID } from '../data/recipes.js';
import { replanWithPantry, parseISO, toISO, addDays } from '../core/planner.js';
import { SLOT_LABELS } from '../core/report.js';

export function renderPantry(state, actions) {
  const root = el('div');

  root.append(el('section', { class: 'card' }, [
    el('h2', {}, '冷蔵庫にあるもの'),
    el('p', { class: 'sub' },
      '使い切りたい食材を登録すると、直近の献立をそれを使う方向に組み直せます。買い出しリストからも差し引きます。'),
    pantryList(state, actions),
    addPicker(state, actions),
  ]));

  if (state.plan) root.append(replanCard(state, actions));
  if (state.ui.replanResult) root.append(resultCard(state.ui.replanResult));
  return root;
}

function pantryList(state, actions) {
  if (!state.pantry.length) {
    return el('p', { class: 'sub' }, 'まだ登録がありません。下から食材を押して足してください。');
  }
  return el('div', { class: 'pantry-list' }, state.pantry.map((item, i) => el('div', { class: 'pantry-row' }, [
    el('span', { class: 'pantry-name' }, getIngredient(item.ingredientId).name),
    el('label', { class: 'inline' }, [
      el('input', {
        type: 'number', min: 1, value: item.grams, inputmode: 'numeric', 'aria-label': '分量（グラム）',
        onchange: (e) => actions.update((s) => { s.pantry[i].grams = Number(e.target.value) || 1; }),
      }),
      'g',
    ]),
    el('label', { class: 'inline' }, [
      '期限',
      el('input', {
        type: 'date', value: item.expiresOn || '', 'aria-label': '賞味・消費期限',
        onchange: (e) => actions.update((s) => { s.pantry[i].expiresOn = e.target.value || null; }),
      }),
    ]),
    el('button', {
      class: 'btn subtle small', 'aria-label': `${getIngredient(item.ingredientId).name}を消す`,
      onclick: () => actions.update((s) => { s.pantry.splice(i, 1); }),
    }, '×'),
  ])));
}

/**
 * 食材を足す。以前は約120件が並ぶ select だったが、スマホでは目的の食材まで
 * 延々と回すことになる。売り場で絞るか名前で探し、押すだけで足せるようにした。
 * 分量は買う単位1つぶん、期限は日持ちの目安で入れておき、違えば上の一覧で直す。
 */
function addPicker(state, actions) {
  const results = el('div', { class: 'chips' });
  const have = new Set(state.pantry.map((p) => p.ingredientId));
  // 入力のたびに全体を描き直すとキーボードが閉じるので、候補だけを描き直す
  const draw = () => {
    const q = (state.ui.pantryQuery || '').trim();
    const aisle = state.ui.pantryAisle || 'produce';
    const hits = q ? searchIngredients(q) : INGREDIENTS.filter((i) => i.aisle === aisle);
    results.replaceChildren(...hits.map((ing) => el('button', {
      class: 'chip', disabled: have.has(ing.id),
      onclick: () => actions.update((s) => {
        s.pantry.push({
          ingredientId: ing.id,
          grams: ing.unitG,
          expiresOn: toISO(addDays(parseISO(todayISO()), Math.min(ing.keepDays, 14))),
        });
      }),
    }, have.has(ing.id) ? `✓ ${ing.name}` : `+ ${ing.name}`)));
    if (!hits.length) results.append(el('span', { class: 'sub' }, '見つかりません。下の売り場から選んでください。'));
    aisles.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(!q && b.dataset.aisle === aisle));
    });
  };

  const search = el('input', {
    type: 'search', class: 'search', placeholder: '食材の名前でさがす（例: とり、キャベツ）',
    value: state.ui.pantryQuery || '', 'aria-label': '食材の名前でさがす',
    oninput: (e) => { state.ui.pantryQuery = e.target.value; draw(); },
  });
  const aisles = el('div', { class: 'trip-nav' }, AISLE_ORDER.map((a) => el('button', {
    dataset: { aisle: a },
    onclick: () => { state.ui.pantryAisle = a; state.ui.pantryQuery = ''; search.value = ''; draw(); },
  }, AISLES[a])));
  draw();

  return el('div', { class: 'add-picker' }, [
    el('h4', {}, '食材を足す'),
    search,
    aisles,
    results,
    el('p', { class: 'sub', style: 'margin:8px 0 0' }, '押すと、買う単位1つぶんの量と日持ちの目安の期限で入ります。違うときは上の一覧で直せます。'),
  ]);
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
    el('h2', {}, '在庫を使い切る献立に組み直す'),
    el('p', { class: 'sub' },
      '期限が近いものから先に使うよう、直近の献立だけを入れ替えます。それより先の予定は動かしません。'),
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

function resultCard(result) {
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
        '残るものがあります。組み直す日数を増やすか、献立タブでその食材を使う料理に「入れ替える」を試してください。')
      : null,
  ]);
}

function latestStart(state) {
  const today = todayISO();
  return state.plan.daysOut.some((d) => d.date >= today) ? today : state.plan.startDate;
}
