// One transaction at a time per control: simulate, sign, wait, refresh. Each button owns its
// own instance so labels and disabled states never leak between actions.
import { useCallback, useRef, useState } from 'react';
import type { Abi, Address, Hex } from 'viem';
import { describeError } from '../lib/errors';
import { makeWalletClient } from '../lib/client';
import { useApp } from './app';

export type TxPhase = 'idle' | 'simulating' | 'signing' | 'pending' | 'confirmed' | 'failed';

export interface TxState {
  phase: TxPhase;
  hash: Hex | null;
  error: string | null;
}

export interface TxRequest {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}

export const IDLE: TxState = { phase: 'idle', hash: null, error: null };

export function useTx() {
  const { config, publicClient, wallet, game } = useApp();
  const [state, setState] = useState<TxState>(IDLE);
  const busy = useRef(false);

  const run = useCallback(
    async (req: TxRequest): Promise<Hex | null> => {
      if (busy.current) return null;
      const w = wallet.getState();
      if (!w.selected || !w.address) {
        setState({ phase: 'failed', hash: null, error: 'Connect a wallet first.' });
        return null;
      }
      if (w.chainId !== config.chain.id) {
        setState({ phase: 'failed', hash: null, error: `Switch the wallet to ${config.chain.name} first.` });
        return null;
      }
      busy.current = true;
      setState({ phase: 'simulating', hash: null, error: null });
      try {
        const { request } = await publicClient.simulateContract({
          account: w.address,
          address: req.address,
          abi: req.abi,
          functionName: req.functionName,
          args: req.args ?? [],
          value: req.value,
          chain: config.chain,
        });
        setState({ phase: 'signing', hash: null, error: null });
        const walletClient = makeWalletClient(config, w.selected.provider, w.address);
        const hash = await walletClient.writeContract(request);
        setState({ phase: 'pending', hash, error: null });
        const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
        if (receipt.status !== 'success') {
          setState({ phase: 'failed', hash, error: 'The transaction was mined but reverted.' });
          return null;
        }
        setState({ phase: 'confirmed', hash, error: null });
        await game.refresh();
        return hash;
      } catch (e) {
        setState({ phase: 'failed', hash: null, error: describeError(e) });
        return null;
      } finally {
        busy.current = false;
      }
    },
    [config, publicClient, wallet, game],
  );

  const reset = useCallback(() => setState(IDLE), []);
  return { state, run, reset, inFlight: state.phase === 'simulating' || state.phase === 'signing' || state.phase === 'pending' };
}
