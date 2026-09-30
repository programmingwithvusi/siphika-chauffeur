// Ambient globals that main.js does NOT own — i.e. things other than its own
// `window.*` assignments (see the `declare global` block at the top of
// main.ts for those). These come from the Cordova platform itself, or from
// Google Maps calling back into `window` directly.

interface CordovaInAppBrowserEvent {
  url?: string;
}

interface CordovaInAppBrowserRef {
  addEventListener(
    event: 'loadstart' | 'exit',
    handler: (event: CordovaInAppBrowserEvent) => void,
  ): void;
  removeEventListener(
    event: 'loadstart' | 'exit',
    handler: (event: CordovaInAppBrowserEvent) => void,
  ): void;
  close(): void;
}

interface Window {
  cordova?: {
    InAppBrowser?: {
      open(url: string, target: string, options: string): CordovaInAppBrowserRef;
    };
  };
  // cordova-plugin-statusbar's global, guarded by `if (window.StatusBar)`
  StatusBar?: {
    styleBlackTranslucent(): void;
    backgroundColorByHexString(hex: string): void;
  };
  // Google Maps calls this itself when the API key is rejected or billing
  // isn't enabled — see https://developers.google.com/maps/documentation/javascript/events#auth-errors
  gm_authFailure?: () => void;
}

interface Navigator {
  // cordova-plugin's back-button-to-exit hook
  app?: { exitApp(): void };
}
