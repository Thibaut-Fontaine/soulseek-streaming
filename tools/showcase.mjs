#!/usr/bin/env node
// Publish a freshly built APK on the current branch: copy it to
// releases/SoulStream.apk and refresh showcase/index.html + showcase/qr.png
// (download links and build info: version, commit, date, size, SHA-256).
//
//   node tools/showcase.mjs android/app/build/outputs/apk/release/app-release.apk [--url <url>]
//
// Run it from the commit the APK was built from, then commit and push
// releases/ and showcase/. By default the QR code points to the APK on GitHub
// for this branch; the repo is private, so it needs a logged-in account with
// access. Pass --url to point it somewhere else.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const REPO = 'https://github.com/Thibaut-Fontaine/soulseek-streaming';
const PAGE = fileURLToPath(new URL('../showcase/index.html', import.meta.url));
const QRCODE = fileURLToPath(new URL('../showcase/qr.png', import.meta.url));
const RELEASES = fileURLToPath(new URL('../releases/', import.meta.url));

const args = process.argv.slice(2);
const urlFlag = args.indexOf('--url');
const customUrl = urlFlag >= 0 ? args.splice(urlFlag, 2)[1] : undefined;
const apkPath = args[0];
if (!apkPath || (urlFlag >= 0 && !customUrl)) {
  console.error('usage: node tools/showcase.mjs <apk> [--url <download url>]');
  process.exit(1);
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const escape = s =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Changes to app code that the commit doesn't contain would not be in the
// build info, so refuse rather than publish a misleading commit.
const dirty = git('status', '--porcelain', '--', '.', ':!showcase', ':!releases', ':!tools/showcase.mjs');
if (dirty) {
  console.error('Uncommitted changes outside showcase/; commit them and rebuild first:\n' + dirty);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
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
const url = customUrl ?? `${REPO}/raw/${encodeURIComponent(branch)}/releases/SoulStream.apk`;

mkdirSync(RELEASES, { recursive: true });
copyFileSync(apkPath, RELEASES + 'SoulStream.apk');

await QRCode.toFile(QRCODE, url, {
  type: 'png',
  width: 600,
  errorCorrectionLevel: 'H', // the app icon covers the centre
  margin: 4,
  color: { dark: '#0B0A0F', light: '#FFFFFF' },
});

const info = `<!-- build:info -->
      <dl class="build">
        <div class="wide"><dt>Version</dt><dd><code>${escape(pkg.version)}</code></dd></div>
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
replace(/<!-- build:info -->.*?<!-- \/build:info -->/s, info);
replace(/href="[^"]*"( data-build="apk-link")/g, `href="${escape(url)}"$1`);
writeFileSync(PAGE, html);

console.log(`showcase updated: ${branch}@${commit}, ${sizeMb} Mo, sha256 ${sha256}`);
console.log(`APK copied to releases/SoulStream.apk; QR -> ${url}`);
