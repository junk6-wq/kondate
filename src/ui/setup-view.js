import { el, field, select, todayISO } from './dom.js';
import { INGREDIENTS } from '../data/ingredients.js';
import { personTargets, householdTargets } from '../core/nutrition.js';

const SEX = [['male', '男性'], ['female', '女性']];
const ACTIVITY = [
  ['low', '低い（座位中心）'],
  ['normal', 'ふつう'],
  ['high', '高い（立ち仕事・運動習慣）'],
];
const PREGNANCY = [
  ['none', 'なし'], ['early', '妊娠初期'], ['mid', '妊娠中期'],
  ['late', '妊娠後期'], ['lactating', '授乳中'],
];

export function renderSetup(state, actions) {
  const root = el('div');

  // --- 世帯 ---
  const memberList = el('div', { class: 'pantry-list' });
  const redraw = () => {
    memberList.replaceChildren(...state.household.map((m, i) => memberRow(state, m, i, actions)));
  };
  redraw();

  root.append(el('section', { class: 'card' }, [
    el('h2', {}, '食べる人'),
    el('p', { class: 'sub' },
      '年齢・性別・活動量から1日の目標量を計算します。人数ぶんの単純合計が世帯の目標です。'),
    memberList,
    el('div', { class: 'row', style: 'margin-top:12px' }, [
      el('button', {
        class: 'btn ghost',
        onclick: () => {
          actions.update((s) => {
            s.household.push({
              id: `p${Date.now()}`, name: `家族${s.household.length + 1}`,
              age: 30, sex: 'female', activity: 'normal',
            });
          });
        },
      }, '+ 人を追加'),
    ]),
    targetsTable(state.household),
  ]));

  // --- 期間と買い物 ---
  const s = state.settings;
  root.append(el('section', { class: 'card' }, [
    el('h2', {}, '期間と買い物'),
    el('p', { class: 'sub' }, '買い物の間隔は生鮮の日持ちの判定にも使われます。週1回にすると、もやしのように3日しかもたない食材に注意書きが付きます。'),
    el('div', { class: 'row' }, [
      field('開始日', el('input', {
        type: 'date', value: s.startDate || todayISO(),
        onchange: (e) => actions.update((st) => { st.settings.startDate = e.target.value; }, false),
      })),
      field('期間', select([[30, '1か月（30日）'], [60, '2か月（60日）'], [90, '3か月（90日）']],
        s.days, (e) => actions.update((st) => { st.settings.days = Number(e.target.value); }, false))),
      field('買い物の間隔', select([[3, '3日に1回'], [4, '4日に1回'], [7, '週1回'], [14, '2週に1回']],
        s.shoppingIntervalDays,
        (e) => actions.update((st) => { st.settings.shoppingIntervalDays = Number(e.target.value); }, false))),
      field('夕食の副菜', select([[1, '1品'], [2, '2品'], [3, '3品']], s.sidesPerDinner,
        (e) => actions.update((st) => { st.settings.sidesPerDinner = Number(e.target.value); }, false))),
      field('平日夜にかけられる時間', select([[20, '20分まで'], [30, '30分まで'], [45, '45分まで'], [999, '気にしない']],
        s.weekdayMaxMinutes,
        (e) => actions.update((st) => { st.settings.weekdayMaxMinutes = Number(e.target.value); }, false))),
      field('味付け', select([
        [1, 'レシピどおり'],
        [0.85, 'ひかえめ（標準の85%・推奨）'],
        [0.7, 'しっかり減塩（70%）'],
      ], s.saltScale ?? 0.85,
      (e) => actions.update((st) => { st.settings.saltScale = Number(e.target.value); }, false))),
    ]),
    el('p', { class: 'sub', style: 'margin-top:10px' },
      '味付けはしょうゆ・みそ・だしの素など、減らしても料理として成立する調味料の量を変えます。'
      + 'パンや麺、ハムにもともと含まれる食塩は減らせないのでそのままです。'
      + '「レシピどおり」だと、家庭料理の標準的な味付けのため食塩が目標を1〜2割超える献立になります'
      + '（とくに子どものいる世帯は上限が厳しいので差が出ます）。買う調味料の量も倍率に合わせて調整されます。'),
  ]));

  // --- 除外 ---
  root.append(el('section', { class: 'card' }, [
    el('h2', {}, '使わない食材'),
    el('p', { class: 'sub' }, 'アレルギーや苦手なもの。指定した食材を含むレシピは候補から外れます。'),
    excludePicker(state, actions),
  ]));

  // --- 生成 ---
  const genMsg = el('p', { class: 'sub', style: 'margin:10px 0 0' });
  root.append(el('section', { class: 'card' }, [
    el('h2', {}, '献立をつくる'),
    el('p', { class: 'sub' }, '同じ設定・同じシードなら毎回同じ献立になります。気に入らなければシードを変えて作り直してください。'),
    el('div', { class: 'row' }, [
      field('シード（作り直しの目印）', el('input', {
        type: 'text', value: s.seed || '', placeholder: '空欄なら自動',
        onchange: (e) => actions.update((st) => { st.settings.seed = e.target.value || null; }, false),
      })),
      el('button', {
        class: 'btn',
        onclick: () => {
          genMsg.textContent = '計算中…';
          setTimeout(() => {
            const t0 = performance.now();
            actions.generate();
            genMsg.textContent = `${state.settings.days}日ぶんを ${Math.round(performance.now() - t0)}ms で作成しました。`;
          }, 10);
        },
      }, state.plan ? '献立を作り直す' : '献立をつくる'),
      state.plan && el('button', {
        class: 'btn subtle',
        onclick: () => {
          actions.update((st) => { st.settings.seed = Math.random().toString(36).slice(2, 8); }, false);
          actions.generate();
        },
      }, '別の案にする'),
    ]),
    genMsg,
    state.plan && el('p', { class: 'sub', style: 'margin-top:10px' },
      `現在の献立: ${state.plan.startDate} から ${state.plan.days}日ぶん（食数係数 ${state.plan.factor}）`),
  ]));

  return root;
}

function memberRow(state, m, i, actions) {
  const set = (key) => (e) => actions.update((s) => {
    const v = e.target.value;
    s.household[i][key] = key === 'age' ? Number(v) : v;
  });
  return el('div', { class: 'row', style: 'align-items:flex-end' }, [
    field('呼び名', el('input', { type: 'text', value: m.name || '', size: 8, onchange: set('name') })),
    field('年齢', el('input', { type: 'number', min: 1, max: 110, value: m.age, style: 'width:70px', onchange: set('age') })),
    field('性別', select(SEX, m.sex, set('sex'))),
    field('活動量', select(ACTIVITY, m.activity || 'normal', set('activity'))),
    m.sex === 'female' && m.age >= 18 && m.age < 50
      && field('妊娠・授乳', select(PREGNANCY, m.pregnancy || 'none', set('pregnancy'))),
    state.household.length > 1 && el('button', {
      class: 'btn subtle',
      onclick: () => actions.update((s) => { s.household.splice(i, 1); }),
    }, '削除'),
  ]);
}

function targetsTable(household) {
  const t = householdTargets(household);
  const rows = [
    ['エネルギー', `${t.kcal} kcal`], ['たんぱく質', `${t.protein} g`],
    ['脂質', `${t.fat} g`], ['炭水化物', `${t.carb} g`],
    ['食物繊維', `${t.fiber} g 以上`], ['食塩相当量', `${t.salt} g 未満`],
    ['カルシウム', `${t.calcium} mg`], ['鉄', `${t.iron} mg`],
    ['ビタミンC', `${t.vitC} mg`], ['野菜', `${t.veg} g 以上`],
  ];
  return el('div', { style: 'margin-top:14px' }, [
    el('h4', { style: 'margin:0 0 6px;font-size:13px' }, '世帯の1日あたり目標量'),
    el('table', { class: 'mini' }, [
      el('tbody', {}, rows.map(([k, v]) => el('tr', {}, [
        el('th', {}, k), el('td', { class: 'num' }, v),
      ]))),
    ]),
    el('p', { class: 'sub', style: 'margin:8px 0 0' },
      household.map((m) => `${m.name || '—'} ${personTargets(m).kcal}kcal`).join(' ／ ')),
  ]);
}

function excludePicker(state, actions) {
  const wrap = el('div');
  const current = state.settings.excludeIngredients;
  const chips = el('div', { class: 'row', style: 'gap:6px;margin-bottom:8px' });
  const draw = () => {
    chips.replaceChildren(...(current.length ? current : []).map((id) => {
      const ing = INGREDIENTS.find((x) => x.id === id);
      return el('button', {
        class: 'btn subtle', style: 'padding:3px 10px;font-size:12.5px',
        onclick: () => actions.update((s) => {
          s.settings.excludeIngredients = s.settings.excludeIngredients.filter((x) => x !== id);
        }),
      }, `${ing ? ing.name : id} ×`);
    }));
    if (!current.length) chips.append(el('span', { class: 'sub' }, '指定なし'));
  };
  draw();

  const picker = el('select', {
    onchange: (e) => {
      const v = e.target.value;
      if (!v) return;
      actions.update((s) => {
        if (!s.settings.excludeIngredients.includes(v)) s.settings.excludeIngredients.push(v);
      });
    },
  }, [el('option', { value: '' }, '食材を選んで追加…'),
    ...INGREDIENTS.map((i) => el('option', { value: i.id }, `${i.name}`))]);

  wrap.append(chips, picker);
  return wrap;
}
