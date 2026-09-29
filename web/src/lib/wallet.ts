// Browser wallet connection over EIP-1193 with EIP-6963 multi-wallet discovery.
// No WalletConnect project ID is configured, so only injected wallets are offered.
import type { Address } from 'viem';
import { getAddress } from 'viem';
import type { WalletAddChain } from '../config/deployment';

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface WalletOption {
  id: string;
  name: string;
  icon?: string;
  provider: Eip1193Provider;
}

export type WalletStatus = 'idle' | 'connecting' | 'connected';

export interface WalletState {
  options: WalletOption[];
  status: WalletStatus;
  selected: WalletOption | null;
  address: Address | null;
  chainId: number | null;
  error: string | null;
}

type Listener = () => void;

interface Eip6963Detail {
  info: { uuid: string; name: string; icon?: string; rdns?: string };
  provider: Eip1193Provider;
}

function errorCode(e: unknown): number | undefined {
  if (!e || typeof e !== 'object') return undefined;
  const any = e as { code?: unknown; data?: { originalError?: { code?: unknown } }; cause?: { code?: unknown } };
  for (const c of [any.code, any.data?.originalError?.code, any.cause?.code]) {
    if (typeof c === 'number') return c;
  }
  return undefined;
}

export function isUnknownChainError(e: unknown): boolean {
  if (errorCode(e) === 4902) return true;
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return /unrecognized chain|unknown chain|not added|4902|does not exist|unsupported chain/i.test(msg);
}

export function isUserRejection(e: unknown): boolean {
  if (errorCode(e) === 4001) return true;
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return /user rejected|user denied|rejected the request/i.test(msg);
}

export class WalletStore {
  private state: WalletState = {
    options: [],
    status: 'idle',
    selected: null,
    address: null,
    chainId: null,
    error: null,
  };
  private listeners = new Set<Listener>();
  private unsubscribeProvider: (() => void) | null = null;

  constructor(private readonly win: Window | null = typeof window === 'undefined' ? null : window) {}

  getState = (): WalletState => this.state;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(patch: Partial<WalletState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** Adds a wallet option unless the same provider is already listed. */
  registerProvider(opt: WalletOption): void {
    if (this.state.options.some((o) => o.id === opt.id || o.provider === opt.provider)) return;
    this.set({ options: [...this.state.options, opt] });
  }

  /** Starts EIP-6963 discovery and picks up a legacy `window.ethereum` provider. */
  discover(): void {
    const w = this.win;
    if (!w) return;
    w.addEventListener('eip6963:announceProvider', (ev) => {
      const detail = (ev as CustomEvent<Eip6963Detail>).detail;
      if (!detail?.provider) return;
      this.registerProvider({ id: detail.info.rdns ?? detail.info.uuid, name: detail.info.name, icon: detail.info.icon, provider: detail.provider });
    });
    w.dispatchEvent(new Event('eip6963:requestProvider'));
    const legacy = (w as Window & { ethereum?: Eip1193Provider }).ethereum;
    if (legacy) {
      // Give EIP-6963 announcements a moment so the same wallet is not listed twice.
      setTimeout(() => {
        if (this.state.options.some((o) => o.provider === legacy)) return;
        this.registerProvider({ id: 'window.ethereum', name: 'Browser wallet', provider: legacy });
      }, 150);
    }
  }

  async connect(option: WalletOption): Promise<void> {
    this.set({ status: 'connecting', error: null, selected: option });
    try {
      const accounts = (await option.provider.request({ method: 'eth_requestAccounts' })) as string[];
      const first = accounts[0];
      if (!first) throw new Error('The wallet returned no account.');
      const chainHex = (await option.provider.request({ method: 'eth_chainId' })) as string;
      this.listen(option.provider);
      this.set({ status: 'connected', address: getAddress(first), chainId: Number.parseInt(chainHex, 16), error: null });
    } catch (e) {
      this.set({
        status: 'idle',
        selected: null,
        error: isUserRejection(e) ? 'Connection request was rejected in the wallet.' : 'Unable to connect. Unlock the wallet and try again.',
      });
      throw e;
    }
  }

  disconnect(): void {
    this.unsubscribeProvider?.();
    this.unsubscribeProvider = null;
    this.set({ status: 'idle', selected: null, address: null, chainId: null, error: null });
  }

  private listen(provider: Eip1193Provider) {
    this.unsubscribeProvider?.();
    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      const first = accounts?.[0];
      if (!first) this.disconnect();
      else this.set({ address: getAddress(first) });
    };
    const onChain = (...args: unknown[]) => {
      const hex = args[0] as string;
      this.set({ chainId: Number.parseInt(hex, 16) });
    };
    const onDisconnect = () => this.disconnect();
    provider.on?.('accountsChanged', onAccounts);
    provider.on?.('chainChanged', onChain);
    provider.on?.('disconnect', onDisconnect);
    this.unsubscribeProvider = () => {
      provider.removeListener?.('accountsChanged', onAccounts);
      provider.removeListener?.('chainChanged', onChain);
      provider.removeListener?.('disconnect', onDisconnect);
    };
  }

  /**
   * Switches the wallet to the target chain. When the wallet does not know the chain (EIP-3085
   * error 4902 or an equivalent message) and `addChain` parameters are available, the chain is
   * added with `wallet_addEthereumChain` and the switch is requested again.
   */
  async switchChain(chainIdHex: `0x${string}`, addChain: WalletAddChain | null): Promise<'switched' | 'added'> {
    const provider = this.state.selected?.provider;
    if (!provider) throw new Error('Connect a wallet first.');
    const target = Number.parseInt(chainIdHex, 16);
    const finish = async (how: 'switched' | 'added') => {
      const hex = (await provider.request({ method: 'eth_chainId' })) as string;
      this.set({ chainId: Number.parseInt(hex, 16) });
      if (Number.parseInt(hex, 16) !== target) throw new Error('The wallet stayed on another network.');
      return how;
    };
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
      return await finish('switched');
    } catch (e) {
      if (!isUnknownChainError(e) || !addChain) throw e;
      await provider.request({ method: 'wallet_addEthereumChain', params: [addChain] });
      try {
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
      } catch (second) {
        // Some wallets switch as part of adding; only surface the failure if we are still elsewhere.
        const hex = (await provider.request({ method: 'eth_chainId' })) as string;
        if (Number.parseInt(hex, 16) !== target) throw second;
      }
      return await finish('added');
    }
  }
}
