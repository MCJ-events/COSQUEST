import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canRetrySilently, isNetworkFailure, OFFLINE_MESSAGE } from "../networkError.ts";

describe("network errors", () => {
  it("recognises what fetch throws on Android and iOS when nothing answers", () => {
    for (const message of [
      "fetch failed: java.net.ConnectException: Failed to connect to localhost/127.0.0.1:4120",
      "java.io.IOException: unexpected end of stream",
      "Network request failed",
      "Unable to resolve host \"cosquest-api-test.example\"",
    ]) {
      assert.equal(isNetworkFailure(new Error(message)), true, message);
    }
    assert.equal(isNetworkFailure(new TypeError("Failed to fetch")), true);
  });
  it("leaves the server's own messages and cancelled requests alone", () => {
    assert.equal(isNetworkFailure(new Error("Invalid username or password")), false);
    const aborted = new Error("Aborted");
    aborted.name = "AbortError";
    assert.equal(isNetworkFailure(aborted), false);
    assert.equal(isNetworkFailure("fetch failed"), false);
  });
  it("retries only reads by itself", () => {
    assert.equal(canRetrySilently("GET"), true);
    assert.equal(canRetrySilently("POST"), false);
  });
  it("says it in plain words", () => {
    assert.doesNotMatch(OFFLINE_MESSAGE, /java|fetch|exception/i);
  });
});
