import { formatAmount } from '../lib/format';
import { Kind, PactStatus, PACT_STATUS_LABEL } from '../lib/game';
import { useApp, useGame } from '../state/app';
import { useTx } from '../state/tx';
import { ActionGate } from '../components/WalletBar';
import { ProposalCard } from '../components/ProposalCard';
import { Button, Card, EmptyState, GuildTag, TxLink, TxStatus, busyLabel } from '../components/ui';

export function DiplomacyPage() {
  const game = useGame();
  const offers = game.proposals.filter((p) => p.kind === Kind.Pact && p.approved && !p.executed && !p.expired);
  const pending = game.proposals.filter((p) => p.kind === Kind.Pact && !p.approved && !p.executed && !p.expired);
  return (
    <>
      <div>
        <h1 className="page-title">Diplomacy</h1>
        <p className="page-intro">
          Two guilds sign a pact by each approving a Pact proposal that names the other with the same length and an acceptable bond. Bonds are
          locked in Diplomacy; if a guild attacks its partner during the pact, both bonds go to the victim. Unbroken pacts return their bonds
          once expired.
        </p>
      </div>
      <div className="grid-2">
        <div className="stack-lg">
          <Card title={`Pacts (${game.pacts.length})`}>
            {game.pacts.length === 0 ? (
              <EmptyState title="No pacts signed yet" body="Approved pact offers appear on the right. Anyone can sign a matching pair." />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Pact</th>
                      <th scope="col">Guilds and bonds</th>
                      <th scope="col">Epochs</th>
                      <th scope="col">Status</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {game.pacts.map((p) => (
                      <tr key={p.id}>
                        <td className="num">#{p.id}</td>
                        <td>
                          <div>
                            <GuildTag id={p.guildA} /> <span className="muted num">{formatAmount(p.bondA)} PACT</span>
                          </div>
                          <div>
                            <GuildTag id={p.guildB} /> <span className="muted num">{formatAmount(p.bondB)} PACT</span>
                          </div>
                        </td>
                        <td className="num">
                          {p.startEpoch.toString()} to {p.endEpoch.toString()}
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              p.status === PactStatus.Active ? 'badge-success' : p.status === PactStatus.Broken ? 'badge-danger' : ''
                            }`}
                          >
                            {PACT_STATUS_LABEL[p.status] ?? 'Unknown'}
                          </span>
                        </td>
                        <td>{p.status === PactStatus.Active && <ExpireButton pactId={p.id} endEpoch={p.endEpoch} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card title={`Betrayals (${game.betrayals.length})`}>
            {game.betrayals.length === 0 ? (
              <p className="small muted">No pact has been broken.</p>
            ) : (
              <ul className="list">
                {game.betrayals.map((b) => (
                  <li key={`${b.pactId}-${b.epoch}-${b.txHash}`} className="list-item small">
                    <span>
                      <GuildTag id={b.betrayer} /> attacked pact partner <GuildTag id={b.victim} /> in epoch {b.epoch.toString()}.{' '}
                      {formatAmount(b.slashed)} PACT was paid to the victim (pact #{b.pactId}).
                    </span>
                    <span className="feed-meta">
                      <TxLink hash={b.txHash} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="stack-lg">
          <Card title={`Open pact offers (${offers.length})`}>
            {offers.length === 0 ? (
              <EmptyState
                title="No approved offers"
                body="A guild member creates a Pact proposal on the guild page. Once it has a majority it appears here for matching."
                action={
                  <a className="btn" href="#/guilds">
                    Open guilds
                  </a>
                }
              />
            ) : (
              <ul className="list">
                {offers.map((p) => (
                  <ProposalCard key={p.id} p={p} showGuild />
                ))}
              </ul>
            )}
          </Card>
          {pending.length > 0 && (
            <Card title={`Pact proposals still voting (${pending.length})`}>
              <ul className="list">
                {pending.map((p) => (
                  <ProposalCard key={p.id} p={p} showGuild />
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function ExpireButton({ pactId, endEpoch }: { pactId: number; endEpoch: bigint }) {
  const { config } = useApp();
  const game = useGame();
  const tx = useTx();
  const ended = game.clock ? game.clock.currentEpoch > endEpoch : false;
  if (!ended) return <span className="small muted">runs until epoch {endEpoch.toString()}</span>;
  return (
    <ActionGate compact>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <Button
          small
          busy={tx.inFlight}
          disabled={!game.children}
          onClick={() => void tx.run({ address: game.children!.Diplomacy, abi: config.abis.Diplomacy, functionName: 'expire', args: [BigInt(pactId)] })}
        >
          {busyLabel(tx.state, 'Expire and return bonds', 'Expiring…')}
        </Button>
        <TxStatus state={tx.state} successText="Pact expired; bonds returned." />
      </div>
    </ActionGate>
  );
}
