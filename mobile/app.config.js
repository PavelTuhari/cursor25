/**
 * Build variants on top of app.json.
 *
 *   APP_VARIANT=demo EXPO_PUBLIC_DEMO=1 npx expo prebuild --platform android --clean
 *
 * The demo variant installs next to the production app (its own package id and
 * name) and answers from the mock backend built into it - see src/demo/.
 * Without APP_VARIANT the configuration is app.json unchanged.
 */
module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== 'demo') return config;

  return {
    ...config,
    name: `${config.name} Demo`,
    ios: { ...config.ios, bundleIdentifier: `${config.ios.bundleIdentifier}.demo` },
    android: { ...config.android, package: `${config.android.package}.demo` },
    extra: { ...config.extra, variant: 'demo' },
  };
};
