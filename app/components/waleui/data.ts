// What Wale's screens show about the player, from what the app already has.
//   name, avatar            the chat profile (redux user), else the game handle
//   level, XP               the game's standing (gameStore me.standing)
//   CosCoin                 the game's coins, else the chat's coinBalance
//   rank, faction, ladder   /v1/progression/me, when the server has it on
// Anything missing is null and the screen says so (a "placeholder" tag), it is
// never invented. There are no gems (Wale, 11 Nov: only XP and CosCoin).
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { type Armory, buildArmory } from "@/features/waleui/armory";
import { buyWeapon, fetchMe, type ProgMe, refusalText } from "@/features/game/progression";
import { gameStore, useGame } from "@/features/game/runtime";
import { hasOwnHomePicture } from "@/features/waleui/homeAvatar";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchCurrentUser } from "@/store/thunks/userThunks";
import { getAvatarSource } from "@/utils/callHelpers";

export type WaleProfile = {
  name: string;
  avatar: ReturnType<typeof getAvatarSource> | null;
  /** For Wale's Home avatar slot only: the player's own photo or chosen preset; null for the default preset or none (then the faction bust shows). */
  homeAvatar: ReturnType<typeof getAvatarSource> | null;
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
  // The Home tab used to load the chat profile (the team dashboard did); Wale's screens are
  // the Home tab now, so they load it once when it is missing.
  const dispatch = useAppDispatch();
  const email = authUser?.email ?? null;
  useEffect(() => {
    if (email && !user) void dispatch(fetchCurrentUser(email));
  }, [dispatch, email, user]);
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
      homeAvatar: hasOwnHomePicture(profile) ? getAvatarSource({ avatarKey: profile?.avatarKey, avatarPhotoUrl: profile?.avatarPhotoUrl } as never) : null,
      level: st ? st.level : null,
      xpHave: st ? st.into_level : null,
      xpNeed: st ? st.level_span : null,
      coins: me ? me.coins : typeof chatCoins === "number" ? chatCoins : null,
      placeholder: !profile && !me,
    };
  }, [authUser, user, me, handle]);
}

// One copy of /v1/progression/me for every Wale screen, so a weapon bought on the weapon
// page shows as owned on the Armory and the rank on the Homepage without a reload.
let progCache: ProgMe | null = null;
let progLoading: Promise<void> | null = null;
const progListeners = new Set<() => void>();

/** Ask the server again (quietly: off on this server, signed out or offline keeps what we have). */
export function refreshProg(): Promise<void> {
  if (progLoading) return progLoading;
  progLoading = (async () => {
    try {
      progCache = await fetchMe(gameStore.client);
      progListeners.forEach((l) => l());
    } catch {
      // The screens use the snapshot.
    } finally {
      progLoading = null;
    }
  })();
  return progLoading;
}

/** /v1/progression/me, quietly: null while loading, when the feature is off, or offline. */
export function useProgMe(): ProgMe | null {
  const me = useSyncExternalStore(
    (l) => {
      progListeners.add(l);
      return () => {
        progListeners.delete(l);
      };
    },
    () => progCache,
    () => progCache,
  );
  useEffect(() => {
    void refreshProg();
  }, []);
  return me;
}

/**
 * Claim or buy a ladder weapon the player has unlocked (the same server call as the game's
 * Ranks sheet). Resolves to a line to show the player; never throws.
 */
export async function buyArmoryWeapon(id: string, name: string): Promise<{ ok: boolean; text: string }> {
  try {
    const r = await buyWeapon(gameStore.client, id);
    if (r.me) {
      progCache = r.me;
      progListeners.forEach((l) => l());
    } else {
      await refreshProg();
    }
    void gameStore.refreshMe?.();
    const up = r.promoted?.length ? ` You are now rank ${r.promoted[r.promoted.length - 1].to}: ${r.promoted[r.promoted.length - 1].name}.` : "";
    return { ok: true, text: `${name} is yours.${up}` };
  } catch (e) {
    return { ok: false, text: refusalText(e) };
  }
}

/** The Armory: the player's own ladder from the server, else the bundled snapshot for their faction. */
export function useArmory(): Armory {
  const prog = useProgMe();
  const gameFaction = useGame((s) => s.me?.faction ?? null);
  const chatFaction = useAppSelector((s) => ((s.user.user ?? s.auth.user) as { faction?: string | { id?: string } | null } | null)?.faction ?? null);
  const fallback = gameFaction ?? (typeof chatFaction === "string" ? chatFaction : (chatFaction?.id ?? null));
  return useMemo(() => buildArmory(prog, fallback), [prog, fallback]);
}
