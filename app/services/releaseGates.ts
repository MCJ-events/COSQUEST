// Store-release switches (build 30, release checklist 19 Nov 2026). Every one is
// build-time env read in services/appConfig.ts, and every default is the store
// build: unset means the thing a reviewer must not see stays hidden. A TestFlight
// or design-review build turns them on before sourcing scripts/cosquest-beta-env.sh.
//
//   EXPO_PUBLIC_COIN_PURCHASE=1      CosCoin buying on iOS and Android (packs,
//                                    the web hand-off, "Manage purchases").
//                                    Off: balance and history only. The web
//                                    build keeps its shop (no store rules there).
//   EXPO_PUBLIC_SHOW_PLACEHOLDERS=1  buttons for things not built yet ("... is
//                                    not in the app yet") and the Lobby mock-up.
//   EXPO_PUBLIC_DEV_SCREENS=1        test screens (/gps-demo, /notifications-check
//                                    and its Settings row). Always on in a dev build.
//
// Pure, so node tests it.

export type ReleaseGates = {
  coinPurchase: boolean;
  showPlaceholders: boolean;
  devScreens: boolean;
};

export type GateEnv = {
  EXPO_PUBLIC_COIN_PURCHASE?: string;
  EXPO_PUBLIC_SHOW_PLACEHOLDERS?: string;
  EXPO_PUBLIC_DEV_SCREENS?: string;
  EXPO_PUBLIC_E2E?: string;
};

/** "1" or "true" (any case, spaces ignored); everything else, unset included, is off. */
export function envOn(value: string | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

export function releaseGates(env: GateEnv, platform: string, dev: boolean): ReleaseGates {
  return {
    coinPurchase: platform === "web" || envOn(env.EXPO_PUBLIC_COIN_PURCHASE),
    showPlaceholders: envOn(env.EXPO_PUBLIC_SHOW_PLACEHOLDERS),
    devScreens: dev || envOn(env.EXPO_PUBLIC_DEV_SCREENS) || envOn(env.EXPO_PUBLIC_E2E),
  };
}

/** Keeps the entries that lead somewhere real; `soon` entries only when placeholders are shown. */
export function withoutPlaceholders<T extends { soon?: boolean }>(items: readonly T[], show: boolean): T[] {
  return items.filter((item) => show || !item.soon);
}

export type LegalKind = "terms" | "privacy" | "guidelines";

/**
 * What the sign-up line links, from the configured URLs (EXPO_PUBLIC_TERMS_URL,
 * _PRIVACY_URL, _GUIDELINES_URL). The documents are the company's and its
 * lawyer's, not ours: a page that is not published is simply not linked, and
 * with none published the line is not drawn at all.
 */
export function signupLegalLinks(urls: Record<LegalKind, string | null>): {
  agree: { doc: "terms" | "guidelines"; label: string }[];
  privacy: { doc: "privacy"; label: string } | null;
} {
  const agree: { doc: "terms" | "guidelines"; label: string }[] = [];
  if (urls.terms) agree.push({ doc: "terms", label: "Terms of Service" });
  if (urls.guidelines) agree.push({ doc: "guidelines", label: "Community Guidelines" });
  return { agree, privacy: urls.privacy ? { doc: "privacy", label: "Privacy Policy" } : null };
}
