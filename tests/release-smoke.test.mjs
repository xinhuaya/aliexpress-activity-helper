import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(rootDir, 'aliexpress-activity-helper.user.js'), 'utf8');
const publishedScript = fs.readFileSync(path.join(rootDir, 'dist', 'stable', 'aliexpress-activity-helper.user.js'), 'utf8');
const publishedMetadata = fs.readFileSync(path.join(rootDir, 'dist', 'stable', 'aliexpress-activity-helper.meta.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(rootDir, 'dist', 'index.html'), 'utf8');
const latest = JSON.parse(fs.readFileSync(path.join(rootDir, 'dist', 'latest.json'), 'utf8'));

const metadata = source.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/)?.[0] || '';
assert.equal(publishedScript, source);
assert.equal(publishedMetadata.trim(), metadata);
assert.equal(latest.version, '0.9.9');
assert.equal(latest.updateUrl, 'https://xinhuaya.github.io/aliexpress-activity-helper/stable/aliexpress-activity-helper.meta.js');
assert.equal(latest.downloadUrl, 'https://xinhuaya.github.io/aliexpress-activity-helper/stable/aliexpress-activity-helper.user.js');
assert.match(indexHtml, /当前稳定版 <strong>v0\.9\.9<\/strong>/);
assert.match(indexHtml, /“新品闪电推”不可以通过本脚本退出/);
assert.match(indexHtml, /SALE 仍残留已经退出的活动/);
assert.match(indexHtml, /活动页面加载较慢/);
assert.match(indexHtml, /结束本次/);
assert.match(indexHtml, /拖动/);
assert.match(indexHtml, /“商品报名 &gt; 已报名”/);
assert.match(indexHtml, /桌面通知/);
assert.match(indexHtml, /标签标题会闪烁/);
assert.match(indexHtml, /href="https:\/\/xinhuaya\.github\.io\/aliexpress-activity-helper\/stable\/aliexpress-activity-helper\.user\.js"/);
assert.doesNotMatch(`${publishedScript}\n${publishedMetadata}\n${indexHtml}`, /codex|localhost|127\.0\.0\.1/i);

console.log('release smoke test passed');
