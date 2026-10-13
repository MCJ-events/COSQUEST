// The chat, floating over the game: a bubble tab on the left edge (the side
// the chat is on) with the unread count.
//   tap         back to the chat
//   long press  the last three conversations with something new; tap one to
//               go straight into it
//   drag right  the same swipe as the edge: the chat follows the finger
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector, type GestureType } from "react-native-gesture-handler";
import Animated, { FadeIn, FadeOut, runOnJS } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONTS } from "@/constants/fonts";
import { badgeText, unreadSummary } from "@/features/world/unread";
import { world } from "@/features/world/worldState";
import { useAppSelector } from "@/store/hooks";

/** Where the bubble sits, as a share of the screen height (inside the edge zone). */
export const BUBBLE_Y = 0.42;

export default function GameBubble({ makePan }: { makePan: () => GestureType }) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const conversations = useAppSelector((state) => state.chat.conversations);
  const summary = useMemo(() => unreadSummary(conversations), [conversations]);
  const [peek, setPeek] = useState(false);

  const openPeek = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setPeek(true);
  };

  const gesture = useMemo(
    () =>
      Gesture.Exclusive(
        makePan(),
        Gesture.LongPress()
          .minDuration(380)
          .onStart(() => {
            runOnJS(openPeek)();
          }),
        Gesture.Tap().onEnd((_event, success) => {
          if (success) runOnJS(goToChat)(null);
        }),
      ),
    // openPeek only sets state; makePan carries the gesture's own deps.
    [makePan],
  );

  const badge = badgeText(summary.count);
  const top = Math.max(insets.top + 72, height * BUBBLE_Y - 28);

  return (
    <>
      <GestureDetector gesture={gesture}>
        <View
          style={[styles.bubble, { top }]}
          accessible
          accessibilityRole="button"
          accessibilityLabel={badge ? `Chats, ${summary.count} unread` : "Chats"}
          accessibilityHint="Goes back to your chats. Long press to see the latest messages."
          accessibilityActions={[{ name: "activate" }, { name: "longpress" }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === "longpress") setPeek(true);
            else goToChat(null);
          }}>
          <Ionicons name="chevron-back" size={14} color="rgba(255,255,255,0.75)" />
          <Ionicons name="chatbubbles" size={22} color="#FFFFFF" />
          {badge ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
        </View>
      </GestureDetector>

      <Modal visible={peek} transparent animationType="none" onRequestClose={() => setPeek(false)}>
        <Pressable style={styles.scrim} onPress={() => setPeek(false)} accessibilityLabel="Close">
          <Animated.View
            entering={FadeIn.duration(140)}
            exiting={FadeOut.duration(100)}
            style={[styles.peek, { top: top - 8 }]}>
            <Text style={styles.peekTitle}>{summary.count ? "New messages" : "No new messages"}</Text>
            {summary.previews.map((item) => (
              <Pressable
                key={item.chatId}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() => {
                  setPeek(false);
                  goToChat(item.chatId);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}: ${item.text}`}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.rowText} numberOfLines={2}>
                  {item.text}
                </Text>
              </Pressable>
            ))}
            <Pressable
              style={({ pressed }) => [styles.allChats, pressed && styles.rowPressed]}
              onPress={() => {
                setPeek(false);
                goToChat(null);
              }}
              accessibilityRole="button">
              <Text style={styles.allChatsText}>All chats</Text>
              <Ionicons name="chevron-forward" size={14} color="#DC179F" />
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>
    </>
  );
}

function goToChat(chatId: string | null) {
  world.openChat(chatId);
}

const styles = StyleSheet.create({
  bubble: {
    position: "absolute",
    left: 0,
    height: 56,
    minWidth: 60,
    paddingLeft: 4,
    paddingRight: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    borderTopRightRadius: 28,
    borderBottomRightRadius: 28,
    backgroundColor: "rgba(28, 12, 34, 0.82)",
    borderWidth: 1,
    borderLeftWidth: 0,
    borderColor: "rgba(255,255,255,0.28)",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  badge: {
    position: "absolute",
    top: -6,
    right: -6,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#DC179F",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  badgeText: {
    color: "#FFFFFF",
    fontFamily: FONTS.bold,
    fontSize: 11,
  },
  scrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  peek: {
    position: "absolute",
    left: 70,
    right: 24,
    maxWidth: 340,
    padding: 10,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  peekTitle: {
    fontFamily: FONTS.semibold,
    fontSize: 12,
    color: "#7A6B7F",
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
  row: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 12,
  },
  rowPressed: {
    backgroundColor: "rgba(220, 23, 159, 0.08)",
  },
  rowTitle: {
    fontFamily: FONTS.semibold,
    fontSize: 14,
    color: "#1D1020",
  },
  rowText: {
    fontFamily: FONTS.regular,
    fontSize: 13,
    color: "#4A3D4F",
  },
  allChats: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 12,
  },
  allChatsText: {
    fontFamily: FONTS.semibold,
    fontSize: 13,
    color: "#DC179F",
  },
});
