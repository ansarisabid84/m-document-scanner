import { useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Progress, Section, Segmented, Sheet, Thumb, TopBar } from '../../components/ui';
import { useLive } from '../../hooks/useLive';
import { listDocuments } from '../../services/library';
import { backupFileName, createBackup, openBackup, restoreBackup, type RestorePreview, type RestoreReport } from '../../services/backup';
import { BackupError } from '../../domain/backupFormat';
import { canSaveToDevice, saveToDevice, shareFiles } from '../../infrastructure/sharing';
import { isNative } from '../../infrastructure/platform';
import { useFeedback } from '../../app/feedback';
import { formatBytes, formatDate, pluralize } from '../../domain/naming';

type Job = { label: string; done: number; total: number } | null;

function strength(pw: string): { score: number; label: string } {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return { score: s, label: ['Too short', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'][s] };
}

export default function Backup() {
  const fb = useFeedback();
  const docs = useLive(listDocuments, []);
  const [scope, setScope] = useState<'all' | 'pick'>('all');
  const [picked, setPicked] = useState<string[]>([]);
  const [pickOpen, setPickOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [job, setJob] = useState<Job>(null);
  const [made, setMade] = useState<{ blob: Blob; name: string } | null>(null);

  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [rpw, setRpw] = useState('');
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [report, setReport] = useState<RestoreReport | null>(null);
  const [restoreErr, setRestoreErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const st = strength(pw);
  const canCreate = pw.length >= 8 && pw === pw2 && !job && (scope === 'all' ? (docs.data?.length ?? 0) > 0 : picked.length > 0);

  const create = async () => {
    setMade(null);
    try {
      const bytes = await createBackup(pw, scope === 'all' ? 'all' : picked, (done, total, label) => setJob({ done, total, label }));
      setMade({ blob: new Blob([bytes as BlobPart], { type: 'application/octet-stream' }), name: backupFileName() });
      setPw('');
      setPw2('');
    } catch (e) {
      fb.error(e, 'The backup could not be created.');
    } finally {
      setJob(null);
    }
  };

  const verify = async () => {
    if (!restoreFile) return;
    setRestoreErr('');
    try {
      const data = new Uint8Array(await restoreFile.arrayBuffer());
      const p = await openBackup(data, rpw, (done, total, label) => setJob({ done, total, label }));
      setPreview(p);
      setRpw('');
    } catch (e) {
      setRestoreErr(e instanceof BackupError ? e.message : 'This file couldn’t be read as a backup.');
    } finally {
      setJob(null);
    }
  };

  const restore = async () => {
    if (!preview) return;
    if (
      mode === 'replace' &&
      !(await fb.confirm({
        title: 'Replace your library?',
        message: 'The backup will be imported first. Only after that succeeds, documents currently on this device that aren’t in the backup are deleted.',
        confirmLabel: 'Replace',
        destructive: true,
      }))
    )
      return;
    try {
      const r = await restoreBackup(preview, mode, (done, total, label) => setJob({ done, total, label }));
      setReport(r);
      setPreview(null);
      setRestoreFile(null);
    } catch (e) {
      fb.error(e, 'Restore failed. Your existing documents were not changed.');
    } finally {
      setJob(null);
    }
  };

  return (
    <div className="screen no-nav">
      <TopBar back title="Backup & restore" />
      <div className="stack-lg">
        <div className="notice">
          <Icon name="archive" />
          <span>Your documents live only on this phone. A backup is a single encrypted file you can keep in Files, a drive, or send to your new phone. Nothing is uploaded by this app.</span>
        </div>

        <section className="stack" style={{ gap: 12 }}>
          <h2 className="section-title">Create a backup</h2>
          <Segmented label="What to back up" value={scope} onChange={setScope} options={[{ value: 'all', label: `All (${docs.data?.length ?? 0})` }, { value: 'pick', label: 'Choose documents' }]} />
          {scope === 'pick' && (
            <button className="btn btn-secondary" onClick={() => setPickOpen(true)}>
              {picked.length ? `${pluralize(picked.length, 'document')} selected` : 'Select documents'}
            </button>
          )}
          <div className="field">
            <label htmlFor="bpw">Backup password</label>
            <input id="bpw" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 8 characters" />
            {pw && (
              <span className="tiny" style={{ marginLeft: 6, color: st.score >= 3 ? 'var(--success)' : 'var(--warning)' }}>
                {st.label}
              </span>
            )}
          </div>
          <div className="field">
            <label htmlFor="bpw2">Confirm password</label>
            <input id="bpw2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} aria-invalid={!!pw2 && pw !== pw2} />
            {pw2 && pw !== pw2 && <span className="tiny" style={{ marginLeft: 6, color: 'var(--danger)' }}>Passwords don’t match</span>}
          </div>
          <div className="notice warning">
            <Icon name="alert" />
            <span>
              <strong>Write this password down.</strong> Without it the backup can’t be opened — by you or anyone else. It can’t be reset.
            </span>
          </div>
          <button className="btn btn-primary btn-block" disabled={!canCreate} onClick={() => void create()}>
            <Icon name="lock" /> Create encrypted backup
          </button>
          {made && (
            <div className="glass card stack" style={{ gap: 10 }}>
              <div className="row">
                <Icon name="check" style={{ color: 'var(--success)' }} />
                <span style={{ flex: 1 }}>
                  <strong>Backup ready</strong>
                  <div className="tiny muted mono">
                    {made.name} · {formatBytes(made.blob.size)}
                  </div>
                </span>
              </div>
              <button className="btn btn-primary" onClick={() => void shareFiles([made], 'Document Scanner backup').catch((e) => fb.error(e))}>
                <Icon name="share" /> {isNative ? 'Save or share…' : 'Share'}
              </button>
              {canSaveToDevice && (
                <button className="btn btn-secondary" onClick={() => void saveToDevice([made]).then((w) => fb.toast(`Saved to ${w}`, 'success')).catch((e) => fb.error(e))}>
                  <Icon name="download" /> {isNative ? 'Save to Documents' : 'Download'}
                </button>
              )}
            </div>
          )}
        </section>

        <section className="stack" style={{ gap: 12 }}>
          <h2 className="section-title">Restore</h2>
          <input
            ref={fileRef}
            type="file"
            hidden
            onChange={(e) => {
              setRestoreFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setReport(null);
              setRestoreErr('');
              e.target.value = '';
            }}
          />
          <button className="btn btn-secondary" onClick={() => fileRef.current?.click()} disabled={!!job}>
            <Icon name="upload" /> {restoreFile ? restoreFile.name : 'Choose a backup file'}
          </button>
          {restoreFile && !preview && (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void verify();
              }}
            >
              <div className="field">
                <label htmlFor="rpw">Backup password</label>
                <input id="rpw" className="input" type="password" autoComplete="current-password" value={rpw} onChange={(e) => setRpw(e.target.value)} aria-invalid={!!restoreErr} />
              </div>
              {restoreErr && (
                <div className="notice danger" role="alert">
                  <Icon name="alert" />
                  <span>{restoreErr} Nothing on this device was changed.</span>
                </div>
              )}
              <button className="btn btn-primary" type="submit" disabled={!rpw || !!job}>
                Unlock & verify
              </button>
            </form>
          )}
          {preview && (
            <div className="glass card stack" style={{ gap: 12 }}>
              <div className="row">
                <Icon name="shield" style={{ color: 'var(--success)' }} />
                <strong>Backup verified</strong>
              </div>
              <dl className="kv">
                <dt>Created</dt>
                <dd>{formatDate(preview.manifest.createdAt)}</dd>
                <dt>Documents</dt>
                <dd className="mono">{preview.manifest.documents.length}</dd>
                <dt>Pages</dt>
                <dd className="mono">{preview.manifest.pages.length}</dd>
                <dt>Folders · tags</dt>
                <dd className="mono">
                  {preview.manifest.folders.length} · {preview.manifest.tags.length}
                </dd>
              </dl>
              {preview.corruptFiles.length > 0 && (
                <div className="notice warning">
                  <Icon name="alert" />
                  <span>{pluralize(preview.corruptFiles.length, 'file')} failed the integrity check and will be skipped. Everything else can be restored.</span>
                </div>
              )}
              <Segmented label="Restore mode" value={mode} onChange={setMode} options={[{ value: 'merge', label: 'Add to library' }, { value: 'replace', label: 'Replace library' }]} />
              <p className="tiny muted">{mode === 'merge' ? 'Existing documents stay. Restored ones are added alongside, with names kept unique.' : 'After the backup is safely imported, documents not in the backup are removed.'}</p>
              <button className="btn btn-primary" disabled={!!job} onClick={() => void restore()}>
                Restore {pluralize(preview.manifest.documents.length, 'document')}
              </button>
            </div>
          )}
          {report && (
            <div className="notice success" role="status">
              <Icon name="check" />
              <span>
                Restored {pluralize(report.documents, 'document')} ({pluralize(report.pages, 'page')}).
                {report.skippedPages ? ` ${pluralize(report.skippedPages, 'damaged page')} skipped.` : ''}
                {report.skippedDocuments.length ? ` Skipped: ${report.skippedDocuments.join(', ')}.` : ''}
              </span>
            </div>
          )}
        </section>

        {job && (
          <Section>
            <div className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <span className="small">{job.label}…</span>
              <Progress value={job.total ? job.done / job.total : null} label={job.label} />
            </div>
          </Section>
        )}
        <p className="tiny muted" style={{ margin: '0 6px' }}>
          Encryption: AES-256-GCM with a key derived from your password (PBKDF2-SHA-256, 600,000 rounds), using your device’s built-in cryptography. Very large libraries may need to be backed up in parts.
        </p>
      </div>

      <Sheet open={pickOpen} onClose={() => setPickOpen(false)} title="Choose documents">
        <div className="list glass" style={{ maxHeight: '55dvh', overflow: 'auto' }}>
          {(docs.data ?? []).map((d) => {
            const on = picked.includes(d.id);
            return (
              <button key={d.id} className="list-row" aria-pressed={on} onClick={() => setPicked((p) => (on ? p.filter((x) => x !== d.id) : [...p, d.id]))}>
                <span className="row-icon" style={on ? { background: 'var(--accent)', color: '#fff' } : { background: 'var(--surface-sunken)', color: 'transparent' }}>
                  <Icon name="check" />
                </span>
                <Thumb path={d.thumbPath} alt="" className="doc-row-thumb" />
                <span className="grow">
                  <span className="label">{d.title}</span>
                  <div className="detail mono tiny">{formatBytes(d.sizeBytes)}</div>
                </span>
              </button>
            );
          })}
        </div>
        <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} onClick={() => setPickOpen(false)}>
          Done
        </button>
      </Sheet>
    </div>
  );
}
