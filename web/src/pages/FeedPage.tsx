import { useMemo, useState } from 'react';
import { describeEvent } from '../components/feed';
import { Card, EmptyState, Field, Notice, TxLink } from '../components/ui';
import { useGame } from '../state/app';

const CONTRACTS = ['All', 'Guilds', 'Realm', 'Diplomacy', 'Season', 'Banners'] as const;
const PAGE = 100;

export function FeedPage() {
  const game = useGame();
  const [filter, setFilter] = useState<(typeof CONTRACTS)[number]>('All');
  const [limit, setLimit] = useState(PAGE);
  const items = useMemo(() => {
    const list = filter === 'All' ? game.feed : game.feed.filter((f) => f.contract === filter);
    return [...list].reverse();
  }, [game.feed, filter]);
  return (
    <>
      <div>
        <h1 className="page-title">Events</h1>
        <p className="page-intro">
          Every action emits an event. This feed is rebuilt from the contract logs since deployment, newest first
          {game.logsSynced !== null && <span className="num"> (synced to block {game.logsSynced.toString()})</span>}.
        </p>
      </div>
      <Card>
        <div className="fields">
          <Field id="feed-filter" label="Contract">
            {(p) => (
              <select {...p} className="input" value={filter} onChange={(e) => setFilter(e.target.value as (typeof CONTRACTS)[number])}>
                {CONTRACTS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        {game.logsError && (
          <Notice kind="warning" role="status">
            Unable to load events: {game.logsError}. The next refresh retries.
          </Notice>
        )}
        {items.length === 0 ? (
          game.logsSynced === null && !game.logsError ? (
            <p role="status" className="small muted">
              Loading events…
            </p>
          ) : (
            <EmptyState title="No events yet" body={filter === 'All' ? 'Nothing has happened in the realm so far.' : `No ${filter} events. Choose another contract.`} />
          )
        ) : (
          <ol className="list" style={{ gap: 0 }} aria-label="Event feed">
            {items.slice(0, limit).map((f) => (
              <li key={f.key} className="feed-item">
                <span>{describeEvent(f, game.guilds)}</span>
                <span className="feed-meta">
                  <span>
                    {f.contract}.{f.event}
                  </span>
                  <span className="num">block {f.blockNumber.toString()}</span>
                  <TxLink hash={f.txHash} />
                </span>
              </li>
            ))}
          </ol>
        )}
        {items.length > limit && (
          <button type="button" className="btn" onClick={() => setLimit((l) => l + PAGE)}>
            Show {Math.min(PAGE, items.length - limit)} more of {items.length - limit} older events
          </button>
        )}
      </Card>
    </>
  );
}
