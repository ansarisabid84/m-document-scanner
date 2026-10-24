import { useEffect } from 'react';
import { Icon } from '../../components/Icon';
import { tap } from '../../infrastructure/haptics';

export function PinDots({ length, filled, shake }: { length: number; filled: number; shake?: boolean }) {
  return (
    <div className={`pin-dots ${shake ? 'shake' : ''}`} aria-hidden="true">
      {Array.from({ length }, (_, i) => (
        <span key={i} className={i < filled ? 'on' : ''} />
      ))}
    </div>
  );
}

/** Numeric keypad. Also accepts a hardware/desktop keyboard. */
export function Keypad({ onDigit, onDelete, extra, disabled }: { onDigit: (d: string) => void; onDelete: () => void; extra?: React.ReactNode; disabled?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (disabled) return;
      if (/^\d$/.test(e.key)) onDigit(e.key);
      else if (e.key === 'Backspace') onDelete();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onDigit, onDelete, disabled]);
  const press = (d: string) => {
    tap();
    onDigit(d);
  };
  return (
    <div className="keypad" role="group" aria-label="PIN keypad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
        <button key={d} className="key glass" onClick={() => press(d)} disabled={disabled} aria-label={d}>
          {d}
        </button>
      ))}
      <div>{extra}</div>
      <button className="key glass" onClick={() => press('0')} disabled={disabled} aria-label="0">
        0
      </button>
      <button className="key plain" onClick={onDelete} disabled={disabled} aria-label="Delete digit">
        <Icon name="backspace" />
      </button>
    </div>
  );
}
