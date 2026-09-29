import { useEffect, useMemo, useState } from 'react';
import { zeroAddress, type Address } from 'viem';
import { POOL } from '../config/launch';
import { describeError } from '../lib/errors';
import { formatAmount, parseAmount } from '../lib/format';
import {
  applySlippage,
  buildPoolKey,
  encodeV4Swap,
  PERMIT2_ABI,
  PERMIT2_MAX_EXPIRATION,
  PERMIT2_MAX_UINT160,
  poolId,
  priceFromSqrtX96,
  QUOTER_ABI,
  STATE_VIEW_ABI,
  UNIVERSAL_ROUTER_ABI,
} from '../lib/swap';
import { useApp, useGame } from '../state/app';
import { useTx } from '../state/tx';
import { ActionGate } from '../components/WalletBar';
import { Button, Card, Field, Notice, TxStatus, busyLabel } from '../components/ui';

type Direction = 'ethToToken' | 'tokenToEth';

export function SwapPage() {
  const { config } = useApp();
  return (
    <>
      <div>
        <h1 className="page-title">Swap</h1>
        <p className="page-intro">
          Trade {config.chain.nativeCurrency.symbol} and PACT in the launch pool on Uniswap v4. Quotes come from the network's quoter; swaps go
          through its Universal Router with your slippage limit. USD values are unavailable because this site reads no price feed.
        </p>
      </div>
      <div className="grid-2">
        {config.swapDisabledReason || !config.uniswap ? (
          <Card title="Swaps unavailable">
            <Notice kind="warning">{config.swapDisabledReason ?? 'Uniswap addresses are missing.'}</Notice>
          </Card>
        ) : (
          <SwapCard uniswap={config.uniswap} />
        )}
        <PoolCard />
      </div>
    </>
  );
}

function usePoolKey() {
  const { config } = useApp();
  return useMemo(
    () => buildPoolKey(config.addresses.LaunchToken, POOL.pairedCurrency as Address, POOL.fee, POOL.tickSpacing, POOL.hooks as Address),
    [config.addresses.LaunchToken],
  );
}

function PoolCard() {
  const { config, publicClient } = useApp();
  const key = usePoolKey();
  const [state, setState] = useState<{ price: number; liquidity: bigint; tick: number } | null | 'error'>(null);
  useEffect(() => {
    const uni = config.uniswap;
    if (!uni) return;
    let cancelled = false;
    const load = async () => {
      try {
        const id = poolId(key);
        const [slot0, liquidity] = await Promise.all([
          publicClient.readContract({ address: uni.stateView, abi: STATE_VIEW_ABI, functionName: 'getSlot0', args: [id] }),
          publicClient.readContract({ address: uni.stateView, abi: STATE_VIEW_ABI, functionName: 'getLiquidity', args: [id] }),
        ]);
        if (!cancelled) setState({ price: priceFromSqrtX96(slot0[0], 18, 18), liquidity, tick: slot0[1] });
      } catch {
        if (!cancelled) setState('error');
      }
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [config.uniswap, key, publicClient]);
  const ethIsZero = key.currency0 === zeroAddress;
  return (
    <Card title="Pool">
      <dl className="kv">
        <dt>Pair</dt>
        <dd>{config.chain.nativeCurrency.symbol} / PACT, fee {(POOL.fee / 10_000).toFixed(2)}%, tick spacing {POOL.tickSpacing}, no hook</dd>
        <dt>Pool id</dt>
        <dd className="mono break">{poolId(key)}</dd>
        <dt>Price</dt>
        <dd>
          {state === null
            ? 'Loading…'
            : state === 'error'
              ? 'Unavailable (pool not initialised or RPC error)'
              : ethIsZero
                ? `${state.price.toLocaleString(undefined, { maximumFractionDigits: 2 })} PACT per ETH`
                : `${(1 / state.price).toLocaleString(undefined, { maximumFractionDigits: 2 })} PACT per ETH`}
        </dd>
        <dt>Active liquidity</dt>
        <dd>{state && state !== 'error' ? state.liquidity.toString() : '—'}</dd>
      </dl>
      <p className="small muted">
        Router, quoter, Permit2 and StateView addresses come from the vetted network table embedded in this site's deployment configuration.
      </p>
    </Card>
  );
}

function SwapCard({ uniswap }: { uniswap: NonNullable<ReturnType<typeof useApp>['config']['uniswap']> }) {
  const { config, publicClient } = useApp();
  const game = useGame();
  const key = usePoolKey();
  const [direction, setDirection] = useState<Direction>('ethToToken');
  const [amountText, setAmountText] = useState('');
  const [slippageText, setSlippageText] = useState('0.5');
  const [quote, setQuote] = useState<{ amountIn: bigint; amountOut: bigint } | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const approveToken = useTx();
  const approvePermit2 = useTx();
  const swap = useTx();
  const player = game.player;
  const symbol = config.chain.nativeCurrency.symbol;

  const amountIn = parseAmount(amountText);
  const slippageBps = Math.round(Number(slippageText) * 100);
  const validSlippage = Number.isFinite(slippageBps) && slippageBps >= 0 && slippageBps <= 5000;
  const tokenIsCurrency1 = key.currency1.toLowerCase() === config.addresses.LaunchToken.toLowerCase();
  // ETH -> PACT swaps from the ETH side towards the token side.
  const zeroForOne = direction === 'ethToToken' ? tokenIsCurrency1 : !tokenIsCurrency1;

  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (amountIn === null || amountIn <= 0n) return;
    let cancelled = false;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const { result } = await publicClient.simulateContract({
          address: uniswap.quoter,
          abi: QUOTER_ABI,
          functionName: 'quoteExactInputSingle',
          args: [{ poolKey: key, zeroForOne, exactAmount: amountIn, hookData: '0x' }],
        });
        if (!cancelled) setQuote({ amountIn, amountOut: result[0] });
      } catch (e) {
        if (!cancelled) setQuoteError(`Unable to quote: ${describeError(e)}`);
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [amountIn, zeroForOne, key, publicClient, uniswap.quoter]);

  const minOut = quote && validSlippage ? applySlippage(quote.amountOut, slippageBps) : null;
  const inSymbol = direction === 'ethToToken' ? symbol : 'PACT';
  const outSymbol = direction === 'ethToToken' ? 'PACT' : symbol;
  const balanceIn = player ? (direction === 'ethToToken' ? player.ethBalance : player.tokenBalance) : null;

  const needsTokenApproval = direction === 'tokenToEth' && amountIn !== null && player !== null && player.allowancePermit2 < amountIn;
  const nowSec = Math.floor(Date.now() / 1000);
  const needsPermit2 =
    direction === 'tokenToEth' &&
    amountIn !== null &&
    player !== null &&
    !needsTokenApproval &&
    (player.permit2Router.amount < amountIn || (player.permit2Router.expiration !== 0 && player.permit2Router.expiration <= nowSec));

  const validate = (): boolean => {
    setError(null);
    if (amountIn === null || amountIn <= 0n) {
      setError(`Enter an amount of ${inSymbol} greater than zero.`);
      return false;
    }
    if (!validSlippage) {
      setError('Use a slippage between 0 and 50 percent.');
      return false;
    }
    if (balanceIn !== null && amountIn > balanceIn) {
      setError(`The wallet holds ${formatAmount(balanceIn)} ${inSymbol}.`);
      return false;
    }
    if (!quote || quote.amountIn !== amountIn) {
      setError('Wait for the quote before swapping.');
      return false;
    }
    return true;
  };

  const doSwap = () => {
    if (!validate() || !quote || minOut === null || amountIn === null) return;
    const plan = encodeV4Swap({ key, zeroForOne, amountIn, amountOutMinimum: minOut });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
    void swap
      .run({
        address: uniswap.universalRouter,
        abi: UNIVERSAL_ROUTER_ABI,
        functionName: 'execute',
        args: [plan.commands, plan.inputs, deadline],
        value: plan.value,
      })
      .then((h) => {
        if (h) setAmountText('');
      });
  };

  return (
    <Card title="Swap">
      <div className="row" role="group" aria-label="Direction">
        <Button variant={direction === 'ethToToken' ? 'primary' : 'secondary'} aria-pressed={direction === 'ethToToken'} onClick={() => setDirection('ethToToken')}>
          {symbol} to PACT
        </Button>
        <Button variant={direction === 'tokenToEth' ? 'primary' : 'secondary'} aria-pressed={direction === 'tokenToEth'} onClick={() => setDirection('tokenToEth')}>
          PACT to {symbol}
        </Button>
      </div>
      <div className="fields">
        <Field id="swap-amount" label={`You pay (${inSymbol})`} hint={balanceIn !== null ? `Balance ${formatAmount(balanceIn)} ${inSymbol}` : 'Connect a wallet to see balances'}>
          {(p) => <input {...p} className="input" inputMode="decimal" autoComplete="off" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0.0" />}
        </Field>
        <Field id="swap-slippage" label="Max slippage (%)" hint="Applied to the quoted output" error={validSlippage ? null : 'Use 0 to 50'}>
          {(p) => <input {...p} className="input" inputMode="decimal" autoComplete="off" value={slippageText} onChange={(e) => setSlippageText(e.target.value)} />}
        </Field>
      </div>
      <dl className="kv" aria-live="polite">
        <dt>You receive</dt>
        <dd>
          {quoting ? 'Quoting…' : quote ? `${formatAmount(quote.amountOut)} ${outSymbol}` : '—'}
        </dd>
        <dt>Minimum after slippage</dt>
        <dd>{minOut !== null ? `${formatAmount(minOut)} ${outSymbol}` : '—'}</dd>
        <dt>Rate</dt>
        <dd>
          {quote && quote.amountIn > 0n
            ? direction === 'ethToToken'
              ? `${formatAmount((quote.amountOut * 10n ** 18n) / quote.amountIn, 18, 2)} PACT per ${symbol}`
              : `${formatAmount((quote.amountIn * 10n ** 18n) / (quote.amountOut === 0n ? 1n : quote.amountOut), 18, 2)} PACT per ${symbol}`
            : '—'}
        </dd>
      </dl>
      {quoteError && (
        <Notice kind="warning" role="status">
          {quoteError}
        </Notice>
      )}
      <ActionGate>
        {error && (
          <Notice kind="danger" role="alert">
            {error}
          </Notice>
        )}
        {direction === 'tokenToEth' && (
          <p className="small muted">
            Selling PACT takes three steps: approve Permit2 on the token, approve the router in Permit2, then swap.{' '}
            {needsTokenApproval ? 'Step 1 of 3.' : needsPermit2 ? 'Step 2 of 3.' : 'Approvals in place: step 3 of 3.'}
          </p>
        )}
        {needsTokenApproval ? (
          <Button
            variant="primary"
            busy={approveToken.inFlight}
            onClick={() => {
              if (amountIn !== null && amountIn > 0n)
                void approveToken.run({ address: config.addresses.LaunchToken, abi: config.abis.LaunchToken, functionName: 'approve', args: [uniswap.permit2, amountIn] });
              else setError('Enter an amount of PACT greater than zero.');
            }}
          >
            {busyLabel(approveToken.state, `Approve ${amountIn ? formatAmount(amountIn) : ''} PACT for Permit2`, 'Approving…')}
          </Button>
        ) : needsPermit2 ? (
          <Button
            variant="primary"
            busy={approvePermit2.inFlight}
            onClick={() =>
              void approvePermit2.run({
                address: uniswap.permit2,
                abi: PERMIT2_ABI,
                functionName: 'approve',
                args: [config.addresses.LaunchToken, uniswap.universalRouter, PERMIT2_MAX_UINT160, PERMIT2_MAX_EXPIRATION],
              })
            }
          >
            {busyLabel(approvePermit2.state, 'Allow the router in Permit2', 'Approving…')}
          </Button>
        ) : (
          <Button variant="primary" busy={swap.inFlight} disabled={!quote || quoting} onClick={doSwap}>
            {busyLabel(swap.state, `Swap ${amountIn ? formatAmount(amountIn) : ''} ${inSymbol} for at least ${minOut !== null ? formatAmount(minOut) : '…'} ${outSymbol}`, 'Swapping…')}
          </Button>
        )}
        <TxStatus state={approveToken.state} successText="Token approved for Permit2." />
        <TxStatus state={approvePermit2.state} successText="Router allowed in Permit2." />
        <TxStatus state={swap.state} successText="Swap confirmed." />
        <p className="small muted">The swap is simulated before your wallet is asked to sign; a failing simulation shows its reason here instead.</p>
      </ActionGate>
    </Card>
  );
}
