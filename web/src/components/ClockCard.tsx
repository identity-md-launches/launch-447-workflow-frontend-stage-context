import { useEffect, useState } from 'react';
import { formatAmount, formatBps, formatDuration } from '../lib/format';
import { epochEnd } from '../lib/game';
import { useGame } from '../state/app';
import { Card } from './ui';

function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function ClockCard() {
  const game = useGame();
  const now = useNow();
  const c = game.clock;
  if (!c) {
    return (
      <Card title="Clock">
        <p className="muted small">Loading the epoch clock…</p>
      </Card>
    );
  }
  const end = Number(epochEnd(c, c.currentEpoch));
  const seasonEndTs = Number(c.genesis + (c.currentSeason + 1n) * c.seasonLength);
  const unsettled = c.currentEpoch - c.settledEpochs;
  return (
    <Card title="Clock">
      <div className="fields">
        <div className="stat">
          <span className="label">Epoch</span>
          <span className="value">{c.currentEpoch.toString()}</span>
        </div>
        <div className="stat">
          <span className="label">Ends in</span>
          <span className="value">{formatDuration(end - now)}</span>
        </div>
        <div className="stat">
          <span className="label">Season</span>
          <span className="value">{c.currentSeason.toString()}</span>
        </div>
        <div className="stat">
          <span className="label">Season ends in</span>
          <span className="value">{formatDuration(seasonEndTs - now)}</span>
        </div>
      </div>
      <dl className="kv">
        <dt>Settled epochs</dt>
        <dd>
          {c.settledEpochs.toString()}
          {unsettled > 0n ? ` (${unsettled.toString()} ended, awaiting settlement)` : ' (up to date)'}
        </dd>
        <dt>Income this epoch</dt>
        <dd>{formatAmount(c.currentIncomePool)} PACT{c.incomeCarry > 0n ? ` + ${formatAmount(c.incomeCarry)} carried` : ''}</dd>
        <dt>Held tiles</dt>
        <dd>{c.heldTiles.toString()} of 144</dd>
        <dt>Troop price</dt>
        <dd>
          {formatAmount(c.troopPrice)} PACT, {formatBps(c.feeBps)} to the season pool
        </dd>
      </dl>
      {c.progress.started && (
        <p className="small muted">
          A stepwise settlement is in progress: {c.progress.tilesDone.toString()} of {c.progress.tilesTotal.toString()} tiles resolved.
        </p>
      )}
    </Card>
  );
}
