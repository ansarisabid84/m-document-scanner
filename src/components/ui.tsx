import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { useBackHandler } from '../app/backStack';
import { useFileUrl } from '../hooks/useFileUrl';

export function TopBar({
  title,
  back,
  onBack,
  actions,
  transparentTitle,
}: {
  title?: ReactNode;
  back?: boolean | string;
  onBack?: () => void;
  actions?: ReactNode;
  transparentTitle?: boolean;
}) {
  const nav = useNavigate();
  const goBack = () => {
    if (onBack) return onBack();
    if (typeof back === 'string') nav(back);
    else if (window.history.length > 1) nav(-1);
    else nav('/');
  };
  return (
    <header className="topbar glass">
      {back !== undefined && back !== false && (
        <button className="icon-btn" onClick={goBack} aria-label="Back">
          <Icon name="back" />
        </button>
      )}
      <div className={`topbar-title ${back ? '' : 'pad'}`} style={transparentTitle ? { opacity: 0 } : undefined}>
        {title}
      </div>
      {actions}
    </header>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
    />
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ListRow({
  icon,
  iconTone,
  label,
  detail,
  to,
  onClick,
  trailing,
  chevron,
  danger,
}: {
  icon?: IconName;
  iconTone?: 'danger' | 'success' | 'warning' | 'neutral';
  label: ReactNode;
  detail?: ReactNode;
  to?: string;
  onClick?: () => void;
  trailing?: ReactNode;
  chevron?: boolean;
  danger?: boolean;
}) {
  const inner = (
    <>
      {icon && (
        <span className={`row-icon ${iconTone ?? (danger ? 'danger' : '')}`}>
          <Icon name={icon} />
        </span>
      )}
      <span className="grow">
        <span className="label" style={danger ? { color: 'var(--danger)' } : undefined}>
          {label}
        </span>
        {detail && <div className="detail">{detail}</div>}
      </span>
      {trailing}
      {(chevron ?? !!to) && <Icon name="chevronRight" style={{ color: 'var(--text-faint)', width: 18, height: 18 }} />}
    </>
  );
  if (to)
    return (
      <Link className="list-row" to={to}>
        {inner}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" className="list-row" onClick={onClick}>
        {inner}
      </button>
    );
  return <div className="list-row">{inner}</div>;
}

export function Section({ title, children, footer }: { title?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="stack" style={{ gap: 8 }}>
      {title && <h2 className="section-title">{title}</h2>}
      <div className="list glass">{children}</div>
      {footer && <p className="small muted" style={{ margin: '0 6px' }}>{footer}</p>}
    </section>
  );
}

export function Sheet({ open, onClose, title, children, labelledBy }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; labelledBy?: string }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useBackHandler(onClose, open);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ref.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="sheet glass-strong" role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? (title ? id : undefined)} tabIndex={-1} ref={ref}>
        <div className="sheet-handle" />
        {title && (
          <h2 className="sheet-title" id={id}>
            {title}
          </h2>
        )}
        {children}
      </div>
    </>,
    document.body,
  );
}

export function EmptyState({ icon, title, message, action }: { icon: IconName; title: string; message?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-art glass">
        <Icon name={icon} />
      </div>
      <h2>{title}</h2>
      {message && <p>{message}</p>}
      {action && <div className="row wrap" style={{ justifyContent: 'center', marginTop: 8 }}>{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', message, onRetry, action }: { title?: string; message?: ReactNode; onRetry?: () => void; action?: ReactNode }) {
  return (
    <div className="empty" role="alert">
      <div className="empty-art glass" style={{ color: 'var(--danger)' }}>
        <Icon name="alert" />
      </div>
      <h2>{title}</h2>
      {message && <p>{message}</p>}
      <div className="row wrap" style={{ justifyContent: 'center', marginTop: 8 }}>
        {onRetry && (
          <button className="btn btn-secondary" onClick={onRetry}>
            <Icon name="refresh" /> Try again
          </button>
        )}
        {action}
      </div>
    </div>
  );
}

export function Progress({ value, label }: { value: number | null; label?: string }) {
  return (
    <div className={`progress ${value === null ? 'indeterminate' : ''}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? undefined : Math.round(value * 100)}>
      <span style={{ width: `${Math.round((value ?? 0.3) * 100)}%` }} />
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function Loading() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: 48, color: 'var(--text-muted)' }}>
      <Spinner />
    </div>
  );
}

export function Thumb({ path, alt, className = 'thumb' }: { path: string | null | undefined; alt: string; className?: string }) {
  const url = useFileUrl(path);
  return (
    <div className={className}>
      {url ? (
        <img src={url} alt={alt} loading="lazy" decoding="async" draggable={false} />
      ) : (
        <div className="placeholder">
          <Icon name="file" />
        </div>
      )}
    </div>
  );
}
