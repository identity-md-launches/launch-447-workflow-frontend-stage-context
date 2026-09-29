import { createContext, useContext, useSyncExternalStore } from 'react';
import type { PublicClient } from 'viem';
import type { AppConfig } from '../config/deployment';
import type { WalletStore } from '../lib/wallet';
import type { GameStore } from './store';

export interface AppServices {
  config: AppConfig;
  publicClient: PublicClient;
  wallet: WalletStore;
  game: GameStore;
}

export const AppContext = createContext<AppServices | null>(null);

export function useApp(): AppServices {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppContext is missing');
  return ctx;
}

export function useWallet() {
  const { wallet } = useApp();
  return useSyncExternalStore(wallet.subscribe, wallet.getState, wallet.getState);
}

export function useGame() {
  const { game } = useApp();
  return useSyncExternalStore(game.subscribe, game.getSnapshot, game.getSnapshot);
}

/** True when a wallet is connected on the configured chain. */
export function useOnChain(): boolean {
  const { config } = useApp();
  const w = useWallet();
  return w.status === 'connected' && w.chainId === config.chain.id;
}

export function useHashRoute(): string {
  const read = () => (typeof window === 'undefined' ? '#/' : window.location.hash || '#/');
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb);
      return () => window.removeEventListener('hashchange', cb);
    },
    read,
    read,
  );
}
