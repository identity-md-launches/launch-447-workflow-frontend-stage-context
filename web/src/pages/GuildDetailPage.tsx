import { useMemo, useState } from 'react';
import { isAddress, getAddress } from 'viem';
import { formatAmount, formatTimestamp, parseAmount, parseTileLabel, tileLabel } from '../lib/format';
import { Kind, KIND_LABEL, PactStatus, guildHue } from '../lib/game';
import { useApp, useGame } from '../state/app';
import { useTx } from '../state/tx';
import { ActionGate } from '../components/WalletBar';
import { ProposalCard } from '../components/ProposalCard';
import { AddressLink, Button, Card, EmptyState, Field, GuildTag, Notice, TxStatus, busyLabel } from '../components/ui';
import { MembershipRiskNotice } from './GuildsPage';

export function GuildDetailPage({ guildId }: { guildId: number }) {
  const game = useGame();
  const guild = game.guilds.find((g) => g.id === guildId);
  if (game.status === 'loading' && !guild) {
    return <p role="status">Loading guild {guildId}…</p>;
  }
  if (!guild) {
    return (
      <>
        <h1 className="page-title">Guild {guildId}</h1>
        <EmptyState
          title="No such guild"
          body="This guild id has not been founded yet."
          action={
            <a className="btn" href="#/guilds">
              Back to guilds
            </a>
          }
        />
      </>
    );
  }
  const members = game.members[guildId] ?? [];
  const proposals = game.proposals.filter((p) => p.guildId === guildId);
  const open = proposals.filter((p) => !p.executed && !p.expired);
  const past = proposals.filter((p) => p.executed || p.expired);
  const pacts = game.pacts.filter((p) => p.guildA === guildId || p.guildB === guildId);
  const betrayals = game.betrayals.filter((b) => b.betrayer === guildId || b.victim === guildId);
  const tiles = game.tiles.map((t, i) => ({ t, i })).filter(({ t }) => t.holder === guildId);

  return (
    <>
      <div className="row" style={{ alignItems: 'center' }}>
        <span className="swatch" style={{ background: `var(--guild-${guildHue(guildId)})`, width: '1.25rem', height: '1.25rem' }} aria-hidden="true" />
        <h1>
          {guild.name} <span className="muted" style={{ fontWeight: 400 }}>#{guildId}</span>
        </h1>
      </div>
      <div className="grid-2">
        <div className="stack-lg">
          <Card title="Overview">
            <div className="fields">
              <div className="stat">
                <span className="label">Members</span>
                <span className="value">{guild.memberCount}</span>
              </div>
              <div className="stat">
                <span className="label">Tiles</span>
                <span className="value">{guild.tiles}</span>
              </div>
              <div className="stat">
                <span className="label">Troop reserve</span>
                <span className="value">{guild.reserve.toString()}</span>
              </div>
              <div className="stat">
                <span className="label">Treasury</span>
                <span className="value">{formatAmount(guild.treasury)} PACT</span>
              </div>
            </div>
            <dl className="kv">
              <dt>Founded</dt>
              <dd>{formatTimestamp(guild.foundedAt)}</dd>
              <dt>Uncollected income</dt>
              <dd>{formatAmount(guild.pendingIncome)} PACT</dd>
              <dt>Tiles held</dt>
              <dd>{tiles.length === 0 ? 'none' : tiles.map(({ i, t }) => `${tileLabel(i)} (${t.garrison.toString()})`).join(', ')}</dd>
            </dl>
            <CollectIncome guildId={guildId} pending={guild.pendingIncome} />
          </Card>

          <Card title={`Pending votes (${open.length})`}>
            {open.length === 0 ? (
              <EmptyState title="Nothing to vote on" body="Members create proposals below: attacks, pacts, treasury spending and expulsions." />
            ) : (
              <ul className="list">
                {open.map((p) => (
                  <ProposalCard key={p.id} p={p} />
                ))}
              </ul>
            )}
          </Card>

          <NewProposal guildId={guildId} />

          {past.length > 0 && (
            <Card title="Past proposals">
              <details className="disclosure">
                <summary>Show {past.length} executed or expired proposals</summary>
                <ul className="list" style={{ marginBlockStart: 'var(--space-2)' }}>
                  {past.slice(0, 50).map((p) => (
                    <ProposalCard key={p.id} p={p} />
                  ))}
                </ul>
              </details>
            </Card>
          )}
        </div>
        <div className="stack-lg">
          <MembershipCard guildId={guildId} members={members} memberCount={guild.memberCount} />
          <DepositCard guildId={guildId} />
          <Card title="Pacts and betrayals">
            {pacts.length === 0 && betrayals.length === 0 ? (
              <p className="small muted">No pacts signed yet.</p>
            ) : (
              <ul className="list">
                {pacts.map((p) => {
                  const other = p.guildA === guildId ? p.guildB : p.guildA;
                  return (
                    <li key={p.id} className="small">
                      Pact #{p.id} with <GuildTag id={other} />: epochs {p.startEpoch.toString()} to {p.endEpoch.toString()},{' '}
                      <span className={`badge ${p.status === PactStatus.Active ? 'badge-success' : p.status === PactStatus.Broken ? 'badge-danger' : ''}`}>
                        {['None', 'Active', 'Expired', 'Broken'][p.status]}
                      </span>
                    </li>
                  );
                })}
                {betrayals.map((b) => (
                  <li key={`${b.pactId}-${b.epoch}`} className="small">
                    {b.betrayer === guildId ? 'Betrayed' : 'Was betrayed by'} <GuildTag id={b.betrayer === guildId ? b.victim : b.betrayer} /> in epoch{' '}
                    {b.epoch.toString()}: {formatAmount(b.slashed)} PACT slashed.
                  </li>
                ))}
              </ul>
            )}
            <a href="#/diplomacy" className="small">
              Open the diplomacy board
            </a>
          </Card>
        </div>
      </div>
    </>
  );
}

function CollectIncome({ guildId, pending }: { guildId: number; pending: bigint }) {
  const { config } = useApp();
  const tx = useTx();
  if (pending === 0n) return null;
  return (
    <div className="stack" style={{ gap: 'var(--space-1)' }}>
      <ActionGate compact>
        <Button
          busy={tx.inFlight}
          onClick={() => void tx.run({ address: config.addresses.Realm, abi: config.abis.Realm, functionName: 'collectIncome', args: [BigInt(guildId)] })}
        >
          {busyLabel(tx.state, `Collect ${formatAmount(pending)} PACT of tile income`, 'Collecting…')}
        </Button>
      </ActionGate>
      <p className="small muted">Anyone may move accrued tile income into the treasury. Only a majority vote can spend it.</p>
      <TxStatus state={tx.state} successText="Income collected into the treasury." />
    </div>
  );
}

function MembershipCard({ guildId, members, memberCount }: { guildId: number; members: readonly `0x${string}`[]; memberCount: number }) {
  const { config } = useApp();
  const game = useGame();
  const tx = useTx();
  const player = game.player;
  const inThis = player?.guildId === guildId;
  const inOther = player ? player.guildId > 0 && player.guildId !== guildId : false;
  return (
    <Card title={`Members (${memberCount})`}>
      {members.length === 0 && memberCount > 0 ? (
        <p className="small muted">{game.logsError ? `Member list unavailable: ${game.logsError}` : 'Loading member list from events…'}</p>
      ) : members.length === 0 ? (
        <p className="small muted">This guild has no members. One wallet joining forms an immediate majority over its treasury.</p>
      ) : (
        <ul className="list" style={{ gap: 'var(--space-1)' }}>
          {members.map((m) => (
            <li key={m} className="small">
              <AddressLink address={m} />
              {player?.address === m && <span className="badge badge-accent" style={{ marginInlineStart: 'var(--space-2)' }}>you</span>}
            </li>
          ))}
        </ul>
      )}
      <MembershipRiskNotice />
      <ActionGate compact>
        {inThis ? (
          <Button
            variant="danger"
            busy={tx.inFlight}
            onClick={() => void tx.run({ address: config.addresses.Guilds, abi: config.abis.Guilds, functionName: 'leave', args: [] })}
          >
            {busyLabel(tx.state, 'Leave guild', 'Leaving…')}
          </Button>
        ) : inOther ? (
          <p className="small">
            You are in <GuildTag id={player!.guildId} />. Leave it before joining this one.
          </p>
        ) : (
          <Button
            variant="primary"
            busy={tx.inFlight}
            onClick={() => void tx.run({ address: config.addresses.Guilds, abi: config.abis.Guilds, functionName: 'join', args: [BigInt(guildId)] })}
          >
            {busyLabel(tx.state, 'Join guild', 'Joining…')}
          </Button>
        )}
        <TxStatus state={tx.state} successText="Membership updated." />
      </ActionGate>
    </Card>
  );
}

function DepositCard({ guildId }: { guildId: number }) {
  const { config } = useApp();
  const game = useGame();
  const approve = useTx();
  const deposit = useTx();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const player = game.player;
  const amount = parseAmount(text);
  const needsApproval = amount !== null && player !== null && player.allowanceGuilds < amount;

  const validate = (): bigint | null => {
    setError(null);
    if (amount === null || amount <= 0n) {
      setError('Enter an amount of PACT greater than zero.');
      return null;
    }
    if (player && amount > player.tokenBalance) {
      setError(`Your balance is ${formatAmount(player.tokenBalance)} PACT.`);
      return null;
    }
    return amount;
  };

  return (
    <Card title="Deposit to treasury">
      <p className="small muted">
        Deposits are irrevocable gifts to the guild. Spending needs a majority vote. Approve the Guilds contract for the amount first, then deposit.
      </p>
      <ActionGate compact>
        <Field id={`deposit-${guildId}`} label="Amount (PACT)" hint={player ? `Balance ${formatAmount(player.tokenBalance)} PACT` : undefined} error={error}>
          {(p) => <input {...p} className="input" inputMode="decimal" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} placeholder="0.0" />}
        </Field>
        {needsApproval ? (
          <Button
            variant="primary"
            busy={approve.inFlight}
            onClick={() => {
              const a = validate();
              if (a !== null) void approve.run({ address: config.addresses.LaunchToken, abi: config.abis.LaunchToken, functionName: 'approve', args: [config.addresses.Guilds, a] });
            }}
          >
            {busyLabel(approve.state, `Approve ${amount ? formatAmount(amount) : ''} PACT`, 'Approving…')}
          </Button>
        ) : (
          <Button
            variant="primary"
            busy={deposit.inFlight}
            onClick={() => {
              const a = validate();
              if (a !== null)
                void deposit.run({ address: config.addresses.Guilds, abi: config.abis.Guilds, functionName: 'deposit', args: [BigInt(guildId), a] }).then((h) => {
                  if (h) setText('');
                });
            }}
          >
            {busyLabel(deposit.state, 'Deposit', 'Depositing…')}
          </Button>
        )}
        <TxStatus state={approve.state} successText="Approved. You can deposit now." />
        <TxStatus state={deposit.state} successText="Deposited." />
      </ActionGate>
    </Card>
  );
}

function NewProposal({ guildId }: { guildId: number }) {
  const { config } = useApp();
  const game = useGame();
  const tx = useTx();
  const [kind, setKind] = useState<Kind>(Kind.Attack);
  const [target, setTarget] = useState('');
  const [amountText, setAmountText] = useState('');
  const [tileText, setTileText] = useState('');
  const [troops, setTroops] = useState('1');
  const [otherGuild, setOtherGuild] = useState('');
  const [epochs, setEpochs] = useState('24');
  const [minBondText, setMinBondText] = useState('');
  const [anyBond, setAnyBond] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const player = game.player;
  const isMember = player?.guildId === guildId;
  const members = game.members[guildId] ?? [];
  const guild = game.guilds.find((g) => g.id === guildId);
  const others = game.guilds.filter((g) => g.id !== guildId);

  const tileId = parseTileLabel(tileText);
  const holder = tileId !== null ? game.tiles[tileId]?.holder ?? 0 : 0;
  const troopPrice = game.clock?.troopPrice ?? 0n;
  const amount = parseAmount(amountText);
  const activePactWithHolder = useMemo(
    () =>
      holder > 0 &&
      game.pacts.some(
        (p) =>
          p.status === PactStatus.Active &&
          ((p.guildA === guildId && p.guildB === holder) || (p.guildB === guildId && p.guildA === holder)) &&
          (game.clock ? p.endEpoch >= game.clock.currentEpoch : true),
      ),
    [game.pacts, game.clock, guildId, holder],
  );

  const submit = async () => {
    setError(null);
    let args: readonly unknown[];
    switch (kind) {
      case Kind.Expel: {
        if (!isAddress(target)) return setError('Enter the member address to expel.');
        args = [Kind.Expel, getAddress(target), 0n, 0n, 0n, 0n];
        break;
      }
      case Kind.Payout: {
        if (!isAddress(target)) return setError('Enter the recipient address.');
        if (amount === null || amount <= 0n) return setError('Enter an amount of PACT greater than zero.');
        args = [Kind.Payout, getAddress(target), amount, 0n, 0n, 0n];
        break;
      }
      case Kind.TreasuryTroops: {
        if (amount === null || amount <= 0n) return setError('Enter an amount of PACT greater than zero.');
        if (troopPrice > 0n && amount % troopPrice !== 0n) return setError(`Use a multiple of the troop price (${formatAmount(troopPrice)} PACT).`);
        args = [Kind.TreasuryTroops, config.addresses.Realm, amount, 0n, 0n, 0n];
        break;
      }
      case Kind.Attack: {
        if (tileId === null) return setError('Enter a tile such as C7 (columns A to L, rows 1 to 12).');
        const n = /^\d+$/.test(troops.trim()) ? BigInt(troops.trim()) : null;
        if (n === null || n <= 0n) return setError('Enter a whole number of troops, at least 1.');
        if (holder === guildId) return setError('The guild already holds that tile.');
        args = [Kind.Attack, config.addresses.Realm, 0n, BigInt(tileId), BigInt(holder), n];
        break;
      }
      case Kind.Pact: {
        const other = Number(otherGuild);
        if (!other || !others.some((g) => g.id === other)) return setError('Choose the partner guild.');
        if (amount === null || amount <= 0n) return setError('Enter a bond of PACT greater than zero.');
        const ep = /^\d+$/.test(epochs.trim()) ? BigInt(epochs.trim()) : null;
        if (ep === null || ep <= 0n) return setError('Enter the pact length in epochs, at least 1.');
        let minBond: bigint;
        if (anyBond) minBond = 0n;
        else {
          const parsed = minBondText.trim() === '' ? amount : parseAmount(minBondText);
          if (parsed === null || parsed <= 0n) return setError('Enter the minimum counter-bond, or accept any bond explicitly.');
          minBond = parsed;
        }
        if (!game.children) return setError('Diplomacy address not loaded yet.');
        args = [Kind.Pact, game.children.Diplomacy, amount, BigInt(other), ep, minBond];
        break;
      }
      default:
        return setError('Choose a proposal kind.');
    }
    await tx.run({ address: config.addresses.Guilds, abi: config.abis.Guilds, functionName: 'propose', args });
  };

  return (
    <Card title="New proposal">
      <ActionGate>
        {!isMember ? (
          <p className="small muted">Only members of this guild can create proposals.</p>
        ) : (
          <>
            <p className="small muted">
              Your yes vote is cast at creation. Members who joined before now can vote until the end of the next epoch. The Realm and Diplomacy targets
              are filled in for you.
            </p>
            <Field id="np-kind" label="Kind">
              {(p) => (
                <select {...p} className="input" value={kind} onChange={(e) => setKind(Number(e.target.value) as Kind)}>
                  {[Kind.Attack, Kind.Pact, Kind.TreasuryTroops, Kind.Payout, Kind.Expel].map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {kind === Kind.Attack && (
              <div className="fields">
                <Field
                  id="np-tile"
                  label="Tile"
                  hint={tileId !== null ? (holder > 0 ? <>Held by <GuildTag id={holder} /></> : 'Empty tile') : 'For example C7'}
                >
                  {(p) => <input {...p} className="input" autoComplete="off" value={tileText} onChange={(e) => setTileText(e.target.value)} placeholder="C7" />}
                </Field>
                <Field id="np-troops" label="Troops" hint={`Reserve ${guild?.reserve.toString() ?? '0'}`}>
                  {(p) => <input {...p} className="input" inputMode="numeric" autoComplete="off" value={troops} onChange={(e) => setTroops(e.target.value)} />}
                </Field>
              </div>
            )}
            {kind === Kind.Attack && activePactWithHolder && (
              <Notice kind="warning">Attacking this holder would break an active pact. Both bonds would be paid to the victim.</Notice>
            )}
            {kind === Kind.Pact && (
              <>
                <div className="fields">
                  <Field id="np-other" label="Partner guild">
                    {(p) => (
                      <select {...p} className="input" value={otherGuild} onChange={(e) => setOtherGuild(e.target.value)}>
                        <option value="">Choose a guild</option>
                        {others.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name} (#{g.id})
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <Field id="np-epochs" label="Length (epochs)" hint="One epoch is one hour">
                    {(p) => <input {...p} className="input" inputMode="numeric" autoComplete="off" value={epochs} onChange={(e) => setEpochs(e.target.value)} />}
                  </Field>
                  <Field id="np-bond" label="Our bond (PACT)" hint={`Treasury ${formatAmount(guild?.treasury ?? 0n)} PACT`}>
                    {(p) => <input {...p} className="input" inputMode="decimal" autoComplete="off" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0.0" />}
                  </Field>
                  <Field id="np-minbond" label="Minimum counter-bond (PACT)" hint="Defaults to our bond">
                    {(p) => (
                      <input
                        {...p}
                        className="input"
                        inputMode="decimal"
                        autoComplete="off"
                        value={minBondText}
                        onChange={(e) => setMinBondText(e.target.value)}
                        placeholder={amountText || '0.0'}
                        disabled={anyBond}
                      />
                    )}
                  </Field>
                </div>
                <label className="check">
                  <input type="checkbox" checked={anyBond} onChange={(e) => setAnyBond(e.target.checked)} />
                  Accept any non-zero counter-bond, even 1 wei
                </label>
                {anyBond && <Notice kind="warning">With a zero minimum the partner can betray for almost nothing while our full bond is at stake.</Notice>}
              </>
            )}
            {kind === Kind.TreasuryTroops && (
              <Field
                id="np-amount"
                label="Treasury to spend (PACT)"
                hint={
                  amount !== null && troopPrice > 0n
                    ? `${(amount / troopPrice).toString()} troops at ${formatAmount(troopPrice)} PACT each; treasury ${formatAmount(guild?.treasury ?? 0n)} PACT`
                    : `Multiple of ${formatAmount(troopPrice)} PACT`
                }
              >
                {(p) => <input {...p} className="input" inputMode="decimal" autoComplete="off" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0.0" />}
              </Field>
            )}
            {kind === Kind.Payout && (
              <div className="fields">
                <Field id="np-target" label="Recipient address">
                  {(p) => <input {...p} className="input mono" autoComplete="off" value={target} onChange={(e) => setTarget(e.target.value.trim())} placeholder="0x…" />}
                </Field>
                <Field id="np-amount" label="Amount (PACT)" hint={`Treasury ${formatAmount(guild?.treasury ?? 0n)} PACT`}>
                  {(p) => <input {...p} className="input" inputMode="decimal" autoComplete="off" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0.0" />}
                </Field>
              </div>
            )}
            {kind === Kind.Expel && (
              <Field id="np-target" label="Member to expel" hint="Expulsion is not a ban: the address can rejoin at once.">
                {(p) =>
                  members.length > 0 ? (
                    <select {...p} className="input mono" value={target} onChange={(e) => setTarget(e.target.value)}>
                      <option value="">Choose a member</option>
                      {members.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input {...p} className="input mono" autoComplete="off" value={target} onChange={(e) => setTarget(e.target.value.trim())} placeholder="0x…" />
                  )
                }
              </Field>
            )}
            {error && (
              <Notice kind="danger" role="alert">
                {error}
              </Notice>
            )}
            <Button variant="primary" onClick={submit} busy={tx.inFlight}>
              {busyLabel(tx.state, 'Create proposal', 'Creating…')}
            </Button>
            <TxStatus state={tx.state} successText="Proposal created." />
          </>
        )}
      </ActionGate>
      <p className="small muted">Treasury amounts leave the guild only when the approved proposal is executed or consumed by its target.</p>
    </Card>
  );
}
