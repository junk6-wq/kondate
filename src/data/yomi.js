// 食材名の読み。名前で探すとき「とり」で鶏もも肉、「たまご」で卵が見つかるようにする。
// 漢字を含む名前だけ持てばよい(かなの名前は kana() でそのまま照合できる)。
// 食材マスタに漢字の名前を足したら、ここにも読みを足す(tests/data.test.mjs が確認する)。

import { INGREDIENTS } from './ingredients.js';
import { kana } from '../ui/dom.js';

export const YOMI = {
  hakusai: 'はくさい', spinach: 'ほうれんそう', komatsuna: 'こまつな', shungiku: 'しゅんぎく',
  chingensai: 'ちんげんさい', mizuna: 'みずな', toumyou: 'とうみょう', negi: 'ながねぎ',
  konegi: 'こねぎ', tamanegi: 'たまねぎ', daikon: 'だいこん', satoimo: 'さといも',
  torimomo: 'とりももにく', torimune: 'とりむねにく', sasami: 'とりささみ', torihiki: 'とりひきにく',
  butakoma: 'ぶたこまぎれにく', butabara: 'ぶたばらにく', butaloin: 'ぶたろーすにく', butahiki: 'ぶたひきにく',
  aibiki: 'あいびきにく', gyukoma: 'ぎゅうこまぎれにく', sake: 'さけ しゃけ', tamago: 'たまご',
  gyunyu: 'ぎゅうにゅう', pizzacheese: 'ぴざようちーず', momen: 'もめんどうふ', kinu: 'きぬごしどうふ',
  atsuage: 'あつあげ', aburaage: 'あぶらあげ', natto: 'なっとう', tounyu: 'とうにゅう',
  rice: 'こめ', shokupan: 'しょくぱん', chukamen: 'ちゅうかめん らーめん', gyozakawa: 'ぎょうざのかわ',
  komugiko: 'こむぎこ', katakuriko: 'かたくりこ', panko: 'ぱんこ', kiriboshi: 'きりぼしだいこん',
  harusame: 'はるさめ', nori: 'やきのり', tunacan: 'つなかん', sabacan: 'さばみずにかん',
  daizu: 'だいずみずに', tomatocan: 'とまとかん', shio: 'しお', satou: 'さとう',
  sake_c: 'りょうりしゅ', abura: 'さらだあぶら', gomaabura: 'ごまあぶら', su: 'す',
  sauce: 'ちゅうのうそーす', toban: 'とうばんじゃん', torigara: 'とりがらすーぷのもと',
  dashi: 'わふうだしのもと', fzspinach: 'れいとうほうれんそう', fzcorn: 'れいとうこーん',
  fzmixveg: 'れいとうみっくすべじたぶる',
};

const KEYS = new Map(INGREDIENTS.map((i) => [i.id, kana(`${i.name} ${YOMI[i.id] || ''}`)]));

/** 名前か読みに text を含む食材を返す。かな・カナの違いは無視する。 */
export function searchIngredients(text) {
  const q = kana(text);
  if (!q) return [];
  return INGREDIENTS.filter((i) => KEYS.get(i.id).includes(q));
}
