import { useMemo, useRef, useState } from 'react';
import { MAP_SIZE, TILE_COUNT, tileLabel } from '../lib/format';
import { guildHue, Kind, PactStatus } from '../lib/game';
import { useApp, useGame } from '../state/app';
import { useTx } from '../state/tx';
import { ClockCard } from '../components/ClockCard';
import { ActionGate } from '../components/WalletBar';
import { Button, Card, EmptyState, Field, GuildTag, Notice, TxStatus, busyLabel } from '../components/ui';

export function MapPage() {
  const game = useGame();
  const [selected, setSelected] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);

  const attackedTiles = useMemo(() => {
    const set = new Set<number>();
    for (const a of game.attacks) set.add(a.tile);
    return set;
  }, [game.attacks]);

  const guildsWithTiles = useMemo(() => game.guilds.filter((g) => g.tiles > 0).sort((a, b) => b.tiles - a.tiles), [game.guilds]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    let next = focusIndex;
    if (e.key === 'ArrowRight') next = Math.min(TILE_COUNT - 1, focusIndex + 1);
    else if (e.key === 'ArrowLeft') next = Math.max(0, focusIndex - 1);
    else if (e.key === 'ArrowDown') next = Math.min(TILE_COUNT - 1, focusIndex + MAP_SIZE);
    else if (e.key === 'ArrowUp') next = Math.max(0, focusIndex - MAP_SIZE);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TILE_COUNT - 1;
    else return;
    e.preventDefault();
    setFocusIndex(next);
    (gridRef.current?.children[next] as HTMLElement | undefined)?.focus();
  };

  const tiles = game.tiles.length === TILE_COUNT ? game.tiles : Array.from({ length: TILE_COUNT }, () => ({ holder: 0, garrison: 0n }));

  return (
    <>
      <div>
        <h1 className="page-title">Map</h1>
        <p className="page-intro">
          144 tiles on a 12 by 12 map. Each tile shows its holder's guild number and garrison. A red dot marks a tile under attack in an
          unsettled epoch. Select a tile to see who holds it and to propose an attack for your guild.
        </p>
      </div>
      <div className="grid-2">
        <div className="map-wrap">
          <div
            ref={gridRef}
            className="map-grid"
            role="grid"
            aria-label="Realm map, 12 by 12 tiles. Use the arrow keys to move between tiles."
            onKeyDown={onKeyDown}
          >
            {tiles.map((t, i) => {
              const hue = guildHue(t.holder);
              const g = game.guilds.find((x) => x.id === t.holder);
              const name = t.holder > 0 ? g?.name ?? `guild ${t.holder}` : 'empty';
              const label = `Tile ${tileLabel(i)}: ${t.holder > 0 ? `held by ${name} with ${t.garrison.toString()} troops` : 'empty'}${
                attackedTiles.has(i) ? ', under attack' : ''
              }`;
              return (
                <button
                  key={i}
                  type="button"
                  role="gridcell"
                  className={`tile${attackedTiles.has(i) ? ' attacked' : ''}`}
                  style={hue >= 0 ? { background: `var(--guild-${hue})` } : undefined}
                  aria-label={label}
                  aria-pressed={selected === i}
                  tabIndex={i === focusIndex ? 0 : -1}
                  onFocus={() => setFocusIndex(i)}
                  onClick={() => setSelected(selected === i ? null : i)}
                >
                  {t.holder > 0 ? (
                    <>
                      <span aria-hidden="true">{t.holder}</span>
                      <span className="garrison" aria-hidden="true">
                        {t.garrison.toString()}
                      </span>
                    </>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="map-legend" aria-label="Guilds holding tiles">
            {guildsWithTiles.length === 0 ? (
              <span className="muted small">No guild holds a tile yet. The first approved attack on an empty tile takes it.</span>
            ) : (
              guildsWithTiles.map((g) => (
                <span key={g.id} className="legend-item">
                  <GuildTag id={g.id} />
                  <span className="muted num">· {g.tiles}</span>
                </span>
              ))
            )}
          </div>
        </div>
        <div className="stack-lg">
          <ClockCard />
          <TileDetails tileId={selected} />
        </div>
      </div>
    </>
  );
}

function TileDetails({ tileId }: { tileId: number | null }) {
  const game = useGame();
  if (tileId === null) {
    return (
      <Card title="Tile">
        <EmptyState title="No tile selected" body="Select a tile on the map to see its holder, garrison and pending attacks, or to propose an attack." />
      </Card>
    );
  }
  const tile = game.tiles[tileId] ?? { holder: 0, garrison: 0n };
  const attacks = game.attacks.filter((a) => a.tile === tileId);
  return (
    <Card title={`Tile ${tileLabel(tileId)}`}>
      <dl className="kv">
        <dt>Holder</dt>
        <dd>{tile.holder > 0 ? <GuildTag id={tile.holder} /> : 'Empty'}</dd>
        <dt>Garrison</dt>
        <dd>{tile.garrison.toString()} troops</dd>
      </dl>
      {attacks.length > 0 && (
        <div className="stack" style={{ gap: 'var(--space-1)' }}>
          <h3 className="small">Pending attacks</h3>
          <ul className="list">
            {attacks.map((a) => (
              <li key={`${a.epoch}-${a.proposalId}`} className="small">
                <GuildTag id={a.attacker} /> with {a.troops.toString()} troops in epoch {a.epoch.toString()} (proposal #{a.proposalId})
              </li>
            ))}
          </ul>
        </div>
      )}
      <ProposeAttack tileId={tileId} holder={tile.holder} />
    </Card>
  );
}

function ProposeAttack({ tileId, holder }: { tileId: number; holder: number }) {
  const { config } = useApp();
  const game = useGame();
  const tx = useTx();
  const [troops, setTroops] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const player = game.player;
  const myGuild = game.guilds.find((g) => g.id === player?.guildId);

  const activePact = useMemo(() => {
    if (!player || player.guildId === 0 || holder === 0 || !game.clock) return null;
    return (
      game.pacts.find(
        (p) =>
          p.status === PactStatus.Active &&
          ((p.guildA === player.guildId && p.guildB === holder) || (p.guildB === player.guildId && p.guildA === holder)) &&
          p.endEpoch >= game.clock!.currentEpoch,
      ) ?? null
    );
  }, [game.pacts, game.clock, player, holder]);

  const submit = async () => {
    setError(null);
    const n = /^\d+$/.test(troops.trim()) ? BigInt(troops.trim()) : null;
    if (n === null || n <= 0n) {
      setError('Enter a whole number of troops, at least 1.');
      return;
    }
    if (myGuild && n > myGuild.reserve) {
      setError(`The guild reserve holds ${myGuild.reserve.toString()} troops. Buy more or commit fewer.`);
      return;
    }
    await tx.run({
      address: config.addresses.Guilds,
      abi: config.abis.Guilds,
      functionName: 'propose',
      args: [Kind.Attack, config.addresses.Realm, 0n, BigInt(tileId), BigInt(holder), n],
    });
  };

  return (
    <div className="stack">
      <h3 className="small">Propose an attack</h3>
      <ActionGate compact>
        {!player || player.guildId === 0 ? (
          <EmptyState
            title="Join a guild to attack"
            body="Attacks are guild votes. Found or join a guild, buy troops, then propose the attack here."
            action={
              <a className="btn" href="#/guilds">
                Open guilds
              </a>
            }
          />
        ) : holder === player.guildId ? (
          <p className="small muted">Your guild holds this tile. Garrisons cannot be reinforced; hold it by winning fights.</p>
        ) : (
          <>
            <p className="small muted">
              Creates an Attack proposal for {myGuild?.name ?? 'your guild'} naming tile {tileLabel(tileId)} and its current holder. It needs a
              majority of members who joined before now, then anyone declares it during an epoch. Reserve: {myGuild?.reserve.toString() ?? '0'} troops.
            </p>
            {activePact && (
              <Notice kind="warning">
                Your guild has an active pact with this tile's holder until epoch {activePact.endEpoch.toString()}. Declaring this attack would be a
                betrayal: both bonds go to the victim.
              </Notice>
            )}
            <div className="fields">
              <Field id={`attack-troops-${tileId}`} label="Troops to commit" error={error}>
                {(p) => <input {...p} className="input" inputMode="numeric" autoComplete="off" value={troops} onChange={(e) => setTroops(e.target.value)} />}
              </Field>
            </div>
            <Button variant="primary" onClick={submit} busy={tx.inFlight}>
              {busyLabel(tx.state, 'Propose attack', 'Proposing…')}
            </Button>
            <TxStatus state={tx.state} successText="Attack proposed. Members can now vote on the guild page." />
          </>
        )}
      </ActionGate>
    </div>
  );
}
