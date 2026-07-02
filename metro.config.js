const path = require('path');
const projectRoot = __dirname;

// Metro's web dev bundle injects EXPO_PUBLIC_* from process.env at serialize time.
// Load .env here so the Metro process always has them (not only in app.config.js).
require('@expo/env').load(projectRoot);

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(projectRoot);
config.transformer = {
  ...config.transformer,
  babelTransformerPath: require.resolve('react-native-svg-transformer'),
};

config.resolver = {
  ...config.resolver,
  assetExts: config.resolver.assetExts.filter((ext) => ext !== 'svg'),
  sourceExts: [...config.resolver.sourceExts, 'svg'],
  blockList: [
    ...(config.resolver.blockList ?? []),
    /\.expo-tmp-bundle[^/]*$/,
    /[/\\]test\.hbc$/,
  ],
  resolveRequest: (context, moduleName, platform) => {
    if (moduleName === 'hls.js' || moduleName === 'hls.js/dist/hls.js') {
      return {
        filePath: path.resolve(projectRoot, 'node_modules/hls.js/dist/hls.js'),
        type: 'sourceFile',
      };
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};

module.exports = config;
