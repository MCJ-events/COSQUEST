// Online or not (NetInfo), for the offline banner and the send queue. When
// the phone comes back online, queued sends go out (services/offlineQueue.ts).
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { useEffect, useState } from "react";

import { isNetworkFailure, OFFLINE_MESSAGE } from "./networkError";
import { createQueue } from "./offlineQueue";

export function isOfflineError(error: unknown): boolean {
  return isNetworkFailure(error) || (error instanceof Error && error.message === OFFLINE_MESSAGE);
}

export const sendQueue = createQueue(isOfflineError);

/** Offline = no connection, or a connection that NetInfo has checked and found no internet on. */
function offlineFrom(state: NetInfoState): boolean {
  return state.isConnected === false || state.isInternetReachable === false;
}

let offline = false;
const listeners = new Set<(offline: boolean) => void>();
let started = false;

function start() {
  if (started) return;
  started = true;
  NetInfo.addEventListener((state) => {
    const next = offlineFrom(state);
    if (next === offline) return;
    offline = next;
    listeners.forEach((l) => l(offline));
    if (!offline) void sendQueue.flush();
  });
}

export function isOfflineNow(): boolean {
  start();
  return offline;
}

export function useOffline(): boolean {
  start();
  const [value, setValue] = useState(offline);
  useEffect(() => {
    setValue(offline);
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}

/** How many sends are waiting (for the banner). */
export function useQueuedCount(scope?: string): number {
  const [n, setN] = useState(() => sendQueue.pending(scope).length);
  useEffect(() => sendQueue.subscribe(() => setN(sendQueue.pending(scope).length)), [scope]);
  return n;
}
