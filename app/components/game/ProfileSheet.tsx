// Who a player is, what they have won, and how they want the game to behave:
// three tabs (Hero, Record, Settings) and the name-and-emblem editor.
// costquest-ios UI/ProfileView.swift, UI/HeroStage.swift, UI/AvatarView.swift.
//
// Left out on purpose, with the reason:
//  - "Appearance" (Automatic / Light / Dark): it set SwiftUI's colour scheme,
//    which the game's own palette never read; the app's light or dark is the
//    chat app's setting. "Time in town" is here: it lights the map
//    (features/game/mapStyle.ts).
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as Application from "expo-application";
import * as Haptics from "expo-haptics";
import { type ComponentProps, type ReactNode, useCallback, useEffect, useState } from "react";
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  AVATAR_MARK_NAMES,
  AVATAR_MARKS,
  AVATAR_PALETTE,
  cleanHandle,
  DEFAULT_AVATAR,
  equippedOf,
  fetchProfileFull,
  heroPower,
  heroTitle,
  moneyText,
  placed,
  type ProfileFull,
  statBars,
  validHandle,
  wallCurrency,
  wallSubtitle,
  xpToNext,
} from "@/features/game/profile";
import { gameStore, useGame } from "@/features/game/runtime";
import type { ProfileAvatar } from "@/features/game/wire";

import AvatarView from "./AvatarView";
import { PlayerAvatar } from "./ForgeWorld";
import { HeroStatBar, XPBar } from "./Bars";
import HeroStage, { HeroSlot, SlotIcon } from "./HeroStage";
import { WORLD_CLOCKS } from "@/features/game/mapStyle";
import { Chip, GameButton, GameCoin, GameHeading, GameIconButton, GamePanel, MAX_FONT_SCALE, pressFeedback } from "./kit";
import { notify, setHapticsOn, setWorldClock, useHapticsOn, useWorldClock } from "./prefs";
import { RelicArt } from "./RelicArt";
import { SheetHost } from "./Sheet";
import StancePicker from "./StancePicker";
import { GameBackdrop } from "./GameBackdrop";
import { SheetFrame } from "./SheetFrame";
import { playSound } from "./sound";
import { edgeOf, GF, GP, realmColor } from "./theme";
import { useWardenMuted, wardenVoice } from "./wardenVoice";

type Tab = "hero" | "record" | "settings";
const TABS: { id: Tab; label: string }[] = [
  { id: "hero", label: "Hero" },
  { id: "record", label: "Record" },
  { id: "settings", label: "Settings" },
];

const INK55 = "rgba(31,59,77,0.55)";
const INK60 = "rgba(31,59,77,0.6)";

type ProfileProps = { onClose: () => void; onCoins?: () => void; initial?: Tab };

export default function ProfileSheet(props: ProfileProps) {
  const insets = useSafeAreaInsets();
  return (
    <SheetHost band={{ top: 0, height: insets.top + 130 }} scrimLabel="Close your profile" onClose={props.onClose}>
      {(close) => <ProfileBody {...props} close={close} />}
    </SheetHost>
  );
}

function ProfileBody({ close, onCoins, initial = "hero" }: ProfileProps & { close: () => void }) {
  const insets = useSafeAreaInsets();
  const me = useGame((s) => s.me);
  const [tab, setTab] = useState<Tab>(initial);
  const [profile, setProfile] = useState<ProfileFull | null>(null);
  const [editing, setEditing] = useState(false);
  const [showAllWall, setShowAllWall] = useState(false);

  const load = useCallback(async () => {
    void gameStore.refreshMe();
    try {
      setProfile(await fetchProfileFull(gameStore.client));
    } catch {
      // A 404 is the normal state for a player who has never set one up; anything else keeps what we had.
    }
  }, []);
  useEffect(() => {
    let alive = true;
    void gameStore.refreshMe();
    fetchProfileFull(gameStore.client)
      .then((p) => {
        if (alive) setProfile(p);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Android Back closes the editor first, then the sheet (the root's handler).
  useEffect(() => {
    if (!editing) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setEditing(false);
      return true;
    });
    return () => sub.remove();
  }, [editing]);

  const handle = profile?.handle || me?.handle || "";
  const avatar = profile?.avatar ?? DEFAULT_AVATAR;
  const tint = realmColor(me?.faction);

  return (
    <SheetFrame top={0} full>
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <GameIconButton icon="arrow-back" color={GP.slate} diameter={42} onPress={close} accessibilityLabel="Back" />
        <View style={{ flex: 1 }}>
          <GameHeading text="PROFILE" size={28} />
        </View>
        {me ? (
          <Pressable
            disabled={!onCoins}
            onPress={onCoins}
            onPressIn={onCoins ? pressFeedback : undefined}
            accessibilityRole={onCoins ? "button" : undefined}
            accessibilityLabel={`${me.coins} CosCoins`}
            accessibilityHint={onCoins ? "Opens your CosCoins" : undefined}
            style={styles.coinPill}>
            <GameCoin size={18} />
            <Text style={styles.coinPillText}>{me.coins}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <Pressable key={t.id} onPress={() => setTab(t.id)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[styles.tab, on && styles.tabOn]}>
              <View style={[styles.tabDot, { backgroundColor: on ? GP.sun : "rgba(54,122,140,0.6)" }]} />
              <Text style={[styles.tabText, { color: on ? GP.ink : GP.mist }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {t.label.toUpperCase()}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
        <Animated.View key={tab} entering={FadeIn.duration(300)} style={tab === "hero" ? undefined : styles.pad}>
          {tab === "hero" ? (
            <HeroTab tint={tint} handle={handle} onEdit={() => setEditing(true)} />
          ) : tab === "record" ? (
            <RecordTab profile={profile} showAll={showAllWall} onShowAll={() => setShowAllWall(true)} />
          ) : (
            <SettingsTab handle={handle} avatar={avatar} onEdit={() => setEditing(true)} />
          )}
        </Animated.View>
      </ScrollView>

      {editing ? (
        <ProfileEditor
          initialHandle={handle}
          initialAvatar={avatar}
          onCancel={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await load();
          }}
        />
      ) : null}
    </SheetFrame>
  );
}

// ---------- Hero ----------

function HeroTab({ tint, handle, onEdit }: { tint: string; handle: string; onEdit: () => void }) {
  const me = useGame((s) => s.me);
  const equipped = equippedOf(me);
  return (
    <View>
      <HeroStage tint={tint} height={330} />
      <View style={styles.heroCard}>
        <View style={styles.nameRow}>
          <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel="Edit name and emblem" style={styles.nameButton}>
            <Text style={styles.heroName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {(handle || "Your hero").toUpperCase()}
            </Text>
            <Ionicons name="pencil" size={14} color={GP.mist} />
          </Pressable>
          <View accessible accessibilityLabel={`Power ${heroPower(me)}`} style={styles.powerRow}>
            <Text style={styles.powerLabel}>POWER:</Text>
            <Text style={styles.powerValue}>{heroPower(me)}</Text>
          </View>
        </View>
        <View style={styles.rule} />
        <Text style={styles.heroTitle} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {heroTitle(me)}
        </Text>
        {me ? statBars(me).map((b) => <HeroStatBar key={b.name} icon={b.icon} name={b.name} value={b.value} extra={b.extra} progress={b.progress} />) : null}
        <View style={[styles.rule, { marginTop: 4 }]} />
        <Text style={styles.equipLabel}>CURRENT EQUIPMENT</Text>
        <View style={styles.slots}>
          <HeroSlot label="Relic" locked={!equipped} a11y={equipped ? `Relic, ${equipped.name}` : "Relic, none equipped"}>
            {equipped ? <RelicArt kind={equipped.kind} rarity={equipped.rarity} size={52} /> : <SlotIcon name="diamond-outline" />}
          </HeroSlot>
          <HeroSlot label="Outfit" locked>
            <SlotIcon name="shirt" />
          </HeroSlot>
          <HeroSlot label="Charm" locked>
            <SlotIcon name="sparkles" />
          </HeroSlot>
          <HeroSlot label="Emote" locked>
            <SlotIcon name="happy" />
          </HeroSlot>
        </View>
        {me?.features?.duel ? (
          <>
            <View style={styles.rule} />
            <StancePicker duel={me.features.duel} />
          </>
        ) : null}
      </View>
    </View>
  );
}

// ---------- Record ----------

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.sectionLabel} accessibilityRole="header">
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

function Stat({ value, label, icon, color }: { value: string; label: string; icon: ComponentProps<typeof Ionicons>["name"]; color: string }) {
  return (
    <GamePanel padding={12} style={{ flex: 1 }}>
      <View accessible accessibilityLabel={`${label}, ${value}`} style={styles.statRow}>
        <View style={[styles.statIcon, { backgroundColor: color }]}>
          <Ionicons name={icon} size={15} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {value}
          </Text>
          <Text style={styles.statLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {label.toUpperCase()}
          </Text>
        </View>
      </View>
    </GamePanel>
  );
}

function RecordTab({ profile, showAll, onShowAll }: { profile: ProfileFull | null; showAll: boolean; onShowAll: () => void }) {
  const me = useGame((s) => s.me);
  const wall = profile?.wall ?? [];
  const shown = showAll ? wall : wall.slice(0, 4);
  const currency = wallCurrency(wall);
  return (
    <View style={{ gap: 18 }}>
      {me ? (
        <Section title="Your progress">
          <GamePanel padding={16}>
            <View style={{ gap: 10 }}>
              <View style={styles.levelRow}>
                <Text style={styles.levelTitle}>{`Level ${me.standing.level}`}</Text>
                <Text style={styles.levelRank}>{me.standing.rank}</Text>
                <View style={{ flex: 1 }} />
                {me.faction ? <Chip text={me.faction_name ?? me.faction} color={realmColor(me.faction)} /> : null}
              </View>
              <XPBar progress={me.standing.max_level ? 1 : me.standing.into_level / Math.max(1, me.standing.level_span)} />
              <Text style={styles.xpLine}>{xpToNext(me)}</Text>
            </View>
          </GamePanel>
          <View style={styles.pair}>
            <Stat value={String(me.coins)} label="Coins" icon="disc" color={GP.sunDeep} />
            <Stat value={String(me.streak.best)} label="Best streak" icon="flame" color={GP.berry} />
          </View>
          <View style={styles.pair}>
            <Stat value={String(me.faction_points)} label="For your faction" icon="flag" color={realmColor(me.faction)} />
          </View>
        </Section>
      ) : null}
      <Section title="Your events">
        <View style={styles.pair}>
          <Stat value={String(profile?.games_played ?? 0)} label="Played" icon="game-controller" color={GP.skyDeep} />
          <Stat value={String(profile?.games_won ?? 0)} label="Won" icon="trophy" color={GP.berry} />
        </View>
        <View style={styles.pair}>
          <GamePanel padding={12} style={{ flex: 1 }}>
            <View accessible accessibilityLabel={`Tokens, ${profile?.tokens_total ?? 0}`} style={styles.statRow}>
              <GameCoin size={32} />
              <View>
                <Text style={styles.statValue}>{profile?.tokens_total ?? 0}</Text>
                <Text style={styles.statLabel}>TOKENS</Text>
              </View>
            </View>
          </GamePanel>
          {/* Prizes are shown even at zero: "you have won nothing yet" is information a player wants. */}
          <Stat value={moneyText(profile?.prizes_cents ?? 0, currency)} label="Prizes" icon="ribbon" color={GP.sunDeep} />
        </View>
      </Section>
      {profile?.in_progress.length ? (
        <Section title="Playing now">
          <GamePanel padding={14}>
            <View style={{ gap: 10 }}>
              {profile.in_progress.map((g) => (
                <View key={g.game_id} accessible accessibilityLabel={`Live, ${g.title}, ${g.tokens} tokens`} style={styles.liveRow}>
                  <Chip text="Live" />
                  <Text style={styles.liveTitle} numberOfLines={1}>
                    {g.title}
                  </Text>
                  <GameCoin size={20} />
                  <Text style={styles.liveTitle}>{g.tokens}</Text>
                </View>
              ))}
            </View>
          </GamePanel>
        </Section>
      ) : null}
      {wall.length ? (
        <Section title="Your wall">
          <GamePanel padding={14}>
            <View style={{ gap: 12 }}>
              {shown.map((r) => (
                <View
                  key={r.game_id}
                  accessible
                  accessibilityLabel={`${r.title}${r.placing ? `, ${placed(r.placing)}` : ""}${r.prize_cents > 0 ? `, ${moneyText(r.prize_cents, r.currency)}` : ""}, ${wallSubtitle(r)}`}
                  style={{ gap: 4 }}>
                  <View style={styles.wallHead}>
                    <Text style={styles.wallTitle} numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                      {r.title}
                    </Text>
                    {r.prize_cents > 0 ? <Text style={[styles.wallTitle, { color: GP.sunDeep }]}>{moneyText(r.prize_cents, r.currency)}</Text> : null}
                  </View>
                  <View style={styles.wallMeta}>
                    {r.placing ? <Chip text={placed(r.placing)} color={r.placing === 1 ? GP.sunDeep : GP.skyDeep} /> : null}
                    {r.faction ? <Text style={styles.wallFaction}>{r.faction.charAt(0).toUpperCase() + r.faction.slice(1)}</Text> : null}
                    <GameCoin size={16} />
                    <Text style={styles.wallTokens}>{r.tokens}</Text>
                  </View>
                </View>
              ))}
              {!showAll && wall.length > 4 ? <GameButton title={`All ${wall.length} results`} size="small" color={GP.skyDeep} onPress={onShowAll} style={{ alignSelf: "flex-start" }} /> : null}
            </View>
          </GamePanel>
          <Text style={styles.note}>Every game you have finished. This survives the game being deleted.</Text>
        </Section>
      ) : null}
    </View>
  );
}

// ---------- Settings ----------

function OnOff({ on, onPress, label }: { on: boolean; onPress: () => void; label: string }) {
  return (
    <GameButton
      title={on ? "ON" : "OFF"}
      size="small"
      color={on ? GP.mint : "#8C8C8C"}
      onPress={onPress}
      accessibilityLabel={`${label}, ${on ? "on" : "off"}`}
      accessibilityHint="Double tap to switch"
    />
  );
}

function SettingsTab({ handle, avatar, onEdit }: { handle: string; avatar: ProfileAvatar; onEdit: () => void }) {
  const me = useGame((s) => s.me);
  const haptics = useHapticsOn();
  const muted = useWardenMuted();
  const clock = useWorldClock();
  const version = `${Constants.expoConfig?.version ?? "?"} (${Application.nativeBuildVersion ?? "?"})`;
  return (
    <View style={{ gap: 18 }}>
      <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel={handle ? `${handle}, level ${me?.standing.level ?? 1}. Edit name and emblem.` : "Set up your profile"}>
        <GamePanel padding={16}>
          <View style={styles.identity}>
            <PlayerAvatar stage size={72} fallback={<AvatarView avatar={avatar} size={72} />} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.identityName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {handle || "Set up your profile"}
              </Text>
              <View style={styles.identityMeta}>
                <Chip text={`Lv ${me?.standing.level ?? 1}`} color={GP.skyDeep} />
                <Text style={styles.identityHint} numberOfLines={2}>
                  {handle ? "Tap to edit" : "Pick a name and an emblem"}
                </Text>
              </View>
            </View>
            <View style={styles.pencil}>
              <Ionicons name="pencil" size={16} color="#FFFFFF" />
            </View>
          </View>
        </GamePanel>
      </Pressable>

      <Section title="The world">
        <GamePanel padding={14}>
          <View style={{ gap: 14 }}>
            <Text style={styles.prefTitle} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              Time in town
            </Text>
            <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel="Time in town">
              {WORLD_CLOCKS.map((c) => (
                <GameButton
                  key={c.id}
                  title={c.label}
                  size="small"
                  color={c.id === clock ? GP.skyDeep : "#999999"}
                  onPress={() => setWorldClock(c.id)}
                  accessibilityLabel={c.id === clock ? `${c.label}, selected` : c.label}
                />
              ))}
            </View>
            <View style={styles.prefRow}>
              <Text style={styles.prefTitle}>Haptics</Text>
              <OnOff
                on={haptics}
                label="Haptics"
                onPress={() => {
                  const next = !haptics;
                  setHapticsOn(next);
                  // Feel the setting you just chose.
                  if (next) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                }}
              />
            </View>
            <View style={styles.prefRow}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.prefTitle}>The Warden speaks</Text>
                <Text style={styles.prefNote}>Its lines are written on your phone either way.</Text>
              </View>
              <OnOff on={!muted} label="The Warden speaks" onPress={() => wardenVoice.setMuted(!muted)} />
            </View>
          </View>
        </GamePanel>
        <Text style={styles.note} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          The town is lit for the hour you are playing in. Fix it to a time if you would rather not wait until dark to see it that way.
        </Text>
      </Section>

      <View style={{ paddingBottom: 26 }}>
        <GamePanel padding={14}>
          <View accessible accessibilityLabel={`Version, ${version}`} style={styles.prefRow}>
            <Text style={styles.prefTitle}>Version</Text>
            <Text style={styles.version}>{version}</Text>
          </View>
        </GamePanel>
        <Text style={[styles.note, { marginTop: 10 }]}>The world is built by CosQuest.</Text>
      </View>
    </View>
  );
}

// ---------- the editor ----------

/** Name and emblem, on its own screen (ProfileEditor): its own Cancel and Save. */
function ProfileEditor({
  initialHandle,
  initialAvatar,
  onCancel,
  onSaved,
}: {
  initialHandle: string;
  initialAvatar: ProfileAvatar;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [handle, setHandle] = useState(initialHandle);
  const [avatar, setAvatar] = useState<ProfileAvatar>(initialAvatar);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canSave = !saving && validHandle(handle);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await gameStore.saveProfile(cleanHandle(handle), avatar);
      playSound("coin");
      notify(Haptics.NotificationFeedbackType.Success);
      await onSaved();
    } catch {
      setMessage("Couldn't save your profile. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Animated.View entering={FadeIn.duration(200)} style={[StyleSheet.absoluteFill, { backgroundColor: GP.ice }]} accessibilityViewIsModal>
      <GameBackdrop />
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={[styles.editor, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 30 }]}>
        <View style={styles.editorHead}>
          <GameIconButton icon="close" color={GP.navy} diameter={42} onPress={onCancel} accessibilityLabel="Cancel" />
          <View style={{ flex: 1 }}>
            <GameHeading text="Your profile" size={32} />
          </View>
        </View>

        <GamePanel padding={16}>
          <View style={{ gap: 14, alignItems: "center" }}>
            <AvatarView avatar={avatar} size={104} />
            <TextInput
              value={handle}
              onChangeText={setHandle}
              maxLength={24}
              autoCapitalize="words"
              autoCorrect={false}
              placeholder="Your name"
              placeholderTextColor="rgba(31,59,77,0.3)"
              accessibilityLabel="Your name"
              style={styles.nameInput}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            />
          </View>
        </GamePanel>

        <Text style={styles.sectionLabel} accessibilityRole="header">
          EMBLEM
        </Text>
        <GamePanel padding={14}>
          <View style={styles.flow}>
            {AVATAR_MARKS.map((icon, i) => {
              const on = avatar.mark === i;
              return (
                <GameIconButton
                  key={icon}
                  icon={icon}
                  color={on ? safe(avatar.tint) : "#999999"}
                  diameter={50}
                  onPress={() => setAvatar({ ...avatar, mark: i })}
                  accessibilityLabel={on ? `${AVATAR_MARK_NAMES[i]}, selected` : AVATAR_MARK_NAMES[i]}
                />
              );
            })}
          </View>
        </GamePanel>

        <Text style={styles.sectionLabel} accessibilityRole="header">
          COLOUR
        </Text>
        <GamePanel padding={14}>
          <View style={[styles.flow, { gap: 14 }]}>
            {AVATAR_PALETTE.map((hex) => {
              const on = avatar.tint.toLowerCase() === hex.toLowerCase();
              return (
                <Pressable
                  key={hex}
                  onPressIn={pressFeedback}
                  onPress={() => setAvatar({ ...avatar, tint: hex })}
                  accessibilityRole="button"
                  accessibilityLabel={on ? `Colour ${hex}, selected` : `Colour ${hex}`}
                  hitSlop={4}
                  style={[styles.swatchRing, on && { borderColor: GP.ink }]}>
                  <View style={[styles.swatchEdge, { backgroundColor: edgeOf(hex) }]} />
                  <View style={[styles.swatch, { backgroundColor: hex }]}>{on ? <Ionicons name="checkmark" size={20} color={hex === "#F4F4F5" ? GP.ink : "#FFFFFF"} /> : null}</View>
                </Pressable>
              );
            })}
          </View>
        </GamePanel>

        {message ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {message}
          </Text>
        ) : null}
        <GameButton title={saving ? "Saving..." : "SAVE"} color={GP.mint} disabled={!canSave} onPress={save} accessibilityLabel="Save" />
      </ScrollView>
    </Animated.View>
  );
}

const safe = (hex: string) => (/^#[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_AVATAR.tint);

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingBottom: 4 },
  coinPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.6)" },
  coinPillText: { fontFamily: GF.display, fontSize: 15, color: GP.ink },
  tabs: { flexDirection: "row", justifyContent: "center", gap: 4, paddingVertical: 8 },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999 },
  tabOn: { backgroundColor: "#FFFFFF", shadowColor: GP.navy, shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  tabDot: { width: 6, height: 6, borderRadius: 3 },
  tabText: { fontFamily: GF.display, fontSize: 14, letterSpacing: 0.8 },
  pad: { paddingHorizontal: 18 },
  heroCard: {
    gap: 14,
    padding: 20,
    marginTop: -2,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    backgroundColor: "rgba(242,247,249,0.94)",
    shadowColor: GP.navy,
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -4 },
  },
  nameRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  nameButton: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  heroName: { flexShrink: 1, fontFamily: GF.display, fontSize: 36, color: GP.ink },
  powerRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  powerLabel: { fontFamily: GF.display, fontSize: 13, color: GP.mist },
  powerValue: { fontFamily: GF.display, fontSize: 24, color: GP.sun },
  rule: { height: 1, backgroundColor: GP.track },
  heroTitle: { fontFamily: GF.bold, fontSize: 14, letterSpacing: 0.5, color: GP.mist },
  equipLabel: { fontFamily: GF.display, fontSize: 13, letterSpacing: 0.8, color: GP.mist },
  slots: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  sectionLabel: { paddingLeft: 6, fontFamily: GF.display, fontSize: 18, letterSpacing: 0.8, color: "#FFFFFF", textShadowColor: "rgba(31,59,77,0.6)", textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 0.1 },
  pair: { flexDirection: "row", gap: 10 },
  statRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 2.5, borderColor: GP.ink },
  statValue: { fontFamily: GF.display, fontSize: 24, color: GP.ink },
  statLabel: { fontFamily: GF.display, fontSize: 12, color: GP.ink, opacity: 0.55 },
  levelRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  levelTitle: { fontFamily: GF.display, fontSize: 26, color: GP.ink },
  levelRank: { fontFamily: GF.body, fontSize: 16, color: INK60 },
  xpLine: { fontFamily: GF.body, fontSize: 14, color: INK60 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  liveTitle: { flex: 1, fontFamily: GF.display, fontSize: 18, color: GP.ink },
  wallHead: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  wallTitle: { flexShrink: 1, fontFamily: GF.display, fontSize: 18, color: GP.ink },
  wallMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  wallFaction: { fontFamily: GF.body, fontSize: 13, color: INK60 },
  wallTokens: { fontFamily: GF.bold, fontSize: 13, color: "rgba(31,59,77,0.7)" },
  note: { fontFamily: GF.body, fontSize: 12, color: GP.ink, paddingHorizontal: 6 },
  identity: { flexDirection: "row", alignItems: "center", gap: 14 },
  identityName: { fontFamily: GF.display, fontSize: 26, color: GP.ink },
  identityMeta: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  identityHint: { flexShrink: 1, fontFamily: GF.body, fontSize: 13, color: INK55 },
  pencil: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: GP.sun, borderWidth: 2.5, borderColor: GP.ink },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  prefRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  prefTitle: { fontFamily: GF.display, fontSize: 17, color: GP.ink },
  prefNote: { fontFamily: GF.body, fontSize: 12, color: INK55 },
  version: { fontFamily: GF.body, fontSize: 15, color: INK60 },
  editor: { paddingHorizontal: 18, gap: 16 },
  editorHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  nameInput: {
    alignSelf: "stretch",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 3.5,
    borderColor: GP.ink,
    backgroundColor: "#FFFFFF",
    fontFamily: GF.display,
    fontSize: 22,
    color: GP.ink,
  },
  flow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  swatchRing: { width: 52, height: 52, borderRadius: 26, borderWidth: 3.5, borderColor: "transparent", alignItems: "center", justifyContent: "center" },
  swatchEdge: { position: "absolute", width: 44, height: 44, borderRadius: 22, top: 6 },
  swatch: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "rgba(255,255,255,0.35)", marginTop: -2 },
  error: { fontFamily: GF.body, fontSize: 14, color: "#FFFFFF", padding: 12, borderRadius: 14, backgroundColor: GP.berry, overflow: "hidden" },
});
