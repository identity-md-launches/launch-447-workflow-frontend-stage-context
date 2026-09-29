// Shared test harness: real App wired to the mock chain and mock wallet.
import { createPublicClient, custom } from 'viem';
import { loadAppConfig, type AppConfig } from '../config/deployment';
import { WalletStore } from '../lib/wallet';
import { AppContext } from '../state/app';
import { GameStore } from '../state/store';
import { App } from '../App';
import { ABIS, MANIFEST, baseState, createRpc, createWalletProvider, type MockRpcOptions, type MockState, type MockWalletOptions } from './mockChain';

export async function loadTestConfig(overrides?: (m: typeof MANIFEST) => typeof MANIFEST): Promise<AppConfig> {
  const manifest = overrides ? overrides(structuredClone(MANIFEST)) : MANIFEST;
  return loadAppConfig('./', async (path) => {
    if (path === './imd-deployment.json') return manifest;
    const m = /^\.\/abi\/(\w+)\.json$/.exec(path);
    if (m && ABIS[m[1]!]) return ABIS[m[1]!];
    throw new Error(`unexpected fetch ${path}`);
  });
}

export interface Harness {
  config: AppConfig;
  state: MockState;
  rpc: ReturnType<typeof createRpc>;
  wallet: WalletStore;
  game: GameStore;
  provider: ReturnType<typeof createWalletProvider>;
  ui: React.ReactElement;
}

export async function makeHarness(opts: { state?: MockState; wallet?: MockWalletOptions; rpc?: MockRpcOptions; noWallet?: boolean } = {}): Promise<Harness> {
  const config = await loadTestConfig();
  const state = opts.state ?? baseState();
  const rpc = createRpc(state, opts.rpc);
  const publicClient = createPublicClient({ chain: config.chain, transport: custom({ request: rpc.request }) });
  const wallet = new WalletStore(null);
  const provider = createWalletProvider(rpc, opts.wallet);
  if (!opts.noWallet) wallet.registerProvider({ id: 'mock', name: 'Mock wallet', provider });
  const game = new GameStore(config, publicClient, 60_000);
  const ui = (
    <AppContext.Provider value={{ config, publicClient, wallet, game }}>
      <App />
    </AppContext.Provider>
  );
  return { config, state, rpc, wallet, game, provider, ui };
}
