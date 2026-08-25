// シード付き乱数 (mulberry32)
// 献立生成にランダム性は必要だが、Math.random() だと同じ条件で結果が再現できず、
// 「さっきの献立に戻して」もテストも成立しなくなる。シードから決定論的に生成する。

export function makeRng(seed) {
  let a = typeof seed === 'string' ? hashString(seed) : (seed >>> 0);
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// 重み付き抽選。重みが大きいものほど選ばれやすいが、必ず選ばれるわけではない。
// 最高スコアだけを取ると毎回同じ献立になるので、上位から確率的に選ぶために使う。
export function weightedPick(items, weights, rng) {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (total <= 0) return items[Math.floor(rng() * items.length)];
  let r = rng() * total;
  for (let i = 0; i < items.length; i += 1) {
    r -= Math.max(0, weights[i]);
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
