import { Icon } from '../../components/Icon';
import { TopBar } from '../../components/ui';
import { SUPPORT_EMAIL } from '../../config';
import { APP_VERSION } from '../../services/backup';
import { platform } from '../../infrastructure/platform';

const TIPS = [
  ['Contrast helps', 'Put light paper on a darker, plain surface. Busy backgrounds make edges harder to find.'],
  ['Light it evenly', 'Avoid your own shadow. Use the torch in dim rooms — the Auto filter removes most remaining shadows.'],
  ['Hold steady', 'With Auto on, the scanner captures once the outline turns green and stays still.'],
  ['Fix it later', 'Turn off “Review” in the scanner for quick batches. You can crop, rotate and filter any page afterwards.'],
  ['Pick the right filter', 'B & W for text, Color for forms and receipts with stamps, Original for photos.'],
];

const FAQ = [
  ['Does it work without internet?', 'Yes. Scanning, editing, search, PDF export and sharing all work offline. Only optional OCR language downloads need a connection.'],
  ['Where are my documents stored?', 'In the app’s private storage on this phone. They are not uploaded anywhere. Use Backup & restore to move them to another device.'],
  ['Why is some recognised text wrong?', 'Text recognition works best on clear printed text. Handwriting isn’t supported, and blurry or dark scans reduce accuracy. Try re-scanning with the B & W filter.'],
  ['Is my drawn signature legally binding?', 'A drawn signature is a visual mark on the page. It is not a certified digital signature; check what the recipient accepts.'],
  ['Does redaction really remove the content?', 'Yes for exports: redacted areas are burned into the exported image and that page’s recognised text is deleted. The original capture stays inside the app so you can undo.'],
  ['I forgot my app lock PIN.', 'For your security it can’t be recovered or bypassed. Reinstalling the app removes its data, so keep regular encrypted backups.'],
  ['What happens when I uninstall?', 'Android and iOS delete the app’s private storage, including your documents. Export or back up first.'],
];

export default function Help() {
  const subject = encodeURIComponent(`Document Scanner ${APP_VERSION} feedback`);
  const body = encodeURIComponent(`\n\n—\nApp ${APP_VERSION} · ${platform}\n(Please don’t attach private documents.)`);
  return (
    <div className="screen no-nav">
      <TopBar back title="Help & tips" />
      <div className="stack-lg">
        <section className="stack" style={{ gap: 8 }}>
          <h2 className="section-title">Scanning tips</h2>
          <div className="list glass">
            {TIPS.map(([t, d]) => (
              <div key={t} className="list-row" style={{ alignItems: 'flex-start' }}>
                <span className="row-icon">
                  <Icon name="sparkles" />
                </span>
                <span className="grow">
                  <span className="label">{t}</span>
                  <div className="detail">{d}</div>
                </span>
              </div>
            ))}
          </div>
        </section>
        <section className="stack" style={{ gap: 8 }}>
          <h2 className="section-title">Questions</h2>
          {FAQ.map(([q, a]) => (
            <details key={q} className="faq glass">
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </section>
        <section className="glass card stack" style={{ gap: 10 }}>
          <strong>Still stuck?</strong>
          <p className="small muted">Send us a message. Nothing from your library is attached — describe the problem in words.</p>
          <a className="btn btn-secondary" href={`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`}>
            <Icon name="mail" /> Email support
          </a>
        </section>
      </div>
    </div>
  );
}
