import * as Sentry from '@sentry/astro';

const dsn = process.env.SENTRY_DSN || process.env.PUBLIC_SENTRY_DSN || '';
const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE || '0');

if (dsn) {
  Sentry.init({
    dsn,
    enabled: true,
    environment: process.env.PUBLIC_APP_ENV || process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0,
    dataCollection: {
      userInfo: false,
      httpBodies: [],
    },
  });
}
