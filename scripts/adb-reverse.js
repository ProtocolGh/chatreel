/**
 * Map device localhost → PC for Metro (8081) and the API port.
 * Applies to every connected Android device unless ANDROID_SERIAL is set.
 *
 * Run: npm run adb:reverse
 */
const { execSync } = require('child_process');

const apiPort = Number(process.env.PORT ?? process.env.EXPO_PUBLIC_API_URL?.match(/:(\d+)\/?$/)?.[1] ?? 3002);
const ports = [8081, apiPort];

function listDevices() {
  const out = execSync('adb devices', { encoding: 'utf8' });
  return out
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('*'))
    .map((line) => {
      const [serial, state] = line.split(/\s+/);
      return { serial, state };
    })
    .filter((d) => d.serial && d.state === 'device');
}

function reverseForSerial(serial) {
  const adbTarget = `-s ${serial}`;
  for (const port of ports) {
    try {
      execSync(`adb ${adbTarget} reverse tcp:${port} tcp:${port}`, { stdio: 'inherit' });
      console.log(`[adb] ${serial}: reverse tcp:${port} → PC`);
    } catch {
      console.warn(`[adb] failed for port ${port} on ${serial}`);
      process.exitCode = 1;
    }
  }
}

const devices = listDevices();

if (process.env.ANDROID_SERIAL) {
  reverseForSerial(process.env.ANDROID_SERIAL);
} else if (devices.length === 0) {
  console.error('[adb] No device found. Start an emulator or connect a phone with USB debugging.');
  process.exit(1);
} else {
  for (const device of devices) {
    reverseForSerial(device.serial);
  }
}
