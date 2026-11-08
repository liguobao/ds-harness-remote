#!/usr/bin/env node
// 校验鸿蒙客户端的中英文案表：
//   1) UI 里出现过的每个 this.tr('…') 都必须有英文条目
//   2) 同一个中文 key 不允许重复 map.set（后者会覆盖前者，容易埋雷）
//   3) 英文翻译里不允许残留中日韩字符（漏翻的典型症状）
//   4) 英文翻译不能是空串（除非原 key 本身就是量词占位）
//
// 用法：node harmony/scripts/check-i18n.mjs     （退出码 1 = 有问题）
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const etsRoot = join(root, 'entry/src/main/ets');
const i18nPath = join(etsRoot, 'services/I18n.ets');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.ets')) out.push(p);
  }
  return out;
}

const i18n = readFileSync(i18nPath, 'utf8');

// 1) 收集 map.set('zh', 'en')，保留重复信息
const entries = new Map();
const duplicates = [];
const cjk = /[\u4e00-\u9fff\u3040-\u30ff]/;
// 语言名在切换器里按原样显示，允许中文字符
const CJK_ALLOWED = new Set(['中文', '日本語', 'English', '中文 / English']);
const cjkHits = [];
const emptyHits = [];
for (const m of i18n.matchAll(/map\.set\('((?:[^'\\]|\\.)*)',\s*'((?:[^'\\]|\\.)*)'\);/g)) {
  const zh = m[1];
  const en = m[2];
  if (entries.has(zh) && entries.get(zh) !== en) duplicates.push(`${zh} → ${entries.get(zh)} / ${en}`);
  entries.set(zh, en);
  if (cjk.test(en) && !CJK_ALLOWED.has(en) && !CJK_ALLOWED.has(zh)) cjkHits.push(`${zh} → ${en}`);
  if (en.trim().length === 0 && zh.trim().length > 0 && !/^[\s个行轮字次张]+$/.test(zh)) {
    emptyHits.push(zh);
  }
}

// 2) 收集 UI 里的 tr() key
const used = new Set();
for (const file of walk(etsRoot)) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/this\.tr\('((?:[^'\\]|\\.)*)'\)/g)) used.add(m[1]);
  for (const m of src.matchAll(/\bt\('((?:[^'\\]|\\.)*)'\)/g)) used.add(m[1]);
}
const missing = [...used].filter(k => !entries.has(k)).sort();

let failed = false;
const report = (title, list) => {
  if (list.length === 0) return;
  failed = true;
  console.log(`\n✖ ${title}（${list.length}）`);
  for (const item of list.slice(0, 40)) console.log('   ' + item);
  if (list.length > 40) console.log(`   …还有 ${list.length - 40} 条`);
};

report('UI 用到但没有英文翻译', missing);
report('重复 key（不同翻译）', duplicates);
report('英文里残留中日韩字符', cjkHits);
report('英文翻译为空', emptyHits);

if (!failed) {
  console.log(`✅ i18n 校验通过：${used.size} 个 UI 文案全部有英文（条目总数 ${entries.size}）`);
}
process.exit(failed ? 1 : 0);
