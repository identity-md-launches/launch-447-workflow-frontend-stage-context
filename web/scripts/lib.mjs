import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { keccak256, stringToBytes } from 'viem';

export function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Canonical JSON: object keys sorted, no whitespace. Matches the handoff's abiHash.
export function canonicalJson(v) {
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  if (v && typeof v === 'object') {
    return (
      '{' +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(v);
}

export function canonicalKeccak(abi) {
  return keccak256(stringToBytes(canonicalJson(abi))).slice(2);
}

export function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}
