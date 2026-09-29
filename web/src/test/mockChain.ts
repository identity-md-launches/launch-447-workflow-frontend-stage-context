// A deterministic fake of the deployed game for tests and browser fixtures. It answers JSON-RPC
// requests the way the public RPC would, using the real ABIs, and exposes an EIP-1193 wallet
// whose chain can be wrong, unknown or correct.
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  getAddress,
  keccak256,
  numberToHex,
  parseEther,
  toHex,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import guildsAbi from '../../public/abi/Guilds.json';
import realmAbi from '../../public/abi/Realm.json';
import tokenAbi from '../../public/abi/LaunchToken.json';
import diplomacyAbi from '../../public/abi/Diplomacy.json';
import seasonAbi from '../../public/abi/Season.json';
import bannersAbi from '../../public/abi/Banners.json';
import manifest from '../../public/imd-deployment.json';
import type { ImdDeployment } from '../config/deployment';
import { PERMIT2_ABI, QUOTER_ABI, STATE_VIEW_ABI, UNIVERSAL_ROUTER_ABI } from '../lib/swap';

export const MANIFEST = manifest as unknown as ImdDeployment;
export const ABIS: Record<string, Abi> = {
  Guilds: guildsAbi as Abi,
  Realm: realmAbi as Abi,
  LaunchToken: tokenAbi as Abi,
  Diplomacy: diplomacyAbi as Abi,
  Season: seasonAbi as Abi,
  Banners: bannersAbi as Abi,
};

const addr = (name: string) => MANIFEST.contracts.find((c) => c.name === name)!.address;
export const ADDR = {
  LaunchToken: addr('LaunchToken'),
  Guilds: addr('Guilds'),
  Realm: addr('Realm'),
  Diplomacy: '0xfEdf6c2E56Ef9E4A9f0A9fe307f6ef2A2A5D4957' as Address,
  Season: '0x27066eD41E7D69f48Ac569A7Efea8Bf428233e9C' as Address,
  Banners: '0xd4E13DfA86A7AdF0ffB25cbFe057eFa9d5e0C603' as Address,
};
export const PLAYER: Address = '0x1111111111111111111111111111111111111111';
export const OTHER: Address = '0x2222222222222222222222222222222222222222';
export const CHAIN_ID = MANIFEST.chainId;
export const START_BLOCK = 11805514n;

export interface MockGuild {
  id: number;
  name: string;
  foundedAt: number;
  members: Address[];
  treasury: bigint;
  tiles: number[];
  reserve: bigint;
  pendingIncome: bigint;
  joinSeq: bigint;
}

export interface MockProposal {
  id: number;
  guildId: number;
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
  voters: Address[];
}

export interface MockPact {
  id: number;
  guildA: number;
  guildB: number;
  bondA: bigint;
  bondB: bigint;
  startEpoch: bigint;
  endEpoch: bigint;
  status: number;
}

export interface MockState {
  blockNumber: bigint;
  timestamp: bigint;
  genesis: bigint;
  epochLength: bigint;
  seasonLength: bigint;
  settledEpochs: bigint;
  troopPrice: bigint;
  feeBps: bigint;
  guilds: MockGuild[];
  proposals: MockProposal[];
  pacts: MockPact[];
  garrisons: Record<number, bigint>;
  balances: Record<string, bigint>;
  ethBalances: Record<string, bigint>;
  allowances: Record<string, bigint>; // `${owner}:${spender}`
  permit2: Record<string, { amount: bigint; expiration: bigint }>;
  prizePool: bigint;
  sentTransactions: { to: Address; data: Hex; value: bigint; from: Address }[];
  logs: { address: Address; topics: Hex[]; data: Hex; blockNumber: bigint; logIndex: number }[];
}

export function baseState(): MockState {
  const genesis = 1_790_658_564n;
  const timestamp = genesis + 3600n * 5n + 1200n; // epoch 5, 20 minutes in
  const guilds: MockGuild[] = [
    { id: 1, name: 'Ember Compact', foundedAt: Number(genesis) + 100, members: [PLAYER, OTHER], treasury: parseEther('12.5'), tiles: [0, 1, 12, 13], reserve: 7n, pendingIncome: parseEther('0.4'), joinSeq: 2n },
    { id: 2, name: 'Salt Marchers', foundedAt: Number(genesis) + 900, members: ['0x3333333333333333333333333333333333333333'], treasury: parseEther('3'), tiles: [77, 78], reserve: 3n, pendingIncome: 0n, joinSeq: 1n },
    { id: 3, name: 'Quiet Banner', foundedAt: Number(genesis) + 1800, members: ['0x4444444444444444444444444444444444444444'], treasury: 0n, tiles: [], reserve: 0n, pendingIncome: 0n, joinSeq: 1n },
  ];
  const proposals: MockProposal[] = [
    {
      id: 1,
      guildId: 1,
      kind: 3,
      proposer: OTHER,
      target: ADDR.Realm,
      amount: 0n,
      data1: 77n,
      data2: 2n,
      data3: 3n,
      createdEpoch: 5n,
      seqAtCreation: 2n,
      eligibleVoters: 2n,
      yesVotes: 1n,
      noVotes: 0n,
      executed: false,
      voters: [OTHER],
    },
    {
      id: 2,
      guildId: 2,
      kind: 4,
      proposer: '0x3333333333333333333333333333333333333333',
      target: ADDR.Diplomacy,
      amount: parseEther('1'),
      data1: 1n,
      data2: 24n,
      data3: parseEther('1'),
      createdEpoch: 5n,
      seqAtCreation: 1n,
      eligibleVoters: 1n,
      yesVotes: 1n,
      noVotes: 0n,
      executed: false,
      voters: ['0x3333333333333333333333333333333333333333'],
    },
    {
      id: 3,
      guildId: 1,
      kind: 2,
      proposer: OTHER,
      target: '0x9999999999999999999999999999999999999999',
      amount: parseEther('2'),
      data1: 0n,
      data2: 0n,
      data3: 0n,
      createdEpoch: 5n,
      seqAtCreation: 2n,
      eligibleVoters: 2n,
      yesVotes: 1n,
      noVotes: 0n,
      executed: false,
      voters: [OTHER],
    },
  ];
  const garrisons: Record<number, bigint> = { 0: 3n, 1: 2n, 12: 1n, 13: 4n, 77: 2n, 78: 1n };
  const logs: MockState['logs'] = [];
  let idx = 0;
  for (const g of guilds) {
    for (const m of g.members) {
      const topics = encodeEventTopics({ abi: ABIS.Guilds!, eventName: 'MemberJoined', args: { guildId: BigInt(g.id), member: m } }) as Hex[];
      logs.push({ address: ADDR.Guilds, topics, data: encodeAbiParameters([{ type: 'uint256' }], [1n]), blockNumber: START_BLOCK + 3n, logIndex: idx++ });
    }
  }
  return {
    blockNumber: START_BLOCK + 2000n,
    timestamp,
    genesis,
    epochLength: 3600n,
    seasonLength: 604800n,
    settledEpochs: 4n,
    troopPrice: parseEther('1'),
    feeBps: 500n,
    guilds,
    proposals,
    pacts: [{ id: 1, guildA: 1, guildB: 3, bondA: parseEther('2'), bondB: parseEther('2'), startEpoch: 2n, endEpoch: 30n, status: 1 }],
    garrisons,
    balances: { [PLAYER.toLowerCase()]: parseEther('25') },
    ethBalances: { [PLAYER.toLowerCase()]: parseEther('0.75') },
    allowances: {},
    permit2: {},
    prizePool: parseEther('4.2'),
    sentTransactions: [],
    logs,
  };
}

function holderOf(state: MockState, tile: number): bigint {
  for (const g of state.guilds) if (g.tiles.includes(tile)) return BigInt(g.id);
  return 0n;
}

function currentEpoch(s: MockState): bigint {
  return (s.timestamp - s.genesis) / s.epochLength;
}

function bigArgs(args: readonly unknown[] | undefined): bigint[] {
  return (args ?? []).map((a) => (typeof a === 'bigint' ? a : typeof a === 'number' ? BigInt(a) : 0n));
}

function proposalTuple(p: MockProposal) {
  return {
    guildId: BigInt(p.guildId),
    kind: p.kind,
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
  };
}

/** Handles an eth_call for a game contract or a Uniswap periphery contract. */
export function handleCall(state: MockState, to: Address, data: Hex): Hex {
  const t = to.toLowerCase();
  const name = (Object.keys(ADDR) as (keyof typeof ADDR)[]).find((k) => ADDR[k].toLowerCase() === t);
  const uni = MANIFEST.network?.uniswapV4;
  if (!name) {
    if (uni && t === uni.quoter.toLowerCase()) {
      const { args } = decodeFunctionData({ abi: QUOTER_ABI, data });
      const params = args[0];
      // 50,000 PACT per ETH in both directions, before fee.
      const out = params.zeroForOne ? params.exactAmount * 50_000n : params.exactAmount / 50_000n;
      return encodeFunctionResult({ abi: QUOTER_ABI, functionName: 'quoteExactInputSingle', result: [out, 90_000n] });
    }
    if (uni && t === uni.stateView.toLowerCase()) {
      const { functionName } = decodeFunctionData({ abi: STATE_VIEW_ABI, data });
      if (functionName === 'getSlot0') {
        // sqrt(50000) * 2^96
        const sqrt = BigInt(Math.round(Math.sqrt(50_000) * 1e9)) * (2n ** 96n) / 1_000_000_000n;
        return encodeFunctionResult({ abi: STATE_VIEW_ABI, functionName: 'getSlot0', result: [sqrt, 108_000, 0, 3000] });
      }
      return encodeFunctionResult({ abi: STATE_VIEW_ABI, functionName: 'getLiquidity', result: 10n ** 18n });
    }
    if (uni && t === uni.permit2.toLowerCase()) {
      const { functionName, args } = decodeFunctionData({ abi: PERMIT2_ABI, data });
      if (functionName === 'allowance') {
        const [owner, token, spender] = args as [Address, Address, Address];
        const key = `${owner.toLowerCase()}:${token.toLowerCase()}:${spender.toLowerCase()}`;
        const v = state.permit2[key] ?? { amount: 0n, expiration: 0n };
        return encodeFunctionResult({ abi: PERMIT2_ABI, functionName: 'allowance', result: [v.amount, Number(v.expiration), 0] });
      }
      return '0x';
    }
    if (uni && t === uni.universalRouter.toLowerCase()) {
      decodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, data });
      return '0x';
    }
    throw new Error(`mock: unknown contract ${to}`);
  }
  const abi = ABIS[name]!;
  const { functionName, args } = decodeFunctionData({ abi, data });
  const n = bigArgs(args);
  const enc = (result: unknown) => encodeFunctionResult({ abi, functionName, result: result as never });
  const epoch = currentEpoch(state);
  const epochsPerSeason = state.seasonLength / state.epochLength;
  switch (`${name}.${functionName}`) {
    case 'Realm.diplomacy':
      return enc(ADDR.Diplomacy);
    case 'Realm.season':
      return enc(ADDR.Season);
    case 'Season.banners':
      return enc(ADDR.Banners);
    case 'Realm.genesis':
    case 'Guilds.genesis':
      return enc(state.genesis);
    case 'Realm.epochLength':
    case 'Guilds.epochLength':
      return enc(state.epochLength);
    case 'Realm.seasonLength':
      return enc(state.seasonLength);
    case 'Realm.epochsPerSeason':
      return enc(epochsPerSeason);
    case 'Realm.troopPrice':
      return enc(state.troopPrice);
    case 'Realm.feeBps':
      return enc(state.feeBps);
    case 'Realm.currentEpoch':
    case 'Guilds.currentEpoch':
      return enc(epoch);
    case 'Realm.settledEpochs':
      return enc(state.settledEpochs);
    case 'Realm.currentSeason':
      return enc(epoch / epochsPerSeason);
    case 'Realm.heldTiles':
      return enc(BigInt(state.guilds.reduce((a, g) => a + g.tiles.length, 0)));
    case 'Realm.incomeCarry':
      return enc(0n);
    case 'Realm.incomePool':
      return enc(parseEther('0.95'));
    case 'Realm.settlementProgress':
      return enc([false, 0n, 0n]);
    case 'Realm.map': {
      const holders = Array.from({ length: 144 }, (_, i) => holderOf(state, i));
      const garrisons = Array.from({ length: 144 }, (_, i) => state.garrisons[i] ?? 0n);
      return enc([holders, garrisons]);
    }
    case 'Realm.tile': {
      const id = Number(n[0]);
      return enc([holderOf(state, id), state.garrisons[id] ?? 0n]);
    }
    case 'Realm.tilesHeldBy':
      return enc(BigInt(state.guilds.find((g) => g.id === Number(n[0]))?.tiles.length ?? 0));
    case 'Realm.reserveOf':
      return enc(state.guilds.find((g) => g.id === Number(n[0]))?.reserve ?? 0n);
    case 'Realm.pendingIncome':
      return enc(state.guilds.find((g) => g.id === Number(n[0]))?.pendingIncome ?? 0n);
    case 'Realm.attackedTilesIn':
      return enc(n[0] === epoch ? [77n] : []);
    case 'Realm.attacksOn':
      return enc(n[0] === epoch && n[1] === 77n ? [{ attacker: 1n, troops: 3n, proposalId: 1n, expectedHolder: 2n }] : []);
    case 'Realm.standingsOf':
      return enc([[0n, 0n, 0n], [0n, 0n, 0n], false]);
    case 'Realm.seasonEnd':
      return enc(state.genesis + (n[0]! + 1n) * state.seasonLength);
    case 'Realm.buyTroops':
      return enc(n[0]! * state.troopPrice);
    case 'Realm.settle':
      return enc(state.settledEpochs);
    case 'Realm.settlePending':
      return enc(n[0]!);
    case 'Realm.settleStep':
      return enc(true);
    case 'Realm.declareAttack':
      return enc(epoch);
    case 'Realm.collectIncome':
      return enc(parseEther('0.4'));
    case 'Realm.buyTroopsFromTreasury':
      return enc(1n);
    case 'Guilds.guildCount':
      return enc(BigInt(state.guilds.length));
    case 'Guilds.getGuild': {
      const g = state.guilds.find((x) => x.id === Number(n[0]));
      if (!g) throw new Error('NoSuchGuild');
      return enc([g.name, BigInt(g.foundedAt), BigInt(g.members.length), g.treasury]);
    }
    case 'Guilds.proposalCount':
      return enc(BigInt(state.proposals.length));
    case 'Guilds.getProposal': {
      const p = state.proposals.find((x) => x.id === Number(n[0]));
      if (!p) throw new Error('NoSuchProposal');
      return enc(proposalTuple(p));
    }
    case 'Guilds.guildOf': {
      const a = String(args?.[0] ?? '').toLowerCase();
      const g = state.guilds.find((x) => x.members.some((m) => m.toLowerCase() === a));
      return enc(BigInt(g?.id ?? 0));
    }
    case 'Guilds.memberSeq': {
      const a = String(args?.[1] ?? '').toLowerCase();
      const g = state.guilds.find((x) => x.id === Number(n[0]));
      const i = g?.members.findIndex((m) => m.toLowerCase() === a) ?? -1;
      return enc(i >= 0 ? BigInt(i + 1) : 0n);
    }
    case 'Guilds.hasVoted': {
      const p = state.proposals.find((x) => x.id === Number(n[0]));
      const a = String(args?.[1] ?? '').toLowerCase();
      return enc(p?.voters.some((v) => v.toLowerCase() === a) ?? false);
    }
    case 'Guilds.found':
      return enc(BigInt(state.guilds.length + 1));
    case 'Guilds.propose':
      return enc(BigInt(state.proposals.length + 1));
    case 'Guilds.join':
    case 'Guilds.leave':
    case 'Guilds.vote':
    case 'Guilds.execute':
    case 'Guilds.deposit':
      return '0x';
    case 'LaunchToken.balanceOf':
      return enc(state.balances[String(args?.[0]).toLowerCase()] ?? 0n);
    case 'LaunchToken.allowance': {
      const key = `${String(args?.[0]).toLowerCase()}:${String(args?.[1]).toLowerCase()}`;
      return enc(state.allowances[key] ?? 0n);
    }
    case 'LaunchToken.approve':
      return enc(true);
    case 'Diplomacy.pactCount':
      return enc(BigInt(state.pacts.length));
    case 'Diplomacy.getPact': {
      const p = state.pacts.find((x) => x.id === Number(n[0]));
      if (!p) throw new Error('NoSuchPact');
      return enc({ guildA: BigInt(p.guildA), guildB: BigInt(p.guildB), bondA: p.bondA, bondB: p.bondB, startEpoch: p.startEpoch, endEpoch: p.endEpoch, status: p.status });
    }
    case 'Diplomacy.sign':
      return enc(BigInt(state.pacts.length + 1));
    case 'Diplomacy.expire':
      return '0x';
    case 'Season.prizePool':
      return enc(state.prizePool);
    case 'Season.getResult':
      return enc({
        closed: false,
        pool: 0n,
        guildIds: [0n, 0n, 0n],
        tiles: [0n, 0n, 0n],
        guildPrize: [0n, 0n, 0n],
        memberCount: [0n, 0n, 0n],
        perMember: [0n, 0n, 0n],
        rollover: 0n,
      });
    case 'Season.claimed':
      return enc(false);
    case 'Season.close':
    case 'Season.mintPeaceBanner':
    case 'Season.claim':
      return '0x';
    default:
      throw new Error(`mock: unhandled ${name}.${functionName}`);
  }
}

interface RpcRequest {
  method: string;
  params?: unknown[];
}

export interface MockRpcOptions {
  /** Function selectors (or contract.function names) that should revert with the given custom error. */
  reverts?: Record<string, Hex>;
}

/** JSON-RPC handler standing in for the public RPC. */
export function createRpc(state: MockState, options: MockRpcOptions = {}) {
  const block = (num: bigint) => ({
    number: numberToHex(num),
    hash: keccak256(toHex(num)),
    parentHash: keccak256(toHex(num - 1n)),
    timestamp: numberToHex(state.timestamp),
    baseFeePerGas: '0x10',
    gasLimit: '0x1c9c380',
    gasUsed: '0x0',
    miner: zeroAddress,
    nonce: '0x0000000000000000',
    difficulty: '0x0',
    extraData: '0x',
    logsBloom: `0x${'0'.repeat(512)}`,
    mixHash: keccak256('0x01'),
    receiptsRoot: keccak256('0x02'),
    sha3Uncles: keccak256('0x03'),
    size: '0x100',
    stateRoot: keccak256('0x04'),
    totalDifficulty: '0x0',
    transactionsRoot: keccak256('0x05'),
    transactions: [],
    uncles: [],
  });
  const receipts = new Map<Hex, Address>();
  const handler = async (req: RpcRequest): Promise<unknown> => {
    const p = req.params ?? [];
    switch (req.method) {
      case 'eth_chainId':
        return numberToHex(CHAIN_ID);
      case 'net_version':
        return String(CHAIN_ID);
      case 'eth_blockNumber':
        return numberToHex(state.blockNumber);
      case 'eth_getBlockByNumber':
        return block(state.blockNumber);
      case 'eth_gasPrice':
        return '0x3b9aca00';
      case 'eth_maxPriorityFeePerGas':
        return '0x3b9aca00';
      case 'eth_feeHistory':
        return { baseFeePerGas: ['0x10', '0x10'], gasUsedRatio: [0.5], oldestBlock: numberToHex(state.blockNumber - 1n), reward: [['0x3b9aca00']] };
      case 'eth_estimateGas':
        return '0x30d40';
      case 'eth_getTransactionCount':
        return '0x5';
      case 'eth_getCode': {
        const [, tag] = p as [Address, string];
        const at = tag === 'latest' || tag === undefined ? state.blockNumber : BigInt(tag);
        return at >= START_BLOCK ? '0x6080' : '0x';
      }
      case 'eth_getBalance':
        return numberToHex(state.ethBalances[String((p as [Address])[0]).toLowerCase()] ?? 0n);
      case 'eth_call': {
        const [tx] = p as [{ to: Address; data: Hex; from?: Address }];
        const selector = tx.data.slice(0, 10);
        const revert = options.reverts?.[selector] ?? options.reverts?.[`${tx.to.toLowerCase()}:${selector}`];
        if (revert) {
          const err = new Error('execution reverted') as Error & { code: number; data: Hex };
          err.code = 3;
          err.data = revert;
          throw err;
        }
        return handleCall(state, getAddress(tx.to), tx.data);
      }
      case 'eth_getLogs': {
        const [filter] = p as [{ fromBlock?: Hex; toBlock?: Hex; address?: Address | Address[] }];
        const from = filter.fromBlock ? BigInt(filter.fromBlock) : 0n;
        const to = filter.toBlock ? BigInt(filter.toBlock) : state.blockNumber;
        const addresses = (Array.isArray(filter.address) ? filter.address : filter.address ? [filter.address] : []).map((a) => a.toLowerCase());
        return state.logs
          .filter((l) => l.blockNumber >= from && l.blockNumber <= to && (addresses.length === 0 || addresses.includes(l.address.toLowerCase())))
          .map((l) => ({
            address: l.address,
            topics: l.topics,
            data: l.data,
            blockNumber: numberToHex(l.blockNumber),
            blockHash: keccak256(toHex(l.blockNumber)),
            transactionHash: keccak256(toHex(l.logIndex + 7)),
            transactionIndex: '0x0',
            logIndex: numberToHex(l.logIndex),
            removed: false,
          }));
      }
      case 'eth_getTransactionReceipt': {
        const [hash] = p as [Hex];
        const to = receipts.get(hash);
        if (!to) return null;
        return {
          transactionHash: hash,
          transactionIndex: '0x0',
          blockHash: keccak256(toHex(state.blockNumber)),
          blockNumber: numberToHex(state.blockNumber),
          from: PLAYER,
          to,
          cumulativeGasUsed: '0x5208',
          gasUsed: '0x5208',
          effectiveGasPrice: '0x3b9aca00',
          contractAddress: null,
          logs: [],
          logsBloom: `0x${'0'.repeat(512)}`,
          status: '0x1',
          type: '0x2',
        };
      }
      default:
        throw new Error(`mock rpc: unsupported ${req.method}`);
    }
  };
  return {
    request: handler,
    /** Records a transaction and returns its hash; the receipt is available immediately. */
    recordTransaction(tx: { to: Address; data: Hex; value?: Hex; from: Address }): Hex {
      state.sentTransactions.push({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n, from: tx.from });
      const hash = keccak256(toHex(`${state.sentTransactions.length}:${tx.data}`));
      receipts.set(hash, tx.to);
      state.blockNumber += 1n;
      applyTransaction(state, tx);
      return hash;
    },
  };
}

export type MockRpc = ReturnType<typeof createRpc>;

/** Minimal state effects of confirmed transactions so follow-up reads look like the real chain. */
function applyTransaction(state: MockState, tx: { to: Address; data: Hex; from: Address }): void {
  const to = tx.to.toLowerCase();
  const from = tx.from.toLowerCase();
  const uni = MANIFEST.network?.uniswapV4;
  try {
    if (to === ADDR.LaunchToken.toLowerCase()) {
      const { functionName, args } = decodeFunctionData({ abi: ABIS.LaunchToken!, data: tx.data });
      if (functionName === 'approve') {
        const [spender, amount] = args as [Address, bigint];
        state.allowances[`${from}:${spender.toLowerCase()}`] = amount;
      }
    } else if (uni && to === uni.permit2.toLowerCase()) {
      const { functionName, args } = decodeFunctionData({ abi: PERMIT2_ABI, data: tx.data });
      if (functionName === 'approve') {
        const [token, spender, amount, expiration] = args as [Address, Address, bigint, number];
        state.permit2[`${from}:${token.toLowerCase()}:${spender.toLowerCase()}`] = { amount, expiration: BigInt(expiration) };
      }
    } else if (to === ADDR.Realm.toLowerCase()) {
      const { functionName, args } = decodeFunctionData({ abi: ABIS.Realm!, data: tx.data });
      const guild = state.guilds.find((g) => g.members.some((m) => m.toLowerCase() === from));
      if (functionName === 'buyTroops' && guild) {
        const n = (args as [bigint])[0];
        guild.reserve += n;
        state.balances[from] = (state.balances[from] ?? 0n) - n * state.troopPrice;
      }
      if (functionName === 'settle') state.settledEpochs += 1n;
    } else if (to === ADDR.Guilds.toLowerCase()) {
      const { functionName, args } = decodeFunctionData({ abi: ABIS.Guilds!, data: tx.data });
      if (functionName === 'vote') {
        const [id, support] = args as [bigint, boolean];
        const p = state.proposals.find((x) => x.id === Number(id));
        if (p) {
          p.voters.push(tx.from);
          if (support) p.yesVotes += 1n;
          else p.noVotes += 1n;
        }
      }
    }
  } catch {
    // Unknown calldata: leave state unchanged.
  }
}

export interface MockWalletOptions {
  chainId?: number;
  /** When true the wallet does not know the target chain: switching fails with 4902 until it is added. */
  unknownChain?: boolean;
  rejectAll?: boolean;
}

/** EIP-1193 provider backed by the mock RPC. */
export function createWalletProvider(rpc: MockRpc, opts: MockWalletOptions = {}) {
  let chainId = opts.chainId ?? CHAIN_ID;
  const known = new Set<number>([opts.unknownChain ? 1 : CHAIN_ID, 1]);
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const calls: { method: string; params?: unknown }[] = [];
  const emit = (event: string, ...args: unknown[]) => {
    for (const l of listeners.get(event) ?? []) l(...args);
  };
  const provider = {
    calls,
    async request({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> {
      calls.push({ method, params });
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          if (opts.rejectAll) throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
          return [PLAYER];
        case 'eth_chainId':
          return numberToHex(chainId);
        case 'wallet_switchEthereumChain': {
          const target = Number.parseInt((params as [{ chainId: string }])[0].chainId, 16);
          if (!known.has(target)) throw Object.assign(new Error('Unrecognized chain ID'), { code: 4902 });
          chainId = target;
          emit('chainChanged', numberToHex(target));
          return null;
        }
        case 'wallet_addEthereumChain': {
          const target = Number.parseInt((params as [{ chainId: string }])[0].chainId, 16);
          known.add(target);
          return null;
        }
        case 'eth_sendTransaction': {
          if (opts.rejectAll) throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
          const [tx] = params as [{ to: Address; data: Hex; value?: Hex; from: Address }];
          return rpc.recordTransaction(tx);
        }
        default:
          return rpc.request({ method, params });
      }
    },
    on(event: string, listener: (...args: unknown[]) => void) {
      (listeners.get(event) ?? listeners.set(event, new Set()).get(event)!).add(listener);
    },
    removeListener(event: string, listener: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(listener);
    },
  };
  return provider;
}
