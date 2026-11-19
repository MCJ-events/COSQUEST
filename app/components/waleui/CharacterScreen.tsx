// The character picker (build 29, Subomi, 18 Nov 2026): pick who you are. Fights play your character's 3D model;
// here, on your profile and on the card you share it is the character's 2D art (characterArt.ts), a picture to
// show off, not something you interact with. Drawn in Wale's style like the Faction screen (his canvas, glass
// cards, pink), reached from his Home (tap your character) and from the profile. "Faction hero" = no pick: the
// hero of your faction, as before. The pick is kept on the phone (characterStore.ts). Logic and roster:
// features/waleui/characters.ts (tested).
// Build 30: eleven tiles in three rows (Faction hero, the six heroes, the four Forge characters), the large picture
// a little shorter so all three rows sit above the buttons.
import { Asset } from "expo-asset";
import { Image } from "expo-image";
import { useState } from "react";
import { Platform, Share } from "react-native";

import { CHARACTERS, characterLine, playerCharacter, shareLine } from "@/features/waleui/characters";
import { heroForFaction } from "@/features/waleui/heroCast";

import { characterArt } from "./characterArt";
import { setPickedCharacter, usePickedCharacter } from "./characterStore";
import { back } from "./go";
import { usePlayerFaction } from "./heroArt";
import { At, Check, DesignCanvas, LineIcon, T, Tap, W, glass } from "./kit";

const FW = 430;
const FH = 932;
const AUTO = "auto";
const COLS = 4;
const TILE_W = 88;
const TILE_H = 100;
const GAP = 8;
const GRID_Y = 432;

/** Hand a character's 9:16 card to the share sheet (the bundled picture as a file); the line alone if that fails. */
export async function shareCharacterCard(key: string): Promise<boolean> {
  const c = CHARACTERS.find((x) => x.key === key);
  const art = characterArt(key);
  if (!c || !art) return false;
  const message = shareLine(c, null);
  try {
    const [a] = await Asset.loadAsync(art.share);
    const uri = a?.localUri ?? a?.uri ?? null;
    if (Platform.OS === "web") {
      if (uri && typeof window !== "undefined") window.open(uri, "_blank", "noopener");
      return true;
    }
    await Share.share(uri ? { url: uri, message } : { message, title: "My CosQuest character" }, { subject: "My CosQuest character" });
    return true;
  } catch {
    try {
      await Share.share({ message, title: "My CosQuest character" });
      return true;
    } catch {
      return false;
    }
  }
}

export default function CharacterScreen() {
  const pick = usePickedCharacter();
  const faction = usePlayerFaction();
  const [sel, setSel] = useState<string>(pick ?? AUTO);
  const [notice, setNotice] = useState<string | null>(null);

  const factionHero = heroForFaction(faction);
  const shown = playerCharacter(sel === AUTO ? null : sel, faction);
  const art = characterArt(shown?.key);
  const current = (pick ?? AUTO) === sel;
  const tiles: { id: string; name: string; portrait: number | null }[] = [
    { id: AUTO, name: "Faction hero", portrait: characterArt(factionHero?.key)?.portrait ?? null },
    ...CHARACTERS.map((c) => ({ id: c.key, name: c.name, portrait: characterArt(c.key)?.portrait ?? null })),
  ];

  const save = () => {
    setPickedCharacter(sel === AUTO ? null : sel);
    setNotice(shown ? `You are ${shown.name}. Your next fight plays ${shown.name}.` : "Saved. Join a faction to get its hero.");
  };

  const share = async () => {
    if (!shown) return;
    const ok = await shareCharacterCard(shown.key);
    if (!ok) setNotice("Sharing didn't work. Try again.");
  };

  const footer = (
    <>
      <Tap
        x={24}
        y={770}
        w={262}
        h={56}
        label={current ? "This is you" : `Play as ${shown?.name ?? "your faction hero"}`}
        disabled={current}
        onPress={save}
        style={{ backgroundColor: current ? W.chip : W.pink, borderRadius: 14 }}
        testID="wale-character-save"
      >
        <T size={16} weight={800} color="#FFFFFF" spacing={0.5}>
          {current ? "THIS IS YOU" : `PLAY AS ${(shown?.name ?? "faction hero").toUpperCase()}`}
        </T>
      </Tap>
      <Tap x={296} y={770} w={110} h={56} label="Share your character card" disabled={!shown} onPress={() => void share()} style={[glass(14, "rgba(255,255,255,0.7)"), { borderWidth: 2, borderColor: W.pink }]} testID="wale-character-share">
        <T size={15} weight={800} color={W.pinkDeep} spacing={0.5}>
          SHARE
        </T>
      </Tap>
      {notice ? (
        <At x={24} y={840} w={382}>
          <T size={12} weight={600} color={W.inkSoft} lines={2} align="center" style={{ lineHeight: 17 }} testID="wale-character-notice">
            {notice}
          </T>
        </At>
      ) : null}
    </>
  );

  return (
    <DesignCanvas width={FW} height={FH} colors={["#B5D9E6", "#E6F2F8", "#D2E8F2"]} testID="wale-character" footer={{ y: 760, h: 120, children: footer }}>
      <At x={24} y={30}>
        <T size={22} weight={700} style={{ lineHeight: 34 }} testID="wale-character-title">
          Your character
        </T>
      </At>
      <Tap x={362} y={26} w={43.6} h={43} label="Close" onPress={() => back("/wale/home")} style={glass(10, "rgba(255,255,255,0.3)")} testID="wale-character-close">
        <LineIcon name="x" size={25} stroke={2.7} />
      </Tap>
      <At x={24} y={70} w={382}>
        <T size={12} weight={500} color={W.inkSoft} lines={2} style={{ lineHeight: 17 }}>
          Who you are in CosQuest. You fight as them; your profile and your share card show their picture.
        </T>
      </At>

      {/* the picked character, large */}
      <At x={24} y={104} w={382} h={240} style={[glass(18, "rgba(255,255,255,0.4)"), { alignItems: "center", justifyContent: "flex-end", overflow: "hidden" }]} testID="wale-character-preview">
        {art ? (
          <Image source={art.card} style={{ width: 360, height: 232 }} contentFit="contain" contentPosition="bottom" accessible accessibilityRole="image" accessibilityLabel={shown ? `${shown.name}, ${characterLine(shown)}` : "Your character"} testID="wale-character-art" />
        ) : (
          <T size={13} weight={600} color={W.inkSoft} align="center" style={{ marginBottom: 100 }}>
            Join a faction to get its hero, or pick a character below.
          </T>
        )}
      </At>
      <At x={24} y={350} w={382} style={{ alignItems: "center" }}>
        <T size={21} weight={800} style={{ lineHeight: 28 }} testID="wale-character-name">
          {shown?.name ?? "No character yet"}
        </T>
        <T size={12} weight={600} color={W.inkSoft} style={{ lineHeight: 17 }} testID="wale-character-line">
          {shown ? (sel === AUTO ? `Your faction hero · ${characterLine(shown)}` : characterLine(shown)) : ""}
        </T>
      </At>

      {tiles.map((t, i) => {
        const x = 24 + (i % COLS) * (TILE_W + GAP);
        const y = GRID_Y + Math.floor(i / COLS) * (TILE_H + GAP);
        const on = sel === t.id;
        return (
          <Tap
            key={t.id}
            x={x}
            y={y}
            w={TILE_W}
            h={TILE_H}
            label={t.id === AUTO ? `Your faction hero${factionHero ? `, ${factionHero.name}` : ""}` : t.name}
            selected={on}
            onPress={() => {
              setSel(t.id);
              setNotice(null);
            }}
            style={[glass(14, on ? "rgba(255,255,255,0.85)" : W.card), { borderWidth: on ? 2 : 1, borderColor: on ? W.pink : W.line, flexDirection: "column", justifyContent: "flex-start", paddingTop: 6, overflow: "hidden" }]}
            testID={`wale-character-${t.id}`}
          >
            {t.portrait ? (
              <Image source={t.portrait} style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "rgba(255,255,255,0.6)" }} contentFit="cover" />
            ) : (
              <At x={12} y={6} w={64} h={64} style={{ borderRadius: 32, backgroundColor: "rgba(255,255,255,0.6)", alignItems: "center", justifyContent: "center" }}>
                <LineIcon name="person-standing" size={30} stroke={2.2} />
              </At>
            )}
            <T size={10.5} weight={700} lines={1} align="center" style={{ lineHeight: 14, marginTop: t.portrait ? 5 : 75, paddingHorizontal: 4 }}>
              {t.name}
            </T>
            {on ? (
              <At x={TILE_W - 24} y={6} w={18} h={18} style={{ borderRadius: 9, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" }}>
                <Check size={10} />
              </At>
            ) : null}
          </Tap>
        );
      })}
    </DesignCanvas>
  );
}
