// 献立生成エンジン
//
// 各食で候補レシピをスコア付けし、上位から重み付き抽選で選ぶ。
// 最高スコアだけを取ると毎回同じ献立になり「自動で決めてくれる」価値が消えるので、
// 候補の幅を持たせたうえでシード付き乱数を使い、再現性は保つ。

import { RECIPES, RECIPE_BY_ID } from '../data/recipes.js';
import { getIngredient } from '../data/ingredients.js';
import {
  recipeNutritionCached, emptyNutrition, addNutrition, householdTargets,
  householdFactor, deficits, judgeDay, imbalance, adjustedGrams, NUTRIENT_KEYS,
} from './nutrition.js';
import { makeRng, weightedPick } from './rng.js';

export const DEFAULT_OPTIONS = {
  sidesPerDinner: 2,
  weekdayMaxMinutes: 30,   // 平日夜にこれを超えるレシピは減点(禁止ではない)
  // 同じレシピを再び出すまでの最低日数。役割ごとに候補数が違うので個別に持つ。
  // これは減点ではなく候補から外すハード制約。減点にすると、栄養スコアの高いレシピが
  // 減点を跳ね返して何日も連続で出てしまい、重みを上げると今度は栄養が崩れる
  // (実測: 減点方式では90日で連日重複が82件、重みを上げると食塩とカルシウムが悪化した)。
  repeatGapByRole: { main: 14, lunch: 10, breakfast: 5, side: 8, soup: 5, staple: 0 },
  minRepeatGapDays: 21,    // ハード制約を超えたあとも、間隔が近いほど軽く減点する
  candidatePoolSize: 8,    // 上位いくつから抽選するか
  avoidCuisines: [],       // 'japanese' | 'western' | 'chinese' | 'other'
  excludeIngredients: [],  // アレルギー・嫌いな食材の食材ID
  excludeRecipes: [],
  // 味付けの倍率。1がレシピどおり。
  // 既定を0.85にしているのは、家庭料理の標準的な味付けのままだと、
  // 食塩が目標を2割ほど超える献立しか組めないため(実測: 4つの世帯構成で100〜122%)。
  // とくに子どものいる世帯は食塩の上限が体格比では緩まないので影響が大きい。
  // 0.85にすると同じ条件で90〜110%に収まり、要改善の日が23%から6%に減る。
  // 利用者が「レシピどおり」を選べる設定にしてあるので、勝手に薄めているわけではない。
  saltScale: 0.85,
  // スコアの重み。値は3世帯構成×複数シードで90日生成し、
  // 判定good率が最大になる組合せを実測して決めた(tests/tune.mjs)。
  weights: {
    protein: 1.4, veg: 4.0, fiber: 1.6, kcal: 2.5, calcium: 4.6, iron: 0.9, vitC: 0.7,
    salt: 12, saltOver: 2.4, fatOver: 1.8, fatOverSq: 1.6,
    repeat: 3, proteinRepeat: 2.2, methodRepeat: 1.0, season: 1.3, pantry: 2.8,
  },
};

const LEVEL_RANK = { bad: 0, warn: 1, good: 2 };

const SEASON_OF_MONTH = [
  'winter', 'winter', 'spring', 'spring', 'spring', 'summer',
  'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter',
];

export function seasonOf(date) {
  return SEASON_OF_MONTH[date.getMonth()];
}

export function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date, n) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
}

/** 献立を組むときの文脈。直近何を出したかを覚えておき、偏りを避けるのに使う。 */
class PlanContext {
  constructor(options) {
    this.options = options;
    this.usageDays = new Map();       // recipeId -> 使った日indexの配列
    this.recentProteins = [];         // 直近の主材料系統(新しいものが末尾)
    this.recentMethods = [];
  }

  /**
   * その日から見て、同じレシピが最も近くで使われている日数の差。
   *
   * 過去だけでなく未来の使用も見るのは、既存の献立を部分的に差し替えるときに
   * 「翌日と同じ料理」を選ばないため。前から順に作る通常の生成では未来の使用が
   * まだ無いので、過去だけを見るのと同じ挙動になる。
   */
  daysSince(recipeId, dayIndex) {
    const days = this.usageDays.get(recipeId);
    if (!days || days.length === 0) return Infinity;
    let min = Infinity;
    for (const d of days) {
      if (d === dayIndex) continue;
      min = Math.min(min, Math.abs(dayIndex - d));
    }
    return min;
  }

  record(recipe, dayIndex) {
    const days = this.usageDays.get(recipe.id) || [];
    days.push(dayIndex);
    this.usageDays.set(recipe.id, days);
    if (recipe.role === 'main' || recipe.role === 'lunch') {
      this.recentProteins.push(recipe.protein);
      this.recentMethods.push(recipe.method);
      if (this.recentProteins.length > 8) this.recentProteins.shift();
      if (this.recentMethods.length > 6) this.recentMethods.shift();
    }
  }

  unrecord(recipeId, dayIndex) {
    const days = this.usageDays.get(recipeId);
    if (!days) return;
    const i = days.indexOf(dayIndex);
    if (i >= 0) days.splice(i, 1);
  }
}

function isExcluded(recipe, options) {
  if (options.excludeRecipes.includes(recipe.id)) return true;
  if (options.avoidCuisines.includes(recipe.cuisine)) return true;
  if (options.excludeIngredients.length) {
    for (const { id } of recipe.ingredients) {
      if (options.excludeIngredients.includes(id)) return true;
    }
  }
  return false;
}

/**
 * 在庫の使用価値。期限が近い食材ほど高い。
 * 期限切れ間近のものを優先して消費させたいので、残り日数の逆数的に効かせる。
 */
function pantryValue(recipe, pantryMap, dayIndex, factor) {
  if (!pantryMap || pantryMap.size === 0) return 0;
  let value = 0;
  for (const { id, grams } of recipe.ingredients) {
    const stock = pantryMap.get(id);
    if (!stock || stock.remaining <= 0) continue;
    const used = Math.min(stock.remaining, grams * factor);
    const daysLeft = stock.daysLeft == null ? 7 : stock.daysLeft - dayIndex;
    const urgency = daysLeft <= 0 ? 3 : daysLeft <= 1 ? 2.5 : daysLeft <= 3 ? 1.8 : daysLeft <= 6 ? 1.2 : 0.7;
    value += (used / 60) * urgency;
  }
  return value;
}

/**
 * 候補レシピのスコア。
 * 各項が「何を防いでいるか」は .claude/skills/kondate-planner/SKILL.md の表と対応している。
 */
function scoreRecipe(recipe, ctx, state) {
  const { saltScale } = ctx.options;
  const {
    dayIndex, season, isWeekend, remaining, factor, pantryMap, targets,
  } = state;
  const n = recipeNutritionCached(recipe, saltScale);
  const W = ctx.options.weights;
  let score = 0;

  // 1. 不足栄養素の充足度。その日まだ足りない分をどれだけ埋めるか。
  //    各栄養素の「1日目標に対する寄与率」を、不足している栄養素についてだけ足す。
  const covers = (key, weight) => {
    const need = remaining[key];
    if (need <= 0) return 0;
    const supply = n[key] * factor;
    return weight * Math.min(supply / Math.max(need, 1e-6), 1.2);
  };
  score += covers('protein', W.protein);
  score += covers('veg', W.veg);
  score += covers('fiber', W.fiber);
  score += covers('kcal', W.kcal);
  score += covers('calcium', W.calcium);
  score += covers('iron', W.iron);
  score += covers('vitC', W.vitC);

  // 2. 食塩。1日の上限をスロットごとの予算に割り振り、その枠に対する使用率で減点する。
  //    1日分の残枠だけを見ると、朝食の時点では枠がたっぷり空いていて何を選んでも減点されず、
  //    夕食で帳尻が合わなくなる。先に配分しておくことで朝から圧力がかかる。
  const budgetUse = (key, eps) => {
    const room = Math.max(state.budget[key] - state.running[key], eps);
    return (n[key] * factor) / room;
  };
  const saltUse = budgetUse('salt', 0.05);
  score -= W.salt * saltUse + W.saltOver * Math.max(0, saltUse - 1) ** 2;

  // 2b. 脂質。エネルギー比20-30%Eに収めたい。
  //     不足栄養素の充足度だけで選ぶと、同じ量で多くのエネルギーを供給できる
  //     脂質の多い料理が常に有利になり、揚げ物と炒め物ばかりの献立ができる。
  //     ただし脂質そのものは必要なので、予算を超えた分だけを減点する。
  const fatUse = budgetUse('fat', 1);
  score -= W.fatOver * Math.max(0, fatUse - 1) + W.fatOverSq * Math.max(0, fatUse - 1) ** 2;

  // 3. 同じレシピの再登場。設定した間隔に届かないほど重く減点する。
  const gap = ctx.daysSince(recipe.id, dayIndex);
  if (gap < ctx.options.minRepeatGapDays) {
    score -= W.repeat * (1 - gap / ctx.options.minRepeatGapDays) ** 1.5;
  }

  // 4. 主材料の連続。「昨日も鶏」を防ぐ。直近ほど重く見る。
  if (recipe.protein !== 'none') {
    ctx.recentProteins.forEach((p, i) => {
      if (p !== recipe.protein) return;
      const recency = ctx.recentProteins.length - i; // 1が最も古い
      score -= W.proteinRepeat / recency;
    });
  }

  // 5. 調理法の重複。揚げ物が続く、全部炒め物、を避ける。
  ctx.recentMethods.forEach((m, i) => {
    if (m !== recipe.method) return;
    const recency = ctx.recentMethods.length - i;
    score -= W.methodRepeat / recency;
  });

  // 6. 調理時間。平日夜に手間のかかるものを置かない。週末は許す。
  if (!isWeekend && recipe.minutes > ctx.options.weekdayMaxMinutes) {
    score -= 0.06 * (recipe.minutes - ctx.options.weekdayMaxMinutes);
  }
  if (isWeekend && recipe.minutes >= 30) score += 0.4;

  // 7. 季節。旬のものを優遇し、季節外れを軽く減点する。
  if (recipe.seasons) {
    score += recipe.seasons.includes(season) ? W.season : -W.season * 0.85;
  }

  // 8. 在庫の消費。冷蔵庫にあるもの、特に期限が近いものを使う候補を強く優遇する。
  score += W.pantry * pantryValue(recipe, pantryMap, dayIndex, factor);

  return score;
}

/**
 * 直近に使ったレシピを候補から外す。
 * ただし外しすぎて候補が枯れると選択の質が落ちるので、
 * 最低数を割るときは間隔の条件を段階的に緩める。
 */
function filterRecent(candidates, ctx, dayIndex, minPool = 5) {
  if (candidates.length === 0) return candidates;
  const role = candidates[0].role;
  const gap = ctx.options.repeatGapByRole[role] ?? 0;
  for (let g = gap; g > 0; g -= 1) {
    const pool = candidates.filter((r) => ctx.daysSince(r.id, dayIndex) >= g);
    if (pool.length >= Math.min(minPool, candidates.length)) return pool;
  }
  return candidates;
}

function pickRecipe(rawCandidates, ctx, state, rng) {
  const candidates = filterRecent(rawCandidates, ctx, state.dayIndex);
  if (candidates.length === 0) return null;
  const scored = candidates
    .map((r) => ({ recipe: r, score: scoreRecipe(r, ctx, state) }))
    .sort((a, b) => b.score - a.score);
  const pool = scored.slice(0, Math.max(2, ctx.options.candidatePoolSize));
  // スコア差を確率差に変える。最上位を確実に選ばず、かといって下位ばかりにもしない。
  const base = pool[pool.length - 1].score;
  const weights = pool.map((p) => Math.exp((p.score - base) * 0.8));
  return weightedPick(pool.map((p) => p.recipe), weights, rng);
}

function mealsNutrition(meals, factor, saltScale) {
  return meals.reduce(
    (acc, m) => addNutrition(acc, recipeNutritionCached(RECIPE_BY_ID.get(m.recipeId), saltScale), factor * m.portion),
    emptyNutrition(),
  );
}

/**
 * 1食ずつ差し替えて、その日の判定が良くなる組合せを探す。
 *
 * 献立は前から順に決めるので、最後のほうで「もう埋めようのない不足」が残ることがある
 * (朝と昼で食塩を使い切った日など)。生成しなおすと今度は別の日が崩れるだけなので、
 * 崩れた日だけを局所的に直す。改善しなくなったら止める。
 */
function repairDay(meals, pools, ctx, dayIndex, targets, factor, saltScale, maxRounds = 3) {
  // maxRounds は options.repairRounds で上書きできる(調整用)。
  // 良さの指標は、利用者に見せる判定(good/warn/bad)と、目標からの連続的なずれの合成。
  // 判定だけだとレベルが変わらない改善を拾えず、ずれだけだと判定の悪い日を
  // 優先して直せない。前者を主、後者を同点のときの決め手として使う。
  const cost_ = (n) => {
    const j = judgeDay(n, targets);
    return (1 - j.score) + 0.25 * j.bads + 0.03 * imbalance(n, targets);
  };

  let current = mealsNutrition(meals, factor, saltScale);
  let judged = judgeDay(current, targets);
  let cost = cost_(current);
  const swaps = [];

  for (let round = 0; round < maxRounds && judged.overall !== 'good'; round += 1) {
    let best = null;
    meals.forEach((m, idx) => {
      const recipe = RECIPE_BY_ID.get(m.recipeId);
      if (recipe.role === 'staple') return; // 主食は量で調整するので差し替えない
      const chosen = new Set(meals.map((x) => x.recipeId));
      const pool = filterRecent(pools[recipe.role] || [], ctx, dayIndex)
        .filter((r) => !chosen.has(r.id));
      const removed = addNutrition(current, recipeNutritionCached(recipe, saltScale), -factor * m.portion);
      pool.forEach((cand) => {
        const next = addNutrition(removed, recipeNutritionCached(cand, saltScale), factor * m.portion);
        const c = cost_(next);
        if (!best || c < best.cost) best = { cost: c, idx, cand, next, from: recipe };
      });
    });
    if (!best || best.cost >= cost - 1e-9) break;
    ctx.unrecord(best.from.id, dayIndex);
    ctx.record(best.cand, dayIndex);
    swaps.push({ slot: meals[best.idx].slot, from: best.from.id, to: best.cand.id });
    meals[best.idx] = { ...meals[best.idx], recipeId: best.cand.id };
    current = best.next;
    cost = best.cost;
    judged = judgeDay(current, targets);
  }
  return { nutrition: current, judgement: judged, swaps };
}

function buildPools(options) {
  const usable = RECIPES.filter((r) => !isExcluded(r, options));
  return {
    main: usable.filter((r) => r.role === 'main'),
    side: usable.filter((r) => r.role === 'side'),
    soup: usable.filter((r) => r.role === 'soup'),
    staple: usable.filter((r) => r.role === 'staple'),
    breakfast: usable.filter((r) => r.role === 'breakfast'),
    lunch: usable.filter((r) => r.role === 'lunch'),
  };
}

/** 主食は主菜の系統に合わせる。洋風の主菜にごはん、和風にトースト、を避ける。 */
function pickStaple(pools, mainRecipe) {
  if (pools.staple.length === 0) return null;
  const wantBread = mainRecipe && mainRecipe.cuisine === 'western' && mainRecipe.method !== 'simmer';
  const bread = pools.staple.find((s) => s.id === 'toast');
  const rice = pools.staple.find((s) => s.id === 'gohan');
  return (wantBread ? bread : rice) || pools.staple[0];
}

function pantryToMap(pantry, startDate) {
  const map = new Map();
  (pantry || []).forEach((item) => {
    const daysLeft = item.expiresOn
      ? Math.round((parseISO(item.expiresOn) - startDate) / 86400000)
      : null;
    const prev = map.get(item.ingredientId);
    if (prev) {
      prev.remaining += item.grams;
      if (daysLeft != null) prev.daysLeft = Math.min(prev.daysLeft ?? daysLeft, daysLeft);
    } else {
      map.set(item.ingredientId, { remaining: item.grams, daysLeft });
    }
  });
  return map;
}

function consumePantry(pantryMap, recipe, factor) {
  if (!pantryMap) return;
  for (const { id, grams } of recipe.ingredients) {
    const stock = pantryMap.get(id);
    if (!stock) continue;
    stock.remaining = Math.max(0, stock.remaining - grams * factor);
  }
}

/**
 * 献立を生成する。
 * days日ぶんの朝・昼・夕を組み、日ごとの栄養判定まで付けて返す。
 */
export function generatePlan(config) {
  const {
    startDate, days = 90, household, seed = 'kondate', pantry = [],
  } = config;
  const options = { ...DEFAULT_OPTIONS, ...(config.options || {}) };
  options.weights = { ...DEFAULT_OPTIONS.weights, ...(config.options?.weights || {}) };
  const start = typeof startDate === 'string' ? parseISO(startDate) : startDate;
  const targets = householdTargets(household);
  const factor = householdFactor(household);
  const saltScale = options.saltScale ?? 1;
  const pools = buildPools(options);
  const ctx = new PlanContext(options);
  const rng = makeRng(`${seed}|${toISO(start)}|${days}`);
  const pantryMap = pantryToMap(pantry, start);

  const daysOut = [];
  for (let i = 0; i < days; i += 1) {
    const date = addDays(start, i);
    const season = seasonOf(date);
    const dow = date.getDay();
    const isWeekend = dow === 0 || dow === 6;
    let running = emptyNutrition();

    // 1日の食塩上限をスロットに配分した累積比率。
    // 朝2割・昼3割・夕5割という実際の食事の重みに合わせている。
    const SALT_BUDGET = {
      breakfast: 0.22, lunch: 0.52, 'dinner-main': 0.76,
      'dinner-side': 0.86, 'dinner-soup': 0.98, 'dinner-staple': 1.0,
    };
    let sideBudgetStep = 0;
    const state = (slot) => {
      let frac = SALT_BUDGET[slot] ?? 1;
      if (slot === 'dinner-side') {
        // 副菜は複数あるので枠を分け合う
        sideBudgetStep += 1;
        frac = 0.76 + (0.86 - 0.76) * (sideBudgetStep / options.sidesPerDinner);
      }
      return {
        dayIndex: i, season, isWeekend, factor, pantryMap, targets,
        remaining: deficits(running, targets),
        budget: { salt: targets.salt * frac, fat: targets.fat * frac },
        running: { salt: running.salt, fat: running.fat },
      };
    };

    const meals = [];
    const take = (recipe, slot, portion = 1) => {
      if (!recipe) return;
      running = addNutrition(running, recipeNutritionCached(recipe, saltScale), factor * portion);
      ctx.record(recipe, i);
      consumePantry(pantryMap, recipe, factor * portion);
      meals.push({ slot, recipeId: recipe.id, portion });
    };

    take(pickRecipe(pools.breakfast, ctx, state('breakfast'), rng), 'breakfast');
    take(pickRecipe(pools.lunch, ctx, state('lunch'), rng), 'lunch');

    take(pickRecipe(pools.main, ctx, state('dinner-main'), rng), 'dinner-main');
    for (let s = 0; s < options.sidesPerDinner; s += 1) {
      const chosenIds = meals.map((m) => m.recipeId);
      const pool = pools.side.filter((r) => !chosenIds.includes(r.id));
      take(pickRecipe(pool, ctx, state('dinner-side'), rng), 'dinner-side');
    }
    take(pickRecipe(pools.soup, ctx, state('dinner-soup'), rng), 'dinner-soup');
    // おかずが決まった時点で判定が崩れている日は、ここで局所的に直す。
    // 主食より先に直すのは、主食の量が残りエネルギーに依存するため。
    const repaired = repairDay(meals, pools, ctx, i, targets, factor, saltScale, options.repairRounds ?? 3);
    running = repaired.nutrition;

    // 主食の盛り量は残りエネルギーに合わせて可変にする。
    // おかずを固定量にしたまま主食も固定にすると、成人男性の日はエネルギーが常に不足し、
    // かといっておかずを増やすと食塩が上限を超える。実際の家庭がごはんの量で調整するのと同じ。
    const staple = pickStaple(pools, RECIPE_BY_ID.get(meals[2].recipeId));
    if (staple) {
      const stapleKcal = recipeNutritionCached(staple, saltScale).kcal * factor;
      const raw = stapleKcal > 0 ? (targets.kcal - running.kcal) / stapleKcal : 1;
      const portion = Math.round(Math.min(3.0, Math.max(0.5, raw)) * 10) / 10;
      take(staple, 'dinner-staple', portion);
    }

    const judgement = judgeDay(running, targets);
    daysOut.push({
      date: toISO(date), dayIndex: i, season, isWeekend,
      meals, nutrition: roundNutrition(running), judgement, swaps: repaired.swaps,
    });
  }

  return {
    startDate: toISO(start), days, seed, household, saltScale,
    options, factor: Math.round(factor * 100) / 100, targets, daysOut,
  };
}

function roundNutrition(n) {
  const out = {};
  NUTRIENT_KEYS.forEach((k) => {
    out[k] = Math.round((n[k] || 0) * 10) / 10;
  });
  return out;
}

/**
 * 冷蔵庫の在庫にもとづき、直近の献立を差し替える。
 *
 * 対象期間をまるごと生成しなおすと、在庫を2品入れただけで38品が入れ替わる。
 * 利用者から見れば「献立が作り直された」のであって「在庫にあわせて調整された」ではない。
 * ここでは在庫を使う方向に効く差し替えだけを、1日あたり数品に絞って探す。
 *
 * @param maxChangesPerDay 1日に差し替える上限。多いほど在庫は消費できるが、
 *                         利用者が把握できる変更量を超える。
 */
export function replanWithPantry(plan, pantry, fromISODate, replanDays = 7, maxChangesPerDay = 2) {
  const fromIndex = plan.daysOut.findIndex((d) => d.date >= fromISODate);
  if (fromIndex < 0) {
    return { plan, changes: [], leftovers: summarizeLeftovers(plan, pantry, []) };
  }
  const end = Math.min(fromIndex + replanDays, plan.daysOut.length);
  const start = parseISO(plan.daysOut[fromIndex].date);
  const options = plan.options || DEFAULT_OPTIONS;
  const pools = buildPools(options);
  const { targets, factor } = plan;
  const saltScale = plan.saltScale ?? 1;

  // 期限が近い在庫ほど早い日に割り当てたいので、残量を消費しながら前から見ていく。
  const remaining = pantryToMap(pantry, start);
  const ctx = new PlanContext(options);
  plan.daysOut.forEach((d, i) => d.meals.forEach((m) => {
    ctx.record(RECIPE_BY_ID.get(m.recipeId), i);
  }));

  const daysOut = [...plan.daysOut];
  const changes = [];

  for (let i = fromIndex; i < end; i += 1) {
    const day = daysOut[i];
    const meals = day.meals.map((m) => ({ ...m }));
    let current = mealsNutrition(meals, factor, saltScale);
    let cost = imbalance(current, targets);
    let level = LEVEL_RANK[judgeDay(current, targets).overall];

    for (let c = 0; c < maxChangesPerDay; c += 1) {
      let best = null;
      meals.forEach((m, idx) => {
        const from = RECIPE_BY_ID.get(m.recipeId);
        if (from.role === 'staple') return;
        const chosen = new Set(meals.map((x) => x.recipeId));
        const removed = addNutrition(current, recipeNutritionCached(from, saltScale), -factor * m.portion);
        const lose = pantryValue(from, remaining, i - fromIndex, factor * m.portion);
        filterRecent(pools[from.role] || [], ctx, i).forEach((cand) => {
          if (chosen.has(cand.id)) return;
          const gain = pantryValue(cand, remaining, i - fromIndex, factor * m.portion) - lose;
          if (gain <= 0) return;
          const next = addNutrition(removed, recipeNutritionCached(cand, saltScale), factor * m.portion);
          // 在庫を使うために栄養判定を落とすのは本末転倒なので、
          // 判定が下がる差し替えは在庫の消費量にかかわらず採らない。
          const nextLevel = LEVEL_RANK[judgeDay(next, targets).overall];
          if (nextLevel < level) return;
          const worse = imbalance(next, targets) - cost;
          const score = gain - 4 * Math.max(0, worse);
          if (score <= 0.15) return;
          if (!best || score > best.score) best = { score, idx, cand, from, next };
        });
      });
      if (!best) break;
      consumePantry(remaining, best.cand, factor * meals[best.idx].portion);
      // 同じ枠を2度差し替えたときは履歴を積まずに行き先だけ書き換える。
      // 「AをBに、BをCに替えました」と見せても利用者には AがCになった としか意味がない。
      const prior = changes.find((c) => c.date === day.date && c.slot === meals[best.idx].slot);
      if (prior) prior.to = best.cand.id;
      else {
        changes.push({
          date: day.date, slot: meals[best.idx].slot, from: best.from.id, to: best.cand.id,
        });
      }
      ctx.unrecord(best.from.id, i);
      ctx.record(best.cand, i);
      meals[best.idx] = { ...meals[best.idx], recipeId: best.cand.id };
      current = best.next;
      cost = imbalance(current, targets);
      level = LEVEL_RANK[judgeDay(current, targets).overall];
    }

    if (meals.some((m, k) => m.recipeId !== day.meals[k].recipeId)) {
      const rounded = {};
      NUTRIENT_KEYS.forEach((k) => { rounded[k] = Math.round(current[k] * 10) / 10; });
      daysOut[i] = { ...day, meals, nutrition: rounded, judgement: judgeDay(current, targets) };
    }
  }

  const next = { ...plan, daysOut };
  return {
    plan: next,
    changes,
    leftovers: summarizeLeftovers(next, pantry, daysOut.slice(fromIndex, end)),
  };
}

/** 在庫が計画期間内に使い切れるかを返す。使い切れないものは正直に返す。 */
export function summarizeLeftovers(plan, pantry, daysOut) {
  const scale = plan.saltScale ?? 1;
  const used = new Map();
  (daysOut || []).forEach((day) => {
    day.meals.forEach((m) => {
      const r = RECIPE_BY_ID.get(m.recipeId);
      if (!r) return;
      r.ingredients.forEach(({ id, grams }) => {
        // 1人前ではなく世帯分で数える。ここを掛け忘れると、使い切れる量を
        // 実際より少なく見積もって「残ります」と誤って告げることになる。
        used.set(id, (used.get(id) || 0)
          + adjustedGrams(getIngredient(id), grams, scale) * plan.factor * m.portion);
      });
    });
  });
  return (pantry || []).map((item) => {
    const consumed = Math.min(item.grams, used.get(item.ingredientId) || 0);
    return {
      ingredientId: item.ingredientId,
      name: getIngredient(item.ingredientId).name,
      grams: item.grams,
      consumedGrams: Math.round(consumed),
      leftoverGrams: Math.round(Math.max(0, item.grams - consumed)),
      usedUp: consumed >= item.grams * 0.95,
    };
  });
}
