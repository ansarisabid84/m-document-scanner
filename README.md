# Document Scanner

Offline-first, privacy-first document scanner for **Android and iOS** (Vite + React 18 + TypeScript + Capacitor 6).

- **App name:** Document Scanner
- **Package / bundle ID:** `com.sabid.documentscanner`
- **Version:** 1.0.0

No account, no uploads, no analytics, no watermark. Every core workflow works in airplane mode.

---

## Quick start

```bash
npm install            # also copies the offline OCR engine + English model into public/ocr
npm run dev            # browser preview at http://localhost:5173 (uses your webcam)
npm test               # unit tests (Vitest)
npm run build          # type-check + production build into dist/
```

### Android

```bash
npm run build
npx cap sync android
npx cap open android   # Android Studio → Run, or Build › Generate Signed Bundle (AAB)
```

Requires Android Studio (Hedgehog or newer), JDK 17, Android SDK 34. `minSdk 24` (Android 7.0).

### iOS (macOS only)

```bash
npm run build
npx cap sync ios       # runs pod install
npx cap open ios       # Xcode → set your Team under Signing & Capabilities → Run
```

Requires Xcode 15+, CocoaPods. Deployment target iOS 15.0. Test the scanner on a **real iPhone** — the simulator has no camera.

> After any web change: `npm run build && npx cap sync`.

---

## What's included

| Area | Features |
|---|---|
| **Scanner** | Live camera preview, real-time edge detection with outline, steady-hold auto-capture, manual shutter, torch, review-each-page or fast batch mode, import from gallery, system-camera fallback, camera released while backgrounded |
| **Page editor** | Draggable perspective corners with magnifier loupe (keyboard-adjustable too), auto-detect, full page, reset, undo, rotate ±90°, filters (Original, Auto, Color, Grayscale, B & W), brightness/contrast. Non-destructive: original capture always kept |
| **Documents** | Multi-page docs, drag-to-reorder (plus Move earlier/later buttons), rotate, duplicate, delete, extract pages to a new doc (split), merge documents, folders (colour + icon), tags, favourites, rename, duplicate |
| **Library** | Grid/list, sort (newest, oldest, modified, name, size), filters (folder, tag, favourites, OCR status, source), multi-select bulk share/move/favourite/merge/delete, undo on delete |
| **OCR** | On-device Tesseract (WASM). English bundled; 20 more languages as optional one-time downloads cached for offline use. Progress + cancel. Word positions stored per page |
| **Search** | Local full-text search over titles, tags and recognised text with highlighted snippets; opens the exact page with matches highlighted |
| **Export** | PDF (Fit scan / A4 / Letter / Legal), JPEG, PNG; Small/Balanced/High quality; As scanned/Grayscale/B&W; page ranges; **searchable PDF text layer**; size estimate; progress + cancel; share sheet or save to Documents (Android) / download (web). No watermark |
| **Import** | Photos (system picker), images and PDFs (pdf.js, page picker, password-protected PDFs), batch queue with per-item status, one-doc or one-per-file, duplicate-file detection |
| **Markup** | Pen, highlighter, text, date stamp, reusable drawn signature, **true redaction** (burned into the image used for every export, page OCR text purged), erase, undo/redo |
| **Security** | PIN app lock (PBKDF2-hashed in Keychain/Keystore-backed storage), Face ID/Touch ID/fingerprint, auto-lock interval, escalating lockout after failed attempts, app-switcher privacy (FLAG_SECURE on Android) |
| **Backup** | Encrypted `.dsbackup` file (AES-256-GCM, PBKDF2-SHA-256 600k), per-file SHA-256 integrity, wrong-password/corrupt detection before anything changes, restore as **merge** or **replace** (replace deletes old data only after import succeeds) |
| **Reliability** | Scan sessions persist page-by-page (recover after a crash), temp-file-then-rename writes, edits roll back on failure, orphan-file cleanup, 30-day Trash with retention setting |
| **Settings** | Theme (system/light/dark), reduce transparency, reduce motion, scan defaults, haptics, OCR, export defaults, storage manager, privacy center (permissions, delete all data), help/FAQ, about/licences |

All 30 screens from the PRD inventory are implemented (some combined, e.g. OCR language setup lives in Settings › Text recognition; recovery/error states are built into each screen).

---

## Architecture

```
src/
├── app/              App shell, routing, lock gate, back-button stack, toasts/dialogs, error boundary
├── components/       Icon set, Liquid Glass UI primitives, document cards, logo
├── domain/           Pure, unit-tested logic: models, geometry/homography, naming, search,
│                     export options, backup container format, lock policy
├── imaging/          Edge detection, perspective warp, filters (pure) + Web Worker + engine facade
├── infrastructure/   IndexedDB, file store, settings, secure storage/biometrics, sharing, haptics
├── services/         Library repository, exporter (jsPDF), OCR (Tesseract), backup, PDF import
├── features/         Screens: onboarding, home, scanner, editor, documents, search, import,
│                     security, backup, settings, export
└── styles/           tokens.css (light/dark + reduced-transparency), app.css
```

- **Images are never stored in the database.** On Android/iOS they are files in the app's private data directory (`Directory.Data`, excluded from Android auto-backup); IndexedDB holds metadata and internal paths only. The web build stores blobs in IndexedDB.
- **Metadata store:** IndexedDB via `idb`, behind `services/library.ts`. It is transactional, offline and needs no native plugin. The PRD suggests SQLite; swapping in `@capacitor-community/sqlite` only requires reimplementing `infrastructure/db.ts` + the repository functions — UI code never touches storage directly.
- **Image processing** runs in a Web Worker; full-resolution jobs are serialised so only one large image is in memory at a time. Originals are capped at 3200 px, processed pages at 2800 px (~240–300 dpi for A4).
- **Edge detection** is an in-house, dependency-free detector (Sobel + Otsu + brightness segmentation → convex hull → best quadrilateral, scored by edge support). It avoids shipping ~10 MB of OpenCV. If you later want OpenCV-grade detection, replace `imaging/detect.ts` — the rest of the app only uses `detect()`.
- **CSP:** a strict Content-Security-Policy is injected into production builds (see `vite.config.ts`). The only external origin allowed is `cdn.jsdelivr.net`, used solely for user-initiated OCR language downloads.

### Live camera note
The scanner uses `getUserMedia` inside the WebView (Capacitor grants the WebView camera permission on Android; WKWebView supports it on iOS 14.3+). Capture resolution is the camera stream's (up to 4K requested). A **“Use system camera”** fallback (native camera at full sensor resolution) appears if the live preview can't start.

---

## Validation done

- `tsc -b` strict (noUnusedLocals/Parameters) — clean
- `vitest` — 33 unit tests: geometry/homography, naming, search & snippets, export ranges/validation, backup crypto (round-trip, wrong password, tampering, bad magic), manifest validation, edge detection on a synthetic tilted page, filters, warp/rotate, lock policy
- `vite build` — clean
- Headless Chromium end-to-end (390×844, fake camera feed of a tilted invoice): onboarding → live detection + auto-capture → review/filters → batch capture → save → OCR → searchable PDF export (text layer verified with pypdf) → search → viewer highlights → dark mode → reload persistence → PDF+image import → duplicate detection → reorder → redaction → encrypted backup → wrong-password rejection → restore (merge) → trash undo → app lock/unlock

**Still required on real hardware** (cannot be automated here): camera quality and torch on Android/iOS devices, Face ID/fingerprint, share sheets, Save to Documents on Android 7–14, app-switcher privacy, low-memory devices, and an airplane-mode run of the PRD §22 milestone. See `docs/RELEASE_CHECKLIST.md`.

---

## Before store submission

1. Set `SUPPORT_EMAIL` and `PRIVACY_POLICY_URL` in `src/config.ts` (currently placeholders).
2. Host `docs/PRIVACY_POLICY.md` and link it in both stores.
3. Android signing: create an upload keystore (never commit it) and configure `android/app/build.gradle` signingConfigs or use Android Studio's wizard.
4. App Store Connect export compliance: the app uses standard encryption (AES via the OS) for user backups — answer the questionnaire accordingly.
5. Data safety / privacy labels: “No data collected”.
