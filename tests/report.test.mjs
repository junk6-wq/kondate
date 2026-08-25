import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePlan } from '../src/core/planner.js';
import {
  weeklyReport, swapCandidates, applySwap, describeIssues, settingSuggestions, localHeadline,
} from '../src/core/report.js';

const HOUSEHOLD = [{ age: 38, sex: 'male' }, { age: 36, sex: 'female' }, { age: 8, sex: 'female' }];
const plan = generatePlan({ startDate: '2026-09-01', days: 28, household: HOUSEHOLD, seed: 'rep' });

test('週レポートは7日分を平均する', () => {
  const w = weeklyReport(plan, 0);
  assert.equal(w.days.length, 7);
  assert.equal(w.from, '2026-09-01');
  assert.equal(w.to, '2026-09-07');
  const manual = plan.daysOut.slice(0, 7).reduce((s, d) => s + d.nutrition.kcal, 0) / 7;
  assert.ok(Math.abs(w.average.kcal - manual) < 0.5);
});

test('範囲外の週を求めると null', () => {
  assert.equal(weeklyReport(plan, 99), null);
});

test('指摘には必ず数値と達成率が入る', () => {
  const day = plan.daysOut.find((d) => d.judgement.overall !== 'good') || plan.daysOut[0];
  const issues = describeIssues(day, plan.targets);
  issues.forEach((i) => {
    assert.ok(i.text.length > 0);
    assert.match(i.text, /\d/);
  });
});

test('食塩とたんぱく質の指摘は他より先に並ぶ', () => {
  // 影響が大きいものから伝えないと、利用者は何から手をつけるか判断できない
  const fake = {
    judgement: {
      items: {
        salt: { key: 'salt', level: 'bad', actual: 25, target: 19, ratio: 1.3 },
        vitC: { key: 'vitC', level: 'warn', actual: 200, target: 268, ratio: 0.75 },
        protein: { key: 'protein', level: 'warn', actual: 180, target: 210, ratio: 0.86 },
      },
      pfc: {},
    },
  };
  const order = describeIssues(fake, plan.targets).map((i) => i.key);
  assert.equal(order[0], 'salt');
  assert.equal(order[1], 'protein');
});

test('差し替え候補は栄養が改善するものだけを返す', () => {
  const day = plan.daysOut.find((d) => d.judgement.overall !== 'good');
  if (!day) return;
  const cands = swapCandidates(plan, day.date, 5);
  assert.ok(cands.length > 0, '要改善の日に候補が1件も出ていない');
  cands.forEach((c) => {
    assert.ok(c.gain > 0);
    assert.ok(c.fromId !== c.toId);
    assert.ok(c.changes.length > 0, '何が変わるのか示されていない');
  });
  // 改善の大きい順
  const gains = cands.map((c) => c.gain);
  assert.deepEqual(gains, [...gains].sort((a, b) => b - a));
});

test('差し替え候補に主食は含まれない（量で調整するため）', () => {
  plan.daysOut.slice(0, 5).forEach((d) => {
    swapCandidates(plan, d.date, 5).forEach((c) => {
      assert.notEqual(c.slot, 'dinner-staple');
    });
  });
});

test('差し替えを適用するとその日だけが変わる', () => {
  const day = plan.daysOut.find((d) => d.judgement.overall !== 'good');
  const cand = swapCandidates(plan, day.date, 1)[0];
  const after = applySwap(plan, cand);
  assert.notDeepEqual(
    after.daysOut.find((d) => d.date === day.date).meals,
    day.meals,
  );
  plan.daysOut.filter((d) => d.date !== day.date).forEach((d) => {
    assert.deepEqual(after.daysOut.find((x) => x.date === d.date).meals, d.meals);
  });
  assert.deepEqual(plan.daysOut.find((d) => d.date === day.date).meals, day.meals, '元のプランが書き換わっている');
});

test('差し替えを適用すると栄養の判定が計算し直される', () => {
  const day = plan.daysOut.find((d) => d.judgement.overall !== 'good');
  const cand = swapCandidates(plan, day.date, 1)[0];
  const after = applySwap(plan, cand).daysOut.find((d) => d.date === day.date);
  assert.notDeepEqual(after.nutrition, day.nutrition);
  assert.ok(after.judgement.items.salt.ratio > 0);
});

test('存在しない差し替えを渡してもプランは壊れない', () => {
  assert.equal(applySwap(plan, null), plan);
  assert.equal(swapCandidates(plan, '1999-01-01').length, 0);
});

test('食塩が高い週には味付けの設定変更が提案される', () => {
  const salty = generatePlan({
    startDate: '2026-09-01', days: 7, household: HOUSEHOLD, seed: 'rep', options: { saltScale: 1 },
  });
  const w = weeklyReport(salty, 0);
  if (w.judgement.items.salt.ratio > 1.05) {
    const sug = settingSuggestions(w, salty);
    assert.ok(sug.some((s) => s.key === 'saltScale'), '食塩が高いのに設定の提案がない');
  }
});

test('すでに減塩済みならそれ以上の提案はしない', () => {
  const low = generatePlan({
    startDate: '2026-09-01', days: 7, household: HOUSEHOLD, seed: 'rep', options: { saltScale: 0.7 },
  });
  const sug = settingSuggestions(weeklyReport(low, 0), low);
  assert.ok(!sug.some((s) => s.key === 'saltScale'));
});

test('見出しは常に文章を返す', () => {
  for (let i = 0; i < 4; i += 1) {
    const w = weeklyReport(plan, i);
    assert.ok(typeof localHeadline(w) === 'string' && localHeadline(w).length > 5);
  }
});

test('食塩が超過していれば見出しでも触れる', () => {
  // 見出しが「目標を満たしています」なのに直下に食塩の警告が並ぶと矛盾して見える
  const salty = generatePlan({
    startDate: '2026-09-01', days: 7, household: HOUSEHOLD, seed: 'rep', options: { saltScale: 1 },
  });
  const w = weeklyReport(salty, 0);
  if (w.judgement.items.salt.ratio > 1.0) {
    assert.match(localHeadline(w), /食塩/);
  }
});

test('PFCの指摘が適正範囲内に見える丸めをしない', () => {
  const fake = {
    judgement: {
      items: {},
      pfc: { fat: { key: 'fat', level: 'warn', ratio: 0.1962, range: [0.20, 0.30] } },
    },
  };
  const text = describeIssues(fake, plan.targets)[0].text;
  assert.ok(!/の20%（適正 20/.test(text), `丸めで範囲内に見えている: ${text}`);
});
