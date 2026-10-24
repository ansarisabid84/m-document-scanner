import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/ui';
import { FOLDER_COLORS, FOLDER_ICONS, type Folder, type Tag } from '../../domain/models';
import { ensureTag, saveFolder } from '../../services/library';
import { useFeedback } from '../../app/feedback';

/** Folder chips with inline "New folder". */
export function FolderPicker({ folders, value, onChange }: { folders: Folder[]; value: string | null; onChange: (id: string | null) => void }) {
  const fb = useFeedback();
  return (
    <div className="chips" role="radiogroup" aria-label="Folder">
      <button className="chip" role="radio" aria-checked={value === null} aria-pressed={value === null} onClick={() => onChange(null)}>
        No folder
      </button>
      {folders.map((f) => (
        <button key={f.id} className="chip" role="radio" aria-checked={value === f.id} aria-pressed={value === f.id} onClick={() => onChange(f.id)}>
          <span style={{ width: 10, height: 10, borderRadius: 5, background: f.color }} /> {f.name}
        </button>
      ))}
      <button
        className="chip"
        onClick={async () => {
          const name = await fb.prompt({ title: 'New folder', placeholder: 'e.g. Receipts', confirmLabel: 'Create' });
          if (!name) return;
          const f = await saveFolder({ name, color: FOLDER_COLORS[folders.length % FOLDER_COLORS.length] });
          onChange(f.id);
        }}
      >
        <Icon name="plus" /> New folder
      </button>
    </div>
  );
}

/** Tag chips (toggle) with free-text add. */
export function TagPicker({ tags, value, onChange }: { tags: Tag[]; value: string[]; onChange: (ids: string[]) => void }) {
  const [text, setText] = useState('');
  const add = async () => {
    const name = text.trim();
    if (!name) return;
    const t = await ensureTag(name);
    if (!value.includes(t.id)) onChange([...value, t.id]);
    setText('');
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      {tags.length > 0 && (
        <div className="chips" role="group" aria-label="Tags">
          {tags.map((t) => {
            const on = value.includes(t.id);
            return (
              <button key={t.id} className="chip" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== t.id) : [...value, t.id])}>
                <Icon name="tag" /> {t.name}
              </button>
            );
          })}
        </div>
      )}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a tag" aria-label="New tag" maxLength={40} />
        <button className="btn btn-secondary" type="submit" disabled={!text.trim()}>
          Add
        </button>
      </form>
    </div>
  );
}

export function FolderEditSheet({ open, folder, onClose }: { open: boolean; folder?: Folder; onClose: (saved?: Folder) => void }) {
  const [name, setName] = useState(folder?.name ?? '');
  const [color, setColor] = useState(folder?.color ?? FOLDER_COLORS[0]);
  const [icon, setIcon] = useState(folder?.icon ?? 'folder');
  return (
    <Sheet open={open} onClose={() => onClose()} title={folder ? 'Edit folder' : 'New folder'}>
      <form
        className="stack"
        style={{ gap: 18 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          onClose(await saveFolder({ id: folder?.id, name, color, icon }));
        }}
      >
        <div className="field">
          <label htmlFor="fname">Name</label>
          <input id="fname" className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={60} />
        </div>
        <div className="field">
          <span className="field-label">Colour</span>
          <div className="row wrap" role="radiogroup" aria-label="Folder colour">
            {FOLDER_COLORS.map((c) => (
              <button key={c} type="button" className="swatch" role="radio" aria-checked={c === color} aria-pressed={c === color} aria-label={c} style={{ background: c, borderColor: 'var(--hairline)', outlineColor: 'var(--text)' }} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">Icon</span>
          <div className="row wrap" role="radiogroup" aria-label="Folder icon">
            {FOLDER_ICONS.map((i) => (
              <button key={i} type="button" className={`icon-btn filled ${i === icon ? 'active' : ''}`} role="radio" aria-checked={i === icon} aria-label={i} onClick={() => setIcon(i)}>
                <Icon name={i as never} />
              </button>
            ))}
          </div>
        </div>
        <button className="btn btn-primary btn-block" type="submit" disabled={!name.trim()}>
          Save folder
        </button>
      </form>
    </Sheet>
  );
}
