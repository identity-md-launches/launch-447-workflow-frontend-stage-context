import { useState } from 'react';
import { formatAmount, formatTimestamp } from '../lib/format';
import { useApp, useGame } from '../state/app';
import { useTx } from '../state/tx';
import { ActionGate } from '../components/WalletBar';
import { Button, Card, EmptyState, Field, GuildTag, Notice, TxStatus, busyLabel } from '../components/ui';

export function MembershipRiskNotice() {
  return (
    <Notice kind="warning">
      Membership is open by design. Anyone can join any guild, one member is one vote, and a majority of newly joined wallets can vote the whole
      treasury to any address or expel founders. Wallets joining in the last second of a season share its prizes equally. Fund a guild only with
      what you are prepared to lose to its future majority.
    </Notice>
  );
}

export function GuildsPage() {
  const game = useGame();
  const guilds = [...game.guilds].sort((a, b) => b.tiles - a.tiles || a.id - b.id);
  return (
    <>
      <div>
        <h1 className="page-title">Guilds</h1>
        <p className="page-intro">
          Guilds pool troops and treasury and act only by majority vote. Open a guild to see its members, treasury, pending votes and pacts.
        </p>
      </div>
      <div className="grid-2">
        <Card title="All guilds">
          {guilds.length === 0 ? (
            <EmptyState title="No guilds yet" body="The realm is empty. Found the first guild to start playing." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Guild</th>
                    <th scope="col" className="num">
                      Members
                    </th>
                    <th scope="col" className="num">
                      Tiles
                    </th>
                    <th scope="col" className="num">
                      Reserve
                    </th>
                    <th scope="col" className="num">
                      Treasury (PACT)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {guilds.map((g) => (
                    <tr key={g.id}>
                      <td>
                        <GuildTag id={g.id} />
                        <div className="small muted">founded {formatTimestamp(g.foundedAt)}</div>
                      </td>
                      <td className="num">{g.memberCount}</td>
                      <td className="num">{g.tiles}</td>
                      <td className="num">{g.reserve.toString()}</td>
                      <td className="num">
                        {formatAmount(g.treasury)}
                        {g.pendingIncome > 0n && <div className="small muted">+{formatAmount(g.pendingIncome)} uncollected</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <FoundGuildCard />
      </div>
    </>
  );
}

function FoundGuildCard() {
  const { config } = useApp();
  const game = useGame();
  const tx = useTx();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const player = game.player;
  const bytes = new TextEncoder().encode(name).length;

  const submit = async () => {
    setError(null);
    if (bytes === 0 || bytes > 32) {
      setError('Use a name of 1 to 32 bytes.');
      return;
    }
    const hash = await tx.run({ address: config.addresses.Guilds, abi: config.abis.Guilds, functionName: 'found', args: [name] });
    if (hash) setName('');
  };

  return (
    <Card title="Found a guild">
      <p className="small muted">Founding is free apart from gas. You become its first member and its first vote.</p>
      <MembershipRiskNotice />
      <ActionGate>
        {player && player.guildId > 0 ? (
          <p className="small">
            You are a member of <GuildTag id={player.guildId} />. Leave it before founding another.
          </p>
        ) : (
          <>
            <Field id="found-name" label="Guild name" hint={`${bytes} of 32 bytes`} error={error}>
              {(p) => <input {...p} className="input" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />}
            </Field>
            <Button variant="primary" onClick={submit} busy={tx.inFlight}>
              {busyLabel(tx.state, 'Found guild', 'Founding…')}
            </Button>
          </>
        )}
        <TxStatus state={tx.state} successText="Guild founded." />
      </ActionGate>
    </Card>
  );
}
