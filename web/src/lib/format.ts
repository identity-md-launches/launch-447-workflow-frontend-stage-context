import { formatUnits, parseUnits } from 'viem';

export const TOKEN_DECIMALS = 18;

/** Formats a token amount in display units with digit grouping and a capped fraction. */
export function formatAmount(value: bigint, decimals = TOKEN_DECIMALS, maxFraction = 4): string {
  const negative = value < 0n;
  const raw = formatUnits(negative ? -value : value, decimals);
  const [whole = '0', fraction = ''] = raw.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const frac = fraction.slice(0, maxFraction).replace(/0+$/, '');
  const text = frac ? `${grouped}.${frac}` : grouped;
  if (text === '0' && value !== 0n) {
    const floor = maxFraction > 0 ? `0.${'0'.repeat(maxFraction - 1)}1` : '1';
    return negative ? `-<${floor}` : `<${floor}`;
  }
  return negative ? `-${text}` : text;
}

export function parseAmount(text: string, decimals = TOKEN_DECIMALS): bigint | null {
  const cleaned = text.trim().replace(/[\s,]/g, '');
  if (!/^\d*(\.\d*)?$/.test(cleaned) || cleaned === '' || cleaned === '.') return null;
  try {
    return parseUnits(cleaned as `${number}`, decimals);
  } catch {
    return null;
  }
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(sec).padStart(2, '0')}s`;
}

export function formatTimestamp(unixSeconds: number | bigint): string {
  const n = Number(unixSeconds);
  if (!Number.isFinite(n) || n === 0) return '—';
  return new Date(n * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export const MAP_SIZE = 12;
export const TILE_COUNT = MAP_SIZE * MAP_SIZE;
const COLUMNS = 'ABCDEFGHIJKL';

/** Tile ids are 0 to 143, row-major: column letter A to L, row number 1 to 12. */
export function tileLabel(tileId: number): string {
  const col = COLUMNS[tileId % MAP_SIZE] ?? '?';
  const row = Math.floor(tileId / MAP_SIZE) + 1;
  return `${col}${row}`;
}

export function parseTileLabel(text: string): number | null {
  const m = /^\s*([A-La-l])\s*(\d{1,2})\s*$/.exec(text);
  if (m) {
    const col = COLUMNS.indexOf(m[1]!.toUpperCase());
    const row = Number(m[2]);
    if (col < 0 || row < 1 || row > MAP_SIZE) return null;
    return (row - 1) * MAP_SIZE + col;
  }
  if (/^\s*\d{1,3}\s*$/.test(text)) {
    const id = Number(text);
    return id >= 0 && id < TILE_COUNT ? id : null;
  }
  return null;
}

export function formatBps(bps: bigint | number): string {
  const n = Number(bps) / 100;
  return `${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}%`;
}

export function pluralize(n: number | bigint, singular: string, plural = `${singular}s`): string {
  const v = typeof n === 'bigint' ? n : BigInt(Math.trunc(n));
  return `${v.toLocaleString()} ${v === 1n ? singular : plural}`;
}
