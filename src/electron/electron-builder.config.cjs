const enableAzureSigning = process.env.ENABLE_AZURE_SIGNING === 'true';
const enableMacSigning = process.env.ENABLE_NOTARIZE === 'true';

const museCoreResources = [
  {
    from: 'PA.MuseTracker',
    to: 'muse-native',
    filter: ['muse_native.node', 'build/Release/muse_native.node']
  }
];

const museWindowsRuntimeResources = [
  {
    from: 'PA.MuseTracker/deps/libmuse/lib/release',
    to: 'muse-native',
    filter: ['**/libmuse.dll']
  }
];

const museMacRuntimeResources = [
  {
    from: 'PA.MuseTracker/deps/libmuse/lib/release',
    to: 'muse-native',
    filter: ['**/libmuse.dylib', '**/Muse.framework/**']
  }
];

module.exports = {
  productName: 'PersonalAnalytics (Musified)',
  appId: 'ch.ifi.hasel.personal-analytics',
  asar: true,
  asarUnpack: ['node_modules/better_sqlite3/**', 'node_modules/sqlite3/**'],
  directories: {
    output: 'release/${version}'
  },
  files: ['dist', 'dist-electron', '!node_modules/uiohook-napi/build/**'],
  publish: {
    provider: 'github',
    owner: 'Grizzlytron',
    repo: 'Muselytics'
  },
  afterPack: 'scripts/ensure-mac-bluetooth-plist.cjs',
  ...(enableMacSigning ? { afterSign: 'scripts/notarize.cjs' } : {}), // Only notarize if explicitly enabled, as no tokens for signing currently available
  mac: {
    identity: null,  
    artifactName: '${productName}-${version}-${arch}.${ext}',
    asarUnpack: ['node_modules/**/*.node'],
    extraResources: [...museCoreResources, ...museMacRuntimeResources],
    // entitlements: 'build/entitlements.mac.plist',
    // entitlementsInherit: 'build/entitlements.mac.plist',
    hardenedRuntime: false,
    gatekeeperAssess: false,
    notarize: false,
    // macOS terminates apps that access Bluetooth without a usage description.
    extendInfo: {
      NSAppleEventsUsageDescription: 'Please allow access to use the application.',
      NSDocumentsFolderUsageDescription: 'Please allow access to use the application.',
      NSDownloadsFolderUsageDescription: 'Please allow access to use the application.',
      NSBluetoothAlwaysUsageDescription:
        'PersonalAnalytics needs Bluetooth access to discover and connect to your Muse device.',
      NSBluetoothPeripheralUsageDescription:
        'PersonalAnalytics needs Bluetooth access to discover and connect to your Muse device.'
    }
  },
  dmg: {
    writeUpdateInfo: false
  },
  win: {
    target: ['nsis'],
    verifyUpdateCodeSignature: false,
    extraResources: [...museCoreResources, ...museWindowsRuntimeResources],
    ...(enableAzureSigning
      ? {
          azureSignOptions: {
            publisherName: `${process.env.AZURE_PUBLISHER_NAME}`,
            endpoint: `${process.env.AZURE_ENDPOINT}`,
            codeSigningAccountName: `${process.env.AZURE_CODE_SIGNING_NAME}`,
            certificateProfileName: `${process.env.AZURE_CERT_PROFILE_NAME}`
          }
        }
      : {})
  },
  nsis: {
    oneClick: true,
    deleteAppDataOnUninstall: true,
    differentialPackage: false,
    artifactName: '${productName}-${version}-Windows.${ext}'
  }
};
