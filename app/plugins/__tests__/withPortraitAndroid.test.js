const assert = require("node:assert/strict");
const { it } = require("node:test");

const { setPortrait } = require("../withPortraitAndroid");
const app = require("../../app.json");

it("keeps Android's main activity portrait from launch", () => {
  const m = { manifest: { application: [{ activity: [{ $: { "android:name": ".MainActivity" } }, { $: { "android:name": ".Other" } }] }] } };
  setPortrait(m);
  assert.equal(m.manifest.application[0].activity[0].$["android:screenOrientation"], "portrait");
  assert.equal(m.manifest.application[0].activity[1].$["android:screenOrientation"], undefined);
});

it("lets iOS lock landscape, starting in portrait", () => {
  assert.equal(app.expo.orientation, "default");
  const so = app.expo.plugins.find((p) => Array.isArray(p) && p[0] === "expo-screen-orientation");
  assert.ok(so, "expo-screen-orientation plugin");
  assert.equal(so[1].initialOrientation, "PORTRAIT_UP");
  assert.ok(app.expo.plugins.includes("./plugins/withPortraitAndroid"));
});
