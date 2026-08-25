// 栄養レポートと差し替え候補
//
// 「バランスが良いです」で終わる評価は利用者を動かせない。
// 判定が悪かった日について、何をどれに替えれば良くなるかまで計算して返す。
// docs/prompt-design.md の P3 が受け取るデータ形はこのモジュールの出力に合わせてある。

import { RECIPE_BY_ID } from '../data/recipes.js';
import { recipeNutritionCached, judgeDay, addNutrition, emptyNutrition, imbalance, NUTRIENT_KEYS } from './nutrition.js';

export const LABELS = {
  kcal: 'エネルギー', protein: 'たんぱく質', fat: '脂質', carb: '炭水化物',
  fiber: '食物繊維', salt: '食塩相当量', calcium: 'カルシウム', iron: '鉄',
  vitC: 'ビタミンC', veg: '野菜',
};
export const UNITS = {
  kcal: 'kcal', protein: 'g', fat: 'g', carb: 'g', fiber: 'g',
  salt: 'g', calcium: 'mg', iron: 'mg', vitC: 'mg', veg: 'g',
};

export const SLOT_LABELS = {
  breakfast: '朝食', lunch: '昼食', 'dinner-main': '主菜',
  'dinner-side': '副菜', 'dinner-soup': '汁物', 'dinner-staple': '主食',
};

/** 週(7日)単位の集計。日単位の判定は振れるので、合否は週平均で見るのが実務的。 */
export function weeklyReport(plan, weekIndex) {
  const from = weekIndex * 7;
  const days = plan.daysOut.slice(from, from + 7);
  if (days.length === 0) return null;

  const sum = days.reduce((acc, d) => addNutrition(acc, d.nutrition), emptyNutrition());
  const avg = {};
  NUTRIENT_KEYS.forEach((k) => { avg[k] = sum[k] / days.length; });
  const judgement = judgeDay(avg, plan.targets);

  return {
    weekIndex,
    from: days[0].date,
    to: days[days.length - 1].date,
    average: avg,
    judgement,
    days: days.map((d) => ({
      date: d.date,
      overall: d.judgement.overall,
      nutrition: d.nutrition,
      items: d.judgement.items,
    })),
    // 週内で判定の悪い日を、影響の大きい順に並べる
    problemDays: days
      .filter((d) => d.judgement.overall !== 'good')
      .sort((a, b) => a.judgement.score - b.judgement.score)
      .slice(0, 3)
      .map((d) => ({ date: d.date, issues: describeIssues(d, plan.targets) })),
  };
}

/** その日の判定から、問題を人が読める形にする。数値は丸め、達成率を併記する。 */
export function describeIssues(day, targets) {
  const out = [];
  const push = (key, level, actual, target) => {
    out.push({
      key,
      level,
      label: LABELS[key],
      actual: round(actual, key),
      target: round(target, key),
      unit: UNITS[key],
      ratio: Math.round((actual / target) * 100),
      text: `${LABELS[key]} ${round(actual, key)}${UNITS[key]}（目標${round(target, key)}${UNITS[key]} / ${Math.round((actual / target) * 100)}%）`,
    });
  };
  Object.values(day.judgement.items).forEach((it) => {
    if (it.level !== 'good') push(it.key, it.level, it.actual, it.target);
  });
  Object.values(day.judgement.pfc).forEach((p) => {
    if (p.level === 'good') return;
    // ここに来るのは範囲を外れている項目だけ。整数に丸めると19.6%が
    // 「20%（適正20〜30%）」となって範囲内にしか見えないので、
    // 丸めた値が範囲に入ってしまう場合だけ小数1桁で出す。
    const pct = p.ratio * 100;
    const [lo, hi] = [p.range[0] * 100, p.range[1] * 100];
    const rounded = Math.round(pct);
    const shown = rounded >= lo && rounded <= hi ? pct.toFixed(1) : String(rounded);
    out.push({
      key: `pfc-${p.key}`,
      level: p.level,
      label: `${LABELS[p.key]}のエネルギー比`,
      actual: Math.round(pct),
      unit: '%E',
      text: `${LABELS[p.key]}が総エネルギーの${shown}%（適正 ${Math.round(p.range[0] * 100)}〜${Math.round(p.range[1] * 100)}%）`,
    });
  });
  // 食塩の超過とたんぱく質の不足を先頭に。前者は積み重なると健康被害に直結し、
  // 後者は他の栄養素の利用にも影響するため、他の指摘より優先して伝えたい。
  const priority = (i) => (i.key === 'salt' ? 0 : i.key === 'protein' ? 1 : i.level === 'bad' ? 2 : 3);
  return out.sort((a, b) => priority(a) - priority(b)).slice(0, 4);
}

/**
 * その日の献立から1品を差し替えて、判定がどれだけ良くなるかを計算する。
 * 指摘だけ返しても利用者は動けないので、必ずこれとセットで提示する。
 */
export function swapCandidates(plan, dateISO, limit = 5) {
  const day = plan.daysOut.find((d) => d.date === dateISO);
  if (!day) return [];
  const pools = {};
  RECIPE_BY_ID.forEach((r) => {
    if (!pools[r.role]) pools[r.role] = [];
    pools[r.role].push(r);
  });

  const base = day.meals.reduce(
    (acc, m) => addNutrition(acc, recipeNutritionCached(RECIPE_BY_ID.get(m.recipeId), plan.saltScale ?? 1), plan.factor * m.portion),
    emptyNutrition(),
  );
  const baseJudge = judgeDay(base, plan.targets);
  const baseCost = imbalance(base, plan.targets);
  const chosen = new Set(day.meals.map((m) => m.recipeId));
  const results = [];

  day.meals.forEach((meal, idx) => {
    const from = RECIPE_BY_ID.get(meal.recipeId);
    if (from.role === 'staple') return;
    const removed = addNutrition(base, recipeNutritionCached(from, plan.saltScale ?? 1), -plan.factor * meal.portion);
    (pools[from.role] || []).forEach((cand) => {
      if (chosen.has(cand.id)) return;
      const next = addNutrition(removed, recipeNutritionCached(cand, plan.saltScale ?? 1), plan.factor * meal.portion);
      const j = judgeDay(next, plan.targets);
      // 判定レベルが変わらなくても目標に近づく差し替えは価値がある。
      // レベルの変化だけで足切りすると、食塩が大幅超過の日に候補が1件も出ない。
      const gain = baseCost - imbalance(next, plan.targets);
      if (gain <= 1e-6) return;
      results.push({
        id: `${dateISO}:${idx}:${cand.id}`,
        date: dateISO,
        slot: meal.slot,
        slotLabel: SLOT_LABELS[meal.slot],
        fromId: from.id,
        fromName: from.name,
        toId: cand.id,
        toName: cand.name,
        gain: Math.round(gain * 1000) / 1000,
        before: baseJudge.overall,
        after: j.overall,
        changes: NUTRIENT_KEYS
          .filter((k) => Math.abs(next[k] - base[k]) / Math.max(plan.targets[k], 1) > 0.03)
          .map((k) => ({
            key: k, label: LABELS[k], unit: UNITS[k],
            delta: round(next[k] - base[k], k),
            ratioAfter: Math.round((next[k] / plan.targets[k]) * 100),
          })),
      });
    });
  });

  return results.sort((a, b) => b.gain - a.gain).slice(0, limit);
}

/** 献立を1品差し替えた新しいプランを返す。元のプランは変更しない。 */
export function applySwap(plan, swap) {
  if (!swap) return plan;
  const daysOut = plan.daysOut.map((d) => {
    if (d.date !== swap.date) return d;
    const meals = d.meals.map((m) => (m.slot === swap.slot && m.recipeId === swap.fromId
      ? { ...m, recipeId: swap.toId } : m));
    const nutrition = meals.reduce(
      (acc, m) => addNutrition(acc, recipeNutritionCached(RECIPE_BY_ID.get(m.recipeId), plan.saltScale ?? 1), plan.factor * m.portion),
      emptyNutrition(),
    );
    const rounded = {};
    NUTRIENT_KEYS.forEach((k) => { rounded[k] = Math.round(nutrition[k] * 10) / 10; });
    return { ...d, meals, nutrition: rounded, judgement: judgeDay(nutrition, plan.targets) };
  });
  return { ...plan, daysOut };
}

function round(v, key) {
  if (key === 'iron') return Math.round(v * 10) / 10;
  if (key === 'salt') return Math.round(v * 10) / 10;
  return Math.round(v);
}

/**
 * 週の結果から、設定で直せることを提案する。
 * 個々の献立を差し替えても直らない種類の問題(食塩が全体に高い、など)は、
 * 日ごとの差し替え候補ではなく設定の話として伝えないと利用者は堂々巡りになる。
 */
export function settingSuggestions(week, plan) {
  const out = [];
  const salt = week.judgement.items.salt;
  const scale = plan.saltScale ?? 1;
  if (salt.ratio > 1.05 && scale > 0.7) {
    const next = scale > 0.85 ? 0.85 : 0.7;
    out.push({
      key: 'saltScale',
      value: next,
      text: `食塩が週平均で目標の${Math.round(salt.ratio * 100)}%です。`
        + `個々の献立を入れ替えるより、「設定」の味付けを${scale > 0.85 ? 'ひかえめ（85%）' : 'しっかり減塩（70%）'}にするほうが確実に下がります。`,
    });
  }
  if (week.judgement.items.kcal.ratio < 0.9) {
    out.push({
      key: 'kcal',
      text: 'エネルギーが不足ぎみです。活動量の設定が実際より低くないか確認してください。',
    });
  }
  return out;
}

/** APIキーなしでも講評を出せるようにするテンプレート版(prompt-design.md の P3 の代替)。 */
export function localHeadline(week) {
  const j = week.judgement;
  const salt = j.items.salt;
  // 食塩の超過は他の項目が良好でも必ず見出しに出す。
  // 「目標を満たしています」と書いた真下に食塩の警告が並ぶと、
  // どちらを信じればよいのか分からなくなる。
  if (salt.ratio > 1.0) {
    const head = j.overall === 'good' ? '週平均はおおむね良好ですが' : '週平均に注意が必要です';
    return `${head}、食塩が目標の${Math.round(salt.ratio * 100)}%です。`;
  }
  if (j.overall === 'good') return '週平均で目標を満たしています。この調子で。';
  const worst = Object.values(j.items)
    .filter((i) => i.level !== 'good')
    .sort((a, b) => Math.abs(1 - a.ratio) - Math.abs(1 - b.ratio)).pop();
  if (!worst) return '週平均はおおむね目標どおりです。';
  return `週平均で${LABELS[worst.key]}が${Math.round(worst.ratio * 100)}%。足す方向の調整をおすすめします。`;
}
