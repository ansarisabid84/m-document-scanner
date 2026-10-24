# Release checklist (PRD §16 / §22)

## Automated (CI)
- [ ] `npm ci` · `npm run typecheck` · `npm test` · `npm run build`
- [ ] Android debug build (`./gradlew assembleDebug`)

## Milestone test — run on BOTH a physical Android phone and a physical iPhone, in airplane mode
1. [ ] Fresh install, launch in airplane mode, finish onboarding without an account
2. [ ] Capture three pages with the camera (auto-capture and manual shutter)
3. [ ] Correct a crop manually, apply B & W
4. [ ] Reorder the pages
5. [ ] Save as a named document
6. [ ] Export a multi-page PDF — confirm no watermark
7. [ ] Force-quit, reopen, confirm the document is intact

## Device checks
- [ ] Camera permission: deny → import still works; later grant in Settings → live camera works
- [ ] Torch toggle (where hardware supports it)
- [ ] Incoming call / app backgrounded mid-scan → camera recovers, captured pages kept
- [ ] Kill the app mid-scan → Home shows "Unsaved scan recovered"
- [ ] Low-light, angled, curled and small documents
- [ ] OCR English offline; download one extra language online, then use it offline
- [ ] Share sheet: Files/Drive/Mail/WhatsApp/Print
- [ ] Android: Save to Documents on Android 9, 10 and 13+
- [ ] App lock: PIN, biometrics, relock after interval, app-switcher snapshot hidden
- [ ] Backup on device A → restore on device B (merge and replace); wrong password; corrupted file
- [ ] Redaction: export PDF, open on a computer, confirm the area is black and text isn't selectable/searchable there
- [ ] Light/dark, Reduce transparency, Reduce motion, large text (Android font scale 1.3 / iOS Dynamic Type), TalkBack/VoiceOver labels
- [ ] Storage full: fill device, attempt capture → clear error, nothing lost
- [ ] Low-end Android device (2–3 GB RAM): 10-page scan + export

## Store
- [ ] `SUPPORT_EMAIL` / `PRIVACY_POLICY_URL` set in `src/config.ts`
- [ ] Privacy policy hosted; Play Data safety = no data collected; App Store privacy label = Data Not Collected
- [ ] Screenshots (phone + tablet), feature graphic, app description
- [ ] Signed AAB (upload key kept out of git) / Xcode archive with your Team
- [ ] Internal → closed beta → staged rollout
