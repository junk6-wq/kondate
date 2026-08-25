// 栄養の目標値算出・献立の栄養計算・判定
// 基準値の出典と考え方は .claude/skills/kondate-planner/references/nutrition.md を参照。

import { getIngredient } from '../data/ingredients.js';

// 推定エネルギー必要量 (kcal/日, 身体活動レベルII)
const ENERGY = [
  // [下限年齢, 男, 女]
  [1, 950, 900], [3, 1300, 1250], [6, 1550, 1450], [8, 1850, 1700],
  [10, 2250, 2100], [12, 2600, 2400], [15, 2800, 2300], [18, 2650, 2000],
  [30, 2700, 2050], [50, 2600, 1950], [65, 2400, 1850], [75, 2100, 1650],
];

const ACTIVITY = { low: 0.86, normal: 1.0, high: 1.14 };

// 小児の食塩上限は体格比で按分せず個別に持つ。体格に対して過剰になりやすいため。
const CHILD_SALT = [[1, 3.0], [3, 3.5], [6, 4.5], [8, 5.0], [10, 6.0], [12, null]];

// 目標とする三大栄養素のエネルギー比(範囲の中央付近)
export const PFC_TARGET = { protein: 0.16, fat: 0.25, carb: 0.59 };
export const PFC_RANGE = { protein: [0.13, 0.20], fat: [0.20, 0.30], carb: [0.50, 0.65] };

function pickByAge(table, age) {
  let row = table[0];
  for (const r of table) if (age >= r[0]) row = r;
  return row;
}

/** 1人分の1日あたり目標値 */
export function personTargets(person) {
  const { age, sex, activity = 'normal', pregnancy = 'none' } = person;
  const row = pickByAge(ENERGY, age);
  let kcal = (sex === 'male' ? row[1] : row[2]) * (ACTIVITY[activity] ?? 1);
  if (sex === 'female') {
    if (pregnancy === 'early') kcal += 50;
    else if (pregnancy === 'mid') kcal += 250;
    else if (pregnancy === 'late') kcal += 450;
    else if (pregnancy === 'lactating') kcal += 350;
  }
  kcal = Math.round(kcal);

  const adult = age >= 18;
  const senior = age >= 65;
  const childRatio = adult ? 1 : kcal / (sex === 'male' ? 2650 : 2000);

  // たんぱく質は %E から出した値と推奨量の大きいほうを採る。
  // 低エネルギー設定の人は %E だけだと実量が推奨量を割るため。
  const proteinRDA = adult ? (sex === 'male' ? (senior ? 60 : 65) : 50) : Math.round(45 * childRatio);
  // 目標量13-20%Eの下限を採る。中央値16%Eを目標にすると現実的な献立が常に未達になり、
  // 「不足」の指摘が狼少年になる。下限を割らないことを保証するのが目標値の役割。
  const proteinFromE = (kcal * PFC_RANGE.protein[0]) / 4;

  const saltRow = pickByAge(CHILD_SALT, age);
  const adultSalt = sex === 'male' ? 7.5 : 6.5;
  const salt = adult || saltRow[1] === null ? adultSalt : saltRow[1];

  const fiber = adult
    ? (sex === 'male' ? (senior ? 20 : 21) : (senior ? 17 : 18))
    : Math.round(18 * childRatio);
  const calcium = adult
    ? (sex === 'male' ? (age < 30 ? 800 : age >= 75 ? 700 : 750) : (age >= 75 ? 600 : 650))
    : Math.round(700 * childRatio);
  const iron = adult
    ? (sex === 'male' ? 7.5 : (person.menstruating === false ? 6.5 : 10.5))
    : Math.round(8 * childRatio * 10) / 10;

  return {
    kcal,
    protein: Math.round(Math.max(proteinRDA, proteinFromE)),
    fat: Math.round((kcal * PFC_TARGET.fat) / 9),
    carb: Math.round((kcal * PFC_TARGET.carb) / 4),
    fiber,
    salt: Math.round(salt * 10) / 10,
    calcium,
    iron,
    vitC: adult ? 100 : Math.round(80 * childRatio),
    veg: adult ? 350 : Math.round(300 * childRatio),
  };
}

/** 世帯合計の目標値。全員分の単純合計でよい(理由は references/nutrition.md 4節)。 */
export function householdTargets(members) {
  const keys = ['kcal', 'protein', 'fat', 'carb', 'fiber', 'salt', 'calcium', 'iron', 'vitC', 'veg'];
  const total = Object.fromEntries(keys.map((k) => [k, 0]));
  members.forEach((m) => {
    const t = personTargets(m);
    keys.forEach((k) => { total[k] += t[k]; });
  });
  keys.forEach((k) => { total[k] = Math.round(total[k] * 10) / 10; });
  return total;
}

export const NUTRIENT_KEYS = ['kcal', 'protein', 'fat', 'carb', 'fiber', 'salt', 'calcium', 'iron', 'vitC', 'veg'];

export function emptyNutrition() {
  return Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0]));
}

/**
 * 味付けを控えめにできる調味料かどうか。
 * しょうゆ・みそ・だしの素のように、量を減らしても料理として成立するものだけを対象にする。
 * パンや麺、ハムに含まれる食塩は減らしようがないので触らない。
 */
function isAdjustableSeasoning(ing) {
  return ing.aisle === 'seasoning' && ing.salt >= 5;
}

/**
 * レシピ1人前の栄養。材料から計算するので、材料を変えれば自動的に追随する。
 *
 * @param saltScale 味付けの倍率。1が標準、0.8で「2割ひかえめ」。
 *   調味料の量そのものを変えるので、食塩だけでなくエネルギーや糖分にも反映される。
 *   レシピの食塩値だけを機械的に割り引くと、みりんや砂糖の分が残って辻褄が合わなくなる。
 */
export function recipeNutrition(recipe, saltScale = 1) {
  const n = emptyNutrition();
  for (const { id, grams: rawGrams } of recipe.ingredients) {
    const ing = getIngredient(id);
    const grams = isAdjustableSeasoning(ing) ? rawGrams * saltScale : rawGrams;
    const f = grams / 100;
    n.kcal += ing.kcal * f;
    n.protein += ing.protein * f;
    n.fat += ing.fat * f;
    n.carb += ing.carb * f;
    n.fiber += ing.fiber * f;
    n.salt += ing.salt * f;
    n.calcium += ing.calcium * f;
    n.iron += ing.iron * f;
    n.vitC += ing.vitC * f;
    if (ing.veg > 0) n.veg += grams;
  }
  return n;
}

const nutritionCache = new Map();
export function recipeNutritionCached(recipe, saltScale = 1) {
  const key = `${recipe.id}|${saltScale}`;
  if (!nutritionCache.has(key)) nutritionCache.set(key, recipeNutrition(recipe, saltScale));
  return nutritionCache.get(key);
}

/** 買い物リストで使う、味付け倍率を反映した材料の量。 */
export function adjustedGrams(ingredient, grams, saltScale = 1) {
  return isAdjustableSeasoning(ingredient) ? grams * saltScale : grams;
}

export function addNutrition(a, b, factor = 1) {
  const out = { ...a };
  NUTRIENT_KEYS.forEach((k) => { out[k] = (out[k] || 0) + (b[k] || 0) * factor; });
  return out;
}

/** 判定。しきい値は references/nutrition.md 5節の表と一致させてある。 */
const RULES = {
  kcal:    { good: [0.90, 1.10], warn: [0.80, 1.20] },
  protein: { good: [1.00, 1.60], warn: [0.85, 1.80] },
  fiber:   { good: [1.00, 3.00], warn: [0.70, 3.00] },
  salt:    { good: [0.00, 1.00], warn: [0.00, 1.20], upperBound: true },
  calcium: { good: [1.00, 3.00], warn: [0.70, 3.00] },
  iron:    { good: [1.00, 3.00], warn: [0.70, 3.00] },
  vitC:    { good: [1.00, 9.00], warn: [0.70, 9.00] },
  veg:     { good: [1.00, 3.00], warn: [0.70, 3.00] },
};

export function judgeOne(key, actual, target) {
  const rule = RULES[key];
  if (!rule || !target) return { key, actual, target, ratio: 1, level: 'good' };
  const ratio = actual / target;
  const inRange = (r) => ratio >= r[0] && ratio <= r[1];
  let level = 'bad';
  if (inRange(rule.good)) level = 'good';
  else if (inRange(rule.warn)) level = 'warn';
  return { key, actual, target, ratio, level };
}

/** PFCバランスは実量ではなくエネルギー比で見る。実量目標に寄せると献立が不自然になる。 */
export function judgePfc(nutrition) {
  const kcal = nutrition.kcal || 1;
  const out = {};
  const ratios = {
    protein: (nutrition.protein * 4) / kcal,
    fat: (nutrition.fat * 9) / kcal,
    carb: (nutrition.carb * 4) / kcal,
  };
  Object.entries(ratios).forEach(([k, v]) => {
    const [lo, hi] = PFC_RANGE[k];
    const margin = k === 'protein' ? 0.02 : 0.03;
    let level = 'bad';
    if (v >= lo && v <= hi) level = 'good';
    else if (v >= lo - margin && v <= hi + margin) level = 'warn';
    out[k] = { key: k, ratio: v, range: [lo, hi], level };
  });
  return out;
}

export function judgeDay(nutrition, targets) {
  const items = {};
  ['kcal', 'protein', 'fiber', 'salt', 'calcium', 'iron', 'vitC', 'veg'].forEach((k) => {
    items[k] = judgeOne(k, nutrition[k], targets[k]);
  });
  const pfc = judgePfc(nutrition);
  const levels = [...Object.values(items), ...Object.values(pfc)].map((x) => x.level);
  const score = levels.filter((l) => l === 'good').length / levels.length;
  const bads = levels.filter((l) => l === 'bad').length;
  const warns = levels.filter((l) => l === 'warn').length;

  // 全11項目を良好にするのは1日単位では非現実的で、それを要求すると
  // 「毎日ほうれん草のおひたし」のような栄養的に正しいが続かない献立になる。
  // 少数の warn は許容し、影響の大きい破綻だけを bad として拾う。
  // 食塩の超過とたんぱく質不足だけは単独でも全体判定を落とす。
  // 前者は毎日積み重なると健康被害に直結し、後者は他の栄養素の利用にも響くため。
  let overall;
  if (items.salt.level === 'bad' || items.protein.level === 'bad' || bads >= 3) overall = 'bad';
  else if (bads >= 1 || warns >= 3) overall = 'warn';
  else overall = 'good';
  return { items, pfc, score, bads, warns, overall };
}

/**
 * 献立生成中に使う「その日にまだ足りない量」。
 * 不足しているほど大きい値を返し、候補レシピのスコアリングに使う。
 * 食塩は不足を埋めたい栄養素ではないので負の重み(=多いほど減点)で扱う。
 */
export function deficits(current, targets) {
  const d = {};
  ['protein', 'fiber', 'calcium', 'iron', 'vitC', 'veg', 'kcal'].forEach((k) => {
    d[k] = Math.max(0, (targets[k] || 0) - (current[k] || 0));
  });
  d.saltRoom = (targets.salt || 0) - (current.salt || 0);
  return d;
}

// レシピの分量は「1人前」だが、1人前×3食が実際に供給するのは約1800kcal。
// 世帯の必要量はこれより多い(成人男性は2700kcal)ので、人数ではなく
// エネルギー必要量から求めた「食数係数」で全体を掛ける。
// 人数で掛けると成人男性の日が常にエネルギー不足判定になり、
// 買い物量も足りなくなる(実際そうなった)。
export const BASE_DAY_KCAL = 1800;

export function servingFactor(person) {
  return personTargets(person).kcal / BASE_DAY_KCAL;
}

export function householdFactor(members) {
  return members.reduce((s, m) => s + servingFactor(m), 0);
}

/**
 * 目標からのずれを1つの非負の数値にする。0が完璧で、大きいほど悪い。
 *
 * 判定(good/warn/bad)は利用者に見せるには良いが、改善の探索には粗すぎる。
 * 食塩152%を135%に下げても判定は bad のままなので、レベルの変化だけを見ていると
 * 「悪いまま少し良くなる」差し替えが1件も見つからない(実際そうなった)。
 * 探索にはこの連続量を使い、表示には判定を使う。
 */
export function imbalance(n, targets) {
  let s = 0;
  const under = (k, w) => {
    const r = (n[k] || 0) / (targets[k] || 1);
    s += w * Math.max(0, 1 - r) ** 2;
  };
  const over = (k, w) => {
    const r = (n[k] || 0) / (targets[k] || 1);
    s += w * Math.max(0, r - 1) ** 2;
  };
  under('protein', 1.0); under('fiber', 0.8); under('calcium', 1.2);
  under('iron', 0.6); under('vitC', 0.4); under('veg', 1.2);
  over('salt', 3.0);

  // エネルギーは不足も過剰も困る。±10%は許容し、そこから外れた分だけを数える。
  const rk = (n.kcal || 0) / (targets.kcal || 1);
  s += 1.5 * Math.max(0, Math.abs(rk - 1) - 0.10) ** 2;

  // PFCは範囲から外れた分だけ。%Eの差は小さいので、他の項と釣り合う倍率にしてある。
  const kcal = n.kcal || 1;
  [['protein', 4], ['fat', 9], ['carb', 4]].forEach(([k, coef]) => {
    const r = (n[k] * coef) / kcal;
    const [lo, hi] = PFC_RANGE[k];
    const out = Math.max(0, lo - r) + Math.max(0, r - hi);
    s += 60 * out ** 2;
  });
  return s;
}
