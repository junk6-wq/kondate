// アプリ本体。状態を1か所に持ち、変更があれば現在のタブを描き直すだけの素朴な作り。
// 90日ぶんの再描画でも数十msなので、差分更新の仕組みは持たせていない。

import { loadState, saveState, clearState } from './core/store.js';
import { generatePlan, toISO } from './core/planner.js';
import { el, clear, todayISO } from './ui/dom.js';
import { renderSetup } from './ui/setup-view.js';
import { renderPlan } from './ui/plan-view.js';
import { renderShopping } from './ui/shopping-view.js';
import { renderPantry } from './ui/pantry-view.js';
import { renderNutrition } from './ui/nutrition-view.js';

const TABS = [
  ['setup', '設定'],
  ['plan', '献立'],
  ['shopping', '買い出し'],
  ['pantry', '冷蔵庫'],
  ['nutrition', '栄養'],
];

const RENDERERS = {
  setup: renderSetup, plan: renderPlan, shopping: renderShopping,
  pantry: renderPantry, nutrition: renderNutrition,
};

const state = loadState();
state.ui = { tab: state.plan ? 'plan' : 'setup', tripIndex: 0, weekIndex: 0 };

const main = document.getElementById('view');
const tabsEl = document.getElementById('tabs');

const actions = {
  /** 状態を変えて再描画する。第2引数 false で再描画を省く(入力中のフォーカスを飛ばさないため)。 */
  update(fn, rerender = true) {
    fn(state);
    persist();
    if (rerender) render();
  },
  setUi(patch, rerender = true) {
    Object.assign(state.ui, patch);
    if (rerender) render();
  },
  goto(tab, uiPatch = {}) {
    Object.assign(state.ui, uiPatch, { tab });
    render();
  },
  generate() {
    const s = state.settings;
    state.plan = generatePlan({
      startDate: s.startDate || todayISO(),
      days: s.days,
      household: state.household,
      seed: s.seed || defaultSeed(),
      pantry: state.pantry,
      options: {
        sidesPerDinner: s.sidesPerDinner,
        weekdayMaxMinutes: s.weekdayMaxMinutes,
        saltScale: s.saltScale ?? 0.85,
        excludeIngredients: s.excludeIngredients,
        avoidCuisines: s.avoidCuisines,
      },
    });
    state.checkedItems = {};
    state.ui.tab = 'plan';
    state.ui.selectedDate = state.plan.daysOut[0].date;
    persist();
    render();
  },
  /** 味付けの設定を変えて献立を作り直す。栄養レポートからの導線。 */
  applySaltScale(value) {
    state.settings.saltScale = value;
    actions.generate();
    state.ui.tab = 'nutrition';
    render();
  },
  reset() {
    clearState();
    location.reload();
  },
};

function defaultSeed() {
  const s = Math.random().toString(36).slice(2, 8);
  state.settings.seed = s;
  return s;
}

function persist() {
  const { ui, ...rest } = state;
  if (!saveState(rest)) {
    banner('保存できませんでした（ブラウザの保存容量が上限のようです）。期間を短くするか、他のサイトのデータを整理してください。');
  }
}

let bannerEl = null;
function banner(text) {
  if (!bannerEl) {
    bannerEl = el('div', { class: 'notice warn no-print' });
    main.before(bannerEl);
  }
  bannerEl.textContent = text;
}

function renderTabs() {
  clear(tabsEl);
  TABS.forEach(([id, label]) => {
    tabsEl.append(el('button', {
      'aria-selected': state.ui.tab === id,
      onclick: () => actions.setUi({ tab: id }),
    }, label));
  });
}

// 描画中に select の blur などから再び描画が要求されることがある。
// 入れ子で走らせると DOM を作りかけの状態で作り直すことになるので、
// 走っている間の要求は1回にまとめて後追いで実行する。
let rendering = false;
let renderQueued = false;

function render() {
  if (rendering) { renderQueued = true; return; }
  rendering = true;
  try {
    renderTabs();
    clear(main);
    main.append(RENDERERS[state.ui.tab](state, actions));
    window.scrollTo({ top: 0 });
  } finally {
    rendering = false;
  }
  if (renderQueued) { renderQueued = false; render(); }
}

document.getElementById('reset').addEventListener('click', () => {
  if (confirm('保存した献立・設定・冷蔵庫の中身をすべて消します。よろしいですか？')) actions.reset();
});

render();
