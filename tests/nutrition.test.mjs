import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  personTargets, householdTargets, householdFactor, recipeNutrition,
  judgeDay, imbalance, emptyNutrition,
} from '../src/core/nutrition.js';
import { RECIPE_BY_ID } from '../src/data/recipes.js';

test('成人男性の目標値が食事摂取基準の水準に一致する', () => {
  const t = personTargets({ age: 38, sex: 'male', activity: 'normal' });
  assert.equal(t.kcal, 2700);
  assert.equal(t.salt, 7.5);
  assert.equal(t.fiber, 21);
  assert.equal(t.calcium, 750);
  assert.equal(t.iron, 7.5);
});

test('成人女性の食塩上限は男性より低い', () => {
  assert.ok(personTargets({ age: 36, sex: 'female' }).salt
    < personTargets({ age: 38, sex: 'male' }).salt);
});

test('身体活動レベルでエネルギーが増減する', () => {
  const low = personTargets({ age: 30, sex: 'male', activity: 'low' }).kcal;
  const mid = personTargets({ age: 30, sex: 'male', activity: 'normal' }).kcal;
  const high = personTargets({ age: 30, sex: 'male', activity: 'high' }).kcal;
  assert.ok(low < mid && mid < high);
});

test('妊娠・授乳でエネルギーが加算される', () => {
  const base = personTargets({ age: 30, sex: 'female' }).kcal;
  assert.equal(personTargets({ age: 30, sex: 'female', pregnancy: 'late' }).kcal, base + 450);
  assert.equal(personTargets({ age: 30, sex: 'female', pregnancy: 'lactating' }).kcal, base + 350);
});

test('小児の食塩上限は体格比で按分せず個別の値を使う', () => {
  // 按分すると8歳女児は 6.5 * (1700/2000) = 5.5g になるが、基準値は5.0g
  assert.equal(personTargets({ age: 8, sex: 'female' }).salt, 5.0);
});

test('世帯目標は全員分の合計', () => {
  const a = { age: 38, sex: 'male' };
  const b = { age: 36, sex: 'female' };
  const t = householdTargets([a, b]);
  assert.equal(t.kcal, personTargets(a).kcal + personTargets(b).kcal);
  assert.equal(t.salt, personTargets(a).salt + personTargets(b).salt);
});

test('食数係数はエネルギー必要量に比例する', () => {
  const one = householdFactor([{ age: 38, sex: 'male' }]);
  const two = householdFactor([{ age: 38, sex: 'male' }, { age: 38, sex: 'male' }]);
  assert.ok(Math.abs(two - one * 2) < 1e-9);
});

test('レシピの栄養は材料から計算される', () => {
  // ごはん = 米65g。米は342kcal/100g なので 222kcal前後。
  const n = recipeNutrition(RECIPE_BY_ID.get('gohan'));
  assert.ok(Math.abs(n.kcal - 222) < 2, `${n.kcal}kcal`);
  assert.equal(n.salt, 0);
});

test('野菜量にいも・きのこ・海藻は含めない', () => {
  // 健康日本21の野菜摂取目標350gはこれらを含まないため
  const potato = recipeNutrition({ ingredients: [{ id: 'jagaimo', grams: 100 }] });
  const carrot = recipeNutrition({ ingredients: [{ id: 'ninjin', grams: 100 }] });
  const mushroom = recipeNutrition({ ingredients: [{ id: 'shimeji', grams: 100 }] });
  assert.equal(potato.veg, 0);
  assert.equal(mushroom.veg, 0);
  assert.equal(carrot.veg, 100);
});

test('食塩の超過は単独でその日を要改善にする', () => {
  const targets = householdTargets([{ age: 38, sex: 'male' }]);
  const perfect = { ...targets, veg: targets.veg, salt: targets.salt * 0.9 };
  assert.notEqual(judgeDay(perfect, targets).overall, 'bad');
  assert.equal(judgeDay({ ...perfect, salt: targets.salt * 1.5 }, targets).overall, 'bad');
});

test('目標からのずれは目標どおりのとき0に近く、外れるほど大きい', () => {
  const targets = householdTargets([{ age: 38, sex: 'male' }]);
  const onTarget = { ...targets };
  const short = { ...targets, protein: targets.protein * 0.5, veg: targets.veg * 0.4 };
  assert.ok(imbalance(onTarget, targets) < imbalance(short, targets));
  assert.ok(imbalance(emptyNutrition(), targets) > imbalance(short, targets));
});
