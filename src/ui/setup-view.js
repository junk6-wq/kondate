import { el, field, select, todayISO, formatDate } from './dom.js';
import { searchIngredients } from '../data/yomi.js';
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
  const today = todayISO();
  const set = (key) => (e) => actions.update((st) => { st.settings[key] = Number(e.target.value); }, false);
  root.append(el('section', { class: 'card' }, [
    el('h2', {}, '献立の決めごと'),
    el('p', { class: 'sub' }, '変えたあと、下の「この設定で献立をつくる」を押すと反映されます。'),
    el('div', { class: 'row' }, [
      field('期間', select(
        [[7, '1週間'], [14, '2週間（おすすめ）'], [21, '3週間'], [28, '4週間']], s.days,
        // 下のボタンの文言(何週間ぶんつくるか)も変わるので、ここだけ描き直す
        (e) => actions.update((st) => { st.settings.days = Number(e.target.value); }))),
      field('買い物の間隔', select([[3, '3日に1回'], [4, '4日に1回'], [7, '週1回'], [14, '2週に1回']],
        s.shoppingIntervalDays, set('shoppingIntervalDays'))),
      field('夕食の副菜', select([[1, '1品'], [2, '2品'], [3, '3品']], s.sidesPerDinner, set('sidesPerDinner'))),
      field('平日夜にかけられる時間', select([[20, '20分まで'], [30, '30分まで'], [45, '45分まで'], [999, '気にしない']],
        s.weekdayMaxMinutes, set('weekdayMaxMinutes'))),
      field('味付け', select([
        [1, 'レシピどおり'],
        [0.85, 'ひかえめ（標準の85%・おすすめ）'],
        [0.7, 'しっかり減塩（70%）'],
      ], s.saltScale ?? 0.85, set('saltScale'))),
      field('はじめる日', el('input', {
        type: 'date', min: today, value: s.startDate && s.startDate >= today ? s.startDate : today,
        onchange: (e) => actions.update((st) => { st.settings.startDate = e.target.value || null; }, false),
      })),
    ]),
    el('details', { class: 'hint' }, [
      el('summary', {}, '買い物の間隔と味付けについて'),
      el('p', { class: 'sub' }, '買い物の間隔は生鮮の日持ちの判定にも使われます。週1回にすると、もやしのように3日しかもたない食材に注意書きが付きます。'),
      el('p', { class: 'sub' },
        '味付けはしょうゆ・みそ・だしの素など、減らしても料理として成立する調味料の量を変えます。'
        + 'パンや麺、ハムにもともと含まれる食塩は減らせないのでそのままです。'
        + '「レシピどおり」だと、家庭料理の標準的な味付けのため食塩が目標を1〜2割超える献立になります'
        + '（とくに子どものいる世帯は上限が厳しいので差が出ます）。買う調味料の量も倍率に合わせて調整されます。'),
    ]),
  ]));

  // --- 除外 ---
  root.append(el('section', { class: 'card' }, [
    el('h2', {}, '使わない食材'),
    el('p', { class: 'sub' }, 'アレルギーや苦手なもの。指定した食材を含む料理は献立に出ません。'),
    excludePicker(state, actions),
  ]));

  // --- 生成 ---
  const genMsg = el('p', { class: 'sub', style: 'margin:10px 0 0' });
  const period = `${s.days / 7}週間ぶん`;
  root.append(el('section', { class: 'card' }, [
    el('h2', {}, state.plan ? '献立をつくり直す' : '献立をつくる'),
    state.plan
      ? el('p', { class: 'sub' },
        `いまの献立は ${formatDate(state.plan.startDate)} から${state.plan.days}日ぶん。つくり直すと、いまの献立と買い物のチェックは新しいものに置き換わります。`)
      : el('p', { class: 'sub' }, '気に入らない料理は、つくったあとで1品ずつ入れ替えられます。'),
    el('div', { class: 'row' }, [
      el('button', {
        class: 'btn big',
        onclick: () => {
          if (state.plan && !confirm('いまの献立を消して、新しくつくり直します。よろしいですか？')) return;
          genMsg.textContent = '計算中…';
          setTimeout(() => actions.generate({ reseed: true }), 10);
        },
      }, `この設定で${period}つくる`),
    ]),
    genMsg,
  ]));

  // --- データの削除 ---
  root.append(el('section', { class: 'card' }, [
    el('h2', {}, 'データを消す'),
    el('p', { class: 'sub' }, '献立・設定・冷蔵庫の中身は、この端末のブラウザの中だけに保存しています。'),
    el('button', {
      class: 'btn danger',
      onclick: () => {
        if (confirm('保存した献立・設定・冷蔵庫の中身をすべて消します。よろしいですか？')) actions.reset();
      },
    }, 'すべてのデータを消す'),
  ]));

  return root;
}

function memberRow(state, m, i, actions) {
  const set = (key) => (e) => actions.update((s) => {
    const v = e.target.value;
    s.household[i][key] = key === 'age' ? Number(v) : v;
  });
  return el('div', { class: 'row member' }, [
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
  return el('details', { class: 'hint' }, [
    el('summary', {}, `世帯の1日あたり目標量（${t.kcal} kcal）`),
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
  const current = state.settings.excludeIngredients;
  const chosen = el('div', { class: 'chips', style: 'margin-bottom:10px' }, current.length
    ? current.map((id) => {
      const ing = INGREDIENTS.find((x) => x.id === id);
      return el('button', {
        class: 'chip on',
        onclick: () => actions.update((s) => {
          s.settings.excludeIngredients = s.settings.excludeIngredients.filter((x) => x !== id);
        }),
      }, `${ing ? ing.name : id} ×`);
    })
    : el('span', { class: 'sub' }, '指定なし'));

  const results = el('div', { class: 'chips' });
  const draw = (text) => {
    const q = text.trim();
    const hits = searchIngredients(q).filter((i) => !current.includes(i.id));
    results.replaceChildren(...hits.map((ing) => el('button', {
      class: 'chip',
      onclick: () => actions.update((s) => { s.settings.excludeIngredients.push(ing.id); }),
    }, `+ ${ing.name}`)));
    if (q && !hits.length) results.append(el('span', { class: 'sub' }, '見つかりません。'));
  };
  const search = el('input', {
    type: 'search', class: 'search', placeholder: '食材の名前でさがして足す（例: えび、卵）',
    'aria-label': '使わない食材をさがす',
    oninput: (e) => draw(e.target.value),
  });
  return el('div', {}, [chosen, search, results]);
}
