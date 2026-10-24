import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Progress, Spinner, TopBar } from '../../components/ui';
import { OCR_LANGUAGES, deleteLanguage, downloadLanguage, installedLanguages } from '../../services/ocr';
import { updateSettings, useSettings } from '../../infrastructure/settings';
import { useFeedback } from '../../app/feedback';

export default function OcrSettings() {
  const s = useSettings();
  const fb = useFeedback();
  const [installed, setInstalled] = useState<string[] | null>(null);
  const [downloading, setDownloading] = useState<{ code: string; p: number } | null>(null);
  const [online, setOnline] = useState(navigator.onLine);

  const refresh = () => void installedLanguages().then(setInstalled);
  useEffect(() => {
    refresh();
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
    };
  }, []);

  const toggle = (code: string) => {
    const on = s.ocrLanguages.includes(code);
    const next = on ? s.ocrLanguages.filter((c) => c !== code) : [...s.ocrLanguages, code];
    if (!next.length) return fb.toast('Keep at least one language selected.', 'error');
    if (next.length > 3) return fb.toast('Use up to 3 languages at once — more makes recognition slower and less accurate.', 'error');
    void updateSettings({ ocrLanguages: next });
  };

  const download = async (code: string) => {
    setDownloading({ code, p: 0 });
    try {
      await downloadLanguage(code, (p) => setDownloading({ code, p }));
      fb.toast('Language installed — works offline now', 'success');
      refresh();
    } catch (e) {
      fb.error(e);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="screen no-nav">
      <TopBar back title="Text recognition" />
      <div className="stack-lg">
        <div className="notice">
          <Icon name="shield" />
          <span>Recognition happens on this device. Images and text are never uploaded. English is built in; other languages are optional one-time downloads that then work offline.</span>
        </div>
        {!online && (
          <div className="notice warning">
            <Icon name="wifiOff" />
            <span>You’re offline. Installed languages keep working; downloading new ones needs a connection.</span>
          </div>
        )}
        <section className="stack" style={{ gap: 8 }}>
          <h2 className="section-title">Languages</h2>
          <p className="small muted" style={{ margin: '0 6px' }}>Tick the languages in your documents (up to 3).</p>
          <div className="list glass">
            {OCR_LANGUAGES.map((l) => {
              const isInstalled = installed?.includes(l.code) ?? false;
              const selected = s.ocrLanguages.includes(l.code);
              const dl = downloading?.code === l.code;
              return (
                <div key={l.code} className="list-row">
                  <button
                    className="row-icon"
                    style={selected && isInstalled ? { background: 'var(--accent)', color: 'var(--on-accent)', border: 0 } : { background: 'var(--surface-sunken)', color: 'transparent', border: 0 }}
                    disabled={!isInstalled}
                    role="checkbox"
                    aria-checked={selected && isInstalled}
                    aria-label={`Use ${l.name}`}
                    onClick={() => toggle(l.code)}
                  >
                    <Icon name="check" />
                  </button>
                  <span className="grow">
                    <span className="label">{l.name}</span>
                    <div className="detail mono tiny">{l.bundled ? 'Built in' : isInstalled ? 'Installed · offline' : `≈ ${l.size.toFixed(1)} MB download`}</div>
                    {dl && <Progress value={downloading!.p || null} label={`Downloading ${l.name}`} />}
                  </span>
                  {installed === null ? (
                    <Spinner />
                  ) : l.bundled ? null : isInstalled ? (
                    <button
                      className="icon-btn"
                      aria-label={`Remove ${l.name}`}
                      onClick={async () => {
                        await deleteLanguage(l.code);
                        if (selected) await updateSettings({ ocrLanguages: s.ocrLanguages.filter((c) => c !== l.code) });
                        refresh();
                      }}
                    >
                      <Icon name="trash" />
                    </button>
                  ) : (
                    <button className="btn btn-secondary btn-sm" disabled={!!downloading || !online} onClick={() => void download(l.code)}>
                      {dl ? <Spinner /> : <Icon name="download" size={16} />} Get
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
        <section className="glass card stack" style={{ gap: 6 }}>
          <strong>What to expect</strong>
          <p className="small muted">Works best on clear, printed text. Results can contain mistakes for handwriting (not supported), stylised fonts, tables, very small print, or blurry and dark scans. Re-scan with the B & W filter for the best results.</p>
        </section>
      </div>
    </div>
  );
}
