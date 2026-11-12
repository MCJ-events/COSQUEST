// What Wale's screens show about the player, from what the app already has.
//   name, avatar            the chat profile (redux user), else the game handle
//   level, XP               the game's standing (gameStore me.standing)
//   CosCoin                 the game's coins, else the chat's coinBalance
//   rank, faction, ladder   /v1/progression/me, when the server has it on
// Anything missing is null and the screen says so (a "placeholder" tag), it is
// never invented. There are no gems (Wale, 11 Nov: only XP and CosCoin).
import { useEffect, useMemo, useState } from "react";

import { type Armory, buildArmory } from "@/features/waleui/armory";
import { fetchMe, type ProgMe } from "@/features/game/progression";
import { gameStore, useGame } from "@/features/game/runtime";
import { useAppSelector } from "@/store/hooks";
import { getAvatarSource } from "@/utils/callHelpers";

export type WaleProfile = {
  name: string;
  avatar: ReturnType<typeof getAvatarSource> | null;
  level: number | null;
  /** XP inside the level and the level's span, for the bar. */
  xpHave: number | null;
  xpNeed: number | null;
  coins: number | null;
  /** True when nothing came from a server (signed out, offline, the web test build). */
  placeholder: boolean;
};

export function useWaleProfile(): WaleProfile {
  const authUser = useAppSelector((s) => s.auth.user);
  const user = useAppSelector((s) => s.user.user);
  const me = useGame((s) => s.me);
  const handle = useGame((s) => s.profile?.handle ?? null);
  return useMemo(() => {
    const profile = (user?.profile || authUser?.profile) as { firstName?: string; username?: string; avatarKey?: string; avatarPhotoUrl?: string } | undefined;
    const chatCoins = (user as { coinBalance?: number } | null)?.coinBalance;
    const name = profile?.username || profile?.firstName || handle || me?.handle || "Player";
    const st = me?.standing ?? null;
    return {
      name,
      avatar: profile ? getAvatarSource({ avatarKey: profile.avatarKey, avatarPhotoUrl: profile.avatarPhotoUrl } as never) : null,
      level: st ? st.level : null,
      xpHave: st ? st.into_level : null,
      xpNeed: st ? st.level_span : null,
      coins: me ? me.coins : typeof chatCoins === "number" ? chatCoins : null,
      placeholder: !profile && !me,
    };
  }, [authUser, user, me, handle]);
}

/** /v1/progression/me, quietly: null while loading, when the feature is off, or offline. */
export function useProgMe(): ProgMe | null {
  const [me, setMe] = useState<ProgMe | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const got = await fetchMe(gameStore.client);
        if (live) setMe(got);
      } catch {
        // Off on this server, signed out or offline: the screens use the snapshot.
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return me;
}

/** The Armory: the player's own ladder from the server, else the bundled snapshot for their faction. */
export function useArmory(): Armory {
  const prog = useProgMe();
  const gameFaction = useGame((s) => s.me?.faction ?? null);
  const chatFaction = useAppSelector((s) => (s.user.user as { faction?: string | { id?: string } | null } | null)?.faction ?? null);
  const fallback = gameFaction ?? (typeof chatFaction === "string" ? chatFaction : (chatFaction?.id ?? null));
  return useMemo(() => buildArmory(prog, fallback), [prog, fallback]);
}
