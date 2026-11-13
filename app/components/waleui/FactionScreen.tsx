// Wale's Faction screen (build 24): pick the faction you play for. His Figma has
// no faction screen, so this is a plain picker in his style (his canvas, glass
// cards, Poppins, pink), reached from FACTION on his Home. Picking joins
// through progression; the entry test is the game's Ranks sheet. The logic is
// features/waleui/factionPick.ts (tested).
import { Image } from "expo-image";
import { useCallback, useEffect, useMemo, useState } from "react";

import { FACTIONS } from "@/constants/factions";
import { fetchConfig, joinFaction, type ProgConfig } from "@/features/game/progression";
import { gameStore } from "@/features/game/runtime";
import { actionLabel, pickAction, pickCards, preselect } from "@/features/waleui/factionPick";
import { useAppSelector } from "@/store/hooks";

import { refreshProg, useProgMe } from "./data";
import { back, openGameSheet } from "./go";
import { At, Check, DesignCanvas, LineIcon, T, Tap, W, glass } from "./kit";

const FW = 430;
const FH = 932;
const COL_X = [24, 222];
const CARD_W = 184;
const CARD_H = 196;
const ROW_Y = [118, 330, 542];

const ART: Record<string, number> = Object.fromEntries(FACTIONS.map((f) => [f.id, f.image as number]));

export default function FactionScreen() {
  const prog = useProgMe();
  const chatFaction = useAppSelector(
    (s) => ((s.user.user ?? s.auth.user) as { faction?: string | { id?: string | null } | null } | null)?.faction ?? null,
  );
  const [config, setConfig] = useState<ProgConfig | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    fetchConfig(gameStore.client)
      .then(setConfig)
      .catch(() => setFailed(true));
    void refreshProg();
  }, []);
  useEffect(load, [load]);

  const cards = useMemo(() => (config ? pickCards(config.factions) : []), [config]);
  const selected = picked ?? preselect(cards, prog, chatFaction);
  const action = pickAction(selected, prog);
  const selectedName = cards.find((c) => c.id === selected)?.name ?? null;
  const joinedName = prog?.faction ? (cards.find((c) => c.id === prog.faction)?.name ?? prog.faction_name ?? null) : null;

  const go = async () => {
    if (busy) return;
    if (action.kind === "ranks" || action.kind === "test") {
      openGameSheet("ranks");
      return;
    }
    if (action.kind !== "join") return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await joinFaction(gameStore.client, action.faction);
      await refreshProg();
      if (r.status === "pending_entry_test") {
        // The Ranks sheet shows the faction being joined and its "Take the entry test" button.
        openGameSheet("ranks");
      } else {
        setNotice(`You are in ${selectedName ?? "your faction"}.`);
        await gameStore.loadBasics().catch(() => {});
      }
    } catch (e) {
      setNotice(e instanceof Error && e.message ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const sub = joinedName
    ? `You play for ${joinedName}.`
    : prog?.pending
      ? "Pass the entry test to finish joining."
      : "Pick the faction you play for. You join once you pass its entry test.";

  // the pick button (and its notice) stays on screen above the home bar on a phone shorter than the frame (build 27)
  const footer = (
    <>
      <Tap
        x={24}
        y={770}
        w={382}
        h={56}
        label={actionLabel(action, selectedName)}
        disabled={action.kind === "none" || busy || !config}
        onPress={() => void go()}
        style={{ backgroundColor: action.kind === "none" || !config ? W.chip : W.pink, borderRadius: 14 }}
        testID="wale-faction-go"
      >
        <T size={17} weight={800} color="#FFFFFF" spacing={0.5}>
          {busy ? "…" : actionLabel(action, selectedName)}
        </T>
      </Tap>
      {notice ? (
        <At x={24} y={840} w={382}>
          <T size={12} weight={600} color={W.inkSoft} lines={2} align="center" style={{ lineHeight: 17 }} testID="wale-faction-notice">
            {notice}
          </T>
        </At>
      ) : null}
    </>
  );

  return (
    <DesignCanvas width={FW} height={FH} colors={["#B5D9E6", "#E6F2F8", "#D2E8F2"]} testID="wale-faction" footer={{ y: 760, h: 120, children: footer }}>
      <At x={24} y={30}>
        <T size={22} weight={700} style={{ lineHeight: 34 }} testID="wale-faction-title">
          Faction
        </T>
      </At>
      <Tap x={362} y={26} w={43.6} h={43} label="Close" onPress={() => back("/wale/home")} style={glass(10, "rgba(255,255,255,0.3)")} testID="wale-faction-close">
        <LineIcon name="x" size={25} stroke={2.7} />
      </Tap>
      <At x={24} y={76} w={382}>
        <T size={12} weight={500} color={W.inkSoft} lines={2} style={{ lineHeight: 17 }} testID="wale-faction-sub">
          {sub}
        </T>
      </At>

      {cards.map((c, i) => {
        const x = COL_X[i % 2];
        const y = ROW_Y[Math.floor(i / 2)] ?? ROW_Y[2] + 212;
        const on = selected === c.id;
        const locked = !!prog?.faction && prog.faction !== c.id;
        return (
          <Tap
            key={c.id}
            x={x}
            y={y}
            w={CARD_W}
            h={CARD_H}
            label={`${c.name}${c.soon ? ", coming soon" : ""}`}
            selected={on}
            disabled={c.soon || locked || busy}
            onPress={() => setPicked(c.id)}
            style={[glass(14, on ? "rgba(255,255,255,0.8)" : W.card), { borderWidth: on ? 2 : 1, borderColor: on ? W.pink : W.line, opacity: c.soon || locked ? 0.55 : 1, flexDirection: "column", justifyContent: "flex-start", paddingTop: 10 }]}
            testID={`wale-faction-${c.id}`}
          >
            {ART[c.id] ? <Image source={ART[c.id]} style={{ width: 118, height: 118 }} contentFit="contain" /> : null}
            <T size={15} weight={700} style={{ lineHeight: 22, marginTop: 4 }}>
              {c.name}
            </T>
            {c.line ? (
              <T size={9.5} weight={500} color={W.inkSoft} lines={2} align="center" style={{ lineHeight: 13, paddingHorizontal: 10 }}>
                {c.line}
              </T>
            ) : null}
            {on ? (
              <At x={CARD_W - 28} y={8} w={20} h={20} style={{ borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" }}>
                <Check size={11} />
              </At>
            ) : null}
          </Tap>
        );
      })}

      {failed ? (
        <Tap x={24} y={300} w={382} h={54} label="Try again" onPress={load} style={glass(12, "rgba(255,255,255,0.6)")} testID="wale-faction-retry">
          <T size={13} weight={700}>
            {"Factions didn't load. Tap to try again."}
          </T>
        </Tap>
      ) : null}

    </DesignCanvas>
  );
}
