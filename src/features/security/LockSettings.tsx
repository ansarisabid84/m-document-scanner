import { useEffect, useState } from 'react';
import { ListRow, Section, Segmented, Sheet, Switch, TopBar } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { updateSettings, useSettings } from '../../infrastructure/settings';
import { authenticateBiometric, biometryInfo, clearPin, setPin, verifyPin } from '../../infrastructure/security';
import { isAndroid, isNative } from '../../infrastructure/platform';
import { useFeedback } from '../../app/feedback';
import { Keypad, PinDots } from './Keypad';

type Flow = { kind: 'set' } | { kind: 'verify'; then: 'change' | 'disable' } | null;

function PinFlow({ flow, onDone, onClose }: { flow: Flow; onDone: (result: 'set' | 'verified') => void; onClose: () => void }) {
  const [len, setLen] = useState<4 | 6>(4);
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPinValue] = useState('');
  const [err, setErr] = useState('');
  const [shake, setShake] = useState(false);
  useEffect(() => {
    setFirst(null);
    setPinValue('');
    setErr('');
  }, [flow]);

  const fail = (m: string) => {
    setErr(m);
    setShake(true);
    setTimeout(() => setShake(false), 400);
    setPinValue('');
  };

  const complete = async (value: string) => {
    if (flow?.kind === 'verify') {
      const r = await verifyPin(value);
      if (r.ok) onDone('verified');
      else fail(r.waitMs ? `Too many attempts. Wait ${Math.ceil(r.waitMs / 1000)}s.` : 'Incorrect PIN.');
      return;
    }
    if (!first) {
      setFirst(value);
      setPinValue('');
      setErr('');
      return;
    }
    if (value !== first) {
      setFirst(null);
      fail('PINs didn’t match. Start again.');
      return;
    }
    await setPin(value);
    onDone('set');
  };

  const effectiveLen = flow?.kind === 'verify' ? 0 : len;
  const onDigit = (d: string) =>
    setPinValue((p) => {
      const max = effectiveLen || 8;
      const n = (p + d).slice(0, max);
      if (effectiveLen && n.length === effectiveLen) void complete(n);
      return n;
    });

  const title = flow?.kind === 'verify' ? 'Enter current PIN' : first ? 'Confirm new PIN' : 'Choose a PIN';
  return (
    <Sheet open={!!flow} onClose={onClose} title={title}>
      <div className="stack" style={{ alignItems: 'center', gap: 18, paddingBottom: 8 }}>
        {flow?.kind === 'set' && !first && <Segmented label="PIN length" value={String(len) as '4' | '6'} options={[{ value: '4', label: '4 digits' }, { value: '6', label: '6 digits' }]} onChange={(v) => { setLen(Number(v) as 4 | 6); setPinValue(''); }} />}
        <PinDots length={effectiveLen || Math.max(4, pin.length)} filled={pin.length} shake={shake} />
        <p className="small" style={{ color: err ? 'var(--danger)' : 'var(--text-muted)', minHeight: 20 }} aria-live="polite">
          {err || (flow?.kind === 'set' ? 'Avoid obvious PINs like 1234.' : ' ')}
        </p>
        <Keypad
          onDigit={onDigit}
          onDelete={() => setPinValue((p) => p.slice(0, -1))}
          extra={
            flow?.kind === 'verify' ? (
              <button className="key plain" aria-label="Confirm PIN" onClick={() => pin.length >= 4 && void complete(pin)}>
                <Icon name="check" />
              </button>
            ) : null
          }
        />
      </div>
    </Sheet>
  );
}

export default function LockSettings() {
  const s = useSettings();
  const fb = useFeedback();
  const [flow, setFlow] = useState<Flow>(null);
  const [bio, setBio] = useState({ available: false, label: 'Biometrics' });
  useEffect(() => {
    void biometryInfo().then(setBio);
  }, []);

  const onDone = async (r: 'set' | 'verified') => {
    const current = flow;
    setFlow(null);
    if (r === 'set') {
      await updateSettings({ lockEnabled: true });
      fb.toast('App lock is on', 'success');
      return;
    }
    if (current?.kind === 'verify' && current.then === 'disable') {
      await clearPin();
      await updateSettings({ lockEnabled: false, lockBiometric: false });
      fb.toast('App lock turned off');
    } else if (current?.kind === 'verify' && current.then === 'change') {
      setTimeout(() => setFlow({ kind: 'set' }), 250);
    }
  };

  return (
    <div className="screen no-nav">
      <TopBar title="App lock" back />
      <div className="stack-lg">
        <div className="notice">
          <Icon name="shield" />
          <span>App lock keeps people who pick up your phone out of your documents. It works with your device’s own encryption — it isn’t a replacement for it.</span>
        </div>
        <Section>
          <ListRow
            icon="lock"
            label="Require PIN to open"
            detail={s.lockEnabled ? 'On' : 'Off'}
            trailing={<Switch label="App lock" checked={s.lockEnabled} onChange={(v) => setFlow(v ? { kind: 'set' } : { kind: 'verify', then: 'disable' })} />}
          />
          {s.lockEnabled && <ListRow icon="refresh" label="Change PIN" chevron onClick={() => setFlow({ kind: 'verify', then: 'change' })} />}
        </Section>

        {s.lockEnabled && (
          <>
            <Section footer={!isNative ? 'Biometric unlock is available in the Android and iOS apps.' : !bio.available ? 'No biometrics are enrolled on this device.' : undefined}>
              <ListRow
                icon="fingerprint"
                label={`Unlock with ${bio.label}`}
                detail="Your PIN always works as a fallback"
                trailing={
                  <Switch
                    label={`Unlock with ${bio.label}`}
                    disabled={!bio.available}
                    checked={s.lockBiometric && bio.available}
                    onChange={async (v) => {
                      if (v && !(await authenticateBiometric())) return fb.toast('Biometric check was cancelled', 'error');
                      await updateSettings({ lockBiometric: v });
                    }}
                  />
                }
              />
            </Section>
            <section className="stack" style={{ gap: 8 }}>
              <h2 className="section-title">Lock again after</h2>
              <Segmented
                label="Auto-lock"
                value={String(s.autoLockSeconds)}
                options={[
                  { value: '0', label: 'Immediately' },
                  { value: '30', label: '30 s' },
                  { value: '60', label: '1 min' },
                  { value: '300', label: '5 min' },
                ]}
                onChange={(v) => void updateSettings({ autoLockSeconds: Number(v) })}
              />
            </section>
            <Section footer={isAndroid ? 'On Android this also blocks screenshots and screen recording inside the app.' : 'Shows a blank screen in the app switcher.'}>
              <ListRow icon="eye" label="Hide content in app switcher" trailing={<Switch label="Hide in app switcher" checked={s.hideInSwitcher} onChange={(v) => void updateSettings({ hideInSwitcher: v })} />} />
            </Section>
          </>
        )}
        <div className="notice warning">
          <Icon name="alert" />
          <span>
            <strong>There’s no PIN recovery.</strong> If you forget it, the only way back in is reinstalling the app, which deletes documents stored here. Keep an encrypted backup in Settings › Backup & restore.
          </span>
        </div>
      </div>
      <PinFlow flow={flow} onDone={(r) => void onDone(r)} onClose={() => setFlow(null)} />
    </div>
  );
}
