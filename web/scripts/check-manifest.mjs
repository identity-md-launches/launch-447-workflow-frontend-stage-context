// Verifies dist/imd-deployment.json the way the publication check does:
//  - only the allowed top-level keys, version 1
//  - every listed asset exists with the recorded SHA-256, and every exported file is listed
//  - each contract's abiPath is a raw ABI array whose canonical keccak equals abiHash
//  - when the handoff / network files are present: identifiers, contract set and network block match
//  - no address or URL outside the handoff and the network block
//
//   node scripts/check-manifest.mjs [--dist ../dist] [--handoff ...] [--network ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalKeccak, readJson, sha256Hex, walk } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const dist = path.resolve(opt('--dist', path.join(repoRoot, 'dist')));
const handoffPath = opt('--handoff', path.join(repoRoot, '.imd/reads/deployment.json'));
const networkPath = opt('--network', path.join(repoRoot, '.imd/reads/network.json'));

const failures = [];
const fail = (m) => failures.push(m);

const manifestPath = path.join(dist, 'imd-deployment.json');
const manifest = readJson(manifestPath);

const ALLOWED = new Set([
  'version',
  'launchId',
  'chainId',
  'sourceCommit',
  'attestationHash',
  'contracts',
  'assets',
  'network',
  'walletAddChain',
]);
for (const k of Object.keys(manifest)) if (!ALLOWED.has(k)) fail(`unexpected top-level key ${k}`);
if (manifest.version !== 1) fail('version must be 1');
const HEX64 = /^[0-9a-f]{64}$/;
if (!HEX64.test(manifest.attestationHash ?? '')) fail('attestationHash must be 64 lowercase hex characters');
if (!/^[0-9a-f]{40}$/.test(manifest.sourceCommit ?? '')) fail('sourceCommit must be a 40-hex commit');
if (typeof manifest.chainId !== 'number') fail('chainId must be a number');

// Assets
const listed = new Map();
for (const a of manifest.assets ?? []) {
  if (typeof a.path !== 'string' || a.path.startsWith('/') || a.path.includes('..') || /^[a-z]+:/i.test(a.path)) {
    fail(`asset path not relative: ${a.path}`);
    continue;
  }
  if (!HEX64.test(a.sha256 ?? '')) fail(`asset ${a.path} sha256 malformed`);
  const full = path.join(dist, a.path);
  if (!fs.existsSync(full)) {
    fail(`asset missing: ${a.path}`);
    continue;
  }
  const bytes = fs.readFileSync(full);
  const h = sha256Hex(bytes);
  if (h !== a.sha256) fail(`asset hash mismatch: ${a.path}`);
  if (bytes.length > 8 * 1024 * 1024) fail(`asset over 8 MiB: ${a.path}`);
  listed.set(a.path, bytes.length);
}
if ((manifest.assets ?? []).length > 128) fail('more than 128 assets');
for (const p of walk(dist)) {
  if (p === 'imd-deployment.json') continue;
  if (!listed.has(p)) fail(`exported file not listed: ${p}`);
}
if (!listed.has('index.html')) fail('index.html not listed');
const totalBytes = [...listed.values()].reduce((a, b) => a + b, 0);

// Contracts
const knownAddresses = new Set();
for (const c of manifest.contracts ?? []) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(c.address ?? '')) fail(`contract ${c.name} address malformed`);
  knownAddresses.add(String(c.address).toLowerCase());
  if (typeof c.abiPath !== 'string' || c.abiPath.includes('..') || /^[a-z]+:/i.test(c.abiPath) || c.abiPath.startsWith('/')) {
    fail(`contract ${c.name} abiPath not relative`);
    continue;
  }
  const full = path.join(dist, c.abiPath);
  if (!fs.existsSync(full)) {
    fail(`contract ${c.name} ABI missing at ${c.abiPath}`);
    continue;
  }
  const abi = JSON.parse(fs.readFileSync(full, 'utf8'));
  if (!Array.isArray(abi)) fail(`contract ${c.name} ABI is not a raw array`);
  else if (canonicalKeccak(abi) !== c.abiHash) fail(`contract ${c.name} abiHash does not match ${c.abiPath}`);
  if (!listed.has(c.abiPath)) fail(`contract ${c.name} ABI not in assets`);
}

// Network block
if (manifest.network) {
  for (const v of Object.values(manifest.network.uniswapV4 ?? {})) knownAddresses.add(String(v).toLowerCase());
}

// Handoff comparison (when the pinned inputs are present)
if (fs.existsSync(handoffPath)) {
  const handoff = readJson(handoffPath);
  for (const k of ['launchId', 'chainId', 'sourceCommit', 'attestationHash']) {
    if (manifest[k] !== handoff[k]) fail(`${k} differs from handoff`);
  }
  const want = new Map(handoff.contracts.map((c) => [c.name, c]));
  const have = new Map((manifest.contracts ?? []).map((c) => [c.name, c]));
  if (want.size !== have.size) fail(`contract count ${have.size} differs from handoff ${want.size}`);
  for (const [name, c] of want) {
    const m = have.get(name);
    if (!m) fail(`handoff contract ${name} missing from manifest`);
    else {
      if (m.address !== c.address) fail(`${name} address differs from handoff`);
      if (m.abiHash !== c.abiHash) fail(`${name} abiHash differs from handoff`);
    }
  }
} else {
  console.log('note: handoff not present, skipped handoff comparison');
}
if (fs.existsSync(networkPath)) {
  const net = readJson(networkPath);
  if (JSON.stringify(manifest.network) !== JSON.stringify(net.network)) fail('network block differs from network.json');
  if (net.walletAddChain && manifest.walletAddChain && JSON.stringify(manifest.walletAddChain) !== JSON.stringify(net.walletAddChain)) {
    fail('walletAddChain differs from network.json');
  }
} else {
  console.log('note: network.json not present, skipped network comparison');
}

// Stray addresses or URLs outside contracts and network block
const text = JSON.stringify({ ...manifest, network: undefined, walletAddChain: undefined, contracts: undefined });
for (const m of text.matchAll(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g)) {
  if (!knownAddresses.has(m[0].toLowerCase())) fail(`address outside handoff/network: ${m[0]}`);
}
for (const m of text.matchAll(/https?:\/\/[^"\s]+/g)) fail(`URL outside network block: ${m[0]}`);

console.log(`assets: ${listed.size}, ${totalBytes} bytes; contracts: ${(manifest.contracts ?? []).length}`);
if (failures.length) {
  for (const f of failures) console.error('FAIL', f);
  process.exit(1);
}
console.log('manifest OK');
