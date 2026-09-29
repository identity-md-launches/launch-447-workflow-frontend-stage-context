// Rewrites dist/imd-deployment.json after `vite build`, listing every exported file with its
// SHA-256. Run it after every export change; the manifest excludes itself.
//
//   node scripts/manifest.mjs [--dist ../dist]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, sha256Hex, walk } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const i = args.indexOf('--dist');
const dist = path.resolve(i >= 0 && args[i + 1] ? args[i + 1] : path.join(here, '../../dist'));
const manifestPath = path.join(dist, 'imd-deployment.json');

const manifest = readJson(manifestPath);
const files = walk(dist).filter((p) => p !== 'imd-deployment.json');
const MAX_ASSETS = 128;
const MAX_FILE = 8 * 1024 * 1024;
if (files.length > MAX_ASSETS) throw new Error(`${files.length} assets exceed the limit of ${MAX_ASSETS}`);

let total = 0;
const assets = files.map((p) => {
  const bytes = fs.readFileSync(path.join(dist, p));
  if (bytes.length > MAX_FILE) throw new Error(`${p} is ${bytes.length} bytes, above the 8 MiB limit`);
  total += bytes.length;
  return { path: p, sha256: sha256Hex(bytes) };
});

const ordered = {
  version: manifest.version,
  launchId: manifest.launchId,
  chainId: manifest.chainId,
  sourceCommit: manifest.sourceCommit,
  attestationHash: manifest.attestationHash,
  contracts: manifest.contracts,
  assets,
};
if (manifest.network) ordered.network = manifest.network;
if (manifest.walletAddChain) ordered.walletAddChain = manifest.walletAddChain;

fs.writeFileSync(manifestPath, JSON.stringify(ordered, null, 2) + '\n');
console.log(`wrote ${path.relative(process.cwd(), manifestPath)} with ${assets.length} assets, ${total} bytes of assets`);
for (const a of assets) console.log(`  ${a.sha256.slice(0, 12)}  ${a.path}`);
