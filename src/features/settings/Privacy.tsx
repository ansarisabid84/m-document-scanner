import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera } from '@capacitor/camera';
import { Preferences } from '@capacitor/preferences';
import { Icon, type IconName } from '../../components/Icon';
import { ListRow, Section, TopBar } from '../../components/ui';
import { deleteAllData } from '../../services/library';
import { clearPin } from '../../infrastructure/security';
import { resetSettings } from '../../infrastructure/settings';
import { isNative, isIOS } from '../../infrastructure/platform';
import { useFeedback } from '../../app/feedback';

const FACTS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'phone', title: 'Processed on this device', text: 'Edge detection, image enhancement, PDF creation and text recognition all run locally.' },
  { icon: 'shield', title: 'Nothing is uploaded', text: 'No account, no cloud storage, no analytics, no crash reports, no ads.' },
  { icon: 'globe', title: 'When the internet is used', text: 'Only if you tap “Get” to download an optional OCR language. That request contains no documents.' },
  { icon: 'share', title: 'When files leave the app', text: 'Only when you export, share or create a backup. Copies you send are controlled by the receiving app.' },
];

type PermState = 'granted' | 'denied' | 'prompt' | 'limited' | 'unknown';

export default function Privacy() {
  const fb = useFeedback();
  const nav = useNavigate();
  const [perm, setPerm] = useState<{ camera: PermState; photos: PermState }>({ camera: 'unknown', photos: 'unknown' });

  useEffect(() => {
    (async () => {
      if (isNative) {
        try {
          const p = await Camera.checkPermissions();
          setPerm({ camera: p.camera as PermState, photos: p.photos as PermState });
        } catch {
          /* ignore */
        }
      } else {
        try {
          const p = await navigator.permissions.query({ name: 'camera' as PermissionName });
          setPerm({ camera: p.state as PermState, photos: 'granted' });
        } catch {
          /* unsupported */
        }
      }
    })();
  }, []);

  const label = (p: PermState) => ({ granted: 'Allowed', limited: 'Limited', denied: 'Not allowed', prompt: 'Not asked yet', unknown: '—' })[p] ?? p;

  return (
    <div className="screen no-nav">
      <TopBar back title="Privacy" />
      <div className="stack-lg">
        <section className="stack" style={{ gap: 16 }}>
          {FACTS.map((f) => (
            <div key={f.title} className="promise">
              <span className="row-icon" style={{ width: 40, height: 40, borderRadius: 13 }}>
                <Icon name={f.icon} />
              </span>
              <div>
                <strong>{f.title}</strong>
                <p className="small muted" style={{ marginTop: 2 }}>{f.text}</p>
              </div>
            </div>
          ))}
        </section>

        <Section title="Permissions" footer={`Change these in your phone’s ${isIOS ? 'Settings app' : 'Settings › Apps › Document Scanner'}. Everything except the live camera works without them.`}>
          <ListRow icon="camera" label="Camera" detail="Asked the first time you scan" trailing={<span className="badge">{label(perm.camera)}</span>} />
          {isNative && <ListRow icon="image" label="Photos" detail="Uses the system picker — only photos you choose are shared" trailing={<span className="badge">{label(perm.photos)}</span>} />}
          <ListRow icon="fingerprint" label="Biometrics" detail="Only if you turn it on for app lock" />
          <ListRow icon="wifiOff" label="Notifications" detail="Not used" />
        </Section>

        <Section title="Your data">
          <ListRow icon="archive" label="Export everything" detail="Create an encrypted backup file" to="/settings/backup" />
          <ListRow
            icon="trash"
            label="Delete all data"
            danger
            detail="Documents, folders, tags, settings and app lock"
            onClick={async () => {
              const ok = await fb.confirm({
                title: 'Delete all data?',
                message: 'Every document stored in this app will be permanently erased, including Trash. Copies you exported or backed up elsewhere are not affected. This can’t be undone.',
                confirmLabel: 'Delete everything',
                destructive: true,
                typeToConfirm: 'DELETE',
              });
              if (!ok) return;
              try {
                await deleteAllData();
                await clearPin();
                await Preferences.remove({ key: 'signature.v1' });
                await resetSettings();
                fb.toast('All data deleted', 'success');
                nav('/', { replace: true });
              } catch (e) {
                fb.error(e);
              }
            }}
          />
        </Section>
        <p className="tiny muted" style={{ margin: '0 6px' }}>
          On phones, deleted files are removed from the app’s storage immediately; like any flash storage, the system reclaims the physical space over time. Device encryption (on by default on modern phones) protects that data.
        </p>
      </div>
    </div>
  );
}
