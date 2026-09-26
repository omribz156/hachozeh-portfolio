import * as Sentry from '@sentry/astro';
import { shouldDropCloudflareWebkitBridgeError } from './src/lib/sentry-filters.js';

const dsn = import.meta.env.PUBLIC_SENTRY_DSN;
const tracesSampleRate = Number(import.meta.env.PUBLIC_SENTRY_TRACES_SAMPLE_RATE || '0');

if (dsn) {
  Sentry.init({
    dsn,
    enabled: true,
    environment: import.meta.env.PUBLIC_APP_ENV || import.meta.env.MODE,
    sendDefaultPii: false,
    tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    dataCollection: {
      userInfo: false,
      httpBodies: [],
    },
    beforeSend(event, hint) {
      if (shouldDropCloudflareWebkitBridgeError(event, hint)) return null;
      return event;
    },
  });
}
