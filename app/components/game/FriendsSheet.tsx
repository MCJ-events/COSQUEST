// Friends: add a friend standing beside you with a six-letter code, open the
// gifts friends sent, and send each friend one a day. No chat, and nobody
// sees where you are. costquest-ios Features/FriendsFeature.swift
// (FriendsSheet); the server (roam_social.py) decides every add and every
// gift, and its refusals are shown in its own words.
//
// iOS's "hold two phones together" card is not here: it needs the Bonjour
// peer link and Nearby Interaction, which an Android phone cannot share with
// an iPhone. The code is the same on both, so an iPhone can type this phone's
// code (under "Or use a code") and this phone can type an iPhone's.
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  canGiftTo,
  canSubmitCode,
  cleanCode,
  codeSecondsLeft,
  countdownText,
  daysLine,
  type FriendEntry,
  giftFromLine,
  levelTone,
  spelledCode,
} from "@/features/game/friends";
import { friendsModel, useFriends } from "@/features/game/friendsRuntime";
import { useGame } from "@/features/game/runtime";

import { Chip, GameButton } from "./kit";
import { GF, GP, realmColor } from "./theme";

export default function FriendsSheet({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const friends = useFriends();
  const { fix } = useGame();
  const [typed, setTyped] = useState("");

  useEffect(() => {
    void friendsModel.refresh();
    return () => friendsModel.dismissed();
  }, []);

  const add = async () => {
    const r = await friendsModel.add(typed);
    if (!r) return;
    setTyped("");
    if (r.added) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  const claim = async () => {
    const gifts = await friendsModel.claim();
    if (gifts?.length) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  const pending = friends.payload?.pending_gifts ?? 0;

  return (
    <Animated.View entering={SlideInDown.springify().damping(20)} exiting={SlideOutDown.duration(180)} style={[styles.sheet, { top: insets.top + 40 }]}>
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">
          Friends
        </Text>
        <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close Friends" hitSlop={8}>
          <Ionicons name="close" size={20} color={GP.navy} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.lead}>Friends are added face to face. No chat, and nobody sees where you are.</Text>

        <View style={[styles.panel, styles.addPanel]}>
          <View style={styles.addHead}>
            <Ionicons name="people" size={30} color={GP.berry} />
            <View style={{ flex: 1 }}>
              <Text style={styles.big}>Add a friend</Text>
              <Text style={styles.sub}>Stand beside them. One of you shows a code, the other types it.</Text>
            </View>
          </View>
          {!fix ? (
            <View style={styles.row}>
              <ActivityIndicator color={GP.navy} />
              <Text style={styles.sub}>Waiting for your location</Text>
            </View>
          ) : (
            <>
              <MyCode />
              <View style={styles.divider} />
              <Text style={styles.label}>{"Got a friend's code?"}</Text>
              <View style={styles.row}>
                <TextInput
                  value={typed}
                  onChangeText={(v) => setTyped(cleanCode(v))}
                  placeholder="ABC234"
                  placeholderTextColor="rgba(30,58,76,0.3)"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  autoComplete="off"
                  spellCheck={false}
                  // No suggestion strip on Android: it would "correct" a code.
                  keyboardType={Platform.OS === "android" ? "visible-password" : "default"}
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    if (canSubmitCode(typed) && !friends.busy) void add();
                  }}
                  style={styles.input}
                  accessibilityLabel="Friend's code"
                />
                <GameButton
                  title="Add"
                  small
                  color={GP.mint}
                  onPress={() => void add()}
                  disabled={!canSubmitCode(typed) || friends.busy}
                  accessibilityLabel="Add the friend with this code"
                />
              </View>
            </>
          )}
        </View>

        {friends.message ? (
          <View style={[styles.panel, styles.message]} accessibilityLiveRegion="polite">
            <Text style={styles.messageText}>{friends.message}</Text>
          </View>
        ) : null}

        {pending > 0 || friends.opened.length ? (
          <View style={styles.panel}>
            {pending > 0 ? (
              <GameButton
                title={`Open gifts (${pending})`}
                color={GP.sun}
                icon={<Ionicons name="gift" size={20} color="#FFF" />}
                onPress={() => void claim()}
                disabled={friends.busy}
              />
            ) : null}
            {friends.opened.length ? (
              <>
                <Text style={styles.big}>Gifts arrived</Text>
                {friends.opened.map((g, i) => (
                  <View key={`${i}-${g.item}`} style={styles.row} accessibilityLabel={`${g.name}, ${giftFromLine(g)}`}>
                    <Ionicons name="gift" size={18} color={GP.berry} />
                    <Text style={[styles.name, { flex: 1 }]}>{g.name}</Text>
                    <Text style={styles.sub}>{giftFromLine(g)}</Text>
                  </View>
                ))}
              </>
            ) : null}
          </View>
        ) : null}

        <View style={styles.panel}>
          <Text style={styles.big}>Your friends</Text>
          {friends.payload ? (
            friends.payload.friends.length ? (
              friends.payload.friends.map((f) => <FriendRow key={f.friend_key} f={f} busy={friends.busy} canGift={canGiftTo(friends, f)} />)
            ) : (
              <Text style={styles.sub}>No friends yet. Meet up, show your code, and play together.</Text>
            )
          ) : friends.failed ? (
            <>
              <Text style={styles.sub}>{"Can't load your friends right now."}</Text>
              <GameButton title="Try again" small color={GP.skyDeep} onPress={() => void friendsModel.refresh()} style={{ alignSelf: "flex-start" }} />
            </>
          ) : (
            <ActivityIndicator color={GP.navy} />
          )}
        </View>
      </ScrollView>
    </Animated.View>
  );
}

/** Your live code with its countdown, or the button that makes one. */
function MyCode() {
  const friends = useFriends();
  const [now, setNow] = useState(() => Date.now());
  const live = friends.codeExpiresAt !== null;
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live, friends.codeExpiresAt]);

  const left = codeSecondsLeft(friends.codeExpiresAt, now);
  if (!friends.code || left <= 0) {
    return (
      <GameButton
        title={friends.code ? "Code expired. New code" : "Show my code"}
        color={GP.skyDeep}
        onPress={() => void friendsModel.makeCode()}
        disabled={friends.busy}
      />
    );
  }
  return (
    <View style={styles.codeBox}>
      <Pressable
        onPress={() => void friendsModel.makeCode()}
        disabled={friends.busy}
        accessibilityRole="button"
        accessibilityLabel={`Your code ${spelledCode(friends.code.code)}. Tap for a new one.`}>
        <Text style={styles.code} selectable>
          {friends.code.code}
        </Text>
      </Pressable>
      <Chip text={`Valid ${countdownText(left)}`} color={left < 60 ? GP.berry : GP.skyDeep} />
      <Text style={styles.sub}>Show this to a friend standing beside you, or read it out.</Text>
    </View>
  );
}

function FriendRow({ f, busy, canGift }: { f: FriendEntry; busy: boolean; canGift: boolean }) {
  return (
    <View style={styles.friend}>
      <View style={[styles.dot, { backgroundColor: realmColor(f.faction) }]} accessibilityElementsHidden importantForAccessibility="no" />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.name} numberOfLines={1}>
          {f.handle}
        </Text>
        <View style={styles.row}>
          <Chip text={f.level_name} color={GP[levelTone(f.level_name)]} />
          <Text style={styles.sub} numberOfLines={1}>
            {daysLine(f)}
          </Text>
        </View>
      </View>
      <GameButton
        title={canGift ? "Gift" : "Sent"}
        small
        color={GP.berry}
        icon={<Ionicons name={canGift ? "gift" : "checkmark"} size={16} color="#FFF" />}
        onPress={() => void friendsModel.gift(f)}
        disabled={!canGift || busy}
        accessibilityLabel={canGift ? `Send ${f.handle} a gift` : `Gift sent to ${f.handle} today`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: GP.cream, elevation: 18 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingTop: 16, paddingBottom: 8 },
  title: { fontFamily: GF.display, fontSize: 26, color: GP.ink },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: GP.ice, alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: 16, gap: 14 },
  lead: { fontFamily: GF.body, fontSize: 15, color: GP.ink },
  panel: { padding: 14, borderRadius: 18, backgroundColor: "#FFF", gap: 12 },
  addPanel: { backgroundColor: "#FFF4E3" },
  addHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  big: { fontFamily: GF.display, fontSize: 19, color: GP.ink },
  sub: { fontFamily: GF.body, fontSize: 13, color: GP.mist, flexShrink: 1 },
  label: { fontFamily: GF.bold, fontSize: 15, color: GP.ink },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: GP.slate },
  input: {
    flex: 1,
    height: 52,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "rgba(30,58,76,0.15)",
    backgroundColor: "#FFF",
    fontFamily: Platform.OS === "android" ? "monospace" : "Menlo",
    fontSize: 24,
    letterSpacing: 4,
    color: GP.ink,
  },
  codeBox: { alignItems: "center", gap: 10 },
  code: { fontFamily: Platform.OS === "android" ? "monospace" : "Menlo", fontWeight: "800", fontSize: 44, letterSpacing: 6, color: GP.ink },
  message: { backgroundColor: GP.sun },
  messageText: { fontFamily: GF.bold, fontSize: 15, color: "#FFF" },
  friend: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  name: { fontFamily: GF.bold, fontSize: 16, color: GP.ink },
});
