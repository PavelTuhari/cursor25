// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite runs on web through a WebAssembly build of SQLite: Metro has to
// treat .wasm as an asset, and the page needs cross-origin isolation for the
// SharedArrayBuffer the worker uses.
config.resolver.assetExts.push('wasm');
config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  return middleware(req, res, next);
};

// EXPO_PUBLIC_* values are inlined into the code while it is transformed, but
// Metro does not put them in the cache key: a demo build after a normal one
// would silently reuse the normal code, and the other way round.
const inlined = Object.keys(process.env)
  .filter((key) => key.startsWith('EXPO_PUBLIC_'))
  .sort()
  .map((key) => `${key}=${process.env[key]}`)
  .join('&');
config.cacheVersion = `${config.cacheVersion ?? ''}|${inlined}`;

module.exports = config;
