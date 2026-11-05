// The public trivia web page lives under the game server's own site
// (https://<game server>/play, same origin as the API): EXPO_WEB_BASE_URL sets
// Expo's experiments.baseUrl so every route and asset carries the prefix.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const path = require("node:path");

const appConfig = require(path.join(__dirname, "..", "..", "app.config.js"));
const base = require(path.join(__dirname, "..", "..", "app.json")).expo;

function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

describe("web base path", () => {
  it("normalises a plain path and refuses anything else", () => {
    const { webBaseUrl } = appConfig;
    assert.equal(webBaseUrl("/play"), "/play");
    assert.equal(webBaseUrl("play/"), "/play");
    assert.equal(webBaseUrl("/a/b"), "/a/b");
    for (const bad of [undefined, "", "/", "https://x.io/play", "../x", "pl ay", "/play?x"]) {
      assert.equal(webBaseUrl(bad), "", String(bad));
    }
  });

  it("sets experiments.baseUrl only when asked, keeping the other experiments", () => {
    const on = withEnv({ EXPO_WEB_BASE_URL: "/play" }, () => appConfig({ config: base }));
    assert.equal(on.experiments.baseUrl, "/play");
    assert.equal(on.experiments.typedRoutes, base.experiments.typedRoutes);
    const off = withEnv({ EXPO_WEB_BASE_URL: undefined }, () => appConfig({ config: base }));
    assert.equal(off.experiments.baseUrl, undefined);
  });
});
