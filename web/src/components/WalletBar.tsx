import { useEffect, useRef, useState, type ReactNode } from 'react';
import { describeError } from '../lib/errors';
import { useApp, useWallet } from '../state/app';
import { AddressLink, Button, Notice } from './ui';

/** Connect / switch controls in the header. One primary action at a time. */
export function WalletBar() {
  const { config, wallet } = useApp();
  const w = useWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !triggerRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [menuOpen]);

  const wrongChain = w.status === 'connected' && w.chainId !== config.chain.id;

  const switchChain = async () => {
    setSwitching(true);
    setSwitchError(null);
    try {
      await wallet.switchChain(config.chainIdHex, config.walletAddChain);
    } catch (e) {
      setSwitchError(describeError(e));
    } finally {
      setSwitching(false);
    }
  };

  if (w.status === 'connected' && w.address) {
    return (
      <div className="wallet-bar">
        {wrongChain ? (
          <>
            <span className="badge badge-warning">Wrong network</span>
            <Button variant="primary" onClick={switchChain} busy={switching}>
              {switching ? 'Switching…' : `Switch to ${config.chain.name}`}
            </Button>
          </>
        ) : (
          <span className="badge badge-success">{config.chain.name}</span>
        )}
        <AddressLink address={w.address} />
        <Button small onClick={() => wallet.disconnect()}>
          Disconnect
        </Button>
        {switchError && (
          <div style={{ flexBasis: '100%' }}>
            <Notice kind="danger" role="alert">
              {switchError}
            </Notice>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="wallet-bar" style={{ position: 'relative' }}>
      <Button
        ref={triggerRef}
        variant="primary"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        busy={w.status === 'connecting'}
        onClick={() => {
          if (w.options.length === 1 && w.options[0]) void wallet.connect(w.options[0]).catch(() => undefined);
          else setMenuOpen((o) => !o);
        }}
      >
        {w.status === 'connecting' ? 'Connecting…' : 'Connect wallet'}
      </Button>
      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Choose a wallet"
          className="card"
          style={{ position: 'absolute', insetInlineEnd: 0, insetBlockStart: '100%', marginBlockStart: 'var(--space-2)', minWidth: '16rem', zIndex: 5 }}
        >
          {w.options.length === 0 ? (
            <p className="small">
              No browser wallet was detected. Install a wallet extension such as MetaMask or Rabby, then reload this page.
            </p>
          ) : (
            w.options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="menuitem"
                className="btn"
                onClick={() => {
                  setMenuOpen(false);
                  void wallet.connect(o).catch(() => undefined);
                }}
              >
                {o.icon && <img src={o.icon} alt="" width={18} height={18} />}
                {o.name}
              </button>
            ))
          )}
        </div>
      )}
      {w.error && (
        <div style={{ flexBasis: '100%' }}>
          <Notice kind="danger" role="alert">
            {w.error}
          </Notice>
        </div>
      )}
    </div>
  );
}

/**
 * Wraps transaction controls with the four-state flow: not connected, wrong network, then the
 * action itself. Children render only when a wallet is connected on the configured chain.
 */
export function ActionGate({ children, compact }: { children: ReactNode; compact?: boolean }) {
  const { config, wallet } = useApp();
  const w = useWallet();
  const [error, setError] = useState<string | null>(null);

  if (w.status !== 'connected' || !w.address) {
    return (
      <div className="stack">
        {!compact && <p className="small muted">Connect a wallet to act. Reads work without one.</p>}
        <div>
          <Button
            busy={w.status === 'connecting'}
            onClick={() => {
              const first = w.options[0];
              if (first) void wallet.connect(first).catch(() => undefined);
              else setError('No browser wallet was detected. Install a wallet extension and reload.');
            }}
          >
            Connect wallet
          </Button>
        </div>
        {error && (
          <Notice kind="danger" role="alert">
            {error}
          </Notice>
        )}
      </div>
    );
  }
  if (w.chainId !== config.chain.id) {
    // The header holds the single "Switch to <network>" control; gates only explain the state.
    return (
      <Notice kind="warning" role="status">
        The wallet is on another network. Use “Switch to {config.chain.name}” in the header to continue.
      </Notice>
    );
  }
  return <>{children}</>;
}
