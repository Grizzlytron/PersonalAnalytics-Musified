const fs = require('node:fs');
const path = require('node:path');

const BLUETOOTH_KEYS = {
  NSBluetoothAlwaysUsageDescription:
    'PersonalAnalytics needs Bluetooth access to discover and connect to your Muse device.',
  NSBluetoothPeripheralUsageDescription:
    'PersonalAnalytics needs Bluetooth access to discover and connect to your Muse device.'
};

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function ensurePlistKeys(plistText) {
  let updated = plistText;
  let insertedAny = false;

  for (const [key, rawValue] of Object.entries(BLUETOOTH_KEYS)) {
    if (updated.includes(`<key>${key}</key>`)) {
      continue;
    }

    const snippet = `\n\t<key>${key}</key>\n\t<string>${escapeXml(rawValue)}</string>`;
    const dictCloseIndex = updated.lastIndexOf('</dict>');

    if (dictCloseIndex === -1) {
      throw new Error('Info.plist does not contain a closing </dict> tag.');
    }

    updated = `${updated.slice(0, dictCloseIndex)}${snippet}\n${updated.slice(dictCloseIndex)}`;
    insertedAny = true;
  }

  return { updated, insertedAny };
}

exports.default = async function ensureMacBluetoothPlist(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const plistPath = path.join(appOutDir, `${appName}.app`, 'Contents', 'Info.plist');

  if (!fs.existsSync(plistPath)) {
    throw new Error(`Unable to find Info.plist at ${plistPath}`);
  }

  const plistText = fs.readFileSync(plistPath, 'utf8');
  const { updated, insertedAny } = ensurePlistKeys(plistText);

  if (insertedAny) {
    fs.writeFileSync(plistPath, updated, 'utf8');
    console.info(`[ensure-mac-bluetooth-plist] Added missing Bluetooth keys to ${plistPath}`);
  } else {
    console.info('[ensure-mac-bluetooth-plist] Bluetooth keys already present in Info.plist');
  }
};
