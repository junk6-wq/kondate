// 買い物リストの集約
//
// 献立と買い物リストを別々に作ると必ず破綻する。レシピが要求するのは「にんじん40g」でも、
// 店で売っているのは1本150g。この差を無視すると、レシピ通りに買って必ず余る。
// ここでは購入単位への丸めと、その余りの持ち越しまでを一続きで扱う。

import { getIngredient, AISLE_ORDER, AISLES } from '../data/ingredients.js';
import { adjustedGrams } from './nutrition.js';
import { RECIPE_BY_ID } from '../data/recipes.js';
import { parseISO, toISO, addDays } from './planner.js';

/** 買い物日の一覧。開始日から interval 日ごと。 */
export function shoppingDates(startISO, days, intervalDays) {
  const start = parseISO(startISO);
  const out = [];
  for (let i = 0; i < days; i += intervalDays) out.push(toISO(addDays(start, i)));
  return out;
}

/**
 * ある使用日を、どの買い物日で買うかに割り当てる。
 *
 * 生鮮を「使う日より前ならいつ買ってもいい」ことにすると、
 * 週1の買い物でもやし(日持ち3日)を7日分買うような、実行不可能なリストができる。
 * 日持ちの範囲に入る最も遅い買い物日を選び、どの買い物日でも届かないものは印をつけて返す。
 */
function assignTrip(useISO, tripISOs, keepDays) {
  const use = parseISO(useISO);
  let fallback = null;
  for (let i = tripISOs.length - 1; i >= 0; i -= 1) {
    const trip = parseISO(tripISOs[i]);
    if (trip > use) continue;
    if (fallback === null) fallback = { index: i, stale: true, gap: Math.round((use - trip) / 86400000) };
    const gap = Math.round((use - trip) / 86400000);
    if (gap <= keepDays) return { index: i, stale: false, gap };
  }
  return fallback ?? { index: 0, stale: true, gap: 0 };
}

/**
 * 献立から買い物リストを作る。
 *
 * @param plan            generatePlan の戻り値
 * @param intervalDays    買い物の間隔(日)
 * @param pantry          冷蔵庫の在庫。買う前に差し引く
 */
export function buildShoppingList(plan, intervalDays = 7, pantry = []) {
  const trips = shoppingDates(plan.startDate, plan.days, intervalDays);
  // trip index -> ingredientId -> { grams, staleDays }
  const need = trips.map(() => new Map());

  plan.daysOut.forEach((day) => {
    day.meals.forEach((meal) => {
      const recipe = RECIPE_BY_ID.get(meal.recipeId);
      if (!recipe) return;
      recipe.ingredients.forEach(({ id, grams }) => {
        const ing = getIngredient(id);
        // 味付けを控えめにしているなら、買う調味料の量もそれに合わせる
        const total = adjustedGrams(ing, grams, plan.saltScale ?? 1)
          * plan.factor * (meal.portion ?? 1);
        const { index, stale, gap } = assignTrip(day.date, trips, ing.keepDays);
        const bucket = need[index];
        const prev = bucket.get(id) || { grams: 0, staleDays: 0, uses: [] };
        prev.grams += total;
        if (stale) prev.staleDays = Math.max(prev.staleDays, gap);
        prev.uses.push({ date: day.date, recipeId: recipe.id, grams: total });
        bucket.set(id, prev);
      });
    });
  });

  // 冷蔵庫の在庫と、買って余った分の持ち越しは分けて持つ。
  // ひとつのマップにまとめると「在庫をどれだけ使えたか」が買った分の余りに混ざり、
  // 在庫の消費状況を利用者に返せなくなる(実際そうなった)。在庫を先に使い切る。
  const pantryStock = new Map();
  (pantry || []).forEach((p) => pantryStock.set(p.ingredientId, (pantryStock.get(p.ingredientId) || 0) + p.grams));
  const pantryStart = new Map(pantryStock);
  const stock = new Map();

  const out = trips.map((date, i) => {
    const items = [];
    const sorted = [...need[i].entries()].sort((a, b) => {
      const ia = getIngredient(a[0]); const ib = getIngredient(b[0]);
      const oa = AISLE_ORDER.indexOf(ia.aisle); const ob = AISLE_ORDER.indexOf(ib.aisle);
      return oa === ob ? ia.name.localeCompare(ib.name, 'ja') : oa - ob;
    });

    sorted.forEach(([id, entry]) => {
      const ing = getIngredient(id);
      const fromPantry = Math.min(pantryStock.get(id) || 0, entry.grams);
      pantryStock.set(id, (pantryStock.get(id) || 0) - fromPantry);
      const carried = stock.get(id) || 0;
      const fromStock = Math.min(carried, entry.grams - fromPantry);
      const net = entry.grams - fromPantry - fromStock;

      let units = 0;
      if (net > 0) units = Math.ceil((net / ing.unitG) - 1e-9);
      const bought = units * ing.unitG;
      const after = carried + bought - (entry.grams - fromPantry);

      // 余りを次回に持ち越せるのは、次の買い物日まで日持ちするものだけ。
      // 何でも持ち越すことにすると、もやしの残りを翌週分に数えてしまう。
      stock.set(id, ing.keepDays >= intervalDays ? Math.max(0, after) : 0);

      items.push({
        ingredientId: id,
        name: ing.name,
        aisle: ing.aisle,
        aisleLabel: AISLES[ing.aisle],
        needGrams: Math.round(entry.grams),
        fromPantryGrams: Math.round(fromPantry),
        fromStockGrams: Math.round(fromStock),
        buyUnits: units,
        unitName: ing.unitName,
        unitGrams: ing.unitG,
        buyGrams: Math.round(bought),
        leftoverGrams: Math.round(Math.max(0, after)),
        keepDays: ing.keepDays,
        freshnessNote: entry.staleDays > 0
          ? `買い物日の${entry.staleDays}日後に使用（日持ち約${ing.keepDays}日）。使う日の近くで買い足すか、冷凍を。`
          : null,
      });
    });

    const buyItems = items.filter((it) => it.buyUnits > 0);
    return {
      date,
      coversUntil: trips[i + 1] ? toISO(addDays(parseISO(trips[i + 1]), -1)) : plan.daysOut[plan.days - 1].date,
      items: buyItems,
      skipped: items.filter((it) => it.buyUnits === 0),
      byAisle: groupByAisle(buyItems),
      totalItems: buyItems.length,
    };
  });

  return { intervalDays, trips: out, pantryUsed: summarizePantryUse(pantryStart, pantryStock) };
}

function groupByAisle(items) {
  const map = new Map();
  items.forEach((it) => {
    if (!map.has(it.aisle)) map.set(it.aisle, []);
    map.get(it.aisle).push(it);
  });
  return AISLE_ORDER.filter((a) => map.has(a)).map((a) => ({
    aisle: a, label: AISLES[a], items: map.get(a),
  }));
}

function summarizePantryUse(before, remaining) {
  const out = [];
  before.forEach((grams, id) => {
    const left = Math.max(0, remaining.get(id) || 0);
    out.push({
      ingredientId: id,
      name: getIngredient(id).name,
      startGrams: Math.round(grams),
      usedGrams: Math.round(grams - left),
      leftoverGrams: Math.round(left),
      usedUp: left <= grams * 0.05,
    });
  });
  return out;
}

/** 印刷・コピー用のテキスト。売り場順に並べる。 */
export function tripToText(trip) {
  const lines = [`■ ${trip.date} の買い物（${trip.coversUntil} まで分）`];
  trip.byAisle.forEach((group) => {
    lines.push(`\n【${group.label}】`);
    group.items.forEach((it) => {
      const used = it.fromPantryGrams + it.fromStockGrams;
      const extra = used > 0 ? `（在庫${used}g使用）` : '';
      lines.push(`  □ ${it.name}  ${it.buyUnits}${it.unitName}  (必要 約${it.needGrams}g)${extra}`);
      if (it.freshnessNote) lines.push(`      ※ ${it.freshnessNote}`);
    });
  });
  return lines.join('\n');
}
