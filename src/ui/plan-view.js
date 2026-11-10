// 献立タブ。開いたらまず「今日なにを作るか」が見えるようにする。
//
// 以前は全期間を週ごとのグリッドで並べ、詳細はページのいちばん下に出していた。
// スマホだと目的の日まで長くスクロールし、押した結果も画面の外に出てしまう。
// いまは上に日付の帯、その下に選んだ1日ぶんを大きく出す。全体の流れを
// 見たいとき(作った直後や買い物の前)のために「一覧」にも切り替えられる。

import { el, formatDate, weekdayIndex, ratioBar, todayISO, WEEKDAYS } from './dom.js';
import { RECIPE_BY_ID } from '../data/recipes.js';
import { getIngredient } from '../data/ingredients.js';
import { recipeNutritionCached, adjustedGrams } from '../core/nutrition.js';
import { LABELS, UNITS, SLOT_LABELS, mealAlternatives, applySwap } from '../core/report.js';

const SEASON_LABEL = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
const JUDGE_LABEL = { good: '栄養バランス良好', warn: '栄養やや注意', bad: '栄養要改善' };
const GROUPS = [
  ['朝食', (m) => m.slot === 'breakfast'],
  ['昼食', (m) => m.slot === 'lunch'],
  ['夕食', (m) => m.slot.startsWith('dinner')],
];
const CANDIDATES_PER_PAGE = 4;

export function renderPlan(state, actions) {
  const plan = state.plan;
  if (!plan) return welcome(state, actions);

  const today = todayISO();
  const first = plan.daysOut[0].date;
  const last = plan.daysOut[plan.daysOut.length - 1].date;
  const inPlan = (d) => !!d && plan.daysOut.some((x) => x.date === d);
  const selected = inPlan(state.ui.selectedDate) ? state.ui.selectedDate : inPlan(today) ? today : first;
  const mode = state.ui.planMode === 'list' ? 'list' : 'day';
  const root = el('div');

  if (today > last) {
    root.append(el('div', { class: 'notice warn no-print' }, [
      `この献立は ${formatDate(last)} で終わりました。`,
      el('button', {
        class: 'btn', style: 'margin-left:10px',
        onclick: () => actions.generate({ startDate: today, reseed: true }),
      }, `今日から${periodLabel(state.settings.days)}つくり直す`),
    ]));
  }

  const strip = el('div', { class: 'strip' }, plan.daysOut.map((d) => {
    const wd = weekdayIndex(d.date);
    return el('button', {
      class: `chip-day${d.date === selected ? ' sel' : ''}${d.date === today ? ' today' : ''}${wd === 0 ? ' sun' : wd === 6 ? ' sat' : ''}`,
      'aria-pressed': d.date === selected && mode === 'day',
      'aria-label': `${formatDate(d.date)}${d.date === today ? ' 今日' : ''}`,
      dataset: { date: d.date },
      onclick: () => actions.setUi({ selectedDate: d.date, planMode: 'day', swap: null }),
    }, [
      el('span', { class: 'wd' }, d.date === today ? '今日' : WEEKDAYS[wd]),
      el('span', { class: 'dn' }, String(Number(d.date.slice(8)))),
      el('span', { class: `dot ${d.judgement.overall}` }),
    ]);
  }));
  // 選んだ日が帯の中央に来るようにする(2週目を見ているとき、帯が1週目のままだと迷う)
  requestAnimationFrame(() => {
    const cur = strip.querySelector('.sel');
    if (cur) strip.scrollLeft = cur.offsetLeft - (strip.clientWidth - cur.offsetWidth) / 2;
  });

  root.append(el('section', { class: 'card plan-head' }, [
    el('div', { class: 'head-row' }, [
      el('h2', {}, `${formatDate(first)} 〜 ${formatDate(last)} の献立`),
      el('div', { class: 'seg no-print' }, [
        segButton('1日', mode === 'day', () => actions.setUi({ planMode: 'day' })),
        segButton('一覧', mode === 'list', () => actions.setUi({ planMode: 'list', swap: null })),
      ]),
    ]),
    strip,
  ]));

  root.append(mode === 'day'
    ? dayView(state, plan, selected, today, actions)
    : listView(plan, selected, today, actions));
  return root;
}

function segButton(label, pressed, onclick) {
  return el('button', { 'aria-pressed': pressed, onclick }, label);
}

function periodLabel(days) {
  return days % 7 === 0 ? `${days / 7}週間ぶん` : `${days}日ぶん`;
}

// --- 1日の表示 ---

function dayView(state, plan, date, today, actions) {
  const day = plan.daysOut.find((d) => d.date === date);
  const saltScale = plan.saltScale ?? 1;
  const wrap = el('div');

  wrap.append(el('div', { class: 'day-title' }, [
    el('h2', {}, [
      formatDate(day.date),
      date === today ? el('span', { class: 'tag today-tag' }, '今日') : null,
    ]),
    el('span', { class: `tag ${day.judgement.overall}` }, JUDGE_LABEL[day.judgement.overall]),
    el('button', {
      class: 'btn subtle small no-print', style: 'margin-left:auto',
      onclick: (e) => copyText(e.target, dayToText(day), '献立をコピー'),
    }, '献立をコピー'),
  ]));

  GROUPS.forEach(([label, match]) => {
    const dishes = day.meals.map((meal, index) => ({ meal, index })).filter(({ meal }) => match(meal));
    if (!dishes.length) return;
    wrap.append(el('section', { class: 'card mealcard' }, [
      el('div', { class: 'meal-label' }, label),
      ...dishes.map(({ meal, index }) => dish(state, plan, day, meal, index, saltScale, actions)),
    ]));
  });

  wrap.append(el('details', { class: 'card fold' }, [
    el('summary', {}, [
      'この日の栄養 ',
      el('span', { class: `tag ${day.judgement.overall}` }, JUDGE_LABEL[day.judgement.overall]),
    ]),
    nutritionPanel(day, plan.targets),
    saltScale !== 1 ? el('p', { class: 'sub' },
      `味付けは標準の${Math.round(saltScale * 100)}%（設定で変えられます）。調味料の分量はその倍率を反映した値です。`) : null,
    day.swaps && day.swaps.length ? el('p', { class: 'sub' },
      `栄養バランスを整えるため、この日は${day.swaps.length}品を自動で差し替えています。`) : null,
    el('button', {
      class: 'btn subtle small no-print', style: 'margin-top:10px',
      onclick: () => actions.goto('nutrition', {
        focusDate: day.date,
        weekIndex: Math.floor(plan.daysOut.indexOf(day) / 7),
      }),
    }, '栄養が良くなる入れ替えを見る'),
  ]));
  return wrap;
}

function dish(state, plan, day, meal, index, saltScale, actions) {
  const r = RECIPE_BY_ID.get(meal.recipeId);
  const n = recipeNutritionCached(r, saltScale);
  const servings = Math.round(plan.factor * meal.portion * 10) / 10;
  const swap = state.ui.swap;
  const swapping = !!swap && swap.date === day.date && swap.index === index;
  const isDinner = meal.slot.startsWith('dinner');

  return el('div', { class: `dish${swapping ? ' swapping' : ''}` }, [
    el('div', { class: 'dish-row' }, [
      el('div', { class: 'dish-main' }, [
        isDinner ? el('span', { class: 'slot' }, SLOT_LABELS[meal.slot]) : null,
        el('h3', {}, r.name + (meal.portion !== 1 ? `（盛り ${meal.portion}倍）` : '')),
        el('div', { class: 'meta' }, [
          r.minutes > 0 ? `${r.minutes}分 ・ ` : '',
          `1人前 ${Math.round(n.kcal)}kcal ・ 食塩${n.salt.toFixed(1)}g`,
        ].join('')),
      ]),
      // 主食は残りのエネルギーに合わせて量を決めているので入れ替えの対象にしない
      r.role !== 'staple' ? el('button', {
        class: 'btn ghost small no-print',
        'aria-expanded': swapping,
        onclick: () => actions.setUi({ swap: swapping ? null : { date: day.date, index, offset: 0 } }),
      }, swapping ? '閉じる' : '入れ替える') : null,
    ]),
    swapping ? swapPanel(plan, day, index, swap.offset || 0, actions) : null,
    el('details', { class: 'recipe' }, [
      el('summary', {}, '材料と作り方'),
      // 栄養は1人前、材料は世帯分。単位が混ざると読み手が誤解するので必ず併記する
      el('div', { class: 'ings-title' }, `材料（世帯${servings}人前）`),
      el('ul', { class: 'ings' }, r.ingredients.map(({ id, grams }) => {
        const ing = getIngredient(id);
        const total = adjustedGrams(ing, grams, saltScale) * plan.factor * meal.portion;
        return el('li', {}, [ing.name, el('span', {}, `${total >= 10 ? Math.round(total) : total.toFixed(1)}g`)]);
      })),
      el('ol', {}, r.steps.map((s) => el('li', {}, s))),
    ]),
  ]);
}

function swapPanel(plan, day, index, offset, actions) {
  let cands = mealAlternatives(plan, day.date, index, CANDIDATES_PER_PAGE, offset);
  // 候補を出し切ったら先頭に戻る
  if (!cands.length && offset > 0) cands = mealAlternatives(plan, day.date, index, CANDIDATES_PER_PAGE, 0);
  if (!cands.length) {
    return el('div', { class: 'swap-panel' }, el('p', { class: 'sub' }, '入れ替えられる料理が見つかりませんでした。'));
  }
  return el('div', { class: 'swap-panel' }, [
    el('p', { class: 'sub' }, 'かわりの料理を選んでください。買い出しリストも自動で変わります。'),
    ...cands.map((c) => el('button', {
      class: 'cand',
      onclick: () => actions.update((s) => { s.plan = applySwap(s.plan, c); s.ui.swap = null; }),
    }, [
      el('b', {}, c.toName),
      el('span', { class: 'cand-meta' }, [
        c.minutes > 0 ? `${c.minutes}分` : '',
        c.after !== c.before
          ? el('span', { class: `tag ${c.after}` }, `栄養 ${JUDGE_SHORT[c.before]}→${JUDGE_SHORT[c.after]}`)
          : null,
      ]),
    ])),
    el('div', { class: 'row', style: 'margin-top:4px' }, [
      el('button', {
        class: 'btn subtle small',
        onclick: () => actions.setUi({
          swap: { date: day.date, index, offset: cands.length < CANDIDATES_PER_PAGE ? 0 : offset + CANDIDATES_PER_PAGE },
        }),
      }, 'ほかの候補'),
    ]),
  ]);
}

const JUDGE_SHORT = { good: '良好', warn: '注意', bad: '要改善' };

function nutritionPanel(day, targets) {
  const it = day.judgement.items;
  const row = (key, upper = false) => el('div', { class: 'n-row' }, [
    el('span', {}, LABELS[key]),
    ratioBar(it[key].ratio, it[key].level, upper),
    el('span', { class: 'n-val' },
      `${fmt(day.nutrition[key], key)}${UNITS[key]} / ${Math.round(it[key].ratio * 100)}%`),
  ]);
  const pfc = day.judgement.pfc;
  const pfcText = ['protein', 'fat', 'carb']
    .map((k) => `${LABELS[k]} ${Math.round(pfc[k].ratio * 100)}%`).join(' ／ ');
  return el('div', {}, [
    el('p', { class: 'sub' }, `世帯の合計です。目標は ${targets.kcal}kcal ／ 食塩${targets.salt}g未満。`),
    el('div', { class: 'nutri' }, [
      row('kcal'), row('protein'), row('salt', true), row('fiber'),
      row('calcium'), row('iron'), row('vitC'), row('veg'),
    ]),
    el('p', { class: 'sub', style: 'margin-top:10px' },
      `PFCバランス（エネルギー比）: ${pfcText}　適正は たんぱく質13-20% / 脂質20-30% / 炭水化物50-65%`),
  ]);
}

function fmt(v, key) {
  return key === 'salt' || key === 'iron' ? v.toFixed(1) : Math.round(v);
}

function dayToText(day) {
  const names = (match) => day.meals.filter(match).map((m) => RECIPE_BY_ID.get(m.recipeId).name).join('、');
  return [`${formatDate(day.date)}の献立`, ...GROUPS.map(([label, match]) => `${label}: ${names(match)}`)].join('\n');
}

async function copyText(button, text, label) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'コピーしました';
  } catch {
    button.textContent = 'コピーできませんでした';
  }
  setTimeout(() => { button.textContent = label; }, 1600);
}

// --- 一覧 ---

function listView(plan, selected, today, actions) {
  const out = el('section', { class: 'card' }, [
    el('p', { class: 'sub' }, '日を押すと、その日の材料と作り方が開きます。点の色は栄養判定です（緑=良好／黄=注意／赤=要改善）。'),
  ]);
  for (let w = 0; w * 7 < plan.daysOut.length; w += 1) {
    const days = plan.daysOut.slice(w * 7, w * 7 + 7);
    out.append(el('div', { class: 'week' }, [
      el('div', { class: 'week-head' }, [
        `${w + 1}週目`,
        el('span', { class: 'muted' },
          `${formatDate(days[0].date)} 〜 ${formatDate(days[days.length - 1].date)} ・ ${SEASON_LABEL[days[0].season]}`),
      ]),
      el('div', { class: 'days' }, days.map((d) => dayCard(d, d.date === selected, d.date === today, actions))),
    ]));
  }
  return out;
}

function dayCard(day, isSelected, isToday, actions) {
  const wd = weekdayIndex(day.date);
  const name = (slot) => {
    const m = day.meals.find((x) => x.slot === slot);
    return m ? RECIPE_BY_ID.get(m.recipeId).name : '';
  };
  return el('button', {
    class: `day${wd === 0 ? ' sun' : wd === 6 ? ' sat' : ''}${isSelected ? ' sel' : ''}${isToday ? ' today' : ''}`,
    dataset: { date: day.date },
    onclick: () => actions.goto('plan', { selectedDate: day.date, planMode: 'day', swap: null }),
  }, [
    el('div', { class: 'd-head' }, [
      el('span', { class: 'd-num' }, formatDate(day.date)),
      isToday ? el('span', { class: 'tag today-tag' }, '今日') : null,
      el('span', { class: `dot ${day.judgement.overall}`, title: JUDGE_LABEL[day.judgement.overall] }),
    ]),
    el('div', { class: 'd-meals' }, [
      el('div', { class: 'm' }, [el('b', {}, '朝'), name('breakfast')]),
      el('div', { class: 'm' }, [el('b', {}, '昼'), name('lunch')]),
      el('div', { class: 'm' }, [el('b', {}, '夕'), name('dinner-main')]),
    ]),
  ]);
}

// --- まだ献立がないとき ---

function welcome(state, actions) {
  const SEX = { male: '男性', female: '女性' };
  const period = periodLabel(state.settings.days);
  const msg = el('p', { class: 'sub', style: 'margin:10px 0 0' });
  return el('section', { class: 'card welcome' }, [
    el('h2', {}, `${period}の献立をつくりましょう`),
    el('p', { class: 'sub' }, '朝・昼・夕の献立と買い出しリストを、栄養バランスを見ながら自動でつくります。つくったあとで1品ずつ入れ替えられます。'),
    el('div', { class: 'who' }, [
      el('span', { class: 'who-label' }, `食べる人（${state.household.length}人）`),
      ...state.household.map((m) => el('span', { class: 'tag' }, `${m.name || '—'} ${m.age}歳・${SEX[m.sex] || ''}`)),
    ]),
    el('div', { class: 'row', style: 'margin-top:14px' }, [
      el('button', {
        class: 'btn big',
        onclick: () => {
          msg.textContent = '計算中…';
          setTimeout(() => actions.generate({ reseed: true }), 10);
        },
      }, `今日から${period}つくる`),
      el('button', { class: 'btn ghost', onclick: () => actions.goto('setup') }, '食べる人や好みを先に決める'),
    ]),
    msg,
  ]);
}
