/**
 * Clear Metro / Expo caches that can cause corrupt "(1 module)" Android bundles.
 * Run: npm run reset:dev
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');

const removeTargets = [
  path.join(root, '.expo'),
  path.join(root, 'node_modules', '.cache'),
  path.join(root, 'test.hbc'),
];

for (const glob of ['.expo-tmp-bundle.js', '.expo-tmp-bundle2.js', '.expo-tmp-bundle-exclude.js']) {
  removeTargets.push(path.join(root, glob));
}

function rm(target) {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`[reset] removed ${path.relative(root, target)}`);
}

for (const target of removeTargets) {
  rm(target);
}

try {
  execSync('adb devices', { stdio: 'ignore' });
  for (const serial of ['emulator-5554']) {
    try {
      execSync(`adb -s ${serial} shell pm clear com.chatapp`, { stdio: 'ignore' });
      console.log(`[reset] cleared app data on ${serial}`);
    } catch {
      // emulator may be offline
    }
  }
} catch {
  // adb not available
}

console.log('[reset] done — run: npm start -- --clear');
