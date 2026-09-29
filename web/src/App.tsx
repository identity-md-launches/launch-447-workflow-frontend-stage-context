import { useEffect } from 'react';
import { explorerAddressUrl } from './config/deployment';
import { useApp, useGame, useHashRoute, useWallet } from './state/app';
import { WalletBar } from './components/WalletBar';
import { Button, Notice } from './components/ui';
import { MapPage } from './pages/MapPage';
import { GuildsPage } from './pages/GuildsPage';
import { GuildDetailPage } from './pages/GuildDetailPage';
import { DiplomacyPage } from './pages/DiplomacyPage';
import { SeasonPage } from './pages/SeasonPage';
import { FeedPage } from './pages/FeedPage';
import { SwapPage } from './pages/SwapPage';
import { PlayPage } from './pages/PlayPage';

const NAV: { href: string; label: string }[] = [
  { href: '#/', label: 'Map' },
  { href: '#/guilds', label: 'Guilds' },
  { href: '#/diplomacy', label: 'Diplomacy' },
  { href: '#/season', label: 'Season' },
  { href: '#/feed', label: 'Events' },
  { href: '#/play', label: 'Play' },
  { href: '#/swap', label: 'Swap' },
];

function routeMatches(current: string, href: string): boolean {
  if (href === '#/') return current === '#/' || current === '#' || current === '';
  return current === href || current.startsWith(`${href}/`);
}

export function App() {
  const { config, game } = useApp();
  const wallet = useWallet();
  const snap = useGame();
  const route = useHashRoute();

  useEffect(() => {
    game.setPlayer(wallet.status === 'connected' ? wallet.address : null);
  }, [game, wallet.status, wallet.address]);

  useEffect(() => {
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [route]);

  let page: React.ReactNode;
  const guildMatch = /^#\/guilds\/(\d+)$/.exec(route);
  if (guildMatch) page = <GuildDetailPage guildId={Number(guildMatch[1])} />;
  else if (routeMatches(route, '#/guilds')) page = <GuildsPage />;
  else if (routeMatches(route, '#/diplomacy')) page = <DiplomacyPage />;
  else if (routeMatches(route, '#/season')) page = <SeasonPage />;
  else if (routeMatches(route, '#/feed')) page = <FeedPage />;
  else if (routeMatches(route, '#/swap')) page = <SwapPage />;
  else if (routeMatches(route, '#/play')) page = <PlayPage />;
  else page = <MapPage />;

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <div className="container">
          <a href="#/" className="brand">
            Pacts
            <span className="brand-badge">{config.chain.name}</span>
          </a>
          <nav className="site-nav" aria-label="Sections">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} aria-current={routeMatches(route, n.href) ? 'page' : undefined}>
                {n.label}
              </a>
            ))}
          </nav>
          <WalletBar />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="container stack-lg" style={{ outline: 'none' }}>
        {snap.status === 'error' && (
          <Notice kind="danger" role="alert">
            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <span>Unable to read chain state from the public RPCs: {snap.error}</span>
              <Button small onClick={() => void game.refresh()}>
                Retry
              </Button>
            </div>
          </Notice>
        )}
        {snap.status === 'ready' && snap.error && (
          <Notice kind="warning" role="status">
            The last refresh failed ({snap.error}). Showing the previous state.
          </Notice>
        )}
        <p role="status" className="visually-hidden">
          {snap.status === 'loading' ? 'Loading chain state' : snap.status === 'ready' ? 'Chain state loaded' : ''}
        </p>
        {page}
      </main>
      <footer className="site-footer">
        <div className="container stack">
          <ul className="footer-list">
            {config.deployment.contracts.map((c) => (
              <li key={c.name}>
                <span>{c.name}: </span>
                <a href={explorerAddressUrl(config, c.address) ?? '#'} target="_blank" rel="noreferrer" className="mono break">
                  {c.address}
                </a>
              </li>
            ))}
            {snap.children &&
              (['Diplomacy', 'Season', 'Banners'] as const).map((name) => (
                <li key={name}>
                  <span>{name}: </span>
                  <a href={explorerAddressUrl(config, snap.children![name]) ?? '#'} target="_blank" rel="noreferrer" className="mono break">
                    {snap.children![name]}
                  </a>
                </li>
              ))}
          </ul>
          <p className="small">
            Launch {config.deployment.launchId} · source commit <span className="mono">{config.deployment.sourceCommit.slice(0, 12)}</span> ·
            reads through {config.rpcUrls.length} public RPC endpoint{config.rpcUrls.length === 1 ? '' : 's'}; signing stays in your wallet.
            {config.faucets.length > 0 && (
              <>
                {' '}
                Test ETH:{' '}
                {config.faucets.map((f, i) => (
                  <span key={f}>
                    {i > 0 && ', '}
                    <a href={f} target="_blank" rel="noreferrer">
                      faucet {i + 1}
                    </a>
                  </span>
                ))}
                .
              </>
            )}
          </p>
        </div>
      </footer>
    </>
  );
}
