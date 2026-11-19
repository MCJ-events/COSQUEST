// What Sentry is started with (services/monitoring.ts), as a pure function so node tests it.
// No DSN, no options: the SDK is never started and nothing is sent anywhere. The DSN, org and
// project come from the account the company opens (scripts/cosquest-beta-env.sh names them).

export type MonitoringOptions = {
  dsn: string;
  environment: string;
  release: string;
  dist?: string;
  tracesSampleRate: 0;
  sendDefaultPii: false;
  enableAutoSessionTracking: true;
  attachScreenshot: false;
  attachViewHierarchy: false;
};

/** Accepts only a Sentry-shaped DSN (https://<key>@<host>/<project>); anything else leaves reporting off. */
export function validDsn(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  return /^https:\/\/[^@\s/]+@[^\s/]+\/\d+$/.test(v) ? v : null;
}

export function monitoringOptions(p: {
  dsn: string | null | undefined;
  environment: string;
  version: string;
  build: string | null | undefined;
}): MonitoringOptions | null {
  const dsn = validDsn(p.dsn);
  if (!dsn) return null;
  const build = (p.build ?? "").trim();
  return {
    dsn,
    environment: p.environment,
    // cosquest@1.0.0+30: one release per store build, so a crash names the build it came from
    release: build ? `cosquest@${p.version}+${build}` : `cosquest@${p.version}`,
    ...(build ? { dist: build } : {}),
    // Errors and crashes only: no performance tracing, no replay, no screenshots, no personal data.
    tracesSampleRate: 0,
    sendDefaultPii: false,
    enableAutoSessionTracking: true,
    attachScreenshot: false,
    attachViewHierarchy: false,
  };
}
