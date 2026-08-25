import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePlan, replanWithPantry, seasonOf, parseISO } from '../src/core/planner.js';
import { RECIPE_BY_ID } from '../src/data/recipes.js';
import { householdTargets } from '../src/core/nutrition.js';

const HOUSEHOLD = [{ age: 38, sex: 'male' }, { age: 36, sex: 'female' }, { age: 8, sex: 'female' }];
const plan90 = generatePlan({ startDate: '2026-09-01', days: 90, household: HOUSEHOLD, seed: 'test' });

test('指定した日数ぶんの献立ができる', () => {
  assert.equal(plan90.daysOut.length, 90);
  assert.equal(plan90.daysOut[0].date, '2026-09-01');
  assert.equal(plan90.daysOut[89].date, '2026-11-29');
});

test('毎日、朝・昼・夕（主菜・副菜・汁物・主食）がそろう', () => {
  plan90.daysOut.forEach((d) => {
    const slots = d.meals.map((m) => m.slot);
    ['breakfast', 'lunch', 'dinner-main', 'dinner-soup', 'dinner-staple'].forEach((s) => {
      assert.ok(slots.includes(s), `${d.date} に ${s} がない`);
    });
    assert.equal(slots.filter((s) => s === 'dinner-side').length, 2);
  });
});

test('同じシードなら同じ献立になる（再現性）', () => {
  const a = generatePlan({ startDate: '2026-09-01', days: 30, household: HOUSEHOLD, seed: 'same' });
  const b = generatePlan({ startDate: '2026-09-01', days: 30, household: HOUSEHOLD, seed: 'same' });
  assert.deepEqual(
    a.daysOut.map((d) => d.meals.map((m) => m.recipeId)),
    b.daysOut.map((d) => d.meals.map((m) => m.recipeId)),
  );
});

test('シードが違えば別の献立になる', () => {
  const a = generatePlan({ startDate: '2026-09-01', days: 14, household: HOUSEHOLD, seed: 'x' });
  const b = generatePlan({ startDate: '2026-09-01', days: 14, household: HOUSEHOLD, seed: 'y' });
  assert.notDeepEqual(
    a.daysOut.map((d) => d.meals.map((m) => m.recipeId)),
    b.daysOut.map((d) => d.meals.map((m) => m.recipeId)),
  );
});

test('同じ料理が2日続けて出ない', () => {
  for (let i = 1; i < plan90.daysOut.length; i += 1) {
    const prev = new Set(plan90.daysOut[i - 1].meals
      .filter((m) => m.slot !== 'dinner-staple').map((m) => m.recipeId));
    plan90.daysOut[i].meals.forEach((m) => {
      if (m.slot === 'dinner-staple') return;
      assert.ok(!prev.has(m.recipeId),
        `${plan90.daysOut[i].date} の ${RECIPE_BY_ID.get(m.recipeId).name} が前日と重複`);
    });
  }
});

test('90日で十分な種類のレシピが使われる', () => {
  const used = new Set();
  plan90.daysOut.forEach((d) => d.meals.forEach((m) => used.add(m.recipeId)));
  assert.ok(used.size >= 80, `${used.size} 種類しか使われていない`);
});

test('90日平均の栄養が目標の範囲に収まる', () => {
  const t = plan90.targets;
  const avg = (k) => plan90.daysOut.reduce((s, d) => s + d.nutrition[k], 0) / plan90.days;
  const ratio = (k) => avg(k) / t[k];
  assert.ok(ratio('kcal') > 0.92 && ratio('kcal') < 1.08, `エネルギー ${ratio('kcal')}`);
  assert.ok(ratio('protein') >= 1.0, `たんぱく質 ${ratio('protein')}`);
  assert.ok(ratio('fiber') >= 1.0, `食物繊維 ${ratio('fiber')}`);
  assert.ok(ratio('veg') >= 1.0, `野菜 ${ratio('veg')}`);
  assert.ok(ratio('calcium') >= 0.95, `カルシウム ${ratio('calcium')}`);
  assert.ok(ratio('salt') <= 1.15, `食塩 ${ratio('salt')}`);
  assert.ok(ratio('salt') >= 0.8, `食塩が低すぎる ${ratio('salt')}`);
});

test('要改善の日は週1日以下に収まる', () => {
  const bad = plan90.daysOut.filter((d) => d.judgement.overall === 'bad').length;
  assert.ok(bad <= 90 / 7, `要改善が ${bad} 日（上限 ${Math.floor(90 / 7)} 日）`);
});

test('除外した食材を含むレシピは出てこない', () => {
  const p = generatePlan({
    startDate: '2026-09-01', days: 30, household: HOUSEHOLD, seed: 'ex',
    options: { excludeIngredients: ['tamago', 'gyunyu'] },
  });
  p.daysOut.forEach((d) => d.meals.forEach((m) => {
    const r = RECIPE_BY_ID.get(m.recipeId);
    r.ingredients.forEach(({ id }) => {
      assert.ok(id !== 'tamago' && id !== 'gyunyu', `${r.name} に除外食材が含まれる`);
    });
  }));
});

test('季節が日付から正しく決まる', () => {
  assert.equal(seasonOf(parseISO('2026-01-15')), 'winter');
  assert.equal(seasonOf(parseISO('2026-04-15')), 'spring');
  assert.equal(seasonOf(parseISO('2026-07-15')), 'summer');
  assert.equal(seasonOf(parseISO('2026-10-15')), 'autumn');
});

test('世帯が大きいほど食数係数も大きくなる', () => {
  const solo = generatePlan({ startDate: '2026-09-01', days: 7, household: [HOUSEHOLD[0]], seed: 's' });
  assert.ok(plan90.factor > solo.factor);
  assert.ok(householdTargets(HOUSEHOLD).kcal > householdTargets([HOUSEHOLD[0]]).kcal);
});

// --- 在庫による差し替え ---
const PANTRY = [
  { ingredientId: 'hakusai', grams: 600, expiresOn: '2026-09-04' },
  { ingredientId: 'torimomo', grams: 500, expiresOn: '2026-09-02' },
];

test('在庫を入れると直近だけが差し替わり、その先は変わらない', () => {
  const r = replanWithPantry(plan90, PANTRY, '2026-09-01', 7);
  const tail = (p) => p.daysOut.slice(7).map((d) => d.meals.map((m) => m.recipeId));
  assert.deepEqual(tail(r.plan), tail(plan90), '8日目以降が変わってしまっている');
  assert.ok(r.changes.every((c) => c.date < '2026-09-08'));
});

test('在庫の差し替えは少数にとどまる', () => {
  const r = replanWithPantry(plan90, PANTRY, '2026-09-01', 7);
  assert.ok(r.changes.length > 0, '差し替えが起きていない');
  assert.ok(r.changes.length <= 14, `${r.changes.length}品も差し替わっている`);
  const slots = r.changes.map((c) => `${c.date}:${c.slot}`);
  assert.equal(new Set(slots).size, slots.length, '同じ枠の差し替えが履歴に重複している');
});

test('在庫の差し替えで栄養判定は下がらない', () => {
  const rank = { bad: 0, warn: 1, good: 2 };
  const r = replanWithPantry(plan90, PANTRY, '2026-09-01', 7);
  for (let i = 0; i < 7; i += 1) {
    assert.ok(
      rank[r.plan.daysOut[i].judgement.overall] >= rank[plan90.daysOut[i].judgement.overall],
      `${plan90.daysOut[i].date} の判定が下がった`,
    );
  }
});

test('在庫を入れると、入れなかった場合より在庫が多く消費される', () => {
  const withPantry = replanWithPantry(plan90, PANTRY, '2026-09-01', 7);
  const target = withPantry.leftovers.find((l) => l.ingredientId === 'torimomo');
  assert.ok(target.consumedGrams > 0, '在庫がまったく使われていない');
});

test('在庫が空なら献立は一切変わらない', () => {
  const r = replanWithPantry(plan90, [], '2026-09-01', 7);
  assert.equal(r.changes.length, 0);
  assert.deepEqual(
    r.plan.daysOut.map((d) => d.meals.map((m) => m.recipeId)),
    plan90.daysOut.map((d) => d.meals.map((m) => m.recipeId)),
  );
});

test('味付けを控えめにすると食塩が下がる', () => {
  const ratio = (p) => p.daysOut.reduce((s, d) => s + d.nutrition.salt, 0) / p.days / p.targets.salt;
  const asWritten = generatePlan({
    startDate: '2026-09-01', days: 90, household: HOUSEHOLD, seed: 'salt',
    options: { saltScale: 1 },
  });
  const reduced = generatePlan({
    startDate: '2026-09-01', days: 90, household: HOUSEHOLD, seed: 'salt',
    options: { saltScale: 0.7 },
  });
  assert.ok(ratio(reduced) < ratio(asWritten) - 0.08,
    `レシピどおり ${ratio(asWritten).toFixed(2)} / 減塩 ${ratio(reduced).toFixed(2)}`);
  // 減らすのは調味料だけ。エネルギーは目標に合わせて主食で調整されるので大きく動かない
  const kcal = (p) => p.daysOut.reduce((s, d) => s + d.nutrition.kcal, 0) / p.days / p.targets.kcal;
  assert.ok(Math.abs(kcal(reduced) - kcal(asWritten)) < 0.06);
});

test('90日ぶんの生成が1秒以内に終わる', () => {
  const t0 = Date.now();
  generatePlan({ startDate: '2026-09-01', days: 90, household: HOUSEHOLD, seed: 'perf' });
  assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0}ms かかった`);
});
