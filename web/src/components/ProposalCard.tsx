import { useMemo } from 'react';
import type { Address } from 'viem';
import { formatAmount, tileLabel } from '../lib/format';
import { Kind, KIND_LABEL, type ProposalInfo } from '../lib/game';
import { useApp, useGame } from '../state/app';
import { useTx } from '../state/tx';
import { ActionGate } from './WalletBar';
import { AddressLink, Amount, Button, GuildTag, Notice, TxStatus, busyLabel } from './ui';

/** Members who joined before the proposal (lower or equal join sequence) may vote. */
export function canVote(memberSeq: bigint, seqAtCreation: bigint): boolean {
  return memberSeq > 0n && memberSeq <= seqAtCreation;
}

export function proposalStatus(p: ProposalInfo): { label: string; kind: 'success' | 'danger' | 'warning' | 'accent' | 'neutral' } {
  if (p.executed) return { label: 'Executed', kind: 'neutral' };
  if (p.expired) return { label: 'Expired', kind: 'danger' };
  if (p.approved) return { label: 'Approved', kind: 'success' };
  return { label: 'Voting', kind: 'accent' };
}

export function expectedTarget(kind: Kind, realm: Address, diplomacy: Address | null): Address | null {
  if (kind === Kind.Attack || kind === Kind.TreasuryTroops) return realm;
  if (kind === Kind.Pact) return diplomacy;
  return null;
}

/** Counter-offers from the other guild that Diplomacy.sign would accept with this pact proposal. */
export function matchingPactOffers(p: ProposalInfo, all: ProposalInfo[]): ProposalInfo[] {
  if (p.kind !== Kind.Pact) return [];
  return all.filter(
    (q) =>
      q.kind === Kind.Pact &&
      q.id !== p.id &&
      q.guildId === Number(p.data1) &&
      Number(q.data1) === p.guildId &&
      q.data2 === p.data2 &&
      q.approved &&
      !q.executed &&
      !q.expired &&
      q.amount >= p.data3 &&
      p.amount >= q.data3,
  );
}

export function ProposalCard({ p, showGuild }: { p: ProposalInfo; showGuild?: boolean }) {
  const { config } = useApp();
  const game = useGame();
  const vote = useTx();
  const act = useTx();
  const status = proposalStatus(p);
  const player = game.player;
  const isMember = player?.guildId === p.guildId;
  const eligible = isMember && player ? canVote(player.memberSeq, p.seqAtCreation) : false;
  const voted = player?.votes[p.id] ?? false;
  const open = !p.executed && !p.expired;
  const expected = expectedTarget(p.kind, config.addresses.Realm, game.children?.Diplomacy ?? null);
  const wrongTarget = expected !== null && expected.toLowerCase() !== p.target.toLowerCase();
  const offers = useMemo(() => matchingPactOffers(p, game.proposals), [p, game.proposals]);
  const yes = Number(p.yesVotes);
  const no = Number(p.noVotes);
  const eligibleCount = Math.max(1, Number(p.eligibleVoters));
  const needed = Math.floor(eligibleCount / 2) + 1;

  let detail: React.ReactNode;
  switch (p.kind) {
    case Kind.Expel:
      detail = (
        <>
          Expel <AddressLink address={p.target} />
        </>
      );
      break;
    case Kind.Payout:
      detail = (
        <>
          Pay <Amount value={p.amount} /> from the treasury to <AddressLink address={p.target} />
        </>
      );
      break;
    case Kind.TreasuryTroops:
      detail = (
        <>
          Spend <Amount value={p.amount} /> from the treasury on {game.clock && game.clock.troopPrice > 0n ? (p.amount / game.clock.troopPrice).toString() : '?'}{' '}
          troops
        </>
      );
      break;
    case Kind.Attack:
      detail = (
        <>
          Attack tile {tileLabel(Number(p.data1))} held by <GuildTag id={Number(p.data2)} /> with {p.data3.toString()} troops
        </>
      );
      break;
    case Kind.Pact:
      detail = (
        <>
          Pact with <GuildTag id={Number(p.data1)} /> for {p.data2.toString()} epochs. Offered bond <Amount value={p.amount} />; the partner must bond at
          least <Amount value={p.data3} />
          {p.data3 === 0n && <span className="badge badge-warning" style={{ marginInlineStart: 'var(--space-2)' }}>any counter-bond, even 1 wei</span>}
        </>
      );
      break;
    default:
      detail = 'Unknown proposal kind';
  }

  return (
    <li className="list-item">
      <div className="row row-between">
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          <strong>
            #{p.id} {KIND_LABEL[p.kind] ?? 'Proposal'}
          </strong>
          <span className={`badge badge-${status.kind === 'neutral' ? '' : status.kind}`.trim()}>{status.label}</span>
          {showGuild && <GuildTag id={p.guildId} />}
        </div>
        <span className="small muted num">
          created epoch {p.createdEpoch.toString()}, expires end of epoch {(p.createdEpoch + 1n).toString()}
        </span>
      </div>
      <p className="small">{detail}</p>
      <p className="small muted">
        Proposed by <AddressLink address={p.proposer} />
      </p>
      {wrongTarget && (
        <Notice kind="danger">
          The target <span className="mono">{p.target}</span> is not the {p.kind === Kind.Pact ? 'Diplomacy' : 'Realm'} contract. Approving this pays{' '}
          {formatAmount(p.amount)} PACT to that address instead. Vote no unless you understand why.
        </Notice>
      )}
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <div className="vote-bar" aria-hidden="true">
          <span className="yes" style={{ width: `${(yes / eligibleCount) * 100}%` }} />
          <span className="no" style={{ width: `${(no / eligibleCount) * 100}%` }} />
        </div>
        <p className="small num">
          {yes} yes, {no} no, of {p.eligibleVoters.toString()} eligible. Majority needs {needed}.
        </p>
      </div>
      {open && (
        <ActionGate compact>
          <div className="stack">
            {isMember ? (
              eligible ? (
                voted ? (
                  <p className="small muted">You have voted on this proposal.</p>
                ) : (
                  <div className="row">
                    <Button
                      variant="primary"
                      busy={vote.inFlight}
                      onClick={() => void vote.run({ address: config.addresses.Guilds, abi: config.abis.Guilds, functionName: 'vote', args: [BigInt(p.id), true] })}
                    >
                      {busyLabel(vote.state, 'Vote yes', 'Voting…')}
                    </Button>
                    <Button
                      variant="danger"
                      busy={vote.inFlight}
                      onClick={() => void vote.run({ address: config.addresses.Guilds, abi: config.abis.Guilds, functionName: 'vote', args: [BigInt(p.id), false] })}
                    >
                      {busyLabel(vote.state, 'Vote no', 'Voting…')}
                    </Button>
                  </div>
                )
              ) : (
                <p className="small muted">You joined after this proposal was created, so you cannot vote on it.</p>
              )
            ) : null}
            <TxStatus state={vote.state} successText="Vote recorded." />
            {p.approved && (p.kind === Kind.Expel || p.kind === Kind.Payout) && (
              <Button
                busy={act.inFlight}
                onClick={() => void act.run({ address: config.addresses.Guilds, abi: config.abis.Guilds, functionName: 'execute', args: [BigInt(p.id)] })}
              >
                {busyLabel(act.state, p.kind === Kind.Expel ? 'Execute expulsion' : 'Execute payout', 'Executing…')}
              </Button>
            )}
            {p.approved && p.kind === Kind.TreasuryTroops && !wrongTarget && (
              <Button
                busy={act.inFlight}
                onClick={() =>
                  void act.run({ address: config.addresses.Realm, abi: config.abis.Realm, functionName: 'buyTroopsFromTreasury', args: [BigInt(p.id)] })
                }
              >
                {busyLabel(act.state, 'Buy troops from treasury', 'Buying…')}
              </Button>
            )}
            {p.approved && p.kind === Kind.Attack && !wrongTarget && (
              <div className="stack" style={{ gap: 'var(--space-1)' }}>
                <Button
                  variant="primary"
                  busy={act.inFlight}
                  onClick={() => void act.run({ address: config.addresses.Realm, abi: config.abis.Realm, functionName: 'declareAttack', args: [BigInt(p.id)] })}
                >
                  {busyLabel(act.state, `Declare attack on ${tileLabel(Number(p.data1))}`, 'Declaring…')}
                </Button>
                <p className="small muted">Commits the troops in the current epoch. Fails if the holder changed or the reserve is short.</p>
              </div>
            )}
            {p.approved && p.kind === Kind.Pact && !wrongTarget && game.children && (
              <div className="stack" style={{ gap: 'var(--space-1)' }}>
                {offers.length === 0 ? (
                  <p className="small muted">
                    Waiting for <GuildTag id={Number(p.data1)} /> to approve a matching pact proposal naming this guild with the same length and a bond of at
                    least {formatAmount(p.data3)} PACT.
                  </p>
                ) : (
                  offers.map((q) => (
                    <Button
                      key={q.id}
                      variant="primary"
                      busy={act.inFlight}
                      onClick={() =>
                        void act.run({
                          address: game.children!.Diplomacy,
                          abi: config.abis.Diplomacy,
                          functionName: 'sign',
                          args: [BigInt(p.id), BigInt(q.id)],
                        })
                      }
                    >
                      {busyLabel(act.state, `Sign pact with offer #${q.id} (bond ${formatAmount(q.amount)} PACT)`, 'Signing…')}
                    </Button>
                  ))
                )}
              </div>
            )}
            <TxStatus state={act.state} successText="Done." />
          </div>
        </ActionGate>
      )}
    </li>
  );
}
