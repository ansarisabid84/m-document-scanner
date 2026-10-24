import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/Icon';
import { useBackHandler } from './backStack';
import { toAppError } from '../infrastructure/platform';

type ToastKind = 'info' | 'success' | 'error';
interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
  action?: { label: string; run: () => void };
}
interface ConfirmOpts {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Require typing this word to enable the confirm button. */
  typeToConfirm?: string;
}
interface PromptOpts {
  title: string;
  message?: ReactNode;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  inputMode?: 'text' | 'numeric';
  type?: 'text' | 'password';
}

interface Feedback {
  toast: (text: string, kind?: ToastKind, action?: Toast['action']) => void;
  error: (e: unknown, fallback?: string) => void;
  confirm: (o: ConfirmOpts) => Promise<boolean>;
  prompt: (o: PromptOpts) => Promise<string | null>;
}

const Ctx = createContext<Feedback | null>(null);
export const useFeedback = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('FeedbackProvider missing');
  return c;
};

type DialogState =
  | { kind: 'confirm'; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOpts; resolve: (v: string | null) => void }
  | null;

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [text, setText] = useState('');
  const seq = useRef(0);

  const toast = useCallback<Feedback['toast']>((t, kind = 'info', action) => {
    const id = ++seq.current;
    setToasts((ts) => [...ts.slice(-2), { id, text: t, kind, action }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), action ? 6000 : 3600);
  }, []);
  const error = useCallback<Feedback['error']>(
    (e, fallback) => {
      const err = toAppError(e, fallback);
      if (err.kind === 'cancelled') return;
      toast(err.message || fallback || 'Something went wrong.', 'error');
    },
    [toast],
  );
  const confirm = useCallback<Feedback['confirm']>((opts) => new Promise((resolve) => (setText(''), setDialog({ kind: 'confirm', opts, resolve }))), []);
  const prompt = useCallback<Feedback['prompt']>((opts) => new Promise((resolve) => (setText(opts.initial ?? ''), setDialog({ kind: 'prompt', opts, resolve }))), []);

  const close = (v: boolean | string | null) => {
    if (!dialog) return;
    if (dialog.kind === 'confirm') dialog.resolve(v as boolean);
    else dialog.resolve(v as string | null);
    setDialog(null);
  };
  useBackHandler(() => close(dialog?.kind === 'confirm' ? false : null), !!dialog);

  const confirmDisabled = dialog?.kind === 'confirm' && !!dialog.opts.typeToConfirm && text.trim().toUpperCase() !== dialog.opts.typeToConfirm.toUpperCase();

  return (
    <Ctx.Provider value={{ toast, error, confirm, prompt }}>
      {children}
      {createPortal(
        <div className="toast-wrap" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast glass-strong ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
              <Icon name={t.kind === 'error' ? 'alert' : t.kind === 'success' ? 'check' : 'info'} />
              <span style={{ flex: 1 }}>{t.text}</span>
              {t.action && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ color: 'var(--accent)' }}
                  onClick={() => {
                    t.action!.run();
                    setToasts((ts) => ts.filter((x) => x.id !== t.id));
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
      {dialog &&
        createPortal(
          <>
            <div className="backdrop" onClick={() => close(dialog.kind === 'confirm' ? false : null)} />
            <form
              className="dialog glass-strong"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="dlg-title"
              onSubmit={(e) => {
                e.preventDefault();
                if (confirmDisabled) return;
                close(dialog.kind === 'confirm' ? true : text);
              }}
            >
              <h2 id="dlg-title">{dialog.opts.title}</h2>
              {dialog.opts.message && <div className="muted" style={{ fontSize: '0.93rem' }}>{dialog.opts.message}</div>}
              {dialog.kind === 'prompt' && (
                <input
                  className="input"
                  style={{ marginTop: 14 }}
                  autoFocus
                  value={text}
                  type={dialog.opts.type ?? 'text'}
                  inputMode={dialog.opts.inputMode}
                  placeholder={dialog.opts.placeholder}
                  onChange={(e) => setText(e.target.value)}
                  aria-label={dialog.opts.title}
                />
              )}
              {dialog.kind === 'confirm' && dialog.opts.typeToConfirm && (
                <input
                  className="input"
                  style={{ marginTop: 14 }}
                  autoFocus
                  value={text}
                  placeholder={`Type ${dialog.opts.typeToConfirm}`}
                  onChange={(e) => setText(e.target.value)}
                  aria-label={`Type ${dialog.opts.typeToConfirm} to confirm`}
                  autoCapitalize="characters"
                />
              )}
              <div className="actions">
                <button type="button" className="btn btn-secondary" onClick={() => close(dialog.kind === 'confirm' ? false : null)}>
                  {(dialog.opts as ConfirmOpts).cancelLabel ?? 'Cancel'}
                </button>
                <button
                  type="submit"
                  className={`btn ${dialog.kind === 'confirm' && dialog.opts.destructive ? 'btn-danger' : 'btn-primary'}`}
                  disabled={confirmDisabled || (dialog.kind === 'prompt' && !text.trim())}
                  autoFocus={dialog.kind === 'confirm' && !dialog.opts.typeToConfirm}
                >
                  {dialog.opts.confirmLabel ?? 'OK'}
                </button>
              </div>
            </form>
          </>,
          document.body,
        )}
    </Ctx.Provider>
  );
}
