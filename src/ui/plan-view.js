import { el, formatDate, weekdayIndex, ratioBar } from './dom.js';
import { RECIPE_BY_ID } from '../data/recipes.js';
import { getIngredient } from '../data/ingredients.js';
import { recipeNutritionCached, adjustedGrams } from '../core/nutrition.js';
import { LABELS, UNITS, SLOT_LABELS } from '../core/report.js';

const SEASON_LABEL = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };

export function renderPlan(state, actions) {
  const plan = state.plan;
  if (!plan) return emptyState();

  const root = el('div');
  const detail = el('section', { class: 'card' });

  const showDay = (date) => {
    actions.setUi({ selectedDate: date });
    detail.replaceChildren(...dayDetail(plan, date, actions).childNodes);
    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    root.querySelectorAll('.day').forEach((n) => n.classList.toggle('sel', n.dataset.date === date));
  };

  const selected = state.ui.selectedDate && plan.daysOut.some((d) => d.date === state.ui.selectedDate)
    ? state.ui.selectedDate : plan.daysOut[0].date;

  root.append(el('section', { class: 'card' }, [
    el('h2', {}, `${plan.days}日分の献立`),
    el('p', { class: 'sub' },
      '日をクリックすると、材料と作り方、その日の栄養が出ます。色は栄養判定です（緑=良好／黄=注意／赤=要改善）。'),
    ...weeks(plan, showDay, selected),
  ]));
  root.append(detail);
  detail.replaceChildren(...dayDetail(plan, selected, actions).childNodes);
  return root;
}

function weeks(plan, showDay, selected) {
  const out = [];
  for (let w = 0; w * 7 < plan.daysOut.length; w += 1) {
    const days = plan.daysOut.slice(w * 7, w * 7 + 7);
    const grid = el('div', { class: 'days' }, days.map((d) => dayCard(d, showDay, d.date === selected)));
    out.push(el('div', { class: 'week' }, [
      el('div', { class: 'week-head' }, [
        `第${w + 1}週`,
        el('span', { class: 'muted' },
          `${formatDate(days[0].date, true)} 〜 ${formatDate(days[days.length - 1].date)} ・ ${SEASON_LABEL[days[0].season]}`),
      ]),
      grid,
    ]));
  }
  return out;
}

function dayCard(day, showDay, isSelected) {
  const wd = weekdayIndex(day.date);
  const name = (slot) => {
    const m = day.meals.find((x) => x.slot === slot);
    return m ? RECIPE_BY_ID.get(m.recipeId).name : '';
  };
  return el('button', {
    class: `day${wd === 0 ? ' sun' : wd === 6 ? ' sat' : ''}${isSelected ? ' sel' : ''}`,
    dataset: { date: day.date },
    onclick: () => showDay(day.date),
  }, [
    el('div', { class: 'd-head' }, [
      el('span', { class: 'd-num' }, formatDate(day.date)),
      el('span', { class: `dot ${day.judgement.overall}`, title: day.judgement.overall }),
    ]),
    el('div', { class: 'm' }, [el('b', {}, '朝'), name('breakfast')]),
    el('div', { class: 'm' }, [el('b', {}, '昼'), name('lunch')]),
    el('div', { class: 'm' }, [el('b', {}, '夕'), name('dinner-main')]),
  ]);
}

function dayDetail(plan, date, actions) {
  const day = plan.daysOut.find((d) => d.date === date);
  const wrap = el('div');
  if (!day) return wrap;

  wrap.append(el('h2', {}, [
    `${formatDate(day.date, true)} の献立 `,
    el('span', { class: `tag ${day.judgement.overall}` },
      { good: '栄養バランス良好', warn: '注意', bad: '要改善' }[day.judgement.overall]),
  ]));
  if ((plan.saltScale ?? 1) !== 1) {
    wrap.append(el('p', { class: 'sub' },
      `※ 味付けは標準の${Math.round((plan.saltScale ?? 1) * 100)}%（設定で変更できます）。調味料の分量はその倍率を反映した値です。`));
  }
  if (day.swaps && day.swaps.length) {
    wrap.append(el('p', { class: 'sub' },
      `※ 栄養バランスを整えるため、この日は${day.swaps.length}品を自動で差し替えています。`));
  }

  const left = el('div', {}, day.meals.map((m) => mealBlock(m, plan.factor, plan.saltScale ?? 1)));
  const right = el('div', {}, [
    el('h4', { style: 'margin:0 0 8px;font-size:13px' }, 'この日の栄養（世帯合計）'),
    nutritionPanel(day, plan.targets),
    el('div', { class: 'row no-print', style: 'margin-top:14px' }, [
      el('button', {
        class: 'btn subtle',
        onclick: () => actions.goto('nutrition', { focusDate: day.date }),
      }, 'この日を見直す'),
    ]),
  ]);

  wrap.append(el('div', { class: 'detail-grid' }, [left, right]));
  return wrap;
}

function mealBlock(meal, factor, saltScale) {
  const r = RECIPE_BY_ID.get(meal.recipeId);
  const n = recipeNutritionCached(r, saltScale);
  const portionNote = meal.portion !== 1 ? `（盛り ${meal.portion}倍）` : '';
  const servings = Math.round(factor * meal.portion * 10) / 10;
  return el('div', { class: 'meal' }, [
    el('div', { class: 'slot' }, SLOT_LABELS[meal.slot] || meal.slot),
    el('h4', {}, r.name + portionNote),
    el('div', { class: 'meta' }, [
      r.minutes > 0 ? `${r.minutes}分 ・ ` : '',
      `1人前 ${Math.round(n.kcal)}kcal ・ 食塩${n.salt.toFixed(1)}g`,
    ].join('')),
    el('div', { class: 'ings' },
      // 栄養は1人前、材料は世帯分。単位が混ざると読み手が誤解するので必ず併記する
      `材料（世帯${servings}人前）: ${r.ingredients.map(({ id, grams }) => {
        const total = adjustedGrams(getIngredient(id), grams, saltScale) * factor * meal.portion;
        return `${getIngredient(id).name} ${total >= 10 ? Math.round(total) : total.toFixed(1)}g`;
      }).join(' / ')}`),
    el('ol', {}, r.steps.map((s) => el('li', {}, s))),
  ]);
}

function nutritionPanel(day, targets) {
  const rows = [];
  const add = (key, item, upper = false) => {
    rows.push(el('div', { class: 'n-row' }, [
      el('span', {}, LABELS[key]),
      ratioBar(item.ratio, item.level, upper),
      el('span', { class: 'n-val' },
        `${fmt(day.nutrition[key], key)}${UNITS[key]} / ${Math.round(item.ratio * 100)}%`),
    ]));
  };
  const it = day.judgement.items;
  add('kcal', it.kcal);
  add('protein', it.protein);
  add('salt', it.salt, true);
  add('fiber', it.fiber);
  add('calcium', it.calcium);
  add('iron', it.iron);
  add('vitC', it.vitC);
  add('veg', it.veg);

  const pfc = day.judgement.pfc;
  const pfcText = ['protein', 'fat', 'carb']
    .map((k) => `${LABELS[k]} ${Math.round(pfc[k].ratio * 100)}%`).join(' ／ ');
  return el('div', {}, [
    el('div', { class: 'nutri' }, rows),
    el('p', { class: 'sub', style: 'margin:10px 0 0' },
      `PFCバランス（エネルギー比）: ${pfcText}　適正は たんぱく質13-20% / 脂質20-30% / 炭水化物50-65%`),
    el('p', { class: 'sub', style: 'margin:2px 0 0' },
      `目標: ${targets.kcal}kcal ／ 食塩${targets.salt}g未満`),
  ]);
}

function fmt(v, key) {
  return key === 'salt' || key === 'iron' ? v.toFixed(1) : Math.round(v);
}

function emptyState() {
  return el('div', { class: 'card' }, [
    el('p', { class: 'empty' }, '「設定」タブで人数と期間を決めて、献立をつくってください。'),
  ]);
}
