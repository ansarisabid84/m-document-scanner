import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Progress, Segmented, Sheet, Switch } from '../../components/ui';
import type { DocumentRecord, Page, PageSizePreset, QualityPreset } from '../../domain/models';
import { QUALITY, estimateExportBytes, parsePageRange, validateExport, type ColorMode, type ExportFormat, type ExportOptions } from '../../domain/exportOptions';
import { formatBytes, safeFileName } from '../../domain/naming';
import { exportDocument } from '../../services/exporter';
import { canSaveToDevice, saveToDevice, shareFiles, type OutFile } from '../../infrastructure/sharing';
import { useSettings } from '../../infrastructure/settings';
import { useFeedback } from '../../app/feedback';
import { success } from '../../infrastructure/haptics';
import { isNative } from '../../infrastructure/platform';

type Phase = { kind: 'form' } | { kind: 'working'; done: number; total: number; label: string } | { kind: 'ready'; files: OutFile[] } | { kind: 'error'; message: string };

export function ExportSheet({ open, onClose, doc, pages, initialRange = '' }: { open: boolean; onClose: () => void; doc: DocumentRecord; pages: Page[]; initialRange?: string }) {
  const s = useSettings();
  const fb = useFeedback();
  const accepted = useMemo(() => pages.filter((p) => p.accepted), [pages]);
  const ocrDone = accepted.some((p) => p.ocrStatus === 'done');
  const [o, setO] = useState<ExportOptions>({
    format: 'pdf',
    quality: s.exportQuality,
    pageSize: s.exportPageSize,
    colorMode: 'as-is',
    ocrLayer: s.exportOcrLayer,
    range: initialRange,
    fileName: doc.title,
  });
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) {
      setPhase({ kind: 'form' });
      setO((x) => ({ ...x, fileName: doc.title, range: initialRange }));
    }
  }, [open, doc.title, initialRange]);

  const set = <K extends keyof ExportOptions>(k: K, v: ExportOptions[K]) => setO((x) => ({ ...x, [k]: v }));
  const error = validateExport(o, accepted.length);
  const idx = parsePageRange(o.range, accepted.length);
  const selected = idx ? idx.map((i) => accepted[i]) : [];
  const est = estimateExportBytes(o, selected);
  const ext = o.format === 'pdf' ? 'pdf' : o.format === 'png' ? 'png' : 'jpg';

  const run = async () => {
    abort.current = new AbortController();
    setPhase({ kind: 'working', done: 0, total: selected.length, label: 'Starting' });
    try {
      const files = await exportDocument(doc, pages, o, (done, total, label) => setPhase({ kind: 'working', done, total, label }), abort.current.signal);
      setPhase({ kind: 'ready', files });
      success();
    } catch (e) {
      const msg = (e as Error)?.message ?? 'Export failed.';
      if ((e as { kind?: string })?.kind === 'cancelled') setPhase({ kind: 'form' });
      else setPhase({ kind: 'error', message: msg });
    }
  };

  const share = async (files: OutFile[]) => {
    try {
      const r = await shareFiles(files, doc.title);
      if (r === 'downloaded') fb.toast('Downloaded', 'success');
      if (r !== 'cancelled') onClose();
    } catch (e) {
      fb.error(e);
    }
  };
  const save = async (files: OutFile[]) => {
    try {
      const where = await saveToDevice(files);
      fb.toast(`Saved to ${where}`, 'success');
      onClose();
    } catch (e) {
      fb.error(e);
    }
  };

  const close = () => {
    abort.current?.abort();
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title="Export">
      {phase.kind === 'form' && (
        <div className="stack" style={{ gap: 16 }}>
          <Segmented<ExportFormat>
            label="Format"
            value={o.format}
            onChange={(v) => set('format', v)}
            options={[
              { value: 'pdf', label: 'PDF' },
              { value: 'jpeg', label: 'JPEG' },
              { value: 'png', label: 'PNG' },
            ]}
          />
          <div className="field">
            <span className="field-label">Quality</span>
            <Segmented<QualityPreset>
              label="Quality"
              value={o.quality}
              onChange={(v) => set('quality', v)}
              options={(Object.keys(QUALITY) as QualityPreset[]).map((k) => ({ value: k, label: QUALITY[k].label }))}
            />
            <span className="tiny muted" style={{ marginLeft: 6 }}>{QUALITY[o.quality].hint}</span>
          </div>
          {o.format === 'pdf' && (
            <div className="field">
              <span className="field-label">Page size</span>
              <Segmented<PageSizePreset>
                label="Page size"
                value={o.pageSize}
                onChange={(v) => set('pageSize', v)}
                options={[
                  { value: 'auto', label: 'Fit scan' },
                  { value: 'a4', label: 'A4' },
                  { value: 'letter', label: 'Letter' },
                  { value: 'legal', label: 'Legal' },
                ]}
              />
            </div>
          )}
          <div className="field">
            <span className="field-label">Colour</span>
            <Segmented<ColorMode>
              label="Colour"
              value={o.colorMode}
              onChange={(v) => set('colorMode', v)}
              options={[
                { value: 'as-is', label: 'As scanned' },
                { value: 'grayscale', label: 'Grayscale' },
                { value: 'bw', label: 'B & W' },
              ]}
            />
          </div>
          {o.format === 'pdf' && (
            <div className="list glass">
              <div className="list-row">
                <span className="row-icon">
                  <Icon name="ocr" />
                </span>
                <span className="grow">
                  <span className="label">Searchable text layer</span>
                  <div className="detail">{ocrDone ? 'Lets you search and copy text in other apps.' : 'Recognise text on this document first to enable.'}</div>
                </span>
                <Switch label="Searchable text layer" checked={o.ocrLayer && ocrDone} disabled={!ocrDone} onChange={(v) => set('ocrLayer', v)} />
              </div>
            </div>
          )}
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 2 }}>
              <label htmlFor="exp-name">File name</label>
              <input id="exp-name" className="input" value={o.fileName} onChange={(e) => set('fileName', e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="exp-range">Pages</label>
              <input id="exp-range" className="input" value={o.range} placeholder={`All ${accepted.length}`} onChange={(e) => set('range', e.target.value)} aria-invalid={idx === null} inputMode="numeric" />
            </div>
          </div>
          <div className="between small">
            <span className="mono muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {o.format !== 'pdf' && selected.length > 1 ? `${selected.length} × .${ext}` : safeFileName(o.fileName || doc.title, ext)}
            </span>
            <span className="mono">≈ {formatBytes(est)}</span>
          </div>
          {error && (
            <p className="small" style={{ color: 'var(--danger)' }} role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary btn-block" disabled={!!error} onClick={() => void run()}>
            <Icon name="share" /> Create {o.format.toUpperCase()}
          </button>
          <p className="tiny muted" style={{ textAlign: 'center' }}>
            Made on this device. No watermark. Copies you share are controlled by the app you send them to.
          </p>
        </div>
      )}

      {phase.kind === 'working' && (
        <div className="stack" style={{ gap: 14, padding: '10px 0 6px' }}>
          <p>{phase.label}…</p>
          <Progress value={phase.total ? phase.done / phase.total : null} label="Export progress" />
          <button className="btn btn-secondary" onClick={() => abort.current?.abort()}>
            Cancel
          </button>
        </div>
      )}

      {phase.kind === 'ready' && (
        <div className="stack" style={{ gap: 14 }}>
          <div className="notice success">
            <Icon name="check" />
            <span>
              Ready: <strong>{phase.files.length === 1 ? phase.files[0].name : `${phase.files.length} files`}</strong> · <span className="mono">{formatBytes(phase.files.reduce((s2, f) => s2 + f.blob.size, 0))}</span>
            </span>
          </div>
          <button className="btn btn-primary btn-block" onClick={() => void share(phase.files)}>
            <Icon name="share" /> {isNative ? 'Share or save…' : 'Share'}
          </button>
          {canSaveToDevice && (
            <button className="btn btn-secondary btn-block" onClick={() => void save(phase.files)}>
              <Icon name="download" /> {isNative ? 'Save to Documents' : 'Download'}
            </button>
          )}
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="stack" style={{ gap: 14 }}>
          <div className="notice danger" role="alert">
            <Icon name="alert" />
            <span>{phase.message}</span>
          </div>
          <p className="small muted">Your document wasn’t changed.</p>
          <button className="btn btn-primary btn-block" onClick={() => void run()}>
            <Icon name="refresh" /> Try again
          </button>
          <button className="btn btn-ghost btn-block" onClick={() => setPhase({ kind: 'form' })}>
            Change options
          </button>
        </div>
      )}
    </Sheet>
  );
}
