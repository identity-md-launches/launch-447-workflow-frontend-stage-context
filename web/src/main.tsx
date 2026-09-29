import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadAppConfig } from './config/deployment';
import { makePublicClient, POLL_INTERVAL_MS } from './lib/client';
import { WalletStore } from './lib/wallet';
import { AppContext } from './state/app';
import { GameStore } from './state/store';
import { App } from './App';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

function renderFatal(message: string) {
  root.render(
    <main className="container" style={{ paddingBlock: '2rem' }}>
      <h1>Pacts</h1>
      <p role="alert" style={{ marginBlockStart: '1rem' }}>
        Unable to start: {message}
      </p>
      <p className="small muted" style={{ marginBlockStart: '0.5rem' }}>
        The deployment configuration next to this page could not be loaded. Reload the page or open it from its original location.
      </p>
    </main>,
  );
}

async function boot() {
  try {
    const config = await loadAppConfig('./');
    const publicClient = makePublicClient(config);
    const wallet = new WalletStore();
    const game = new GameStore(config, publicClient, POLL_INTERVAL_MS);
    wallet.discover();
    game.start();
    root.render(
      <StrictMode>
        <AppContext.Provider value={{ config, publicClient, wallet, game }}>
          <App />
        </AppContext.Provider>
      </StrictMode>,
    );
  } catch (e) {
    renderFatal(e instanceof Error ? e.message : String(e));
  }
}

void boot();
