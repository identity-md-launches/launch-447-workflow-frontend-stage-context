// Game state: every read the pages show, refreshed on a fixed cadence from the public RPCs and
// rebuilt from event logs where the contracts expose no enumerator (members, betrayals, banners).
import type { Address, Log, PublicClient } from 'viem';
import { zeroAddress } from 'viem';
import type { AppConfig, ContractName } from '../config/deployment';
import { START_BLOCK } from '../config/launch';
import { PERMIT2_ABI } from '../lib/swap';
import { decodeFeed, fetchLogsChunked } from '../lib/logs';
import {
  Kind,
  type AttackInfo,
  type BannerInfo,
  type BetrayalInfo,
  type Clock,
  type FeedItem,
  type GuildInfo,
  type PactInfo,
  type PlayerState,
  type ProposalInfo,
  type SeasonInfo,
  type SeasonResult,
  type TileState,
} from '../lib/game';
import { TILE_COUNT } from '../lib/format';

export interface ChildAddresses {
  Diplomacy: Address;
  Season: Address;
  Banners: Address;
}

export interface GameSnapshot {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  updatedAt: number;
  children: ChildAddresses | null;
  clock: Clock | null;
  tiles: TileState[];
  guilds: GuildInfo[];
  members: Record<number, Address[]>;
  proposals: ProposalInfo[];
  pacts: PactInfo[];
  attacks: AttackInfo[];
  seasons: SeasonInfo[];
  betrayals: BetrayalInfo[];
  banners: BannerInfo[];
  feed: FeedItem[];
  logsSynced: bigint | null;
  logsError: string | null;
  player: PlayerState | null;
  playerError: string | null;
}

const EMPTY: GameSnapshot = {
  status: 'loading',
  error: null,
  updatedAt: 0,
  children: null,
  clock: null,
  tiles: [],
  guilds: [],
  members: {},
  proposals: [],
  pacts: [],
  attacks: [],
  seasons: [],
  betrayals: [],
  banners: [],
  feed: [],
  logsSynced: null,
  logsError: null,
  player: null,
  playerError: null,
};

const MAX_PROPOSALS = 300;
const MAX_SEASONS = 12;

type Listener = () => void;

export class GameStore {
  private snap: GameSnapshot = EMPTY;
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshing: Promise<void> | null = null;
  private staticClock: Pick<Clock, 'genesis' | 'epochLength' | 'seasonLength' | 'epochsPerSeason' | 'troopPrice' | 'feeBps'> | null = null;
  private rawLogs: Log[] = [];
  private playerAddress: Address | null = null;
  private logStart: bigint | null = null;

  constructor(
    readonly config: AppConfig,
    readonly client: PublicClient,
    private readonly intervalMs = 12_000,
  ) {}

  getSnapshot = (): GameSnapshot => this.snap;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(patch: Partial<GameSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }

  start(): void {
    void this.refresh();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setPlayer(address: Address | null): void {
    if (address === this.playerAddress) return;
    this.playerAddress = address;
    if (!address) this.set({ player: null, playerError: null });
    else void this.refreshPlayer();
  }

  addressOf(name: ContractName): Address | null {
    if (name === 'LaunchToken' || name === 'Guilds' || name === 'Realm') return this.config.addresses[name];
    return this.snap.children?.[name] ?? null;
  }

  private async read<T>(name: ContractName, functionName: string, args: unknown[] = []): Promise<T> {
    const address = this.addressOf(name);
    if (!address) throw new Error(`${name} address not discovered yet`);
    return (await this.client.readContract({ address, abi: this.config.abis[name], functionName, args })) as T;
  }

  /** Refreshes everything; overlapping calls share one in-flight refresh. */
  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    try {
      if (!this.snap.children) await this.discoverChildren();
      if (!this.staticClock) await this.loadStatic();
      const clock = await this.loadClock();
      const [tiles, guilds, proposals, pacts, attacks, seasons] = await Promise.all([
        this.loadMap(),
        this.loadGuilds(),
        this.loadProposals(clock),
        this.loadPacts(),
        this.loadAttacks(clock),
        this.loadSeasons(clock),
      ]);
      this.set({ status: 'ready', error: null, updatedAt: Date.now(), clock, tiles, guilds, proposals, pacts, attacks, seasons });
      await Promise.all([this.syncLogs(clock.blockNumber), this.refreshPlayer()]);
    } catch (e) {
      const message = e instanceof Error ? e.message.split('\n')[0] ?? 'Unable to read chain state.' : 'Unable to read chain state.';
      this.set({ status: this.snap.clock ? 'ready' : 'error', error: message });
    }
  }

  private async discoverChildren() {
    const [diplomacy, season] = await Promise.all([this.read<Address>('Realm', 'diplomacy'), this.read<Address>('Realm', 'season')]);
    const partial = { Diplomacy: diplomacy, Season: season, Banners: zeroAddress } as ChildAddresses;
    this.set({ children: partial });
    const banners = await this.read<Address>('Season', 'banners');
    this.set({ children: { ...partial, Banners: banners } });
  }

  private async loadStatic() {
    const [genesis, epochLength, seasonLength, epochsPerSeason, troopPrice, feeBps] = await Promise.all([
      this.read<bigint>('Realm', 'genesis'),
      this.read<bigint>('Realm', 'epochLength'),
      this.read<bigint>('Realm', 'seasonLength'),
      this.read<bigint>('Realm', 'epochsPerSeason'),
      this.read<bigint>('Realm', 'troopPrice'),
      this.read<bigint>('Realm', 'feeBps'),
    ]);
    this.staticClock = { genesis, epochLength, seasonLength, epochsPerSeason, troopPrice, feeBps };
  }

  private async loadClock(): Promise<Clock> {
    const s = this.staticClock!;
    const [block, currentEpoch, settledEpochs, currentSeason, heldTiles, incomeCarry, progress] = await Promise.all([
      this.client.getBlock({ blockTag: 'latest' }),
      this.read<bigint>('Realm', 'currentEpoch'),
      this.read<bigint>('Realm', 'settledEpochs'),
      this.read<bigint>('Realm', 'currentSeason'),
      this.read<bigint>('Realm', 'heldTiles'),
      this.read<bigint>('Realm', 'incomeCarry'),
      this.read<[boolean, bigint, bigint]>('Realm', 'settlementProgress'),
    ]);
    const currentIncomePool = await this.read<bigint>('Realm', 'incomePool', [currentEpoch]);
    return {
      ...s,
      currentEpoch,
      settledEpochs,
      currentSeason,
      heldTiles,
      incomeCarry,
      currentIncomePool,
      progress: { started: progress[0], tilesDone: progress[1], tilesTotal: progress[2] },
      blockNumber: block.number ?? 0n,
      blockTimestamp: block.timestamp,
    };
  }

  private async loadMap(): Promise<TileState[]> {
    const [holders, garrisons] = await this.read<[readonly bigint[], readonly bigint[]]>('Realm', 'map');
    const tiles: TileState[] = [];
    for (let i = 0; i < TILE_COUNT; i++) tiles.push({ holder: Number(holders[i] ?? 0n), garrison: garrisons[i] ?? 0n });
    return tiles;
  }

  private async loadGuilds(): Promise<GuildInfo[]> {
    const count = Number(await this.read<bigint>('Guilds', 'guildCount'));
    const ids = Array.from({ length: count }, (_, i) => i + 1);
    return Promise.all(
      ids.map(async (id) => {
        const [info, tiles, reserve, pendingIncome] = await Promise.all([
          this.read<[string, bigint, bigint, bigint]>('Guilds', 'getGuild', [BigInt(id)]),
          this.read<bigint>('Realm', 'tilesHeldBy', [BigInt(id)]),
          this.read<bigint>('Realm', 'reserveOf', [BigInt(id)]),
          this.read<bigint>('Realm', 'pendingIncome', [BigInt(id)]),
        ]);
        return {
          id,
          name: info[0],
          foundedAt: Number(info[1]),
          memberCount: Number(info[2]),
          treasury: info[3],
          tiles: Number(tiles),
          reserve,
          pendingIncome,
        };
      }),
    );
  }

  private async loadProposals(clock: Clock): Promise<ProposalInfo[]> {
    const count = Number(await this.read<bigint>('Guilds', 'proposalCount'));
    const first = Math.max(1, count - MAX_PROPOSALS + 1);
    const ids = Array.from({ length: count - first + 1 }, (_, i) => first + i);
    const rows = await Promise.all(
      ids.map(async (id) => {
        const p = await this.read<{
          guildId: bigint;
          kind: number;
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
        }>('Guilds', 'getProposal', [BigInt(id)]);
        const approved = p.yesVotes * 2n > p.eligibleVoters;
        const expired = !p.executed && clock.currentEpoch > p.createdEpoch + 1n;
        return {
          id,
          guildId: Number(p.guildId),
          kind: p.kind as Kind,
          proposer: p.proposer,
          target: p.target,
          amount: p.amount,
          data1: p.data1,
          data2: p.data2,
          data3: p.data3,
          createdEpoch: p.createdEpoch,
          seqAtCreation: p.seqAtCreation,
          eligibleVoters: p.eligibleVoters,
          yesVotes: p.yesVotes,
          noVotes: p.noVotes,
          executed: p.executed,
          approved,
          expired,
        } satisfies ProposalInfo;
      }),
    );
    return rows.sort((a, b) => b.id - a.id);
  }

  private async loadPacts(): Promise<PactInfo[]> {
    const count = Number(await this.read<bigint>('Diplomacy', 'pactCount'));
    const ids = Array.from({ length: count }, (_, i) => i + 1);
    const rows = await Promise.all(
      ids.map(async (id) => {
        const p = await this.read<{
          guildA: bigint;
          guildB: bigint;
          bondA: bigint;
          bondB: bigint;
          startEpoch: bigint;
          endEpoch: bigint;
          status: number;
        }>('Diplomacy', 'getPact', [BigInt(id)]);
        return {
          id,
          guildA: Number(p.guildA),
          guildB: Number(p.guildB),
          bondA: p.bondA,
          bondB: p.bondB,
          startEpoch: p.startEpoch,
          endEpoch: p.endEpoch,
          status: p.status,
        } satisfies PactInfo;
      }),
    );
    return rows.sort((a, b) => b.id - a.id);
  }

  private async loadAttacks(clock: Clock): Promise<AttackInfo[]> {
    const epochs: bigint[] = [];
    for (let e = clock.settledEpochs; e <= clock.currentEpoch && epochs.length < 24; e++) epochs.push(e);
    const perEpoch = await Promise.all(
      epochs.map(async (epoch) => {
        const tiles = await this.read<readonly bigint[]>('Realm', 'attackedTilesIn', [epoch]);
        const lists = await Promise.all(
          tiles.map((tile) =>
            this.read<readonly { attacker: bigint; troops: bigint; proposalId: bigint; expectedHolder: bigint }[]>('Realm', 'attacksOn', [epoch, tile]).then((rows) =>
              rows.map((r) => ({
                epoch,
                tile: Number(tile),
                attacker: Number(r.attacker),
                troops: r.troops,
                proposalId: Number(r.proposalId),
                expectedHolder: Number(r.expectedHolder),
              })),
            ),
          ),
        );
        return lists.flat();
      }),
    );
    return perEpoch.flat();
  }

  private async loadSeasons(clock: Clock): Promise<SeasonInfo[]> {
    const current = Number(clock.currentSeason);
    const first = Math.max(0, current - MAX_SEASONS + 1);
    const seasons = Array.from({ length: current - first + 1 }, (_, i) => first + i);
    const rows = await Promise.all(
      seasons.map(async (season) => {
        const s = BigInt(season);
        const [pool, result, standings, end] = await Promise.all([
          this.read<bigint>('Season', 'prizePool', [s]),
          this.read<{
            closed: boolean;
            pool: bigint;
            guildIds: readonly bigint[];
            tiles: readonly bigint[];
            guildPrize: readonly bigint[];
            memberCount: readonly bigint[];
            perMember: readonly bigint[];
            rollover: bigint;
          }>('Season', 'getResult', [s]),
          this.read<[readonly bigint[], readonly bigint[], boolean]>('Realm', 'standingsOf', [s]),
          this.read<bigint>('Realm', 'seasonEnd', [s]),
        ]);
        const three = <T,>(xs: readonly T[]): [T, T, T] => [xs[0]!, xs[1]!, xs[2]!];
        const lastEpoch = (s + 1n) * clock.epochsPerSeason - 1n;
        const res: SeasonResult = {
          closed: result.closed,
          pool: result.pool,
          guildIds: three(result.guildIds.map(Number)),
          tiles: three(result.tiles),
          guildPrize: three(result.guildPrize),
          memberCount: three(result.memberCount),
          perMember: three(result.perMember),
          rollover: result.rollover,
        };
        return {
          season,
          pool,
          end,
          ended: clock.blockTimestamp >= end,
          lastEpochSettled: clock.settledEpochs > lastEpoch,
          standings: { guildIds: three(standings[0].map(Number)), tiles: three(standings[1]), recorded: standings[2] },
          result: res,
        } satisfies SeasonInfo;
      }),
    );
    return rows.sort((a, b) => b.season - a.season);
  }

  private async findLogStart(): Promise<bigint> {
    if (this.logStart !== null) return this.logStart;
    const guilds = this.config.addresses.Guilds;
    const hint = START_BLOCK;
    const hasCode = async (block: bigint) => {
      const code = await this.client.getCode({ address: guilds, blockNumber: block });
      return !!code && code !== '0x';
    };
    try {
      if (hint > 0n && (await hasCode(hint)) && !(await hasCode(hint - 1n))) {
        this.logStart = hint;
        return hint;
      }
    } catch {
      // Archive data for the hint may be unavailable; fall through to the search.
    }
    // Binary search for the first block with code (needs archive reads; public RPCs usually allow getCode).
    let lo = 0n;
    let hi = await this.client.getBlockNumber();
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      if (await hasCode(mid)) hi = mid;
      else lo = mid + 1n;
    }
    this.logStart = lo;
    return lo;
  }

  private async syncLogs(head: bigint): Promise<void> {
    try {
      const children = this.snap.children;
      if (!children || children.Banners === zeroAddress) return;
      const from = this.snap.logsSynced === null ? await this.findLogStart() : this.snap.logsSynced + 1n;
      if (from > head) return;
      const addresses: Address[] = [
        this.config.addresses.Guilds,
        this.config.addresses.Realm,
        children.Diplomacy,
        children.Season,
        children.Banners,
      ];
      const logs = await fetchLogsChunked(this.client, addresses, from, head);
      this.rawLogs.push(...logs);
      const names = new Map<string, string>([
        [this.config.addresses.Guilds.toLowerCase(), 'Guilds'],
        [this.config.addresses.Realm.toLowerCase(), 'Realm'],
        [children.Diplomacy.toLowerCase(), 'Diplomacy'],
        [children.Season.toLowerCase(), 'Season'],
        [children.Banners.toLowerCase(), 'Banners'],
      ]);
      const feed = decodeFeed(this.rawLogs, this.config.abis, names);
      this.set({ feed, logsSynced: head, logsError: null, ...deriveFromFeed(feed) });
    } catch (e) {
      const message = e instanceof Error ? e.message.split('\n')[0] ?? 'Unable to load events.' : 'Unable to load events.';
      this.set({ logsError: message });
    }
  }

  async refreshPlayer(): Promise<void> {
    const address = this.playerAddress;
    if (!address || !this.snap.children) return;
    try {
      const { Realm, Guilds, LaunchToken } = this.config.addresses;
      const uni = this.config.uniswap;
      const [ethBalance, tokenBalance, allowanceRealm, allowanceGuilds, guildIdRaw] = await Promise.all([
        this.client.getBalance({ address }),
        this.read<bigint>('LaunchToken', 'balanceOf', [address]),
        this.read<bigint>('LaunchToken', 'allowance', [address, Realm]),
        this.read<bigint>('LaunchToken', 'allowance', [address, Guilds]),
        this.read<bigint>('Guilds', 'guildOf', [address]),
      ]);
      const guildId = Number(guildIdRaw);
      let allowancePermit2 = 0n;
      let permit2Router = { amount: 0n, expiration: 0 };
      if (uni) {
        const [a, p] = await Promise.all([
          this.read<bigint>('LaunchToken', 'allowance', [address, uni.permit2]),
          this.client.readContract({
            address: uni.permit2,
            abi: PERMIT2_ABI,
            functionName: 'allowance',
            args: [address, LaunchToken, uni.universalRouter],
          }),
        ]);
        allowancePermit2 = a;
        permit2Router = { amount: p[0], expiration: Number(p[1]) };
      }
      const memberSeq = guildId > 0 ? await this.read<bigint>('Guilds', 'memberSeq', [BigInt(guildId), address]) : 0n;
      const open = this.snap.proposals.filter((p) => p.guildId === guildId && !p.executed && !p.expired);
      const voteFlags = await Promise.all(open.map((p) => this.read<boolean>('Guilds', 'hasVoted', [BigInt(p.id), address])));
      const votes: Record<number, boolean> = {};
      open.forEach((p, i) => {
        votes[p.id] = voteFlags[i] ?? false;
      });
      const claimable = this.snap.seasons.filter((s) => s.result.closed);
      const claimFlags = await Promise.all(
        claimable.flatMap((s) =>
          s.result.guildIds
            .filter((g) => g > 0)
            .map((g) => this.read<boolean>('Season', 'claimed', [BigInt(s.season), BigInt(g), address]).then((v) => [`${s.season}:${g}`, v] as const)),
        ),
      );
      const claimed: Record<string, boolean> = {};
      for (const [k, v] of claimFlags) claimed[k] = v;
      this.set({
        player: { address, ethBalance, tokenBalance, allowanceRealm, allowanceGuilds, allowancePermit2, permit2Router, guildId, memberSeq, votes, claimed },
        playerError: null,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message.split('\n')[0] ?? 'Unable to read wallet state.' : 'Unable to read wallet state.';
      this.set({ playerError: message });
    }
  }
}

/** Membership, betrayals and banners are derived from the complete decoded feed. */
export function deriveFromFeed(feed: FeedItem[]): Pick<GameSnapshot, 'members' | 'betrayals' | 'banners'> {
  const members: Record<number, Set<Address>> = {};
  const betrayals: BetrayalInfo[] = [];
  const banners: BannerInfo[] = [];
  for (const item of feed) {
    const a = item.args;
    if (item.contract === 'Guilds') {
      const guildId = Number(a.guildId ?? 0);
      const member = a.member as Address | undefined;
      if (item.event === 'MemberJoined' && member) (members[guildId] ??= new Set()).add(member);
      if ((item.event === 'MemberLeft' || item.event === 'MemberExpelled') && member) members[guildId]?.delete(member);
    } else if (item.contract === 'Diplomacy' && item.event === 'PactBroken') {
      betrayals.push({
        pactId: Number(a.pactId),
        betrayer: Number(a.betrayer),
        victim: Number(a.victim),
        slashed: a.slashed as bigint,
        epoch: a.epoch as bigint,
        txHash: item.txHash,
        blockNumber: item.blockNumber,
      });
    } else if (item.contract === 'Banners' && item.event === 'BannerMinted') {
      banners.push({
        tokenId: a.tokenId as bigint,
        to: a.to as Address,
        season: Number(a.season),
        guildId: Number(a.guildId),
        kind: Number(a.kind),
        rank: Number(a.rank),
        txHash: item.txHash,
      });
    }
  }
  const membersOut: Record<number, Address[]> = {};
  for (const [id, set] of Object.entries(members)) membersOut[Number(id)] = [...set];
  return { members: membersOut, betrayals: betrayals.reverse(), banners: banners.reverse() };
}
