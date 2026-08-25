// 保存層。ブラウザの localStorage に保存する。
// サーバーを持たないので、献立・設定・在庫はすべて利用者の端末に残る。
// 献立は90日ぶんで数百KBになるため、レシピの中身ではなくIDだけを保存している。

const KEY = 'kondate.v1';

const DEFAULT_STATE = {
  household: [
    { id: 'p1', name: '本人', age: 38, sex: 'male', activity: 'normal' },
  ],
  settings: {
    startDate: null,        // null なら今日
    days: 90,
    shoppingIntervalDays: 7,
    sidesPerDinner: 2,
    weekdayMaxMinutes: 30,
    saltScale: 0.85,
    excludeIngredients: [],
    avoidCuisines: [],
    seed: null,
  },
  plan: null,
  pantry: [],
  checkedItems: {},         // 買い物リストのチェック状態 "date:ingredientId" -> true
};

function safeParse(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadState() {
  const saved = safeParse(localStorage.getItem(KEY));
  if (!saved) return structuredClone(DEFAULT_STATE);
  return {
    ...structuredClone(DEFAULT_STATE),
    ...saved,
    settings: { ...DEFAULT_STATE.settings, ...(saved.settings || {}) },
  };
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    // 容量超過。90日ぶんの献立を保存できないと使い物にならないので、
    // 黙って失敗させず呼び出し側に返す。
    console.warn('保存に失敗しました', e);
    return false;
  }
}

export function clearState() {
  localStorage.removeItem(KEY);
}

export { DEFAULT_STATE };
