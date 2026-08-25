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

await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
ok('タブが5つ表示される', (await page.$$('nav.tabs button')).length === 5);
ok('選択中タブがハイライトされる', (await page.$$('nav.tabs button[aria-selected="true"]')).length === 1);

// 3人世帯
await page.click('text=+ 人を追加'); await page.waitForTimeout(120);
await page.click('text=+ 人を追加'); await page.waitForTimeout(120);
let nums = await page.$$('input[type=number]');
await nums[1].fill('36'); await nums[1].dispatchEvent('change'); await page.waitForTimeout(150);
nums = await page.$$('input[type=number]');
await nums[2].fill('8'); await nums[2].dispatchEvent('change'); await page.waitForTimeout(150);
const kcal = await page.$eval('table.mini tr td', n => n.textContent);
ok('世帯目標が合算される', kcal === '6450 kcal', kcal);
ok('味付けの既定がひかえめ', (await page.$$eval('select', ns => ns.map(n=>n.value))).includes('0.85'));
await shot(page, '1-setup', { fullPage: true  });

await page.click('button.btn:has-text("献立をつくる")');
await page.waitForTimeout(1500);
await page.click('nav.tabs button:has-text("献立")'); await page.waitForTimeout(500);
ok('90日 = 13週', (await page.$$('.week')).length === 13);
ok('日カードが90枚', (await page.$$('.day')).length === 90);
const dots = await page.$$eval('.day .dot', ns => ns.map(n => n.className.split(' ')[1]));
ok('栄養判定の色が付く', dots.filter(d=>d==='good').length > 40, `良好${dots.filter(d=>d==='good').length}日 注意${dots.filter(d=>d==='warn').length}日 要改善${dots.filter(d=>d==='bad').length}日`);
await page.click('.day:nth-child(2)'); await page.waitForTimeout(400);
ok('詳細に作り方が出る', (await page.$$('.meal ol li')).length > 15);
ok('詳細に栄養バーが出る', (await page.$$('.n-row')).length === 8);
await shot(page, '2-plan', {   });

await page.click('nav.tabs button:has-text("買い出し")'); await page.waitForTimeout(700);
ok('買い物回数が13回', (await page.$$('.trip-nav button')).length === 13);
const aisles = await page.$$eval('.aisle h4', ns => ns.map(n=>n.textContent));
ok('売り場順に並ぶ', aisles[0] === '青果' && aisles[aisles.length-1] === '冷凍', aisles.join('>'));
const item0 = await page.$eval('.shop-item label', n => n.textContent.replace(/\s+/g,' ').trim());
ok('数量が購入単位で出る', /^\d+[^\d]/.test(item0), item0.slice(0,50));
await page.check('.shop-item input'); await page.waitForTimeout(250);
ok('チェックが反映される', (await page.$eval('.shop-item', n => n.className)).includes('done'));
await page.click('.trip-nav button:nth-child(3)'); await page.waitForTimeout(400);
ok('別の買い物日に切り替わる', (await page.$$('.shop-item')).length > 0);
await shot(page, '3-shopping', {   });

await page.click('nav.tabs button:has-text("冷蔵庫")'); await page.waitForTimeout(300);
for (const name of ['白菜', '鶏もも肉', '牛乳']) {
  await page.selectOption('.card select', { label: name }); await page.waitForTimeout(150);
  await page.click('button:has-text("+ 追加")'); await page.waitForTimeout(250);
}
ok('在庫が3件登録される', (await page.$$('.pantry-row')).length === 3);
await page.click('button:has-text("在庫にあわせて組み直す")'); await page.waitForTimeout(1200);
const changes = await page.$$('.change');
ok('差し替えが局所的（20件以下）', changes.length > 0 && changes.length <= 20, `${changes.length}件`);
const usedUp = await page.$$eval('table.mini .tag', ns => ns.map(n=>n.textContent));
ok('使い切り判定が出る', usedUp.length === 3, usedUp.join(','));
await shot(page, '4-pantry', { fullPage: true  });

await page.click('nav.tabs button:has-text("栄養")'); await page.waitForTimeout(700);
ok('週の講評が出る', (await page.$eval('.notice', n=>n.textContent)).length > 8);
ok('週バーが8項目', (await page.$$('.nutri .n-row')).length >= 8);
ok('日別テーブルが7行', (await page.$$('table.mini tbody tr')).length === 7);
const swaps = await page.$$('.swap');
ok('差し替え候補が出る', swaps.length > 0, `${swaps.length}件`);
if (swaps.length) {
  const before = await page.$eval('.swap .headline', n=>n.textContent.replace(/\s+/g,' ').trim());
  const beforeRow = await page.$$eval('table.mini tbody tr', ns => ns.map(n=>n.textContent.replace(/\s+/g,' ')));
  await page.click('.swap button'); await page.waitForTimeout(700);
  const afterHead = await page.$eval('.swap .headline', n=>n.textContent.replace(/\s+/g,' ').trim()).catch(()=>null);
  const afterRow = await page.$$eval('table.mini tbody tr', ns => ns.map(n=>n.textContent.replace(/\s+/g,' ')));
  ok('差し替えを適用すると献立と栄養が変わる',
    afterHead !== before && JSON.stringify(afterRow) !== JSON.stringify(beforeRow),
    afterHead === null ? '候補を出し切った' : '');
}
await shot(page, '5-nutrition', {   });

await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(600);
ok('リロードで献立が保持される', (await page.$$('.day')).length === 90);
ok('リロード後もタブが選択状態', (await page.$$('nav.tabs button[aria-selected="true"]')).length === 1);

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
ok('スマホ幅で横スクロールが出ない', !overflow);
await shot(page, '6-mobile', {   });

console.log('\nコンソールエラー:', errors.length ? errors : 'なし');
await browser.close();
if (errors.length || failed) process.exit(1);
