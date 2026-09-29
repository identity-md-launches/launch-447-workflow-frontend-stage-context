import { createPublicClient, createWalletClient, custom, fallback, http, type PublicClient, type WalletClient, type Address } from 'viem';
import type { AppConfig } from '../config/deployment';
import type { Eip1193Provider } from './wallet';

/** Polling cadence for reads. Sepolia blocks arrive about every 12 seconds. */
export const POLL_INTERVAL_MS = 12_000;

/** Public read client over the configured public RPC URLs, batched and with fallback. */
export function makePublicClient(config: AppConfig): PublicClient {
  if (config.rpcUrls.length === 0) {
    throw new Error('The deployment configuration lists no public RPC URL.');
  }
  const transports = config.rpcUrls.map((url) => http(url, { batch: { wait: 16, batchSize: 100 }, retryCount: 1, timeout: 20_000 }));
  return createPublicClient({
    chain: config.chain,
    transport: fallback(transports, { rank: false, retryCount: 0 }),
    pollingInterval: POLL_INTERVAL_MS,
    batch: { multicall: false },
  });
}

/** Signing client over the visitor's wallet. Only used to send transactions. */
export function makeWalletClient(config: AppConfig, provider: Eip1193Provider, account: Address): WalletClient {
  return createWalletClient({ chain: config.chain, account, transport: custom(provider) });
}
