import { useState } from 'react';
import { formatAmount, formatTimestamp } from '../lib/format';
import { BannerKind, type SeasonInfo } from '../lib/game';
import { useApp, useGame } from '../state/app';
import { useTx } from '../state/tx';
import { ActionGate } from '../components/WalletBar';
import { AddressLink, Button, Card, EmptyState, Field, GuildTag, Notice, TxLink, TxStatus, busyLabel } from '../components/ui';

const SHARES = ['50%', '30%', '20%'];

export function SeasonPage() {
  const game = useGame();
  const current = game.clock ? Number(game.clock.currentSeason) : null;
  const live = [...game.guilds].sort((a, b) => b.tiles - a.tiles || a.id - b.id).slice(0, 5);
  return (
    <>
      <div>
        <h1 className="page-title">Season</h1>
        <p className="page-intro">
          Every troop purchase pays a fee into the season prize pool. When the season's last epoch is settled, anyone can close the season and the
          top three guilds by tiles held split 50/30/20, shared equally among the members they had at the season's last second. Winners and
          peaceful guilds receive banners.
        </p>
      </div>
      <div className="grid-2">
        <div className="stack-lg">
          <Card title={current === null ? 'Current season' : `Current season ${current}`}>
            {game.seasons[0] && (
              <dl className="kv">
                <dt>Prize pool</dt>
                <dd>{formatAmount(game.seasons[0].pool)} PACT</dd>
                <dt>Ends</dt>
                <dd>{formatTimestamp(game.seasons[0].end)}</dd>
              </dl>
            )}
            <h3 className="small">Live standings by tiles held</h3>
            {live.length === 0 || live.every((g) => g.tiles === 0) ? (
              <p className="small muted">No guild holds a tile yet.</p>
            ) : (
              <ol className="list" style={{ gap: 'var(--space-1)' }}>
                {live
                  .filter((g) => g.tiles > 0)
                  .map((g, i) => (
                    <li key={g.id} className="row small">
                      <span className="num" style={{ minWidth: '1.5rem' }}>
                        {i + 1}.
                      </span>
                      <GuildTag id={g.id} />
                      <span className="muted num">{g.tiles} tiles</span>
                      {i < 3 && <span className="badge">{SHARES[i]}</span>}
                    </li>
                  ))}
              </ol>
            )}
            <p className="small muted">Ties rank the older guild higher. Standings are fixed only when the season's last epoch is settled.</p>
          </Card>
          {game.seasons.map((s) => (
            <SeasonCard key={s.season} s={s} isCurrent={s.season === current} />
          ))}
        </div>
        <div className="stack-lg">
          <Card title={`Banners (${game.banners.length})`}>
            {game.banners.length === 0 ? (
              <EmptyState title="No banners yet" body="Winner banners are minted on claim; Peace banners for guilds that ended a season without betraying a pact." />
            ) : (
              <ul className="list">
                {game.banners.map((b) => (
                  <li key={b.tokenId.toString()} className="list-item small">
                    <span>
                      <strong>Banner #{b.tokenId.toString()}</strong>{' '}
                      <span className={`badge ${b.kind === BannerKind.Winner ? 'badge-accent' : 'badge-success'}`}>
                        {b.kind === BannerKind.Winner ? `Winner, rank ${b.rank}` : 'Peace'}
                      </span>
                    </span>
                    <span>
                      Season {b.season}, <GuildTag id={b.guildId} />, held by <AddressLink address={b.to} />
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
      </div>
    </>
  );
}

function SeasonCard({ s, isCurrent }: { s: SeasonInfo; isCurrent: boolean }) {
  const { config } = useApp();
  const game = useGame();
  const close = useTx();
  const claim = useTx();
  const peace = useTx();
  const [peaceGuild, setPeaceGuild] = useState('');
  const player = game.player;
  const previousClosed = s.season === 0 || (game.seasons.find((x) => x.season === s.season - 1)?.result.closed ?? true);
  const canClose = s.ended && s.lastEpochSettled && !s.result.closed && previousClosed;

  return (
    <Card title={`Season ${s.season}${isCurrent ? ' (in progress)' : ''}`}>
      <dl className="kv">
        <dt>Prize pool</dt>
        <dd>{formatAmount(s.result.closed ? s.result.pool : s.pool)} PACT</dd>
        <dt>Status</dt>
        <dd>
          {!s.ended
            ? `Ends ${formatTimestamp(s.end)}`
            : !s.lastEpochSettled
              ? 'Ended; settle the last epoch to fix standings'
              : s.result.closed
                ? 'Closed'
                : previousClosed
                  ? 'Ended and recorded; ready to close'
                  : 'Ended; close the previous season first'}
        </dd>
      </dl>
      {s.standings.recorded && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Guild</th>
                <th scope="col" className="num">
                  Tiles
                </th>
                <th scope="col" className="num">
                  Prize
                </th>
                <th scope="col" className="num">
                  Per member
                </th>
              </tr>
            </thead>
            <tbody>
              {s.standings.guildIds.map((gid, i) =>
                gid > 0 ? (
                  <tr key={i}>
                    <td className="num">{i + 1}</td>
                    <td>
                      <GuildTag id={gid} />
                    </td>
                    <td className="num">{s.standings.tiles[i]!.toString()}</td>
                    <td className="num">{s.result.closed ? `${formatAmount(s.result.guildPrize[i]!)} PACT` : SHARES[i]}</td>
                    <td className="num">
                      {s.result.closed ? `${formatAmount(s.result.perMember[i]!)} PACT (${s.result.memberCount[i]!.toString()} members)` : '—'}
                    </td>
                  </tr>
                ) : null,
              )}
            </tbody>
          </table>
        </div>
      )}
      {s.result.closed && s.result.rollover > 0n && <p className="small muted">{formatAmount(s.result.rollover)} PACT rolled over to the next season.</p>}
      {!isCurrent && (
        <ActionGate compact>
          <div className="stack">
            {!s.result.closed && (
              <div className="stack" style={{ gap: 'var(--space-1)' }}>
                <Button
                  variant="primary"
                  disabled={!canClose || !game.children}
                  busy={close.inFlight}
                  onClick={() => void close.run({ address: game.children!.Season, abi: config.abis.Season, functionName: 'close', args: [BigInt(s.season)] })}
                >
                  {busyLabel(close.state, `Close season ${s.season}`, 'Closing…')}
                </Button>
                {!canClose && <p className="small muted">Closing needs the season ended, its last epoch settled and the previous season closed.</p>}
                <TxStatus state={close.state} successText="Season closed. Winners can claim." />
              </div>
            )}
            {s.result.closed && (
              <div className="stack" style={{ gap: 'var(--space-1)' }}>
                <h3 className="small">Claim your share</h3>
                {s.result.guildIds.filter((g) => g > 0).length === 0 ? (
                  <p className="small muted">No guild placed this season.</p>
                ) : (
                  s.result.guildIds
                    .map((gid, i) => ({ gid, i }))
                    .filter(({ gid }) => gid > 0)
                    .map(({ gid, i }) => {
                      const done = player?.claimed[`${s.season}:${gid}`] ?? false;
                      return (
                        <div key={gid} className="row">
                          <Button
                            disabled={done || !game.children}
                            busy={claim.inFlight}
                            onClick={() =>
                              void claim.run({
                                address: game.children!.Season,
                                abi: config.abis.Season,
                                functionName: 'claim',
                                args: [BigInt(s.season), BigInt(gid)],
                              })
                            }
                          >
                            {done ? `Claimed for rank ${i + 1}` : busyLabel(claim.state, `Claim ${formatAmount(s.result.perMember[i]!)} PACT as rank ${i + 1}`, 'Claiming…')}
                          </Button>
                          <GuildTag id={gid} />
                        </div>
                      );
                    })
                )}
                <p className="small muted">Only wallets that were members of the guild at the season's last second can claim; each claim also mints a Winner banner.</p>
                <TxStatus state={claim.state} successText="Prize claimed and banner minted." />
              </div>
            )}
            {s.ended && (
              <div className="stack" style={{ gap: 'var(--space-1)' }}>
                <h3 className="small">Mint a Peace banner</h3>
                <div className="fields">
                  <Field id={`peace-${s.season}`} label="Guild" hint="A guild that existed at season end and broke no pact during the season">
                    {(p) => (
                      <select {...p} className="input" value={peaceGuild} onChange={(e) => setPeaceGuild(e.target.value)}>
                        <option value="">Choose a guild</option>
                        {game.guilds.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name} (#{g.id})
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                </div>
                <Button
                  disabled={!peaceGuild || !game.children}
                  busy={peace.inFlight}
                  onClick={() =>
                    void peace.run({
                      address: game.children!.Season,
                      abi: config.abis.Season,
                      functionName: 'mintPeaceBanner',
                      args: [BigInt(s.season), BigInt(peaceGuild)],
                    })
                  }
                >
                  {busyLabel(peace.state, 'Mint Peace banner', 'Minting…')}
                </Button>
                <TxStatus state={peace.state} successText="Peace banner minted to the Guilds contract for the guild." />
              </div>
            )}
          </div>
        </ActionGate>
      )}
      {isCurrent && (
        <Notice kind="info">Late joiners share prizes: a wallet that joins a winning guild one second before the season ends receives an equal share.</Notice>
      )}
    </Card>
  );
}
