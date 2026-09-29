// Shared game types mirrored from the Solidity enums and structs.
import type { Address, Hex } from 'viem';

export enum Kind {
  Expel = 0,
  Payout = 1,
  TreasuryTroops = 2,
  Attack = 3,
  Pact = 4,
}

export const KIND_LABEL: Record<Kind, string> = {
  [Kind.Expel]: 'Expel member',
  [Kind.Payout]: 'Treasury payout',
  [Kind.TreasuryTroops]: 'Buy troops from treasury',
  [Kind.Attack]: 'Attack',
  [Kind.Pact]: 'Pact',
};

export enum PactStatus {
  None = 0,
  Active = 1,
  Expired = 2,
  Broken = 3,
}

export const PACT_STATUS_LABEL: Record<PactStatus, string> = {
  [PactStatus.None]: 'None',
  [PactStatus.Active]: 'Active',
  [PactStatus.Expired]: 'Expired',
  [PactStatus.Broken]: 'Broken',
};

export enum BannerKind {
  Winner = 0,
  Peace = 1,
}

export interface Clock {
  genesis: bigint;
  epochLength: bigint;
  seasonLength: bigint;
  epochsPerSeason: bigint;
  currentEpoch: bigint;
  settledEpochs: bigint;
  currentSeason: bigint;
  troopPrice: bigint;
  feeBps: bigint;
  heldTiles: bigint;
  incomeCarry: bigint;
  currentIncomePool: bigint;
  progress: { started: boolean; tilesDone: bigint; tilesTotal: bigint };
  blockNumber: bigint;
  blockTimestamp: bigint;
}

export interface GuildInfo {
  id: number;
  name: string;
  foundedAt: number;
  memberCount: number;
  treasury: bigint;
  tiles: number;
  reserve: bigint;
  pendingIncome: bigint;
}

export interface TileState {
  holder: number;
  garrison: bigint;
}

export interface ProposalInfo {
  id: number;
  guildId: number;
  kind: Kind;
  proposer: Address;
  target: Address;
  amount: bigint;
  data1: bigint;
  data2: bigint;
  data3: bigint;
  createdEpoch: bigint;
  seqAtCreation: bigint;
  eligibleVoters: bigint;
  yesVotes: bigint;
  noVotes: bigint;
  executed: boolean;
  approved: boolean;
  expired: boolean;
}

export interface PactInfo {
  id: number;
  guildA: number;
  guildB: number;
  bondA: bigint;
  bondB: bigint;
  startEpoch: bigint;
  endEpoch: bigint;
  status: PactStatus;
}

export interface AttackInfo {
  epoch: bigint;
  tile: number;
  attacker: number;
  troops: bigint;
  proposalId: number;
  expectedHolder: number;
}

export interface SeasonResult {
  closed: boolean;
  pool: bigint;
  guildIds: [number, number, number];
  tiles: [bigint, bigint, bigint];
  guildPrize: [bigint, bigint, bigint];
  memberCount: [bigint, bigint, bigint];
  perMember: [bigint, bigint, bigint];
  rollover: bigint;
}

export interface SeasonInfo {
  season: number;
  pool: bigint;
  end: bigint;
  ended: boolean;
  lastEpochSettled: boolean;
  standings: { guildIds: [number, number, number]; tiles: [bigint, bigint, bigint]; recorded: boolean };
  result: SeasonResult;
}

export interface BetrayalInfo {
  pactId: number;
  betrayer: number;
  victim: number;
  slashed: bigint;
  epoch: bigint;
  txHash: Hex;
  blockNumber: bigint;
}

export interface BannerInfo {
  tokenId: bigint;
  to: Address;
  season: number;
  guildId: number;
  kind: BannerKind;
  rank: number;
  txHash: Hex;
}

export interface FeedItem {
  key: string;
  blockNumber: bigint;
  logIndex: number;
  txHash: Hex;
  contract: string;
  event: string;
  args: Record<string, unknown>;
}

export interface PlayerState {
  address: Address;
  ethBalance: bigint;
  tokenBalance: bigint;
  allowanceRealm: bigint;
  allowanceGuilds: bigint;
  allowancePermit2: bigint;
  permit2Router: { amount: bigint; expiration: number };
  guildId: number;
  memberSeq: bigint;
  votes: Record<number, boolean>;
  claimed: Record<string, boolean>;
}

export function epochStart(clock: Pick<Clock, 'genesis' | 'epochLength'>, epoch: bigint): bigint {
  return clock.genesis + epoch * clock.epochLength;
}

export function epochEnd(clock: Pick<Clock, 'genesis' | 'epochLength'>, epoch: bigint): bigint {
  return clock.genesis + (epoch + 1n) * clock.epochLength;
}

export function seasonOfEpoch(clock: Pick<Clock, 'epochsPerSeason'>, epoch: bigint): bigint {
  return clock.epochsPerSeason === 0n ? 0n : epoch / clock.epochsPerSeason;
}

export function proposalOpen(p: ProposalInfo): boolean {
  return !p.executed && !p.expired;
}

/** A guild's colour class index. Guild 0 means no holder. */
export function guildHue(guildId: number): number {
  return guildId <= 0 ? -1 : (guildId - 1) % 12;
}
