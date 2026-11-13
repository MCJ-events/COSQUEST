// The Warden announcer on the phone (features/game/announcer.ts): the feed
// call (signed; 404 = silent), what shows where, the ceremony once, the
// speech rules, the fight's lines, the rules card and the poll timing.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type Announcement,
  AnnouncerBook,
  announcerOn,
  cleanLine,
  countdownText,
  fetchFeed,
  fetchWardenEvent,
  fightLinesOf,
  maySpeak,
  maySpeakFightLine,
  parseFeed,
  POLL_EVENT_MS,
  POLL_MAP_MS,
  POLL_MAX_MS,
  pollDelayMs,
  rulesCard,
} from "../announcer.ts";
import { GameClient } from "../client.ts";
import { Identity } from "../identity.ts";

type Call = { url: string; method: string; headers: Record<string, string> };

function fakeFetch(answer: (c: Call, n: number) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: { method: string; headers: Record<string, string> }) => {
    const call = { url, method: init.method, headers: init.headers };
    calls.push(call);
    const a = answer(call, calls.length);
    const status = a.status ?? 200;
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(a.body) };
  };
  return { fetch, calls };
}

const T0 = Date.parse("2026-11-13T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

function line(id: string, kind: string, text: string, opts: Partial<Announcement> & { from?: number; to?: number } = {}): Announcement {
  return {
    id,
    kind,
    scope: opts.scope ?? "global",
    line: text,
    display: opts.display ?? "banner",
    screens: opts.screens ?? ["map"],
    starts_at: iso(opts.from ?? T0 - 1000),
    expires_at: iso(opts.to ?? T0 + 600_000),
    event_id: opts.event_id ?? null,
  };
}

function feed(items: Announcement[], serverNow = T0) {
  return { server_now: iso(serverNow), next_since: iso(serverNow - 15000), announcements: items };
}

const id = new Identity("33".repeat(32), "device");

describe("announcer: the feed call", () => {
  it("GETs v1/warden/feed signed, with the place and the event, and parses the lines", async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: feed([line("a", "boss_hour_open", "Boss Hour is open. Bosses stand for thirty minutes.")]) }));
    const client = new GameClient({ baseUrl: "https://g.example", identity: () => id, fetch, sleep: async () => {} });
    const got = await fetchFeed(client, { since: "2026-11-13T11:59:00Z", lat: 51.500712, lng: -0.124611, eventId: "ev-1" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "GET");
    assert.ok(calls[0].url.startsWith(`https://g.example/v1/warden/feed?device_key=${id.publicKeyHex}&since=`));
    assert.ok(calls[0].url.includes("&lat=51.50071&lng=-0.12461&event_id=ev-1"));
    assert.ok(calls[0].headers["X-Signature"], "signed");
    assert.equal(got?.announcements[0].line, "Boss Hour is open. Bosses stand for thirty minutes.");
  });

  it("a 404 means the feature is off: null, not an error", async () => {
    const { fetch } = fakeFetch(() => ({ status: 404, body: { detail: "Not Found" } }));
    const client = new GameClient({ baseUrl: "https://g", identity: () => id, fetch, sleep: async () => {} });
    assert.equal(await fetchFeed(client), null);
    assert.equal(await fetchWardenEvent(client, "x"), null);
  });

  it("other failures throw (the caller backs off)", async () => {
    const { fetch } = fakeFetch(() => ({ status: 503, body: { detail: "busy" } }));
    const client = new GameClient({ baseUrl: "https://g", identity: () => id, fetch, sleep: async () => {} });
    await assert.rejects(() => fetchFeed(client));
  });

  it("the switch is features.announcer exactly true", () => {
    assert.equal(announcerOn({ features: { announcer: true } }), true);
    assert.equal(announcerOn({ features: { announcer: false } }), false);
    assert.equal(announcerOn({ features: {} }), false);
    assert.equal(announcerOn(null), false);
  });
});

describe("announcer: never money", () => {
  it("drops a line that mentions money or odds, whatever the server sent", () => {
    for (const bad of ["Win a prize.", "Entry is $5.", "Cash for first place.", "Earn double.", "The odds are good.", "Free coins."]) {
      assert.equal(cleanLine(bad), null, bad);
    }
    assert.equal(cleanLine("  Quest Hour   opens in ten minutes. "), "Quest Hour opens in ten minutes.");
    const f = parseFeed(feed([line("a", "calendar_soon", "Quest Hour pays cash."), line("b", "calendar_soon", "Quest Hour opens in ten minutes.")]));
    assert.deepEqual(f?.announcements.map((a) => a.id), ["b"]);
  });
});

describe("announcer: what shows where", () => {
  it("ceremonies go to the card once; the newest other map line is the strip", () => {
    const book = new AnnouncerBook();
    book.ingest(
      feed([
        line("1", "calendar_soon", "Quest Hour opens in one hour.", { display: "banner" }),
        line("2", "game_live", "Southbank Night Quest is live.", { screens: ["event", "map"] }),
        line("3", "boss_hour_open", "Boss Hour is open. Bosses stand for thirty minutes."),
        line("4", "proctor_handoff", "The Proctor will put five questions. Forty-five seconds.", { screens: ["trivia", "map"] }),
        line("5", "rite_passed", "The rite of Disciple is passed.", { screens: ["trivia", "profile"] }),
      ]),
      T0,
    );
    const v = book.view(T0);
    assert.equal(v.strip?.id, "3");
    assert.equal(v.ceremony?.id, "2");
    book.markShown("2");
    assert.equal(book.view(T0).ceremony, null);
  });

  it("goes by the server's clock, not the phone's", () => {
    const book = new AnnouncerBook();
    // The phone is 5 minutes slow; the line started 1 minute ago by the server.
    const phone = T0 - 300_000;
    book.ingest(feed([line("a", "calendar_soon", "Quest Hour opens in one minute.", { from: T0 - 60_000, to: T0 + 30_000 })]), phone);
    assert.equal(book.view(phone).strip?.id, "a");
    assert.equal(book.view(phone + 31_000).strip, null);
  });

  it("an event's own lines show at that event, and a line is kept once", () => {
    const book = new AnnouncerBook();
    const ev = line("e", "round_open", "Round two. Four players remain.", { screens: ["event"], event_id: "g1", scope: "event" });
    assert.equal(book.ingest(feed([ev]), T0).length, 1);
    assert.equal(book.ingest(feed([ev]), T0).length, 0);
    assert.equal(book.view(T0).strip, null);
    assert.equal(book.view(T0, { eventId: "g1" }).strip?.id, "e");
    book.cancel("e");
    assert.equal(book.view(T0, { eventId: "g1" }).strip, null);
  });
});

describe("announcer: when it speaks", () => {
  const calm = { inQuestion: false, inFight: false, muted: false, onCall: false, onScreen: true };
  const a = { kind: "calendar_soon", line: "Quest Hour opens in ten minutes." };
  it("speaks on the map, and never during a question, a fight, a call, muted or off screen", () => {
    assert.equal(maySpeak(a, calm), true);
    for (const k of ["inQuestion", "inFight", "muted", "onCall"] as const) assert.equal(maySpeak(a, { ...calm, [k]: true }), false, k);
    assert.equal(maySpeak(a, { ...calm, onScreen: false }), false);
    assert.equal(maySpeak({ kind: "proctor_handoff", line: "The Proctor will put five questions." }, calm), false);
  });
  it("a fight's intro and verdict are said in the fight, never during a question", () => {
    assert.equal(maySpeakFightLine("Siege at Tower Bridge. The Guardian holds. Begin.", { inQuestion: false, muted: false, onCall: false, onScreen: true }), true);
    assert.equal(maySpeakFightLine("The Guardian falls.", { inQuestion: true, muted: false, onCall: false, onScreen: true }), false);
  });
  it("each line is spoken once", () => {
    const book = new AnnouncerBook();
    assert.equal(book.takeSpeech("x"), true);
    assert.equal(book.takeSpeech("x"), false);
  });
});

describe("announcer: the fight's lines", () => {
  it("reads setup.warden, and nothing when it is absent", () => {
    assert.deepEqual(fightLinesOf({ kind: "fight3d", warden: { intro: "Siege at Tower Bridge. The Guardian holds. Begin.", win: "The Guardian falls.", loss: "The Guardian stands." } }), {
      intro: "Siege at Tower Bridge. The Guardian holds. Begin.",
      win: "The Guardian falls.",
      loss: "The Guardian stands.",
    });
    assert.equal(fightLinesOf({ kind: "fight3d" }), null);
    assert.equal(fightLinesOf(null), null);
  });
});

describe("announcer: the event rules card and the polling", () => {
  it("counts down to the start and states the rules", () => {
    const ev = {
      id: "g1",
      title: "Southbank Night Quest",
      status: "scheduled",
      starts_at: iso(T0 + 125_000),
      ends_at: iso(T0 + 3_725_000),
      lives: 3,
      rules_line: null,
      run_sheet: null,
    };
    assert.deepEqual(rulesCard(ev, T0), { title: "Southbank Night Quest", status: "Starts in 2:05", startsInMs: 125_000, rules: ["3 lives each."] });
    const live = rulesCard({ ...ev, status: "live", rules_line: "Three rounds. Three lives each. A player who is down returns after one minute." }, T0);
    assert.equal(live.status, "Live now");
    assert.deepEqual(live.rules, ["Three rounds. Three lives each. A player who is down returns after one minute."]);
    assert.equal(countdownText(T0 + 3_840_000, T0), "1 h 04 min");
    assert.equal(countdownText(T0 + 3 * 86_400_000, T0), "3 days");
  });

  it("polls a live event every 5 s, the map every minute, and backs off after failures", () => {
    assert.equal(pollDelayMs({ liveEvent: true, failures: 0 }), POLL_EVENT_MS);
    assert.equal(pollDelayMs({ liveEvent: false, failures: 0 }), POLL_MAP_MS);
    assert.equal(pollDelayMs({ liveEvent: true, failures: 2 }), 20_000);
    assert.equal(pollDelayMs({ liveEvent: false, failures: 9 }), POLL_MAX_MS);
  });
});
