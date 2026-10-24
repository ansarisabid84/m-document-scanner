import { ListRow, Section, Segmented, Switch } from '../../components/ui';
import { updateSettings, useSettings } from '../../infrastructure/settings';
import { FILTER_LABELS, type FilterType, type PageSizePreset, type QualityPreset, type ThemePref } from '../../domain/models';
import { QUALITY } from '../../domain/exportOptions';
import { OCR_LANGUAGES } from '../../services/ocr';
import { isNative } from '../../infrastructure/platform';
import { APP_VERSION } from '../../services/backup';

export default function Settings() {
  const s = useSettings();
  const langNames = s.ocrLanguages.map((c) => OCR_LANGUAGES.find((l) => l.code === c)?.name ?? c).join(', ');
  return (
    <div className="screen">
      <h1 className="large-title">Settings</h1>
      <div className="stack-lg">
        <section className="stack" style={{ gap: 8 }}>
          <h2 className="section-title">Appearance</h2>
          <Segmented<ThemePref>
            label="Theme"
            value={s.theme}
            onChange={(v) => void updateSettings({ theme: v })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
          <div className="list glass">
            <ListRow icon="eye" label="Reduce transparency" detail="Solid surfaces instead of glass. Faster on older phones." trailing={<Switch label="Reduce transparency" checked={s.reducedTransparency} onChange={(v) => void updateSettings({ reducedTransparency: v })} />} />
            <ListRow icon="sparkles" label="Reduce motion" detail="Also follows your system setting." trailing={<Switch label="Reduce motion" checked={s.reducedMotion} onChange={(v) => void updateSettings({ reducedMotion: v })} />} />
          </div>
        </section>

        <section className="stack" style={{ gap: 8 }}>
          <h2 className="section-title">Scanning</h2>
          <div className="field">
            <span className="field-label">Default filter</span>
            <div className="chips">
              {(Object.keys(FILTER_LABELS) as FilterType[]).map((f) => (
                <button key={f} className="chip" aria-pressed={s.defaultFilter === f} onClick={() => void updateSettings({ defaultFilter: f })}>
                  {FILTER_LABELS[f]}
                </button>
              ))}
            </div>
          </div>
          <div className="list glass">
            <ListRow icon="sparkles" label="Auto-capture" detail="Takes the photo when the page is steady" trailing={<Switch label="Auto-capture" checked={s.autoCapture} onChange={(v) => void updateSettings({ autoCapture: v })} />} />
            <ListRow icon="crop" label="Review each page" detail="Off = fast batch scanning; edit later" trailing={<Switch label="Review each page" checked={s.reviewAfterCapture} onChange={(v) => void updateSettings({ reviewAfterCapture: v })} />} />
            {isNative && <ListRow icon="phone" label="Haptic feedback" trailing={<Switch label="Haptic feedback" checked={s.haptics} onChange={(v) => void updateSettings({ haptics: v })} />} />}
          </div>
        </section>

        <Section title="Text recognition">
          <ListRow icon="ocr" label="Recognise text after saving" detail="Runs on-device in the background" trailing={<Switch label="Recognise text after saving" checked={s.autoOcr} onChange={(v) => void updateSettings({ autoOcr: v })} />} />
          <ListRow icon="globe" label="Languages" detail={langNames} to="/settings/ocr" />
        </Section>

        <section className="stack" style={{ gap: 8 }}>
          <h2 className="section-title">Export defaults</h2>
          <Segmented<QualityPreset> label="Default quality" value={s.exportQuality} onChange={(v) => void updateSettings({ exportQuality: v })} options={(Object.keys(QUALITY) as QualityPreset[]).map((k) => ({ value: k, label: QUALITY[k].label }))} />
          <Segmented<PageSizePreset>
            label="Default page size"
            value={s.exportPageSize}
            onChange={(v) => void updateSettings({ exportPageSize: v })}
            options={[
              { value: 'auto', label: 'Fit scan' },
              { value: 'a4', label: 'A4' },
              { value: 'letter', label: 'Letter' },
              { value: 'legal', label: 'Legal' },
            ]}
          />
          <div className="list glass">
            <ListRow icon="text" label="Searchable PDFs" detail="Include recognised text when available" trailing={<Switch label="Searchable PDFs" checked={s.exportOcrLayer} onChange={(v) => void updateSettings({ exportOcrLayer: v })} />} />
          </div>
        </section>

        <Section title="Security & data">
          <ListRow icon="lock" label="App lock" detail={s.lockEnabled ? 'On' : 'Off'} to="/settings/lock" />
          <ListRow icon="archive" label="Backup & restore" detail="Encrypted file you control" to="/settings/backup" />
          <ListRow icon="storage" label="Storage" to="/settings/storage" />
          <ListRow icon="shield" label="Privacy" to="/settings/privacy" />
        </Section>

        <section className="stack" style={{ gap: 8 }}>
          <h2 className="section-title">Trash</h2>
          <Segmented label="Keep deleted documents for" value={String(s.trashRetentionDays)} onChange={(v) => void updateSettings({ trashRetentionDays: Number(v) })} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
        </section>

        <Section>
          <ListRow icon="help" label="Help & tips" to="/help" />
          <ListRow icon="info" label="About" detail={`Version ${APP_VERSION}`} to="/about" />
        </Section>
      </div>
    </div>
  );
}
