import { createElement as h, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Image, PanResponder, Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';

// In-app notifications, the way Instagram does it: while the app is open, a
// banner slides down from the top for a new message, like, comment, repost,
// follow, mention, post by someone you follow, or scheduled-call reminder.
// Tap it to open the thing, swipe it up to dismiss; it hides by itself after
// 4 seconds and the next one follows.
//
// Where they come from: with the app open, the backend does NOT send a push
// (the phone would deliver it silently to the app). It sends the same title,
// text and data over the socket instead, as the `banner` event:
//   { id, title, body, data: { type, chatId?, messageId?, postId?, commentId?,
//     callId?, scheduledCallId?, conversationId? }, channel, actor, at }
// (actor: { id, username, name, avatarKey, avatarPhotoUrl } - who did it).
// With the app in the background or closed, the normal push arrives instead.

// 1. Pushes that do arrive while the app is open (game events) show as a
//    banner too. Call once at startup, outside any component.
export function showPushesWhileOpen() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

// 2. Tapping a push (app in the background, or opened by the tap): call
//    onOpen(data) with the push's data, the same shape as a banner's data.
export function usePushTaps(onOpen) {
  const open = useRef(onOpen);
  open.current = onOpen;
  useEffect(() => {
    let handled = null;
    const handle = (response) => {
      const id = response?.notification?.request?.identifier;
      if (!id || id === handled) return;
      handled = id;
      open.current(response.notification.request.content.data || {});
    };
    Notifications.getLastNotificationResponseAsync().then(handle).catch(() => {});
    const subscription = Notifications.addNotificationResponseReceivedListener(handle);
    return () => subscription.remove();
  }, []);
}

const SHOW_MS = 4000;

// 3. The banner itself. Mount once, above the navigator:
//   h(InAppNotifications, { socket, onOpen: openFromNotification, currentChatId })
// onOpen(data): navigate by data.type - see the README. currentChatId: the
// chat on screen right now (its messages don't pop up while you're reading
// it). renderAvatar(actor) is optional (default: their photo, or initials).
export function InAppNotifications({ socket, onOpen, currentChatId = null, topInset, renderAvatar }) {
  const [current, setCurrent] = useState(null);
  const queue = useRef([]);
  const showing = useRef(false);
  const seen = useRef(new Set());
  const timer = useRef(null);
  const y = useRef(new Animated.Value(-160)).current;
  const chatOnScreen = useRef(currentChatId);
  chatOnScreen.current = currentChatId;

  const next = useCallback(() => {
    clearTimeout(timer.current);
    const banner = queue.current.shift() || null;
    showing.current = Boolean(banner);
    setCurrent(banner);
    if (!banner) return;
    y.setValue(-160);
    Animated.spring(y, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
    timer.current = setTimeout(() => hide(), SHOW_MS);
  }, [y]);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    Animated.timing(y, { toValue: -160, duration: 180, useNativeDriver: true }).start(() => next());
  }, [y, next]);

  useEffect(() => {
    if (!socket) return undefined;
    const onBanner = (banner) => {
      if (!banner?.id || seen.current.has(banner.id)) return;
      seen.current.add(banner.id);
      const type = banner.data?.type;
      if (type === 'call') return; // the ringing screen (call:incoming) shows calls
      if (type === 'message' && banner.data.chatId && banner.data.chatId === chatOnScreen.current) return;
      queue.current.push(banner);
      if (!showing.current) next();
    };
    socket.on('banner', onBanner);
    return () => socket.off('banner', onBanner);
  }, [socket, next]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (event, gesture) => Math.abs(gesture.dy) > 6,
    onPanResponderGrant: () => clearTimeout(timer.current),
    onPanResponderMove: (event, gesture) => y.setValue(Math.min(0, gesture.dy)),
    onPanResponderRelease: (event, gesture) => {
      if (gesture.dy < -20) hide();
      else {
        Animated.spring(y, { toValue: 0, useNativeDriver: true }).start();
        timer.current = setTimeout(() => hide(), SHOW_MS);
      }
    },
  })).current;

  if (!current) return null;
  const top = topInset ?? (Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 8 : 52);
  const avatar = renderAvatar ? renderAvatar(current.actor) : defaultAvatar(current.actor);

  return h(Animated.View, { style: [s.wrap, { top, transform: [{ translateY: y }] }], pointerEvents: 'box-none', ...pan.panHandlers },
    h(Pressable, {
      style: s.banner,
      accessibilityRole: 'button',
      accessibilityLabel: [current.title, current.body].filter(Boolean).join('. '),
      onPress: () => { const data = current.data || {}; hide(); onOpen?.(data); },
    },
      avatar,
      h(View, { style: s.text },
        current.title ? h(Text, { style: s.title, numberOfLines: 1 }, current.title) : null,
        h(Text, { style: s.body, numberOfLines: 2 }, current.body)))
  );
}

function defaultAvatar(actor) {
  if (actor?.avatarPhotoUrl) return h(Image, { source: { uri: actor.avatarPhotoUrl }, style: s.avatar });
  const initials = (actor?.name || actor?.username || 'C').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  return h(View, { style: [s.avatar, s.initials] }, h(Text, { style: s.initialsText }, initials));
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 10, right: 10, zIndex: 1000, elevation: 20 },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16,
    backgroundColor: '#1f1f2b', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  initials: { backgroundColor: '#ca4aa0', alignItems: 'center', justifyContent: 'center' },
  initialsText: { color: '#fff', fontWeight: '700' },
  text: { flex: 1 },
  title: { color: '#fff', fontWeight: '700', fontSize: 14 },
  body: { color: '#e4e4ee', fontSize: 14, marginTop: 1 },
});
