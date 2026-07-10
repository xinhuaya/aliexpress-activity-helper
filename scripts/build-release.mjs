import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(rootDir, 'aliexpress-activity-helper.user.js');
const templatePath = path.join(rootDir, 'web', 'index.html');
const packagePath = path.join(rootDir, 'package.json');
const outputDir = path.join(rootDir, 'dist');
const stableDir = path.join(outputDir, 'stable');
const baseUrl = 'https://xinhuaya.github.io/aliexpress-activity-helper';
const updateUrl = `${baseUrl}/stable/aliexpress-activity-helper.meta.js`;
const downloadUrl = `${baseUrl}/stable/aliexpress-activity-helper.user.js`;

const source = fs.readFileSync(sourcePath, 'utf8');
const metadata = source.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/)?.[0];
assert.ok(metadata, 'Userscript metadata block is missing.');

const version = metadata.match(/@version\s+([^\s]+)/)?.[1];
const runtimeVersion = source.match(/const SCRIPT_VERSION = '([^']+)'/)?.[1];
const packageVersion = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
assert.ok(version, '@version is missing.');
assert.equal(runtimeVersion, version, 'SCRIPT_VERSION must match @version.');
assert.equal(packageVersion, version, 'package.json version must match @version.');
assert.match(metadata, new RegExp(`@updateURL\\s+${escapeRegex(updateUrl)}`));
assert.match(metadata, new RegExp(`@downloadURL\\s+${escapeRegex(downloadUrl)}`));

const template = fs.readFileSync(templatePath, 'utf8');
const indexHtml = template
  .replaceAll('__VERSION__', version)
  .replaceAll('__DOWNLOAD_URL__', downloadUrl);

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(stableDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'index.html'), indexHtml, 'utf8');
fs.writeFileSync(path.join(stableDir, 'aliexpress-activity-helper.user.js'), source, 'utf8');
fs.writeFileSync(path.join(stableDir, 'aliexpress-activity-helper.meta.js'), `${metadata}\n`, 'utf8');
fs.writeFileSync(path.join(outputDir, 'latest.json'), `${JSON.stringify({
  version,
  updateUrl,
  downloadUrl
}, null, 2)}\n`, 'utf8');

console.log(`Built AE Activity Helper ${version} for GitHub Pages.`);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
