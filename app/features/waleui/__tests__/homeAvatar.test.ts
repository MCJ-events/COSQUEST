import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_AVATAR_KEY, hasOwnHomePicture } from "../homeAvatar.ts";

test("Home avatar: the default adventurer preset counts as no picture, so the faction bust shows", () => {
  assert.equal(DEFAULT_AVATAR_KEY, "adventurer");
  assert.equal(hasOwnHomePicture({ avatarKey: "adventurer" }), false);
  assert.equal(hasOwnHomePicture({ avatarKey: " adventurer ", avatarPhotoUrl: "" }), false);
});

test("Home avatar: no profile, no key or a blank key is no picture", () => {
  assert.equal(hasOwnHomePicture(null), false);
  assert.equal(hasOwnHomePicture(undefined), false);
  assert.equal(hasOwnHomePicture({}), false);
  assert.equal(hasOwnHomePicture({ avatarKey: "", avatarPhotoUrl: "   " }), false);
  assert.equal(hasOwnHomePicture({ avatarKey: null, avatarPhotoUrl: null }), false);
});

test("Home avatar: a chosen preset or any photo is the player's own picture", () => {
  assert.equal(hasOwnHomePicture({ avatarKey: "beat-gamer" }), true);
  assert.equal(hasOwnHomePicture({ avatarKey: "sky-guardian" }), true);
  // a photo wins even over the default preset key
  assert.equal(hasOwnHomePicture({ avatarKey: "adventurer", avatarPhotoUrl: "https://example.com/me.jpg" }), true);
});
