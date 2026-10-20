// The React Native game's one store, wired to the phone: the secure store for
// the phone's own key, expo-crypto for randomness, expo-location for the fix.
// (store.ts is the pure part; this file is the glue, so it is not unit tested.)
import { requireOptionalNativeModule } from "expo";
import * as Crypto from "expo-crypto";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { Platform } from "react-native";

import { isProductionServer, resolveDuelRenderer, resolveGameServer, resolveGameUi } from "./config.ts";
import { LOCATION_WATCH } from "./locationWatch.ts";
import { createGameStore, type GameState, type KeyStorage } from "./store.ts";

/** Metro inlines EXPO_PUBLIC_* at bundle time (direct dotted access only). */
export const GAME_SERVER = resolveGameServer(process.env.EXPO_PUBLIC_GAME_SERVER);
export const GAME_SERVER_IS_PRODUCTION = isProductionServer(GAME_SERVER);
export const GAME_UI = resolveGameUi(Platform.OS, process.env.EXPO_PUBLIC_GAME_UI);
export const DUEL_RENDERER_FLAG = process.env.EXPO_PUBLIC_DUEL_RENDERER;
export const duelRenderer = (hasUnity: boolean) => resolveDuelRenderer(DUEL_RENDERER_FLAG, hasUnity);

const secureStorage: KeyStorage = {
  async get(key) {
    if (Platform.OS === "web") return globalThis.localStorage?.getItem(key) ?? null;
    return SecureStore.getItemAsync(key);
  },
  async set(key, value) {
    if (Platform.OS === "web") return void globalThis.localStorage?.setItem(key, value);
    await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  },
  async remove(key) {
    if (Platform.OS === "web") return void globalThis.localStorage?.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  },
};

function randomSeedHex(): string {
  return Array.from(Crypto.getRandomBytes(32), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** iOS: the SwiftUI game's Keychain key, for players moving to this game (CostQuestGameModule.swift). */
async function legacySeedHex(): Promise<string | null> {
  if (Platform.OS !== "ios") return null;
  const native = requireOptionalNativeModule<{ readLegacyDeviceKey?: () => Promise<string | null> }>("CostQuestGame");
  return (await native?.readLegacyDeviceKey?.()) ?? null;
}

export const gameStore = createGameStore({
  baseUrl: GAME_SERVER,
  storage: secureStorage,
  randomSeedHex,
  legacySeedHex,
  log: (message) => {
    if (__DEV__) console.log(message);
  },
});

export function useGame(): GameState {
  return useSyncExternalStore(gameStore.subscribe, gameStore.get, gameStore.get);
}

// ---------- location ----------

export type LocationPermission = "unknown" | "granted" | "denied";

let watch: Location.LocationSubscription | null = null;
let starting = false;
let permission: LocationPermission = "unknown";
const permissionListeners = new Set<() => void>();

function setPermission(next: LocationPermission) {
  if (permission === next) return;
  permission = next;
  permissionListeners.forEach((l) => l());
}

export function useLocationPermission(): LocationPermission {
  return useSyncExternalStore(
    (l) => {
      permissionListeners.add(l);
      return () => permissionListeners.delete(l);
    },
    () => permission,
    () => permission,
  );
}

/** Start following the phone. `ask`: show the system prompt if never asked. */
export async function startLocation(ask: boolean): Promise<LocationPermission> {
  if (watch || starting) return permission;
  starting = true;
  try {
    let status = (await Location.getForegroundPermissionsAsync()).status;
    if (status !== "granted" && ask) status = (await Location.requestForegroundPermissionsAsync()).status;
    setPermission(status === "granted" ? "granted" : status === "denied" ? "denied" : "unknown");
    if (status !== "granted") return permission;
    // A last-known fix draws the world at once; the watch refines it.
    const last = await Location.getLastKnownPositionAsync().catch(() => null);
    if (last) {
      gameStore.setFix({ lat: last.coords.latitude, lng: last.coords.longitude, accuracy: last.coords.accuracy ?? 50, at: last.timestamp });
    }
    watch = await Location.watchPositionAsync(
      // High (not BestForNavigation), 5 s / 5 m: accurate enough for the 40 m
      // reach (locationWatch.test.ts), less battery and fewer map renders (audit B8).
      { accuracy: Location.Accuracy.High, distanceInterval: LOCATION_WATCH.distanceIntervalM, timeInterval: LOCATION_WATCH.timeIntervalMs },
      (pos) =>
        gameStore.setFix({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? 30,
          at: pos.timestamp,
        }),
    );
    return permission;
  } catch (error) {
    if (__DEV__) console.warn("[game] location failed", error);
    return permission;
  } finally {
    starting = false;
  }
}

/** Off screen: no location (the battery is the chat's too). */
export function stopLocation() {
  watch?.remove();
  watch = null;
}
