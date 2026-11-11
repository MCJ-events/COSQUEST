// build 21: the app turns sideways only when the map or a fight asks
// (features/game/orientation.ts, expo-screen-orientation). app.json's
// "orientation" is "default" so iOS lists the landscape orientations (a lock
// to landscape is refused otherwise), and expo-screen-orientation's
// initialOrientation keeps iOS in portrait from launch. Android needs no
// manifest entry for a lock, so its main activity stays portrait from launch
// as before; ScreenOrientation.lockAsync overrides it while the map or a fight
// holds landscape.
const { withAndroidManifest } = require("@expo/config-plugins");

function setPortrait(manifest) {
  const app = manifest.manifest.application?.[0];
  for (const a of app?.activity ?? []) {
    if (a.$["android:name"] === ".MainActivity") a.$["android:screenOrientation"] = "portrait";
  }
  return manifest;
}

module.exports = (config) =>
  withAndroidManifest(config, (c) => {
    c.modResults = setPortrait(c.modResults);
    return c;
  });
module.exports.setPortrait = setPortrait;
