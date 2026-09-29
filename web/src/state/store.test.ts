import { describe, expect, it } from 'vitest';
import { deriveFromFeed } from './store';
import type { FeedItem } from '../lib/game';

const item = (contract: string, event: string, args: Record<string, unknown>, i: number): FeedItem => ({
  key: `k${i}`,
  blockNumber: BigInt(i),
  logIndex: i,
  txHash: `0x${i.toString(16).padStart(64, '0')}`,
  contract,
  event,
  args,
});

describe('deriveFromFeed', () => {
  it('rebuilds membership from join, leave and expel events', () => {
    const feed = [
      item('Guilds', 'MemberJoined', { guildId: 1n, member: '0x1111111111111111111111111111111111111111' }, 1),
      item('Guilds', 'MemberJoined', { guildId: 1n, member: '0x2222222222222222222222222222222222222222' }, 2),
      item('Guilds', 'MemberLeft', { guildId: 1n, member: '0x1111111111111111111111111111111111111111' }, 3),
      item('Guilds', 'MemberJoined', { guildId: 2n, member: '0x1111111111111111111111111111111111111111' }, 4),
      item('Guilds', 'MemberExpelled', { guildId: 2n, member: '0x1111111111111111111111111111111111111111', proposalId: 9n }, 5),
    ];
    const d = deriveFromFeed(feed);
    expect(d.members[1]).toEqual(['0x2222222222222222222222222222222222222222']);
    expect(d.members[2]).toEqual([]);
  });

  it('collects betrayals and banners newest first', () => {
    const feed = [
      item('Diplomacy', 'PactBroken', { pactId: 1n, betrayer: 2n, victim: 1n, slashed: 5n, epoch: 7n }, 1),
      item('Banners', 'BannerMinted', { tokenId: 1n, to: '0x1111111111111111111111111111111111111111', season: 0n, guildId: 1n, kind: 0, rank: 1 }, 2),
      item('Banners', 'BannerMinted', { tokenId: 2n, to: '0x1111111111111111111111111111111111111111', season: 0n, guildId: 3n, kind: 1, rank: 0 }, 3),
    ];
    const d = deriveFromFeed(feed);
    expect(d.betrayals.length).toBe(1);
    expect(d.betrayals[0]!.betrayer).toBe(2);
    expect(d.banners.map((b) => b.tokenId)).toEqual([2n, 1n]);
  });
});
