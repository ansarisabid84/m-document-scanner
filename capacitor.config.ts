import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sabid.documentscanner',
  appName: 'Document Scanner',
  webDir: 'dist',
  backgroundColor: '#EEF1F7',
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
  ios: { contentInset: 'never', limitsNavigationsToAppBoundDomains: false },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: '#EEF1F7',
      showSpinner: false,
    },
    PrivacyScreen: { enable: false, preventScreenshots: false },
  },
};

export default config;
