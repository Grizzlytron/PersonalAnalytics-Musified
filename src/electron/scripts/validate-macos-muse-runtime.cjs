const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = __dirname;
const musifiedRoot = path.resolve(root, '..');

const frameworkBinary = path.resolve(
  musifiedRoot,
  'PA.MuseTracker',
  'deps',
  'libmuse',
  'lib',
  'release',
  'macos',
  'Muse.framework',
  'Muse'
);

const nativeAddon = path.resolve(
  musifiedRoot,
  'PA.MuseTracker',
  'build',
  'Release',
  'muse_native.node'
);

const riskyPatterns = [
  'EAAccessoryDidConnectNotification',
  'EAAccessoryDidDisconnectNotification',
  '_OBJC_CLASS_$_EAAccessoryManager',
  '@"EAAccessoryManager"'
];

function info(message) {
  console.log(`[muse-native][validate-mac] ${message}`);
}

function warn(message) {
  console.warn(`[muse-native][validate-mac] ${message}`);
}

function fail(message) {
  console.error(`[muse-native][validate-mac] ERROR: ${message}`);
}

function readStrings(filePath) {
  const result = spawnSync('strings', [filePath], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });

  if (result.error) {
    throw new Error(`Failed to execute 'strings' for ${filePath}: ${result.error.message}`);
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(
      `strings exited with code ${result.status} for ${filePath}: ${result.stderr || '(no stderr)'}`
    );
  }

  return result.stdout || '';
}

function scanFile(filePath) {
  if (!fs.existsSync(filePath)) {
    warn(`Not found, skipping: ${filePath}`);
    return [];
  }

  const text = readStrings(filePath);
  const hits = riskyPatterns.filter((pattern) => text.includes(pattern));

  if (hits.length > 0) {
    fail(`Detected ExternalAccessory-linked symbols in ${filePath}`);
    hits.forEach((hit) => fail(`  - ${hit}`));
  } else {
    info(`No risky ExternalAccessory symbols detected in ${filePath}`);
  }

  return hits;
}

(function main() {
  if (process.platform !== 'darwin') {
    info(`Skipping mac runtime validation on platform=${process.platform}`);
    return;
  }

  info('Validating Muse framework/native binary compatibility for macOS Electron runtime...');

  const frameworkHits = scanFile(frameworkBinary);
  const addonHits = scanFile(nativeAddon);

  if (frameworkHits.length === 0 && addonHits.length === 0) {
    info('Validation passed.');
    return;
  }

  fail('Validation failed. The current Muse SDK/native addon likely targets an incompatible Apple platform runtime.');
  fail('Use a macOS-compatible Muse.framework build (without EAAccessory runtime dependency), then rebuild PA.MuseTracker.');
  process.exit(1);
})();
