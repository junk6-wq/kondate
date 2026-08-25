import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INGREDIENTS, INGREDIENT_BY_ID, AISLE_ORDER } from '../src/data/ingredients.js';
import { RECIPES } from '../src/data/recipes.js';
import { recipeNutrition } from '../src/core/nutrition.js';

test('食材マスタのIDは一意', () => {
  assert.equal(new Set(INGREDIENTS.map((i) => i.id)).size, INGREDIENTS.length);
});

test('食材マスタの売り場はすべて巡回順に含まれる', () => {
  INGREDIENTS.forEach((i) => {
    assert.ok(AISLE_ORDER.includes(i.aisle), `${i.name} の売り場 ${i.aisle} が巡回順にない`);
  });
});

test('食材マスタの数値に欠損や負値がない', () => {
  const keys = ['unitG', 'keepDays', 'kcal', 'protein', 'fat', 'carb', 'fiber', 'salt', 'calcium', 'iron', 'vitC'];
  INGREDIENTS.forEach((i) => keys.forEach((k) => {
    assert.equal(typeof i[k], 'number', `${i.name}.${k} が数値でない`);
    assert.ok(i[k] >= 0, `${i.name}.${k} が負`);
  }));
});

test('レシピのIDは一意で、材料はすべて食材マスタに存在する', () => {
  assert.equal(new Set(RECIPES.map((r) => r.id)).size, RECIPES.length);
  RECIPES.forEach((r) => {
    assert.ok(r.ingredients.length > 0, `${r.name} に材料がない`);
    r.ingredients.forEach(({ id, grams }) => {
      assert.ok(INGREDIENT_BY_ID.has(id), `${r.name} の材料 ${id} がマスタにない`);
      assert.ok(grams > 0, `${r.name} の ${id} の分量が0以下`);
    });
  });
});

test('レシピの手順が空でない', () => {
  RECIPES.forEach((r) => {
    assert.ok(r.steps.length >= 1 && r.steps.every((s) => s.trim().length > 0), `${r.name} の手順が空`);
  });
});

test('各役割に献立を組めるだけのレシピがある', () => {
  const need = { main: 30, side: 25, soup: 10, breakfast: 10, lunch: 20, staple: 1 };
  Object.entries(need).forEach(([role, min]) => {
    const n = RECIPES.filter((r) => r.role === role).length;
    assert.ok(n >= min, `${role} が ${n} 品しかない（${min} 品以上必要）`);
  });
});

test('1人前のエネルギーと食塩が現実的な範囲に収まる', () => {
  RECIPES.forEach((r) => {
    const n = recipeNutrition(r);
    assert.ok(n.kcal < 900, `${r.name} が ${Math.round(n.kcal)}kcal と過大`);
    // 1食1人前で食塩4gを超えるものは、調味料のグラム数を間違えている可能性が高い
    assert.ok(n.salt < 4, `${r.name} の食塩が ${n.salt.toFixed(1)}g と過大`);
  });
});

test('主菜はたんぱく質源を含む', () => {
  RECIPES.filter((r) => r.role === 'main').forEach((r) => {
    const n = recipeNutrition(r);
    assert.ok(n.protein >= 10, `主菜 ${r.name} のたんぱく質が ${n.protein.toFixed(1)}g しかない`);
  });
});
