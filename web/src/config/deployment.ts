// Runtime deployment configuration.
//
// The app has exactly one source of addresses, chain settings, public RPC URLs and ABIs: the
// `imd-deployment.json` file exported beside index.html. Nothing in the bundle repeats an
// address or RPC URL. Contracts created by Realm's constructor (Diplomacy, Season, Banners) have
// no handoff entry; their addresses are read from chain and their ABIs are loaded from the same
// `abi/` directory using the naming convention below.
import type { Abi, Address, Chain } from 'viem';
import { getAddress, isAddress } from 'viem';

export interface DeploymentContract {
  name: string;
  address: Address;
  abiHash: string;
  abiPath: string;
}

export interface NetworkBlock {
  chainId: number;
  name: string;
  testnet: boolean;
  rpcUrls: string[];
  explorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  faucets?: string[];
  uniswapV4?: {
    poolManager: Address;
    universalRouter: Address;
    quoter: Address;
    stateView: Address;
    positionManager: Address;
    permit2: Address;
  };
}

export interface WalletAddChain {
  chainId: `0x${string}`;
  chainName: string;
  rpcUrls: string[];
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorerUrls?: string[];
}

export interface ImdDeployment {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: DeploymentContract[];
  assets: { path: string; sha256: string }[];
  network?: NetworkBlock;
  walletAddChain?: WalletAddChain;
}

export const HANDOFF_CONTRACTS = ['LaunchToken', 'Guilds', 'Realm'] as const;
export type HandoffName = (typeof HANDOFF_CONTRACTS)[number];

/** Contracts created inside Realm's constructor: address from chain, ABI from `abi/<Name>.json`. */
export const CHILD_CONTRACTS = ['Diplomacy', 'Season', 'Banners'] as const;
export type ChildName = (typeof CHILD_CONTRACTS)[number];
export type ContractName = HandoffName | ChildName;

export interface AppConfig {
  deployment: ImdDeployment;
  chain: Chain;
  chainIdHex: `0x${string}`;
  rpcUrls: string[];
  explorer: string | null;
  faucets: string[];
  addresses: Record<HandoffName, Address>;
  abis: Record<ContractName, Abi>;
  uniswap: NonNullable<NetworkBlock['uniswapV4']> | null;
  walletAddChain: WalletAddChain | null;
  /** Reason swaps are unavailable, or null when the chain table vetted the network. */
  swapDisabledReason: string | null;
}

export class DeploymentError extends Error {}

type Fetcher = (path: string) => Promise<unknown>;

const defaultFetcher: Fetcher = async (path) => {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new DeploymentError(`Unable to load ${path} (HTTP ${res.status})`);
  return res.json();
};

function assertString(v: unknown, what: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new DeploymentError(`${what} is missing`);
  return v;
}

export function validateDeployment(raw: unknown): ImdDeployment {
  if (!raw || typeof raw !== 'object') throw new DeploymentError('imd-deployment.json is not an object');
  const d = raw as Record<string, unknown>;
  if (d.version !== 1) throw new DeploymentError(`Unsupported deployment version ${String(d.version)}`);
  assertString(d.launchId, 'launchId');
  assertString(d.sourceCommit, 'sourceCommit');
  assertString(d.attestationHash, 'attestationHash');
  if (typeof d.chainId !== 'number') throw new DeploymentError('chainId is missing');
  if (!Array.isArray(d.contracts)) throw new DeploymentError('contracts is missing');
  const contracts: DeploymentContract[] = d.contracts.map((c) => {
    const e = c as Record<string, unknown>;
    const name = assertString(e.name, 'contract name');
    const address = assertString(e.address, `${name} address`);
    if (!isAddress(address)) throw new DeploymentError(`${name} address is malformed`);
    const abiPath = assertString(e.abiPath, `${name} abiPath`);
    if (abiPath.startsWith('/') || abiPath.includes('..') || /^[a-z]+:/i.test(abiPath)) {
      throw new DeploymentError(`${name} abiPath must be relative`);
    }
    return { name, address: getAddress(address), abiHash: assertString(e.abiHash, `${name} abiHash`), abiPath };
  });
  for (const required of HANDOFF_CONTRACTS) {
    if (!contracts.some((c) => c.name === required)) throw new DeploymentError(`Deployment lacks ${required}`);
  }
  const network = d.network as NetworkBlock | undefined;
  if (network && network.chainId !== d.chainId) {
    throw new DeploymentError('network.chainId differs from chainId');
  }
  return {
    version: 1,
    launchId: d.launchId as string,
    chainId: d.chainId,
    sourceCommit: d.sourceCommit as string,
    attestationHash: d.attestationHash as string,
    contracts,
    assets: Array.isArray(d.assets) ? (d.assets as ImdDeployment['assets']) : [],
    network,
    walletAddChain: d.walletAddChain as WalletAddChain | undefined,
  };
}

export function buildChain(deployment: ImdDeployment): Chain {
  const n = deployment.network;
  const name = n?.name ?? `Chain ${deployment.chainId}`;
  const explorer = n?.explorer ?? deployment.walletAddChain?.blockExplorerUrls?.[0];
  return {
    id: deployment.chainId,
    name,
    nativeCurrency: n?.nativeCurrency ?? { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: n?.rpcUrls ?? [] } },
    blockExplorers: explorer ? { default: { name: 'Explorer', url: explorer } } : undefined,
    testnet: n?.testnet ?? true,
  };
}

/** Loads the runtime deployment configuration and every ABI it references. */
export async function loadAppConfig(base = './', fetcher: Fetcher = defaultFetcher): Promise<AppConfig> {
  const deployment = validateDeployment(await fetcher(`${base}imd-deployment.json`));
  const abis = {} as Record<ContractName, Abi>;
  const addresses = {} as Record<HandoffName, Address>;

  await Promise.all([
    ...HANDOFF_CONTRACTS.map(async (name) => {
      const entry = deployment.contracts.find((c) => c.name === name)!;
      const abi = await fetcher(`${base}${entry.abiPath}`);
      if (!Array.isArray(abi)) throw new DeploymentError(`${entry.abiPath} is not an ABI array`);
      abis[name] = abi as Abi;
      addresses[name] = entry.address;
    }),
    ...CHILD_CONTRACTS.map(async (name) => {
      const abi = await fetcher(`${base}abi/${name}.json`);
      if (!Array.isArray(abi)) throw new DeploymentError(`abi/${name}.json is not an ABI array`);
      abis[name] = abi as Abi;
    }),
  ]);

  const network = deployment.network ?? null;
  const rpcUrls = network?.rpcUrls ?? [];
  const uniswap = network?.uniswapV4 ?? null;
  let swapDisabledReason: string | null = null;
  if (!network) {
    swapDisabledReason = 'This chain is not in the vetted network table, so swaps and liquidity actions are unavailable.';
  } else if (!uniswap) {
    swapDisabledReason = 'The network table lists no Uniswap v4 addresses for this chain, so swaps are unavailable.';
  }

  return {
    deployment,
    chain: buildChain(deployment),
    chainIdHex: `0x${deployment.chainId.toString(16)}`,
    rpcUrls,
    explorer: network?.explorer ?? deployment.walletAddChain?.blockExplorerUrls?.[0] ?? null,
    faucets: network?.faucets ?? [],
    addresses,
    abis,
    uniswap,
    walletAddChain: deployment.walletAddChain ?? null,
    swapDisabledReason,
  };
}

export function explorerAddressUrl(config: AppConfig, address: string): string | null {
  return config.explorer ? `${config.explorer.replace(/\/$/, '')}/address/${address}` : null;
}

export function explorerTxUrl(config: AppConfig, hash: string): string | null {
  return config.explorer ? `${config.explorer.replace(/\/$/, '')}/tx/${hash}` : null;
}
