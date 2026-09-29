import { describe, expect, it } from 'vitest';
import { parseEther } from 'viem';
import { formatAmount, formatDuration, parseAmount, parseTileLabel, tileLabel } from './format';

describe('format', () => {
  it('formats token amounts with grouping and a capped fraction', () => {
    expect(formatAmount(parseEther('1234567.891234'))).toBe('1 234 567.8912');
    expect(formatAmount(0n)).toBe('0');
    expect(formatAmount(1n)).toBe('<0.0001');
    expect(formatAmount(parseEther('2'))).toBe('2');
  });

  it('parses decimal input and rejects garbage', () => {
    expect(parseAmount('1.5')).toBe(parseEther('1.5'));
    expect(parseAmount(' 1,000 ')).toBe(parseEther('1000'));
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('1e5')).toBeNull();
  });

  it('labels tiles row-major from A1 to L12 and parses them back', () => {
    expect(tileLabel(0)).toBe('A1');
    expect(tileLabel(11)).toBe('L1');
    expect(tileLabel(12)).toBe('A2');
    expect(tileLabel(143)).toBe('L12');
    for (let i = 0; i < 144; i++) expect(parseTileLabel(tileLabel(i))).toBe(i);
    expect(parseTileLabel('c7')).toBe(6 * 12 + 2);
    expect(parseTileLabel('M1')).toBeNull();
    expect(parseTileLabel('A13')).toBeNull();
    expect(parseTileLabel('77')).toBe(77);
    expect(parseTileLabel('144')).toBeNull();
  });

  it('formats durations coarsely', () => {
    expect(formatDuration(59)).toBe('0m 59s');
    expect(formatDuration(3600 * 5 + 120)).toBe('5h 02m');
    expect(formatDuration(86400 * 2 + 3600)).toBe('2d 1h');
    expect(formatDuration(-5)).toBe('0m 00s');
  });
});
