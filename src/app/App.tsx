import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { loadSettings, useSettings } from '../infrastructure/settings';
import { getDB } from '../infrastructure/db';
import { hasPin, setSwitcherPrivacy } from '../infrastructure/security';
import { isNative, platform } from '../infrastructure/platform';
import { cleanExportCache } from '../infrastructure/sharing';
import { purgeExpiredTrash } from '../services/library';
import { shouldRelock } from '../domain/lockPolicy';
import { dispatchBack } from './backStack';
import { FeedbackProvider } from './feedback';
import { BottomNav } from '../components/documents';
import { ErrorState, Loading } from '../components/ui';
import { ErrorBoundary } from './ErrorBoundary';
import { LockScreen } from '../features/security/LockScreen';
import { Home } from '../features/home/Home';
import { Logo } from '../components/Logo';

const Onboarding = lazy(() => import('../features/onboarding/Onboarding'));
const Scanner = lazy(() => import('../features/scanner/Scanner'));
const SaveDocument = lazy(() => import('../features/documents/SaveDocument'));
const DocumentDetail = lazy(() => import('../features/documents/DocumentDetail'));
const PageManager = lazy(() => import('../features/documents/PageManager'));
const Viewer = lazy(() => import('../features/documents/Viewer'));
const EditPageRoute = lazy(() => import('../features/editor/EditPageRoute'));
const Markup = lazy(() => import('../features/editor/Markup'));
const Library = lazy(() => import('../features/documents/Library'));
const FolderDetail = lazy(() => import('../features/documents/FolderDetail'));
const Search = lazy(() => import('../features/search/Search'));
const Favorites = lazy(() => import('../features/documents/Favorites'));
const Trash = lazy(() => import('../features/documents/Trash'));
const Import = lazy(() => import('../features/import/Import'));
const Settings = lazy(() => import('../features/settings/Settings'));
const OcrSettings = lazy(() => import('../features/settings/OcrSettings'));
const LockSettings = lazy(() => import('../features/security/LockSettings'));
const Backup = lazy(() => import('../features/backup/Backup'));
const Storage = lazy(() => import('../features/settings/Storage'));
const Privacy = lazy(() => import('../features/settings/Privacy'));
const Help = lazy(() => import('../features/settings/Help'));
const About = lazy(() => import('../features/settings/About'));

type Boot = { state: 'loading' } | { state: 'ready'; locked: boolean } | { state: 'error'; message: string };

function useTheme() {
  const s = useSettings();
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = s.theme === 'dark' || (s.theme === 'system' && mq.matches);
      const root = document.documentElement;
      root.dataset.theme = dark ? 'dark' : 'light';
      root.dataset.reduceTransparency = String(s.reducedTransparency);
      root.dataset.reduceMotion = String(s.reducedMotion);
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#0B0F19' : '#EEF1F7'));
      if (isNative) {
        StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined);
        if (platform === 'android') {
          StatusBar.setOverlaysWebView({ overlay: true }).catch(() => undefined);
          StatusBar.setBackgroundColor({ color: '#00000000' }).catch(() => undefined);
        }
      }
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [s.theme, s.reducedMotion, s.reducedTransparency]);
}

const NAV_PATHS = ['/', '/documents', '/search', '/settings'];

function Shell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const nav = useNavigate();
  const showNav = NAV_PATHS.includes(loc.pathname);

  // Hardware back: open sheets/dialogs first, then history, then leave the app from Home.
  useEffect(() => {
    if (!isNative) return;
    const h = CapApp.addListener('backButton', () => {
      if (dispatchBack()) return;
      if (window.location.pathname === '/' || window.location.pathname === '/welcome') CapApp.minimizeApp().catch(() => CapApp.exitApp());
      else nav(-1);
    });
    return () => {
      void h.then((x) => x.remove());
    };
  }, [nav]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dispatchBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);

  return (
    <>
      <div className="ambient" aria-hidden="true" />
      <main className="app">{children}</main>
      {showNav && <BottomNav onScan={() => nav('/scan')} />}
    </>
  );
}

function AppRoutes() {
  const s = useSettings();
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/welcome" element={<Onboarding />} />
        <Route path="/" element={s.onboarded ? <Home /> : <Navigate to="/welcome" replace />} />
        <Route path="/scan" element={<Scanner />} />
        <Route path="/import" element={<Import />} />
        <Route path="/save/:id" element={<SaveDocument />} />
        <Route path="/doc/:id" element={<DocumentDetail />} />
        <Route path="/doc/:id/pages" element={<PageManager />} />
        <Route path="/doc/:id/view/:index" element={<Viewer />} />
        <Route path="/doc/:id/edit/:pageId" element={<EditPageRoute />} />
        <Route path="/doc/:id/markup/:pageId" element={<Markup />} />
        <Route path="/documents" element={<Library />} />
        <Route path="/folder/:id" element={<FolderDetail />} />
        <Route path="/search" element={<Search />} />
        <Route path="/favorites" element={<Favorites />} />
        <Route path="/trash" element={<Trash />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/ocr" element={<OcrSettings />} />
        <Route path="/settings/lock" element={<LockSettings />} />
        <Route path="/settings/backup" element={<Backup />} />
        <Route path="/settings/storage" element={<Storage />} />
        <Route path="/settings/privacy" element={<Privacy />} />
        <Route path="/help" element={<Help />} />
        <Route path="/about" element={<About />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export function App() {
  const [boot, setBoot] = useState<Boot>({ state: 'loading' });
  const [locked, setLocked] = useState(false);
  const settings = useSettings();
  useTheme();

  const start = async () => {
    setBoot({ state: 'loading' });
    try {
      const s = await loadSettings();
      await getDB();
      const lock = s.lockEnabled && (await hasPin());
      setLocked(lock);
      setBoot({ state: 'ready', locked: lock });
      void purgeExpiredTrash(s.trashRetentionDays).catch(() => undefined);
      void cleanExportCache();
    } catch (e) {
      setBoot({ state: 'error', message: e instanceof Error ? e.message : 'The local database could not be opened.' });
    } finally {
      if (isNative) SplashScreen.hide().catch(() => undefined);
    }
  };

  useEffect(() => {
    void start();
  }, []);

  // App-switcher privacy follows the lock setting.
  useEffect(() => {
    void setSwitcherPrivacy(settings.lockEnabled && settings.hideInSwitcher);
  }, [settings.lockEnabled, settings.hideInSwitcher]);

  // Relock after the configured time in the background.
  useEffect(() => {
    let hiddenAt = 0;
    const onHide = () => {
      hiddenAt = Date.now();
    };
    const onShow = async () => {
      if (!hiddenAt) return;
      const away = Date.now() - hiddenAt;
      hiddenAt = 0;
      if (shouldRelock(settings.lockEnabled, away, settings.autoLockSeconds) && (await hasPin())) setLocked(true);
    };
    if (isNative) {
      const a = CapApp.addListener('pause', onHide);
      const b = CapApp.addListener('resume', () => void onShow());
      return () => {
        void a.then((x) => x.remove());
        void b.then((x) => x.remove());
      };
    }
    const vis = () => (document.hidden ? onHide() : void onShow());
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, [settings.lockEnabled, settings.autoLockSeconds]);

  if (boot.state === 'loading')
    return (
      <div className="splash" aria-label="Document Scanner is starting">
        <Logo size={84} />
      </div>
    );
  if (boot.state === 'error')
    return (
      <div className="screen no-nav" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="ambient" />
        <ErrorState
          title="Can’t open your library"
          message={
            <>
              {boot.message} Your documents have not been deleted. Close other copies of the app, make sure the device has free storage, then try again.
            </>
          }
          onRetry={() => void start()}
        />
      </div>
    );

  return (
    <ErrorBoundary>
      <FeedbackProvider>
        <BrowserRouter>
          {locked ? (
            <LockScreen onUnlock={() => setLocked(false)} />
          ) : (
            <Shell>
              <AppRoutes />
            </Shell>
          )}
        </BrowserRouter>
      </FeedbackProvider>
    </ErrorBoundary>
  );
}
