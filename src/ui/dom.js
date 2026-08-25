// DOM組み立ての小道具。テンプレート文字列でHTMLを書くと、料理名などの
// 利用者由来の文字列でエスケープを忘れやすいので、要素を関数で作る。

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    // aria-* は false も意味を持つ属性。真偽値を落とすと aria-selected="" になり、
    // CSSの [aria-selected="true"] に一致せず選択状態が見た目に出ない。
    if (k.startsWith('aria-')) { node.setAttribute(k, String(v)); return; }
    if (v == null || v === false) return;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.entries(v).forEach(([dk, dv]) => { node.dataset[dk] = dv; });
    else node.setAttribute(k, v === true ? '' : String(v));
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c == null || c === false) return;
    node.append(typeof c === 'string' || typeof c === 'number' ? String(c) : c);
  });
  return node;
}

/**
 * 中身を空にする。1つずつ removeChild すると、消している最中に
 * blur イベント経由で再描画が始まったときに参照が古くなって例外になる。
 * replaceChildren は1回の操作で置き換わるので、その隙間ができない。
 */
export function clear(node) {
  node.replaceChildren();
  return node;
}

export function field(labelText, control) {
  return el('label', { class: 'field' }, [labelText, control]);
}

export function select(options, value, onchange, attrs = {}) {
  const node = el('select', { ...attrs, onchange });
  options.forEach(([v, label]) => {
    node.append(el('option', { value: v, selected: String(v) === String(value) }, label));
  });
  return node;
}

const WD = ['日', '月', '火', '水', '木', '金', '土'];

export function formatDate(iso, withYear = false) {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = WD[new Date(y, m - 1, d).getDay()];
  return `${withYear ? `${y}/` : ''}${m}/${d}(${wd})`;
}

export function weekdayIndex(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 達成率のバー。目標100%の位置に印を置き、どちら側に外れているかを見せる。 */
export function ratioBar(ratio, level, upperBound = false) {
  const pct = Math.max(0, Math.min(160, ratio * 100));
  const bar = el('div', { class: 'bar' }, [
    el('i', { class: level === 'good' ? '' : level, style: `width:${(pct / 160) * 100}%` }),
    el('span', { class: 'mark', style: `left:${(100 / 160) * 100}%`, title: upperBound ? '上限' : '目標' }),
  ]);
  return bar;
}
