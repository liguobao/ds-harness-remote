#!/usr/bin/env node
// 版本号唯一入口：同时改 AppScope/app.json5 与 ServerApi 的兜底常量。
//
//   node harmony/scripts/bump-version.mjs 0.17.101-lan 1000223
//   node harmony/scripts/bump-version.mjs --check      # 只校验两处是否一致
//
// 起因：今晚用 sed 逐版本替换兜底常量，其中一次没匹配上，导致 app.json5 到了 0.17.100
// 而 ServerApi 还停在 0.17.84（bundleInfo 读取失败时会把假版本报给主机）。
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appJson = join(root, 'AppScope/app.json5');
const serverApi = join(root, 'entry/src/main/ets/net/ServerApi.ets');

const app = readFileSync(appJson, 'utf8');
const api = readFileSync(serverApi, 'utf8');
const appVersion = /"versionName":\s*"([^"]+)"/.exec(app)?.[1] ?? '';
const appCode = /"versionCode":\s*(\d+)/.exec(app)?.[1] ?? '';
const fallback = /CLIENT_VERSION_FALLBACK: string = '([^']*)'/.exec(api)?.[1] ?? '';

const checkOnly = process.argv[2] === '--check';
if (checkOnly) {
  const ok = appVersion === fallback && appVersion !== '';
  console.log(`app.json5  versionName=${appVersion} versionCode=${appCode}`);
  console.log(`ServerApi   CLIENT_VERSION_FALLBACK=${fallback}`);
  console.log(ok ? '✅ 两处一致' : '✖ 两处不一致（跑一次 bump-version <name> <code> 修）');
  process.exit(ok ? 0 : 1);
}

const [versionName, versionCode] = process.argv.slice(2);
if (!versionName || !versionCode) {
  console.error('用法：node harmony/scripts/bump-version.mjs <versionName> <versionCode> ｜ --check');
  process.exit(2);
}
writeFileSync(appJson, app.replace(/"versionName":\s*"[^"]+"/, `"versionName": "${versionName}"`)
  .replace(/"versionCode":\s*\d+/, `"versionCode": ${versionCode}`));
writeFileSync(serverApi, api.replace(/CLIENT_VERSION_FALLBACK: string = '[^']*'/,
  `CLIENT_VERSION_FALLBACK: string = '${versionName}'`));
console.log(`已把版本改成 ${versionName} / ${versionCode}（app.json5 与 ServerApi 两处同步）`);
