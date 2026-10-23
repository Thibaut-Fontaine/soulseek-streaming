#!/usr/bin/env node
// Refresh showcase/index.html for a freshly built APK: QR code, download
// links and build info (branch, commit, date, size, SHA-256).
//
//   node tools/showcase.mjs android/app/build/outputs/apk/release/app-release.apk \
//     [--url https://thibautfontaine.space/streaming/dev/SoulStream.apk]
//
// Run it from the commit the APK was built from, then upload the APK to --url.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const DEFAULT_URL = 'https://thibautfontaine.space/streaming/dev/SoulStream.apk';
const PAGE = fileURLToPath(new URL('../showcase/index.html', import.meta.url));

const args = process.argv.slice(2);
const urlFlag = args.indexOf('--url');
const url = urlFlag >= 0 ? args.splice(urlFlag, 2)[1] : DEFAULT_URL;
const apkPath = args[0];
if (!apkPath || !url) {
  console.error('usage: node tools/showcase.mjs <apk> [--url <download url>]');
  process.exit(1);
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const escape = s =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Changes to app code that the commit doesn't contain would not be in the
// build info, so refuse rather than publish a misleading commit.
const dirty = git('status', '--porcelain', '--', '.', ':!showcase', ':!tools/showcase.mjs');
if (dirty) {
  console.error('Uncommitted changes outside showcase/; commit them and rebuild first:\n' + dirty);
  process.exit(1);
}

const apk = readFileSync(apkPath);
const sha256 = createHash('sha256').update(apk).digest('hex');
const sizeMb = (apk.length / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const commit = git('rev-parse', '--short', 'HEAD');
const date = new Date(git('log', '-1', '--format=%cI')).toLocaleDateString('fr-FR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const svg = await QRCode.toString(url, {
  type: 'svg',
  errorCorrectionLevel: 'H', // the app icon covers the centre
  margin: 0,
  color: { dark: '#0B0A0F', light: '#FFFFFF' },
});
const viewBox = svg.match(/viewBox="([^"]+)"/)[1];
const paths = svg
  .replace(/^.*?<svg[^>]*>/s, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<path fill="#FFFFFF"[^>]*\/>/, '');

const info = `<!-- build:info -->
      <dl class="build">
        <div class="wide"><dt>Branche</dt><dd><code>${escape(branch)}</code></dd></div>
        <div><dt>Commit</dt><dd><code>${commit}</code></dd></div>
        <div><dt>Date</dt><dd>${escape(date)}</dd></div>
        <div><dt>Taille</dt><dd>${sizeMb} Mo</dd></div>
        <div><dt>Android</dt><dd>7.0+</dd></div>
      </dl>
      <p class="sha">SHA-256 <code>${sha256}</code></p>
      <!-- /build:info -->`;

let html = readFileSync(PAGE, 'utf8');
const replace = (re, to) => {
  if (!re.test(html)) throw new Error(`marker not found in showcase/index.html: ${re}`);
  html = html.replace(re, to);
};
replace(/(data-build="viewbox" viewBox=")[^"]+"/, `$1${viewBox}"`);
replace(/<!-- build:qr -->.*?<!-- \/build:qr -->/s, `<!-- build:qr -->${paths}<!-- /build:qr -->`);
replace(/<!-- build:info -->.*?<!-- \/build:info -->/s, info);
replace(/href="[^"]*"( data-build="apk-link")/g, `href="${escape(url)}"$1`);
writeFileSync(PAGE, html);

console.log(`showcase updated: ${branch}@${commit}, ${sizeMb} Mo, sha256 ${sha256}`);
console.log(`QR -> ${url}`);
