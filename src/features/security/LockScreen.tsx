import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import { useSettings } from '../../infrastructure/settings';
import { authenticateBiometric, biometryInfo, lockoutRemaining, pinLength, verifyPin } from '../../infrastructure/security';
import { Keypad, PinDots } from './Keypad';

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const s = useSettings();
  const [len, setLen] = useState(4);
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);
  const [msg, setMsg] = useState('Enter your PIN');
  const [wait, setWait] = useState(0);
  const [bio, setBio] = useState<{ available: boolean; label: string }>({ available: false, label: '' });
  const [checking, setChecking] = useState(false);

  const tryBio = useCallback(async () => {
    if (await authenticateBiometric()) onUnlock();
  }, [onUnlock]);

  useEffect(() => {
    void pinLength().then(setLen);
    void lockoutRemaining().then(setWait);
    if (s.lockBiometric)
      void biometryInfo().then((b) => {
        setBio(b);
        if (b.available) void tryBio();
      });
  }, [s.lockBiometric, tryBio]);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setInterval(() => setWait((w) => Math.max(0, w - 1000)), 1000);
    return () => clearInterval(t);
  }, [wait > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (value: string) => {
    setChecking(true);
    const r = await verifyPin(value);
    setChecking(false);
    if (r.ok) return onUnlock();
    setShake(true);
    setTimeout(() => setShake(false), 400);
    setPin('');
    if (r.waitMs) {
      setWait(r.waitMs);
      setMsg('Too many attempts');
    } else setMsg('Incorrect PIN — try again');
  };

  const onDigit = (d: string) => {
    if (wait > 0 || checking) return;
    setPin((p) => {
      const n = (p + d).slice(0, len);
      if (n.length === len) void submit(n);
      return n;
    });
  };

  return (
    <div className="lock" role="dialog" aria-modal="true" aria-label="App locked">
      <div className="ambient" />
      <Logo size={64} />
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.5rem' }}>Document Scanner is locked</h1>
        <p className="muted" style={{ marginTop: 6 }} aria-live="polite">
          {wait > 0 ? `Try again in ${Math.ceil(wait / 1000)}s` : msg}
        </p>
      </div>
      <PinDots length={len} filled={pin.length} shake={shake} />
      <Keypad
        onDigit={onDigit}
        onDelete={() => setPin((p) => p.slice(0, -1))}
        disabled={wait > 0 || checking}
        extra={
          s.lockBiometric && bio.available ? (
            <button className="key plain" onClick={() => void tryBio()} aria-label={`Unlock with ${bio.label}`}>
              <Icon name="fingerprint" size={28} />
            </button>
          ) : null
        }
      />
      <p className="small faint" style={{ maxWidth: 300, textAlign: 'center' }}>
        Forgot your PIN? It can’t be recovered. Reinstalling removes documents stored only in this app.
      </p>
    </div>
  );
}
