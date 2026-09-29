import { describe, expect, it } from 'vitest';
import { WalletStore, isUnknownChainError, isUserRejection, type Eip1193Provider } from './wallet';
import type { WalletAddChain } from '../config/deployment';

const ADD: WalletAddChain = {
  chainId: '0xaa36a7',
  chainName: 'Sepolia',
  rpcUrls: ['https://example.invalid'],
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
};

function fakeProvider(known: Set<number>, start: number) {
  let chain = start;
  const calls: string[] = [];
  const provider: Eip1193Provider & { calls: string[] } = {
    calls,
    async request({ method, params }) {
      calls.push(method);
      if (method === 'eth_requestAccounts') return ['0x1111111111111111111111111111111111111111'];
      if (method === 'eth_chainId') return `0x${chain.toString(16)}`;
      if (method === 'wallet_switchEthereumChain') {
        const target = Number.parseInt((params as [{ chainId: string }])[0].chainId, 16);
        if (!known.has(target)) throw Object.assign(new Error('Unrecognized chain ID "0xaa36a7".'), { code: 4902 });
        chain = target;
        return null;
      }
      if (method === 'wallet_addEthereumChain') {
        known.add(Number.parseInt((params as [{ chainId: string }])[0].chainId, 16));
        return null;
      }
      throw new Error(`unexpected ${method}`);
    },
  };
  return provider;
}

describe('WalletStore.switchChain', () => {
  it('switches directly when the wallet knows the chain', async () => {
    const provider = fakeProvider(new Set([1, 11155111]), 1);
    const store = new WalletStore(null);
    const option = { id: 'x', name: 'X', provider };
    store.registerProvider(option);
    await store.connect(option);
    expect(store.getState().chainId).toBe(1);
    const how = await store.switchChain('0xaa36a7', ADD);
    expect(how).toBe('switched');
    expect(store.getState().chainId).toBe(11155111);
    expect(provider.calls).not.toContain('wallet_addEthereumChain');
  });

  it('adds the chain after a 4902 error and switches again', async () => {
    const provider = fakeProvider(new Set([1]), 1);
    const store = new WalletStore(null);
    const option = { id: 'x', name: 'X', provider };
    store.registerProvider(option);
    await store.connect(option);
    const how = await store.switchChain('0xaa36a7', ADD);
    expect(how).toBe('added');
    expect(store.getState().chainId).toBe(11155111);
    const seq = provider.calls.filter((c) => c.startsWith('wallet_'));
    expect(seq).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
  });

  it('rethrows when the chain is unknown and no add parameters exist', async () => {
    const provider = fakeProvider(new Set([1]), 1);
    const store = new WalletStore(null);
    const option = { id: 'x', name: 'X', provider };
    store.registerProvider(option);
    await store.connect(option);
    await expect(store.switchChain('0xaa36a7', null)).rejects.toThrow();
    expect(provider.calls).not.toContain('wallet_addEthereumChain');
  });

  it('recognises unknown-chain and rejection errors by code or message', () => {
    expect(isUnknownChainError({ code: 4902 })).toBe(true);
    expect(isUnknownChainError(new Error('Unrecognized chain ID'))).toBe(true);
    expect(isUnknownChainError(new Error('insufficient funds'))).toBe(false);
    expect(isUserRejection({ code: 4001 })).toBe(true);
    expect(isUserRejection(new Error('User rejected the request.'))).toBe(true);
  });
});
