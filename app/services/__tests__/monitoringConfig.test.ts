import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { monitoringOptions, validDsn } from "../monitoringConfig.ts";

const DSN = "https://abc123@o1.ingest.example.io/42";

describe("monitoringOptions", () => {
  it("stays off without a DSN, or with something that is not one", () => {
    for (const dsn of [undefined, null, "", "   ", "not-a-dsn", "http://abc@host/1", "https://host/1"]) {
      assert.equal(monitoringOptions({ dsn, environment: "production", version: "1.0.0", build: "30" }), null, String(dsn));
    }
  });

  it("starts with errors only and no personal data once a DSN is set", () => {
    const o = monitoringOptions({ dsn: ` ${DSN} `, environment: "production", version: "1.0.0", build: "30" });
    assert.ok(o);
    assert.equal(o.dsn, DSN);
    assert.equal(o.release, "cosquest@1.0.0+30");
    assert.equal(o.dist, "30");
    assert.equal(o.tracesSampleRate, 0);
    assert.equal(o.sendDefaultPii, false);
    assert.equal(o.attachScreenshot, false);
  });

  it("names the release without a build number when the build has none (web)", () => {
    const o = monitoringOptions({ dsn: DSN, environment: "development", version: "1.0.0", build: null });
    assert.equal(o?.release, "cosquest@1.0.0");
    assert.equal(o && "dist" in o, false);
  });

  it("validDsn", () => {
    assert.equal(validDsn(DSN), DSN);
    assert.equal(validDsn("https://k@host/abc"), null);
  });
});
