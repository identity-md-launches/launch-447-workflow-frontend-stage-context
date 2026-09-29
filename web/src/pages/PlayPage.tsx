import { useState } from 'react';
import { formatAmount, formatBps } from '../lib/format';
import { useApp, useGame, useWallet } from '../state/app';
import { useTx } from '../state/tx';
import { ClockCard } from '../components/ClockCard';
import { ActionGate } from '../components/WalletBar';
import { Button, Card, EmptyState, Field, GuildTag, Notice, TxStatus, busyLabel } from '../components/ui';
import { MembershipRiskNotice } from './GuildsPage';

export function PlayPage() {
  return (
    <>
      <div>
        <h1 className="page-title">Play</h1>
        <p className="page-intro">
          Buy troops for your guild with PACT, then propose attacks on the map. Anyone may settle ended epochs so that fights resolve and tile income
          is distributed.
        </p>
      </div>
      <div className="grid-2">
        <div className="stack-lg">
          <WalletCard />
          <BuyTroopsCard />
        </div>
        <div className="stack-lg">
          <ClockCard />
          <SettleCard />
        </div>
      </div>
    </>
  );
}

function WalletCard() {
  const game = useGame();
  const w = useWallet();
  const { config } = useApp();
  const p = game.player;
  return (
    <Card title="Your wallet">
      <ActionGate>
        {!p ? (
          <p className="small muted" role="status">
            {game.playerError ? `Unable to read wallet state: ${game.playerError}` : 'Loading balances…'}
          </p>
        ) : (
          <>
            <div className="fields">
              <div className="stat">
                <span className="label">PACT</span>
                <span className="value">{formatAmount(p.tokenBalance)}</span>
              </div>
              <div className="stat">
                <span className="label">{config.chain.nativeCurrency.symbol} for gas</span>
                <span className="value">{formatAmount(p.ethBalance, 18, 5)}</span>
              </div>
              <div className="stat">
                <span className="label">Guild</span>
                <span className="value" style={{ fontSize: 'var(--text-base)' }}>
                  {p.guildId > 0 ? <GuildTag id={p.guildId} /> : 'None'}
                </span>
              </div>
            </div>
            <p className="small muted">
              USD value is unavailable: this site reads no price source. The swap page shows the pool's PACT per ETH rate.
              {w.chainId === config.chain.id && p.tokenBalance === 0n && (
                <>
                  {' '}
                  <a href="#/swap">Swap ETH for PACT</a> to buy troops.
                </>
              )}
            </p>
          </>
        )}
      </ActionGate>
    </Card>
  );
}

function BuyTroopsCard() {
  const { config } = useApp();
  const game = useGame();
  const approve = useTx();
  const buy = useTx();
  const [text, setText] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const p = game.player;
  const price = game.clock?.troopPrice ?? 0n;
  const fee = game.clock?.feeBps ?? 0n;
  const troops = /^\d+$/.test(text.trim()) ? BigInt(text.trim()) : null;
  const cost = troops !== null ? troops * price : null;
  const needsApproval = cost !== null && p !== null && p.allowanceRealm < cost;

  const validate = (): bigint | null => {
    setError(null);
    if (troops === null || troops <= 0n) {
      setError('Enter a whole number of troops, at least 1.');
      return null;
    }
    if (p && cost !== null && cost > p.tokenBalance) {
      setError(`This costs ${formatAmount(cost)} PACT but the wallet holds ${formatAmount(p.tokenBalance)} PACT.`);
      return null;
    }
    return troops;
  };

  return (
    <Card title="Buy troops">
      <p className="small muted">
        Troops go to your guild's shared reserve, where any approved attack can commit them. {formatBps(fee)} of each purchase funds the season prize
        pool and the rest becomes this epoch's tile income. Troops are never refunded except when an attack is void.
      </p>
      <MembershipRiskNotice />
      <ActionGate>
        {!p ? (
          <p className="small muted">Loading…</p>
        ) : p.guildId === 0 ? (
          <EmptyState
            title="Join a guild first"
            body="Troops belong to a guild. Found or join one, then buy troops for it."
            action={
              <a className="btn" href="#/guilds">
                Open guilds
              </a>
            }
          />
        ) : (
          <>
            <div className="fields">
              <Field
                id="buy-troops"
                label="Troops"
                hint={cost !== null ? `Costs ${formatAmount(cost)} PACT (${formatAmount((cost * fee) / 10_000n)} PACT to the prize pool)` : `${formatAmount(price)} PACT per troop`}
                error={error}
              >
                {(f) => <input {...f} className="input" inputMode="numeric" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />}
              </Field>
            </div>
            {needsApproval ? (
              <Button
                variant="primary"
                busy={approve.inFlight}
                onClick={() => {
                  if (validate() !== null && cost !== null)
                    void approve.run({ address: config.addresses.LaunchToken, abi: config.abis.LaunchToken, functionName: 'approve', args: [config.addresses.Realm, cost] });
                }}
              >
                {busyLabel(approve.state, `Approve ${cost ? formatAmount(cost) : ''} PACT for Realm`, 'Approving…')}
              </Button>
            ) : (
              <Button
                variant="primary"
                busy={buy.inFlight}
                onClick={() => {
                  const n = validate();
                  if (n !== null) void buy.run({ address: config.addresses.Realm, abi: config.abis.Realm, functionName: 'buyTroops', args: [n] });
                }}
              >
                {busyLabel(buy.state, `Buy ${troops?.toString() ?? ''} troops for ${formatAmount(cost ?? 0n)} PACT`, 'Buying…')}
              </Button>
            )}
            <p className="small muted">Step {needsApproval ? '1 of 2: approve the Realm contract to take the cost.' : '2 of 2: buy. Allowance covers the cost.'}</p>
            <TxStatus state={approve.state} successText="Approved. You can buy now." />
            <TxStatus state={buy.state} successText="Troops bought and added to the guild reserve." />
          </>
        )}
      </ActionGate>
    </Card>
  );
}

function SettleCard() {
  const { config } = useApp();
  const game = useGame();
  const settle = useTx();
  const step = useTx();
  const [maxAttacks, setMaxAttacks] = useState('200');
  const c = game.clock;
  const pending = c ? c.currentEpoch - c.settledEpochs : 0n;
  const attacksInNext = c ? game.attacks.filter((a) => a.epoch === c.settledEpochs).length : 0;
  return (
    <Card title="Settle epochs">
      <p className="small muted">
        Settlement resolves all attacks of an ended epoch and distributes its income. It is permissionless: anyone may pay the gas.
        {c && (
          <>
            {' '}
            {pending > 0n ? `${pending.toString()} ended epoch${pending === 1n ? '' : 's'} await settlement` : 'Everything is settled'}
            {attacksInNext > 0 && `; the next one holds ${attacksInNext} attack${attacksInNext === 1 ? '' : 's'}`}.
          </>
        )}
      </p>
      <ActionGate compact>
        <div className="row">
          <Button
            variant="primary"
            disabled={pending === 0n}
            busy={settle.inFlight}
            onClick={() => void settle.run({ address: config.addresses.Realm, abi: config.abis.Realm, functionName: 'settle', args: [] })}
          >
            {busyLabel(settle.state, 'Settle next epoch', 'Settling…')}
          </Button>
          <Button
            disabled={pending < 2n}
            busy={settle.inFlight}
            onClick={() => void settle.run({ address: config.addresses.Realm, abi: config.abis.Realm, functionName: 'settlePending', args: [pending > 10n ? 10n : pending] })}
          >
            {busyLabel(settle.state, pending < 2n ? 'Settle several epochs' : `Settle up to ${(pending > 10n ? 10n : pending).toString()} epochs`, 'Settling…')}
          </Button>
        </div>
        <TxStatus state={settle.state} successText="Epoch settled." />
        <details className="disclosure">
          <summary>Stepwise settlement for epochs with many attacks</summary>
          <div className="stack" style={{ marginBlockStart: 'var(--space-2)' }}>
            <p className="small muted">
              If a plain settle runs out of gas, call settleStep repeatedly with a bounded number of attack visits until it reports completion.
              {c?.progress.started && ` In progress: ${c.progress.tilesDone.toString()} of ${c.progress.tilesTotal.toString()} tiles.`}
            </p>
            <div className="fields">
              <Field id="settle-step" label="Max attack visits per call" hint="A few hundred is comfortable">
                {(f) => <input {...f} className="input" inputMode="numeric" autoComplete="off" value={maxAttacks} onChange={(e) => setMaxAttacks(e.target.value)} />}
              </Field>
            </div>
            <Button
              disabled={pending === 0n || !/^\d+$/.test(maxAttacks) || BigInt(maxAttacks || '0') === 0n}
              busy={step.inFlight}
              onClick={() => void step.run({ address: config.addresses.Realm, abi: config.abis.Realm, functionName: 'settleStep', args: [BigInt(maxAttacks)] })}
            >
              {busyLabel(step.state, 'Run one settlement step', 'Stepping…')}
            </Button>
            <TxStatus state={step.state} successText="Step done. Check the progress line and repeat if needed." />
          </div>
        </details>
      </ActionGate>
      {c && pending === 0n && <Notice kind="success">All ended epochs are settled.</Notice>}
    </Card>
  );
}
