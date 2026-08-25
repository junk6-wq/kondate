// スコア重みの探索。判定good率と各栄養素の達成率を実測して比較する。
// 重みを勘で決めると、ある指標を直すと別が壊れる。探索して数値で決める。
import { generatePlan } from '../src/core/planner.js';

const HOUSEHOLDS = [
  [{ age: 38, sex: 'male' }, { age: 36, sex: 'female' }, { age: 8, sex: 'female' }],
  [{ age: 29, sex: 'female', activity: 'low' }],
  [{ age: 68, sex: 'male' }, { age: 66, sex: 'female' }],
];
const SEEDS = ['a', 'b', 'c'];

function evaluate(weights) {
  const acc = { good: 0, warn: 0, bad: 0, n: 0 };
  const ratios = {};
  for (const household of HOUSEHOLDS) {
    for (const seed of SEEDS) {
      const plan = generatePlan({ startDate: '2026-09-01', days: 90, household, seed, options: { weights } });
      plan.daysOut.forEach((d) => { acc[d.judgement.overall] += 1; acc.n += 1; });
      const seen = new Set();
      plan.daysOut.forEach((d) => d.meals.forEach((m) => seen.add(m.recipeId)));
      acc.variety = (acc.variety || 0) + seen.size / (HOUSEHOLDS.length * SEEDS.length);
      let dup = 0;
      for (let i = 1; i < plan.daysOut.length; i += 1) {
        const prev = new Set(plan.daysOut[i - 1].meals.map((m) => m.recipeId));
        dup += plan.daysOut[i].meals.filter((m) => prev.has(m.recipeId) && m.slot !== 'dinner-staple').length;
      }
      acc.dup = (acc.dup || 0) + dup / (HOUSEHOLDS.length * SEEDS.length);
      ['kcal', 'protein', 'fiber', 'salt', 'calcium', 'iron', 'veg'].forEach((k) => {
        const r = plan.daysOut.reduce((s, d) => s + d.nutrition[k], 0) / plan.days / plan.targets[k];
        ratios[k] = (ratios[k] || 0) + r / (HOUSEHOLDS.length * SEEDS.length);
      });
    }
  }
  return { goodRate: acc.good / acc.n, badRate: acc.bad / acc.n, variety: acc.variety, dup: acc.dup, ratios };
}

const grid = [];
grid.push({});
const results = grid.map((g) => {
  const r = evaluate(g);
  return { ...g, ...r };
});
results.sort((a, b) => (b.goodRate - b.badRate) - (a.goodRate - a.badRate));
console.log('             good%  bad%   ' + ['kcal', 'protein', 'fiber', 'salt', 'calcium', 'iron', 'veg'].map((k) => k.padStart(8)).join(''));
results.forEach((r) => {
  console.log(
    '現行設定     '
    + (r.goodRate * 100).toFixed(0).padStart(4) + '%'
    + (r.badRate * 100).toFixed(0).padStart(5) + '%'
    + `  種類${r.variety.toFixed(0)} 連日重複${r.dup.toFixed(0)}  `
    + ['kcal', 'protein', 'fiber', 'salt', 'calcium', 'iron', 'veg']
      .map((k) => `${(r.ratios[k] * 100).toFixed(0)}%`.padStart(8)).join(''),
  );
});
