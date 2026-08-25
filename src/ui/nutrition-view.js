import { el, formatDate, ratioBar } from './dom.js';
import { weeklyReport, swapCandidates, applySwap, localHeadline, settingSuggestions, LABELS, UNITS } from '../core/report.js';

export function renderNutrition(state, actions) {
  if (!state.plan) {
    return el('div', { class: 'card' }, el('p', { class: 'empty' }, '先に献立をつくってください。'));
  }
  const plan = state.plan;
  const weekCount = Math.ceil(plan.daysOut.length / 7);
  const wi = Math.min(state.ui.weekIndex || 0, weekCount - 1);
  const week = weeklyReport(plan, wi);
  const root = el('div');

  root.append(el('section', { class: 'card' }, [
    el('h2', {}, '栄養レポート'),
    el('p', { class: 'sub' },
      '1日ごとの数値は揺れるので、合否は週平均で見ます。要改善の日が週1日以下なら、その献立は合格として扱って構いません。'),
    el('div', { class: 'trip-nav' }, Array.from({ length: weekCount }, (_, i) => el('button', {
      'aria-pressed': i === wi,
      onclick: () => actions.setUi({ weekIndex: i }, true),
    }, `第${i + 1}週`))),
    el('div', { class: `notice${week.judgement.overall === 'good' ? '' : ' warn'}` }, localHeadline(week)),
    ...settingSuggestions(week, plan).map((sug) => el('div', { class: 'notice warn' }, [
      sug.text,
      sug.key === 'saltScale' ? el('button', {
        class: 'btn ghost no-print', style: 'margin-left:8px;padding:3px 10px;font-size:12.5px',
        onclick: () => actions.applySaltScale(sug.value),
      }, `味付けを${Math.round(sug.value * 100)}%にして作り直す`) : null,
    ])),
    weekBars(week, plan.targets),
  ]));

  root.append(el('section', { class: 'card' }, [
    el('h2', {}, `第${wi + 1}週の日別（${formatDate(week.from, true)} 〜 ${formatDate(week.to)}）`),
    el('table', { class: 'mini' }, [
      el('thead', {}, el('tr', {}, [
        el('th', {}, '日'), el('th', {}, '判定'),
        ...['kcal', 'protein', 'salt', 'fiber', 'calcium', 'veg'].map((k) => el('th', { class: 'num' }, LABELS[k])),
      ])),
      el('tbody', {}, week.days.map((d) => el('tr', {}, [
        el('td', {}, formatDate(d.date)),
        el('td', {}, el('span', { class: `tag ${d.overall}` },
          { good: '良好', warn: '注意', bad: '要改善' }[d.overall])),
        ...['kcal', 'protein', 'salt', 'fiber', 'calcium', 'veg'].map((k) => {
          const item = d.items[k];
          const pct = item ? Math.round(item.ratio * 100) : null;
          return el('td', {
            class: 'num',
            style: item && item.level !== 'good'
              ? `color:var(--${item.level});font-weight:600` : '',
          }, pct == null ? '—' : `${pct}%`);
        }),
      ]))),
    ]),
  ]));

  const focus = state.ui.focusDate
    && plan.daysOut.some((d) => d.date === state.ui.focusDate)
    ? state.ui.focusDate
    : (week.problemDays[0]?.date || week.days[0].date);

  root.append(improveCard(plan, focus, week, actions));
  return root;
}

function weekBars(week, targets) {
  const keys = ['kcal', 'protein', 'salt', 'fiber', 'calcium', 'iron', 'vitC', 'veg'];
  return el('div', { class: 'nutri' }, keys.map((k) => {
    const item = week.judgement.items[k];
    const v = week.average[k];
    return el('div', { class: 'n-row' }, [
      el('span', {}, LABELS[k]),
      ratioBar(item.ratio, item.level, k === 'salt'),
      el('span', { class: 'n-val' },
        `${k === 'salt' || k === 'iron' ? v.toFixed(1) : Math.round(v)}${UNITS[k]} / ${Math.round(item.ratio * 100)}%`),
    ]);
  }));
}

function improveCard(plan, date, week, actions) {
  const day = plan.daysOut.find((d) => d.date === date);
  const problem = week.problemDays.find((p) => p.date === date);
  const candidates = swapCandidates(plan, date, 5);

  return el('section', { class: 'card' }, [
    el('h2', {}, `${formatDate(date, true)} を見直す`),
    el('div', { class: 'trip-nav' }, week.days.map((d) => el('button', {
      'aria-pressed': d.date === date,
      onclick: () => actions.setUi({ focusDate: d.date }, true),
    }, [formatDate(d.date), ' ', el('span', { class: `dot ${d.overall}` })]))),

    problem
      ? el('div', {}, [
        el('p', { class: 'sub', style: 'margin-bottom:4px' }, 'この日に足りない／多いもの:'),
        el('ul', { style: 'margin:0 0 14px;padding-left:18px;font-size:13.5px' },
          problem.issues.map((i) => el('li', { style: `color:var(--${i.level === 'bad' ? 'bad' : 'warn'})` }, i.text))),
      ])
      : el('p', { class: 'sub' }, `この日は判定「${day.judgement.overall === 'good' ? '良好' : day.judgement.overall}」です。それでも入れ替えたい場合は下から選べます。`),

    candidates.length === 0
      ? el('p', { class: 'sub' }, '今より良くなる差し替えは見つかりませんでした。')
      : el('div', {}, [
        el('p', { class: 'sub' }, '差し替え候補（栄養の改善が大きい順）:'),
        ...candidates.map((c) => el('div', { class: 'swap' }, [
          el('div', { class: 'headline' }, [
            el('span', { class: 'tag' }, c.slotLabel), ' ',
            c.fromName, ' → ', el('b', {}, c.toName),
            c.after !== c.before ? el('span', { class: `tag ${c.after}`, style: 'margin-left:6px' },
              `判定 ${jp(c.before)} → ${jp(c.after)}`) : null,
          ]),
          el('div', { class: 'delta' }, c.changes.slice(0, 4)
            .map((ch) => `${ch.label} ${ch.delta > 0 ? '+' : ''}${ch.delta}${ch.unit}（${ch.ratioAfter}%）`)
            .join(' ／ ')),
          el('button', {
            class: 'btn ghost no-print', style: 'margin-top:8px;padding:5px 12px;font-size:13px',
            onclick: () => actions.update((s) => { s.plan = applySwap(s.plan, c); }),
          }, 'この差し替えを適用'),
        ])),
      ]),
  ]);
}

const jp = (v) => ({ good: '良好', warn: '注意', bad: '要改善' }[v] || v);
