// Push notifications and incoming links, mounted once at the root (task 059).
//   - Signed in and notifications allowed: get the Expo push token and
//     register it (the existing settings registerDeviceThunk). Again when
//     the app comes back (the person may have allowed it in Settings).
//   - A tap on a notification opens its chat, person, game spot or the
//     notification centre (features/world/links.ts). Game links that
//     GameBridge already handles (data.url = cosquest://play) are left to it.
//   - A link (cosquest://..., the website's https links) that arrives while
//     signed out waits and opens after sign-in.
//   - The app badge = unread chats + unread notifications.
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";

import { parsePlayUrl } from "@/features/world/deepLink";
import { routeForNotification, routeForUrl, type PushData } from "@/features/world/links";
import { getPushToken, rememberedPushToken, rememberPushToken, setBadge, setForegroundHandler } from "@/services/push";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { registerDeviceThunk } from "@/store/thunks/settingsThunks";
import { getPref, setPref } from "@/utils/prefsStorage";

setForegroundHandler();

const HANDLED_PREF = "push.lastHandled";

let waiting: string | null = null;

/** Open a route now if signed in, or after sign-in. */
function openWhenSignedIn(route: string, signedIn: boolean) {
  if (!signedIn) {
    waiting = route;
    return;
  }
  waiting = null;
  router.push(route as any);
}

export default function PushBridge() {
  const dispatch = useAppDispatch();
  const token = useAppSelector((state) => state.auth.token);
  const chats = useAppSelector((state) => state.chat.conversations);
  const unreadNotifications = useAppSelector((state) => state.notification.unreadCount);
  const signedIn = useRef(false);
  signedIn.current = !!token;

  // ---------- the token ----------
  useEffect(() => {
    if (!token || Platform.OS === "web") return;
    let cancelled = false;
    const register = async () => {
      const pushToken = await getPushToken();
      if (cancelled || !pushToken) return;
      const result = await dispatch(registerDeviceThunk({ token, data: { pushToken, platform: Platform.OS } }));
      if (!cancelled && registerDeviceThunk.fulfilled.match(result)) await rememberPushToken(pushToken);
    };
    void register();
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") return;
      void (async () => {
        if (!(await rememberedPushToken())) void register();
      })();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [dispatch, token]);

  // ---------- after sign-in, the link that was waiting ----------
  useEffect(() => {
    if (token && waiting) {
      const route = waiting;
      waiting = null;
      // Let the signed-in screens mount first.
      const t = setTimeout(() => router.push(route as any), 600);
      return () => clearTimeout(t);
    }
  }, [token]);

  // ---------- taps ----------
  useEffect(() => {
    if (Platform.OS === "web") return;
    let cancelled = false;
    const handle = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const data = (response.notification.request.content.data ?? {}) as PushData;
      // GameBridge opens the game for these.
      if (typeof data.url === "string" && parsePlayUrl(data.url)) return;
      void setPref(HANDLED_PREF, response.notification.request.identifier);
      openWhenSignedIn(routeForNotification(data), signedIn.current);
    };
    Notifications.getLastNotificationResponseAsync()
      .then(async (response) => {
        const id = response?.notification.request.identifier;
        if (cancelled || !id || (await getPref(HANDLED_PREF)) === id) return;
        handle(response);
      })
      .catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  // ---------- links that arrive while signed out ----------
  useEffect(() => {
    const sub = Linking.addEventListener("url", ({ url }) => {
      const route = routeForUrl(url);
      // Signed in, expo-router opens it itself (app/+native-intent.tsx).
      if (route && !signedIn.current) waiting = route;
    });
    void Linking.getInitialURL().then((url) => {
      const route = routeForUrl(url);
      if (route && !signedIn.current) waiting = route;
    });
    return () => sub.remove();
  }, []);

  // ---------- badge ----------
  const unreadChats = chats.reduce((n, c: any) => n + Math.max(0, Math.floor(Number(c?.unreadCount) || 0)), 0);
  const badge = token ? unreadChats + (unreadNotifications || 0) : 0;
  useEffect(() => {
    void setBadge(badge);
  }, [badge]);

  return null;
}
