// app.json plus the production plumbing that must stay inert until someone
// supplies the keys (task 059, docs/polish/DECISIONS.md). Each part switches
// on only from build-time env:
//
//   SENTRY_ORG + SENTRY_PROJECT   the Sentry plugin (source maps upload with
//                                 SENTRY_AUTH_TOKEN). The SDK itself runs only
//                                 when EXPO_PUBLIC_SENTRY_DSN is set.
//   EAS_UPDATE_CHANNEL            OTA updates from the EAS project in
//                                 app.json (extra.eas.projectId). Unset: the
//                                 app runs its embedded bundle, never checks.
//   (Sign in with Apple uses the backend's Apple web flow, utils/appleAuth.ts:
//   no entitlement needed; the button shows with EXPO_PUBLIC_APPLE_SIGNIN=1.)
module.exports = ({ config }) => {
  const env = process.env;
  // One copy of BouncyCastle (expo-updates and the Sparks SDK both bring one).
  const plugins = [...(config.plugins || []), "./plugins/withBouncyCastleDedupe"];

  if (env.SENTRY_ORG && env.SENTRY_PROJECT) {
    plugins.push(["@sentry/react-native", { organization: env.SENTRY_ORG, project: env.SENTRY_PROJECT }]);
  }

  const projectId = config.extra?.eas?.projectId;
  const channel = env.EAS_UPDATE_CHANNEL;
  const updates =
    channel && projectId
      ? {
          enabled: true,
          url: `https://u.expo.dev/${projectId}`,
          checkAutomatically: "ON_LOAD",
          fallbackToCacheTimeout: 0,
          requestHeaders: { "expo-channel-name": channel },
        }
      : { enabled: false };

  return {
    ...config,
    plugins,
    updates,
    // OTA updates only reach builds with the same runtime version.
    runtimeVersion: { policy: "appVersion" },
  };
};
