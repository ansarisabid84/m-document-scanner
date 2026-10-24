import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import { Switch } from '../../components/ui';
import { updateSettings, useSettings } from '../../infrastructure/settings';

const PROMISES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'wifiOff', title: 'Works offline', text: 'Scan, edit, search and export with no internet — even in airplane mode.' },
  { icon: 'shield', title: 'Stays on your phone', text: 'Documents are processed and stored on this device. Nothing is uploaded.' },
  { icon: 'unlock', title: 'No account, no watermark', text: 'Start right away. Your exports are clean and yours.' },
];

function ScanArt() {
  return (
    <div style={{ position: 'relative', width: 220, height: 250 }} aria-hidden="true">
      <div className="glass" style={{ position: 'absolute', inset: '18px 26px', borderRadius: 18, transform: 'rotate(-6deg)' }} />
      <div style={{ position: 'absolute', inset: '8px 30px 22px', borderRadius: 14, background: '#fff', boxShadow: 'var(--shadow-lg)', padding: '26px 20px', transform: 'rotate(3deg)' }}>
        {[70, 100, 88, 100, 60, 94, 76].map((w, i) => (
          <i key={i} style={{ display: 'block', height: 7, width: `${w}%`, borderRadius: 4, background: i === 0 ? '#AAB4E8' : '#E1E5F2', marginBottom: 12 }} />
        ))}
      </div>
      <svg viewBox="0 0 220 250" style={{ position: 'absolute', inset: 0 }}>
        <g stroke="#2FBF8F" strokeWidth="6" strokeLinecap="round" fill="none">
          <path d="M14 44V22a8 8 0 0 1 8-8h22" />
          <path d="M176 14h22a8 8 0 0 1 8 8v22" />
          <path d="M206 206v22a8 8 0 0 1-8 8h-22" />
          <path d="M44 236H22a8 8 0 0 1-8-8v-22" />
        </g>
      </svg>
    </div>
  );
}

export default function Onboarding() {
  const nav = useNavigate();
  const s = useSettings();
  const [step, setStep] = useState(0);

  const finish = async (to: string) => {
    await updateSettings({ onboarded: true });
    nav(to, { replace: true });
  };

  return (
    <div className="onb">
      <div className="ambient" />
      <div className="between">
        <div className="row" style={{ gap: 10 }}>
          <Logo size={36} />
          <strong style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem' }}>Document Scanner</strong>
        </div>
        {step < 2 && (
          <button className="btn btn-ghost btn-sm" onClick={() => setStep(2)}>
            Skip
          </button>
        )}
      </div>

      {step === 0 && (
        <>
          <div className="onb-art">
            <ScanArt />
          </div>
          <h1>Your pocket scanner.</h1>
          <p className="lead">Turn paper into clean, searchable PDFs in seconds — edges found, perspective fixed, shadows removed.</p>
        </>
      )}

      {step === 1 && (
        <>
          <div style={{ flex: 1 }} />
          <h1>Private by design.</h1>
          <div className="stack" style={{ marginTop: 22, gap: 18 }}>
            {PROMISES.map((p) => (
              <div className="promise" key={p.title}>
                <span className="row-icon" style={{ width: 44, height: 44, borderRadius: 14 }}>
                  <Icon name={p.icon} />
                </span>
                <div>
                  <strong>{p.title}</strong>
                  <p className="muted" style={{ marginTop: 2 }}>{p.text}</p>
                </div>
              </div>
            ))}
          </div>
          <div style={{ flex: 1 }} />
        </>
      )}

      {step === 2 && (
        <>
          <div style={{ flex: 1 }} />
          <h1>A few optional choices.</h1>
          <p className="lead">You can change these any time in Settings.</p>
          <div className="list glass" style={{ marginTop: 22 }}>
            <div className="list-row">
              <span className="row-icon"><Icon name="camera" /></span>
              <span className="grow">
                <span className="label">Camera access</span>
                <div className="detail">We’ll ask only when you tap Scan. You can always import photos and PDFs instead.</div>
              </span>
            </div>
            <div className="list-row">
              <span className="row-icon"><Icon name="ocr" /></span>
              <span className="grow">
                <span className="label">Recognise text automatically</span>
                <div className="detail">Makes scans searchable on-device. English is built in.</div>
              </span>
              <Switch label="Recognise text automatically" checked={s.autoOcr} onChange={(v) => void updateSettings({ autoOcr: v })} />
            </div>
            <button className="list-row" onClick={() => void finish('/settings/lock')}>
              <span className="row-icon"><Icon name="lock" /></span>
              <span className="grow">
                <span className="label">Set up app lock</span>
                <div className="detail">Protect the app with a PIN or biometrics.</div>
              </span>
              <Icon name="chevronRight" style={{ color: 'var(--text-faint)' }} />
            </button>
          </div>
          <div style={{ flex: 1 }} />
        </>
      )}

      <div className="dots" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={i === step ? 'on' : ''} />
        ))}
      </div>
      {step < 2 ? (
        <button className="btn btn-primary btn-block" onClick={() => setStep(step + 1)}>
          Continue
        </button>
      ) : (
        <div className="stack">
          <button className="btn btn-primary btn-block" onClick={() => void finish('/scan')}>
            <Icon name="scan" /> Scan my first document
          </button>
          <button className="btn btn-secondary btn-block" onClick={() => void finish('/')}>
            Go to Home
          </button>
        </div>
      )}
    </div>
  );
}
