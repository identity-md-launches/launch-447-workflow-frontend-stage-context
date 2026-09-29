import { useId, useState, type ReactNode } from 'react';
import type { Hex } from 'viem';
import { explorerAddressUrl, explorerTxUrl } from '../config/deployment';
import { formatAmount, shortAddress } from '../lib/format';
import { guildHue } from '../lib/game';
import { useApp, useGame } from '../state/app';
import type { TxState } from '../state/tx';

export function Card({ title, actions, children, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="card" id={id} aria-labelledby={id ? `${id}-title` : undefined}>
      {(title || actions) && (
        <header className="card-header">
          {title && <h2 id={id ? `${id}-title` : undefined}>{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Notice({ kind = 'info', children, role }: { kind?: 'info' | 'danger' | 'success' | 'warning'; children: ReactNode; role?: 'status' | 'alert' }) {
  const icon = kind === 'danger' ? '!' : kind === 'success' ? '✓' : kind === 'warning' ? '△' : 'i';
  return (
    <div className={`notice notice-${kind}`} role={role}>
      <span className="notice-icon" aria-hidden="true">
        {icon}
      </span>
      <div>{children}</div>
    </div>
  );
}

export function Button({
  variant = 'secondary',
  small,
  block,
  busy,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  small?: boolean;
  block?: boolean;
  busy?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  const cls = ['btn', variant === 'primary' && 'btn-primary', variant === 'danger' && 'btn-danger', small && 'btn-small', block && 'btn-block']
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} {...rest} disabled={rest.disabled || busy}>
      {busy && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  id,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  id: string;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const described = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-describedby': described, 'aria-invalid': error ? true : undefined })}
      {hint && (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      )}
      {error && (
        <span className="error-text" id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
}

export function AddressLink({ address, label }: { address: string; label?: string }) {
  const { config } = useApp();
  const [copied, setCopied] = useState(false);
  const url = explorerAddressUrl(config, address);
  const text = label ?? shortAddress(address);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <span className="row" style={{ display: 'inline-flex', gap: 'var(--space-1)' }}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="mono" title={address}>
          {text}
        </a>
      ) : (
        <span className="mono" title={address}>
          {text}
        </span>
      )}
      <button type="button" className="btn btn-small" onClick={copy} aria-label={`Copy address ${address}`}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}

export function TxLink({ hash }: { hash: Hex }) {
  const { config } = useApp();
  const url = explorerTxUrl(config, hash);
  const text = `${hash.slice(0, 10)}…${hash.slice(-6)}`;
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="mono">
      {text}
    </a>
  ) : (
    <span className="mono">{text}</span>
  );
}

export function Amount({ value, symbol = 'PACT', decimals = 18, maxFraction = 4 }: { value: bigint; symbol?: string; decimals?: number; maxFraction?: number }) {
  return (
    <span className="num">
      {formatAmount(value, decimals, maxFraction)} {symbol}
    </span>
  );
}

export function GuildTag({ id, link = true }: { id: number; link?: boolean }) {
  const game = useGame();
  if (id <= 0) return <span className="muted">no guild</span>;
  const g = game.guilds.find((x) => x.id === id);
  const name = g?.name ?? `Guild ${id}`;
  const hue = guildHue(id);
  const inner = (
    <>
      <span className="swatch" style={{ background: `var(--guild-${hue})` }} aria-hidden="true" />
      <span>
        {name} <span className="muted small">#{id}</span>
      </span>
    </>
  );
  return link ? (
    <a href={`#/guilds/${id}`} className="legend-item" style={{ textDecoration: 'none', color: 'inherit' }}>
      {inner}
    </a>
  ) : (
    <span className="legend-item">{inner}</span>
  );
}

/** Status line under a transaction control. Announces politely; errors stay until the next attempt. */
export function TxStatus({ state, successText = 'Confirmed.' }: { state: TxState; successText?: string }) {
  const id = useId();
  let text: ReactNode = null;
  if (state.phase === 'simulating') text = 'Checking the call…';
  else if (state.phase === 'signing') text = 'Confirm in the wallet…';
  else if (state.phase === 'pending' && state.hash) text = <>Sent. Waiting for confirmation: <TxLink hash={state.hash} /></>;
  else if (state.phase === 'confirmed') text = <>{successText} {state.hash && <TxLink hash={state.hash} />}</>;
  return (
    <div className="tx-status stack" id={id}>
      <p role="status" className={state.phase === 'confirmed' ? 'muted' : undefined}>
        {text}
      </p>
      {state.phase === 'failed' && state.error && (
        <Notice kind="danger" role="alert">
          {state.error}
        </Notice>
      )}
    </div>
  );
}

export function busyLabel(state: TxState, idle: string, active: string): string {
  return state.phase === 'simulating' || state.phase === 'signing' || state.phase === 'pending' ? active : idle;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="card-inset stack" style={{ gap: 'var(--space-1)' }}>
      <p style={{ fontWeight: 600 }}>{title}</p>
      <p className="small muted">{body}</p>
      {action && <div style={{ marginBlockStart: 'var(--space-2)' }}>{action}</div>}
    </div>
  );
}
