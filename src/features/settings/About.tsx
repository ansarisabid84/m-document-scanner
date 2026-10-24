import { Logo } from '../../components/Logo';
import { TopBar } from '../../components/ui';
import { APP_VERSION } from '../../services/backup';
import { PRIVACY_POLICY_URL, SUPPORT_EMAIL } from '../../config';

const LICENSES: [string, string][] = [
  ['React, React DOM', 'MIT'],
  ['React Router', 'MIT'],
  ['Capacitor & official plugins', 'MIT'],
  ['@aparajita/capacitor-biometric-auth, capacitor-secure-storage', 'MIT'],
  ['@capacitor-community/privacy-screen', 'MIT'],
  ['Tesseract.js, tesseract.js-core', 'Apache-2.0'],
  ['Tesseract OCR & trained language data', 'Apache-2.0'],
  ['pdf.js (pdfjs-dist)', 'Apache-2.0'],
  ['jsPDF', 'MIT'],
  ['fflate', 'MIT'],
  ['idb', 'ISC'],
  ['Bricolage Grotesque', 'SIL Open Font License 1.1'],
  ['Public Sans', 'SIL Open Font License 1.1'],
  ['IBM Plex Mono', 'SIL Open Font License 1.1'],
];

export default function About() {
  return (
    <div className="screen no-nav">
      <TopBar back title="About" />
      <div className="stack-lg">
        <section style={{ display: 'grid', placeItems: 'center', gap: 10, padding: '12px 0' }}>
          <Logo size={72} />
          <h1 style={{ fontSize: '1.5rem' }}>Document Scanner</h1>
          <span className="mono small muted">Version {APP_VERSION}</span>
        </section>

        <section className="glass card stack" style={{ gap: 8 }}>
          <strong>Privacy policy</strong>
          <p className="small muted">
            Document Scanner does not collect, transmit or sell personal data. Documents, recognised text, folders, tags and settings are stored only on your device. The app has no
            accounts, analytics, advertising or crash reporting. The camera is used only while the scanner is open. The internet is used only to download optional text-recognition
            language data when you request it. Files leave the app only when you export, share or back them up.
          </p>
          {PRIVACY_POLICY_URL && (
            <a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer">
              Full privacy policy
            </a>
          )}
        </section>

        <section className="glass card stack" style={{ gap: 8 }}>
          <strong>Terms</strong>
          <p className="small muted">
            Provided as is. Text recognition and edge detection may make mistakes — check important documents before relying on them. Drawn signatures are visual marks, not certified
            digital signatures. You are responsible for keeping backups of documents stored only on this device.
          </p>
          <p className="small muted">Support: {SUPPORT_EMAIL}</p>
        </section>

        <section className="stack" style={{ gap: 8 }}>
          <h2 className="section-title">Open-source software</h2>
          <div className="list glass">
            {LICENSES.map(([n, l]) => (
              <div key={n} className="list-row">
                <span className="grow small">{n}</span>
                <span className="badge mono">{l}</span>
              </div>
            ))}
          </div>
          <p className="tiny muted" style={{ margin: '0 6px' }}>Full licence texts are included with each package in the source distribution.</p>
        </section>
      </div>
    </div>
  );
}
