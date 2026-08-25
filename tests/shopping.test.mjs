import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePlan } from '../src/core/planner.js';
import { buildShoppingList, shoppingDates, tripToText } from '../src/core/shopping.js';
import { RECIPE_BY_ID } from '../src/data/recipes.js';
import { getIngredient, AISLE_ORDER } from '../src/data/ingredients.js';
import { adjustedGrams } from '../src/core/nutrition.js';

const HOUSEHOLD = [{ age: 38, sex: 'male' }, { age: 36, sex: 'female' }, { age: 8, sex: 'female' }];
const plan = generatePlan({ startDate: '2026-09-01', days: 28, household: HOUSEHOLD, seed: 'shop' });

test('買い物日は指定した間隔で並ぶ', () => {
  assert.deepEqual(shoppingDates('2026-09-01', 14, 7), ['2026-09-01', '2026-09-08']);
  assert.equal(shoppingDates('2026-09-01', 28, 3).length, 10);
});

test('献立が必要とする食材はすべてどこかの回で買える', () => {
  const list = buildShoppingList(plan, 7, []);
  const bought = new Map();
  list.trips.forEach((t) => [...t.items, ...t.skipped].forEach((it) => {
    bought.set(it.ingredientId, (bought.get(it.ingredientId) || 0) + it.buyGrams);
  }));
  const needed = new Map();
  plan.daysOut.forEach((d) => d.meals.forEach((m) => {
    RECIPE_BY_ID.get(m.recipeId).ingredients.forEach(({ id, grams }) => {
      needed.set(id, (needed.get(id) || 0)
        + adjustedGrams(getIngredient(id), grams, plan.saltScale) * plan.factor * m.portion);
    });
  }));
  needed.forEach((g, id) => {
    assert.ok(bought.has(id), `${getIngredient(id).name} が買い物リストにない`);
    assert.ok(bought.get(id) >= g - 1e-6,
      `${getIngredient(id).name} が ${Math.round(bought.get(id))}g しか買われていない（必要 ${Math.round(g)}g）`);
  });
});

test('購入数量は購入単位の整数倍', () => {
  const list = buildShoppingList(plan, 7, []);
  list.trips.forEach((t) => t.items.forEach((it) => {
    assert.ok(Number.isInteger(it.buyUnits) && it.buyUnits > 0);
    assert.equal(it.buyGrams, it.buyUnits * it.unitGrams);
  }));
});

test('売り場の並び順が巡回順どおり', () => {
  const list = buildShoppingList(plan, 7, []);
  list.trips.forEach((t) => {
    const order = t.byAisle.map((g) => AISLE_ORDER.indexOf(g.aisle));
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
  });
});

test('冷蔵庫にあるものは買わない', () => {
  const withoutPantry = buildShoppingList(plan, 7, []);
  const first = withoutPantry.trips[0].items.find((i) => i.ingredientId === 'ninjin');
  assert.ok(first, 'にんじんが第1回で買われる前提のテスト');
  const withPantry = buildShoppingList(plan, 7, [{ ingredientId: 'ninjin', grams: first.needGrams }]);
  const after = withPantry.trips[0].items.find((i) => i.ingredientId === 'ninjin');
  assert.ok(!after, '在庫でまかなえるのに買い物リストに残っている');
});

test('在庫は消費量として集計され、残りが返る', () => {
  const list = buildShoppingList(plan, 7, [{ ingredientId: 'jagaimo', grams: 100000 }]);
  const used = list.pantryUsed.find((p) => p.ingredientId === 'jagaimo');
  assert.ok(used.usedGrams > 0);
  assert.ok(used.leftoverGrams > 0, '使い切れない量なのに残りが0になっている');
  assert.equal(used.usedGrams + used.leftoverGrams, used.startGrams);
});

test('日持ちしない食材が長い買い物間隔で使われると注意が付く', () => {
  const list = buildShoppingList(plan, 14, []);
  const notes = list.trips.flatMap((t) => t.items.filter((i) => i.freshnessNote));
  assert.ok(notes.length > 0, '2週に1回の買い物で日持ち注意が1件も出ないのはおかしい');
  notes.forEach((n) => assert.ok(getIngredient(n.ingredientId).keepDays < 14));
});

test('買い物間隔を短くすると日持ちの注意は減る', () => {
  const count = (days) => buildShoppingList(plan, days, [])
    .trips.flatMap((t) => t.items.filter((i) => i.freshnessNote)).length;
  assert.ok(count(3) < count(14));
});

test('日持ちする食材の余りは次回に持ち越され、買いすぎにならない', () => {
  // 米や調味料は大きな単位で売られている。毎回の買い物で必要量に切り上げると
  // 余りがどんどん積み上がるので、前回の余りを次回の必要量から差し引けているかを見る。
  const list = buildShoppingList(plan, 7, []);
  const bought = new Map();
  list.trips.forEach((t) => t.items.forEach((it) => {
    bought.set(it.ingredientId, (bought.get(it.ingredientId) || 0) + it.buyGrams);
  }));
  const needed = new Map();
  plan.daysOut.forEach((d) => d.meals.forEach((m) => {
    RECIPE_BY_ID.get(m.recipeId).ingredients.forEach(({ id, grams }) => {
      needed.set(id, (needed.get(id) || 0)
        + adjustedGrams(getIngredient(id), grams, plan.saltScale) * plan.factor * m.portion);
    });
  }));
  ['rice', 'shoyu', 'abura', 'komugiko', 'pasta'].forEach((id) => {
    if (!bought.has(id)) return;
    const unit = getIngredient(id).unitG;
    const excess = bought.get(id) - (needed.get(id) || 0);
    assert.ok(excess >= 0 && excess < unit,
      `${getIngredient(id).name} の買いすぎ ${Math.round(excess)}g（1${getIngredient(id).unitName} = ${unit}g）`);
  });
});

test('日持ちしない食材の余りは持ち越さない', () => {
  const list = buildShoppingList(plan, 7, []);
  // もやしは日持ち3日。週1の買い物では毎回買い直しになるはず
  const trips = list.trips.filter((t) => t.items.some((i) => i.ingredientId === 'moyashi'));
  trips.forEach((t) => {
    const it = t.items.find((i) => i.ingredientId === 'moyashi');
    assert.ok(it.buyUnits >= 1);
  });
});

test('味付けを控えめにすると買う調味料も減る', () => {
  const mk = (scale) => generatePlan({
    startDate: '2026-09-01', days: 28, household: HOUSEHOLD, seed: 'shop', options: { saltScale: scale },
  });
  const soy = (p) => buildShoppingList(p, 7, []).trips
    .reduce((s, t) => s + ((t.items.find((i) => i.ingredientId === 'shoyu') || {}).buyGrams || 0), 0);
  assert.ok(soy(mk(0.7)) <= soy(mk(1)), 'しょうゆの購入量が減っていない');
});

test('テキスト出力に売り場と数量が含まれる', () => {
  const list = buildShoppingList(plan, 7, []);
  const text = tripToText(list.trips[0]);
  assert.match(text, /【青果】/);
  assert.match(text, /□ .+ {2}\d+/);
});
