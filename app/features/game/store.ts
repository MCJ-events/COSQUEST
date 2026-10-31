// Everything the always-on game knows, for every game screen. The TypeScript
// twin of costquest-ios Roam/RoamStore.swift: one object at the root, because
// the map, the challenge and the reward are three views of the same moment.
//
// Nothing here decides an outcome. Distances are shown so a player knows
// whether to keep walking, and the Play button follows them, but the server
// says yes or no, and its refusal is shown in its own words.
//
// Pure: no React Native imports. The client, the key storage, randomness and
// the clock are injected (tested in features/game/__tests__).
import { GameClient, GameError } from "./client.ts";
import { distanceM, type LatLng, reachM } from "./geo.ts";
import { Identity, SEED_HEX } from "./identity.ts";
import type {
  CodexPayload,
  DuelFinished,
  DuelOutcome,
  DuelStart,
  FactionWar,
  GroundGeometry,
  Profile,
  QuestPoint,
  RoamAnswer,
  RoamAttempt,
  RoamConfig,
  RoamHint,
  RoamLeaders,
  RoamMe,
  RoamSpin,
  RoamVerdict,
} from "./wire.ts";
import { isCooling, pointPlaysAsDuel } from "./wire.ts";

export type KeyStorage = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

export type Fix = LatLng & { accuracy: number; at: number };

export type GameState = {
  /** Who is playing: the account's player (one login) or this phone's own key. */
  session: { playerKey: string; source: "account" | "device"; created: boolean } | null;
  /** Why one login did not work, when it did not (shown nowhere; logged). */
  ssoProblem: string | null;
  config: RoamConfig | null;
  me: RoamMe | null;
  profile: Profile | null;
  points: QuestPoint[];
  region: string;
  war: FactionWar | null;
  leaders: RoamLeaders | null;
  codex: CodexPayload | null;
  ground: GroundGeometry | null;
  /** Where the world was last cut (ground and points are fetched around it). */
  centre: LatLng | null;
  fix: Fix | null;
  /** Why the world is empty, when it is. */
  problem: string | null;
  loadedOnce: boolean;
  /** The world is standing: basics and the first points are in. */
  ready: boolean;
  /** Paused: off screen, location stopped, nothing polls. */
  paused: boolean;
  /** A spot something asked the game to open (an invite, a link). */
  focus: { pointId?: string; raidId?: string; duelId?: string; lat?: number; lng?: number; place?: string } | null;
};

const DEVICE_KEY_STORE = "cq.game.devicekey";

const INITIAL: GameState = {
  session: null,
  ssoProblem: null,
  config: null,
  me: null,
  profile: null,
  points: [],
  region: "world",
  war: null,
  leaders: null,
  codex: null,
  ground: null,
  centre: null,
  fix: null,
  problem: null,
  loadedOnce: false,
  ready: false,
  paused: true,
  focus: null,
};

export type GameStoreDeps = {
  baseUrl: string;
  storage: KeyStorage;
  /** 32 random bytes as hex (expo-crypto in the app, node:crypto in tests). */
  randomSeedHex: () => string;
  /**
   * iOS: the native game's own key (Keychain, Game/Net/DeviceIdentity.swift),
   * the same 32-byte Ed25519 seed. Adopted once when this phone has no RN key
   * yet, so a player who never signed in keeps their progress when iOS moves
   * from the SwiftUI game to this one. Null: nothing to adopt.
   */
  legacySeedHex?: () => Promise<string | null>;
  fetch?: ConstructorParameters<typeof GameClient>[0]["fetch"];
  now?: () => number;
  log?: (message: string) => void;
};

/** Points nearest first (as given when there is no fix yet). Pure, so a
 * component can memoise it on the points and the fix it is given. */
export function nearestFirst(points: QuestPoint[], here: LatLng | null): QuestPoint[] {
  if (!here) return points;
  return [...points].sort((a, b) => distanceM(here, a) - distanceM(here, b));
}

export function createGameStore(deps: GameStoreDeps) {
  let state: GameState = { ...INITIAL };
  let identity: Identity | null = null;
  const listeners = new Set<() => void>();
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => {});
  const client = new GameClient({ baseUrl: deps.baseUrl, identity: () => identity, fetch: deps.fetch });
  let pointsFetchedAt: LatLng | null = null;
  let pointsFetchedTime = 0;
  let starterAsked = false;
  let groundFor: LatLng | null = null;
  let sessionSerial = 0;

  const set = (patch: Partial<GameState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };

  async function deviceIdentity(): Promise<Identity> {
    let seed = await deps.storage.get(DEVICE_KEY_STORE);
    if (!seed || !SEED_HEX.test(seed)) {
      const legacy = (await deps.legacySeedHex?.().catch(() => null))?.trim().toLowerCase() ?? null;
      seed = legacy && SEED_HEX.test(legacy) ? legacy : deps.randomSeedHex();
      await deps.storage.set(DEVICE_KEY_STORE, seed);
    }
    return new Identity(seed, "device");
  }

  const store = {
    client,
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    // ---------- who is playing ----------

    /**
     * One login: trade the chat session for the account's player. If the game
     * backend cannot do one login (not configured: 503; unreachable), the game
     * still runs on this phone's own key, as the iOS game does.
     * `null` signs out: the player is forgotten and the world starts over.
     */
    async setSession(chatToken: string | null): Promise<void> {
      const serial = ++sessionSerial;
      if (!chatToken) {
        identity = null;
        starterAsked = false;
        set({ ...INITIAL, paused: state.paused, fix: state.fix });
        return;
      }
      let next: Identity;
      let created = false;
      let ssoProblem: string | null = null;
      try {
        const sso = await client.sso(chatToken);
        next = new Identity(sso.key.seed_hex, "account", sso.nonce_floor);
        created = sso.created;
      } catch (error) {
        ssoProblem = error instanceof Error ? error.message : String(error);
        log(`[game] one login unavailable (${ssoProblem}); playing on this phone's key`);
        next = await deviceIdentity();
      }
      if (serial !== sessionSerial) return; // signed out or in again meanwhile
      const changed = identity?.publicKeyHex !== next.publicKeyHex;
      identity = next;
      set({
        session: { playerKey: next.publicKeyHex, source: next.source, created },
        ssoProblem,
        ...(changed ? { me: null, profile: null, points: [], codex: null, loadedOnce: false, ready: false } : {}),
      });
      if (changed) await store.loadBasics();
    },

    signedIn: () => identity !== null,

    // ---------- loading ----------

    async loadBasics(): Promise<void> {
      if (!identity) return;
      try {
        const [config, me] = await Promise.all([client.roamConfig(), client.roamMe()]);
        set({ config, me, problem: null });
        client
          .profile(identity.publicKeyHex)
          .then((profile) => set({ profile }))
          .catch(() => {});
      } catch (error) {
        log(`[game] basics failed: ${String(error)}`);
        set({ problem: "Can't reach CosQuest right now." });
      }
      set({ loadedOnce: true });
      await store.refreshPoints(true);
    },

    /** The phone moved (or a first fix arrived). */
    setFix(fix: Fix) {
      const centre = state.centre;
      const patch: Partial<GameState> = { fix };
      // Re-cut the world a good way before its edge.
      if (!centre || distanceM(centre, fix) > 300) patch.centre = { lat: fix.lat, lng: fix.lng };
      set(patch);
      if (state.paused || !identity) return;
      const stale = !pointsFetchedAt || distanceM(pointsFetchedAt, fix) > 60;
      if (stale || now() - pointsFetchedTime > 90000) void store.refreshPoints();
      if (!groundFor || distanceM(groundFor, fix) > 250) void store.refreshGround();
    },

    async refreshPoints(force = false): Promise<void> {
      const here = state.fix;
      if (!here || !identity) return;
      if (!force && now() - pointsFetchedTime < 5000) return;
      pointsFetchedTime = now();
      pointsFetchedAt = { lat: here.lat, lng: here.lng };
      try {
        const got = await client.questPoints(here.lat, here.lng);
        set({ points: got.points, region: got.region, problem: null });
      } catch (error) {
        log(`[game] points failed: ${String(error)}`);
        if (!state.points.length) set({ problem: "Can't find Quest Points right now." });
      }
      await store.ensureStarter();
      if (!state.ready && state.me) set({ ready: true });
      void store.refreshWar();
    },

    /** A new player's first point, beside them (the first thing asked is never "walk half a kilometre"). */
    async ensureStarter(): Promise<void> {
      const { me, fix } = state;
      if (!me || !me.faction || me.tutorial_done || starterAsked || !fix) return;
      if (state.points.some((p) => p.source === "starter")) return;
      starterAsked = true;
      try {
        const s = await client.starter(fix.lat, fix.lng, fix.accuracy);
        if (s.starter) set({ points: [s.starter, ...state.points] });
      } catch (error) {
        starterAsked = false;
        log(`[game] starter failed: ${String(error)}`);
      }
    },

    async refreshGround(): Promise<void> {
      const here = state.fix;
      if (!here) return;
      groundFor = { lat: here.lat, lng: here.lng };
      try {
        set({ ground: await client.ground(here.lat, here.lng, 600) });
      } catch (error) {
        groundFor = null;
        log(`[game] ground failed: ${String(error)}`);
      }
    },

    async refreshWar(): Promise<void> {
      const here = state.fix;
      if (!here) return;
      const [war, leaders] = await Promise.all([
        client.factionWar(here.lat, here.lng).catch(() => null),
        client.roamLeaders(here.lat, here.lng).catch(() => null),
      ]);
      set({ war: war ?? state.war, leaders: leaders ?? state.leaders });
    },

    async refreshMe(): Promise<void> {
      try {
        set({ me: await client.roamMe() });
      } catch {
        // Keep what we had.
      }
    },

    async refreshCodex(): Promise<CodexPayload | null> {
      try {
        const codex = await client.codex();
        set({ codex });
        return codex;
      } catch {
        return state.codex;
      }
    },

    // ---------- onboarding ----------

    get needsOnboarding(): boolean {
      return state.loadedOnce && !!state.me && !!state.config && !state.me.faction;
    },

    async saveProfile(handle: string, avatar = { face: 1, mark: 1, tint: "#3FA7D6" }): Promise<void> {
      await client.saveProfile(handle, avatar);
      if (identity) {
        client
          .profile(identity.publicKeyHex)
          .then((profile) => set({ profile }))
          .catch(() => {});
      }
    },

    async chooseFaction(id: string): Promise<void> {
      set({ me: await client.chooseFaction(id) });
      await store.refreshPoints(true);
    },

    // ---------- distances (the interface only) ----------

    distanceTo(p: LatLng): number | null {
      return state.fix ? distanceM(state.fix, p) : null;
    },

    reach(): number {
      return reachM(state.config?.open_radius_m, state.fix?.accuracy ?? 0);
    },

    inReach(p: LatLng): boolean {
      const d = store.distanceTo(p);
      return d !== null && d <= store.reach();
    },

    /** Nearest first. */
    nearby(): QuestPoint[] {
      return nearestFirst(state.points, state.fix);
    },

    playsAsDuel(p: QuestPoint): boolean {
      return pointPlaysAsDuel(p, state.me);
    },

    isCooling(p: QuestPoint): boolean {
      return isCooling(p, now());
    },

    // ---------- playing a quiz point ----------

    async open(p: QuestPoint): Promise<RoamAttempt> {
      const here = state.fix;
      if (!here) throw new GameError("http", "Waiting for your location.");
      return client.openPoint(p.id, here.lat, here.lng, here.accuracy);
    },

    async submit(attempt: RoamAttempt, answers: RoamAnswer[]): Promise<RoamVerdict> {
      const v = await client.answer(attempt.attempt_id, answers);
      store.applyCooling(v.point_id, v.cooling_until);
      if (v.me) set({ me: v.me });
      void store.refreshWar();
      return v;
    },

    async hint(attempt: RoamAttempt, kind: "fifty" | "time", question: number): Promise<RoamHint> {
      const h = await client.hint(attempt.attempt_id, kind, question);
      if (state.me) set({ me: { ...state.me, coins: h.coins } });
      return h;
    },

    // ---------- playing a duel point ----------

    /** `battle`: this build can play the fantasy battle scene (DuelModel.start: body.battle on point fights). */
    async duelStart(p: QuestPoint, opts?: { battle?: boolean; fight3d?: boolean }): Promise<DuelStart> {
      const here = state.fix;
      if (!here) throw new GameError("http", "Waiting for your location.");
      return client.duelStart({ mode: "point", target: p.id, lat: here.lat, lng: here.lng, accuracy_m: here.accuracy, battle: opts?.battle, fight3d: opts?.fight3d });
    },

    async duelFinish(start: DuelStart, finished: DuelFinished & { fight3d?: Record<string, unknown> | null }): Promise<DuelOutcome> {
      const out = await client.duelFinish(start.duel_id, finished);
      if (out.point?.point_id && out.point.cooling_until) store.applyCooling(out.point.point_id, out.point.cooling_until);
      void store.refreshMe();
      void store.refreshPoints(true);
      return out;
    },

    /** Spin: the one-second verb. Items fly into the bag, and the point rests (RoamStore.spin). */
    async spin(p: QuestPoint): Promise<RoamSpin> {
      const here = state.fix;
      if (!here) throw new GameError("http", "Waiting for your location.");
      const r = await client.spin(p.id, here.lat, here.lng, here.accuracy);
      set({ points: state.points.map((x) => (x.id === p.id ? { ...x, extra: { ...(x.extra ?? {}), spin_ready_at: r.spin_ready_at } } : x)) });
      void store.refreshMe();
      return r;
    },

    /** The point cools for this player: show it at once, not on the next fetch. Starters go. */
    applyCooling(pointId: string, coolingUntil: string) {
      const points = state.points.flatMap((p) => {
        if (p.id !== pointId) return [p];
        if (p.source === "starter") return [];
        return [{ ...p, cooling_until: coolingUntil }];
      });
      set({ points });
    },

    // ---------- the shell ----------

    pause() {
      if (!state.paused) set({ paused: true });
    },

    resume() {
      if (!state.paused) return;
      set({ paused: false });
      if (identity && state.fix) {
        void store.refreshPoints();
        if (!state.ground) void store.refreshGround();
      }
    },

    setFocus(focus: GameState["focus"]) {
      set({ focus });
    },

    factionName(id: string | null | undefined): string {
      if (!id) return "No faction";
      return state.config?.factions.find((f) => f.id === id)?.name ?? id.charAt(0).toUpperCase() + id.slice(1);
    },

    playerName(): string {
      return state.profile?.handle || state.me?.handle || "traveller";
    },
  };
  return store;
}

export type GameStore = ReturnType<typeof createGameStore>;
