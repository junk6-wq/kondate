// ブラウザでの通し確認。node --test では動かないので単独で実行する。
//
//   npm i --no-save playwright
//   npm start &                 # http://localhost:8080
//   BASE=http://localhost:8080 node tests/e2e.mjs
//
// 単体テスト(npm test)がエンジンの正しさを見るのに対し、こちらは
// 「画面に出て、押せて、保存される」ところまでを確認する。
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8080';
const SHOT = process.env.SHOT_DIR || null;
const shot = async (page, name, opts = {}) => {
  if (SHOT) await page.screenshot({ path: `${SHOT}/${name}.png`, ...opts });
};
const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
let failed = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) failed += 1;
  console.log((cond ? '✓' : '✗') + ' ' + label + (extra ? '  ' + extra : ''));
};
const tab = async (name) => { await page.click(`nav.tabs button:has-text("${name}")`); await page.waitForTimeout(400); };
const count = async (sel) => (await page.$$(sel)).length;

await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
ok('タブが5つ表示される', await count('nav.tabs button') === 5);
ok('最初は献立タブが選ばれている',
  (await page.$eval('nav.tabs button[aria-selected="true"]', n => n.textContent)).includes('献立'));
ok('献立がないときは「つくる」ボタンが出る', await count('button.btn.big') === 1);

// 3人世帯
await tab('設定');
await page.click('text=+ 人を追加'); await page.waitForTimeout(120);
await page.click('text=+ 人を追加'); await page.waitForTimeout(120);
let nums = await page.$$('input[type=number]');
await nums[1].fill('36'); await nums[1].dispatchEvent('change'); await page.waitForTimeout(150);
nums = await page.$$('input[type=number]');
await nums[2].fill('8'); await nums[2].dispatchEvent('change'); await page.waitForTimeout(150);
const kcal = await page.$eval('details.hint summary', n => n.textContent);
ok('世帯目標が合算される', kcal.includes('6450 kcal'), kcal);
const selects = await page.$$eval('select', ns => ns.map(n => n.value));
ok('期間の既定が2週間', selects.includes('14'));
ok('味付けの既定がひかえめ', selects.includes('0.85'));
await shot(page, '1-setup', { fullPage: true });

await page.click('button.btn:has-text("2週間ぶんつくる")');
await page.waitForTimeout(1200);
ok('つくると献立タブに移る',
  (await page.$eval('nav.tabs button[aria-selected="true"]', n => n.textContent)).includes('献立'));
ok('日付の帯が14日ぶん', await count('.chip-day') === 14);
ok('朝・昼・夕のカードが出る', await count('.mealcard') === 3);
await page.click('.chip-day:nth-child(2)'); await page.waitForTimeout(300);
ok('日を押すとその日に切り替わる',
  (await page.$eval('.chip-day:nth-child(2)', n => n.getAttribute('aria-pressed'))) === 'true');
ok('作り方が入っている', await count('details.recipe ol li') > 10);

// 1品入れ替え
const beforeDish = await page.$$eval('.dish', ns => ns.map(n => n.textContent).join('|'));
await page.click('.dish button:has-text("入れ替える")'); await page.waitForTimeout(300);
const cands = await count('.cand');
ok('入れ替えの候補が出る', cands > 0 && cands <= 4, `${cands}件`);
await page.click('.cand'); await page.waitForTimeout(400);
const afterDish = await page.$$eval('.dish', ns => ns.map(n => n.textContent).join('|'));
ok('候補を押すと料理が変わる', beforeDish !== afterDish && await count('.cand') === 0);
await shot(page, '2-plan-day');

await page.click('.seg button:has-text("一覧")'); await page.waitForTimeout(400);
ok('一覧は 14日 = 2週', await count('.week') === 2 && await count('.day') === 14);
const dots = await page.$$eval('.day .dot', ns => ns.map(n => n.className.split(' ')[1]));
ok('栄養判定の色が付く', dots.filter(d => d === 'good').length > 6,
  `良好${dots.filter(d => d === 'good').length}日 注意${dots.filter(d => d === 'warn').length}日 要改善${dots.filter(d => d === 'bad').length}日`);
await shot(page, '2-plan-list');
await page.click('.day'); await page.waitForTimeout(300);
ok('一覧の日を押すと1日表示に戻る', await count('.mealcard') === 3);

await tab('買い出し');
ok('買い物は2回', await count('.trip-nav button') === 2);
const aisles = await page.$$eval('.aisle h4', ns => ns.map(n => n.textContent));
ok('売り場順に並ぶ', aisles[0] === '青果', aisles.join('>'));
const total = await count('.shop-item');
await page.click('.shop-item'); await page.waitForTimeout(250);
ok('行を押すとチェックが付く', await count('.shop-item.done') === 1);
ok('進み具合が出る', (await page.$eval('.progress', n => n.textContent)).includes(`1 / ${total}`));
await page.click('.progress button'); await page.waitForTimeout(250);
ok('買ったものを隠せる', await count('.shop-item') === total - 1);
await page.click('.trip-nav button:nth-child(2)'); await page.waitForTimeout(400);
ok('別の買い物日に切り替わる', await count('.shop-item') > 0);
await shot(page, '3-shopping');

await tab('冷蔵庫');
for (const [query, name] of [['はくさい', '白菜'], ['とり', '鶏もも肉'], ['ぎゅうにゅう', '牛乳']]) {
  await page.fill('input.search', query); await page.waitForTimeout(150);
  await page.click(`.chips .chip:has-text("${name}")`); await page.waitForTimeout(250);
}
ok('かなで探して在庫が3件登録される', await count('.pantry-row') === 3);
await page.click('button:has-text("在庫にあわせて組み直す")'); await page.waitForTimeout(1200);
const changes = await count('.change');
ok('差し替えが局所的（20件以下）', changes > 0 && changes <= 20, `${changes}件`);
const usedUp = await page.$$eval('table.mini .tag', ns => ns.map(n => n.textContent));
ok('使い切り判定が出る', usedUp.length === 3, usedUp.join(','));
await shot(page, '4-pantry', { fullPage: true });

await tab('栄養');
ok('週の講評が出る', (await page.$eval('.notice', n => n.textContent)).length > 8);
ok('週バーが8項目', await count('.nutri .n-row') >= 8);
ok('日別テーブルが7行', await count('table.mini tbody tr') === 7);
await shot(page, '5-nutrition');

await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(600);
ok('リロードで献立と在庫が保持される', await count('.chip-day') === 14);
ok('リロード後もタブが選択状態', await count('nav.tabs button[aria-selected="true"]') === 1);

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
for (const name of ['献立', '買い出し', '冷蔵庫', '栄養', '設定']) {
  await tab(name);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  ok(`スマホ幅で横スクロールが出ない（${name}）`, !overflow);
}
ok('スマホ幅ではタブが画面の下に付く',
  await page.$eval('nav.tabs', n => getComputedStyle(n).position === 'fixed'));
await shot(page, '6-mobile');

console.log('\nコンソールエラー:', errors.length ? errors : 'なし');
await browser.close();
if (errors.length || failed) process.exit(1);
