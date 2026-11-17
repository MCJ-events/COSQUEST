// Hands a share card the server made (a 1080 x 1920 PNG and a line) to the phone, without native
// modules the app does not have (no expo-sharing, no view-shot). The plan per platform is
// features/game/triviaVisual.ts sharePlan; this is the glue. Nothing is ever posted by itself: the
// player picks where it goes in the share sheet, or saves the picture from the browser tab.
import { File, Paths } from "expo-file-system";
import { Platform, Share } from "react-native";

import { type ShareCard, shareFileName, shareMessage, sharePlan } from "@/features/game/triviaVisual";

export type ShareOutcome = "shared" | "opened" | "again" | "failed";

/** A card's file, fetched once per page on the web: a second tap shares at once (the browser wants the tap fresh). */
const webFiles = new Map<string, globalThis.File>();

type WebNav = {
  share?: (d: { files?: globalThis.File[]; text?: string; url?: string; title?: string }) => Promise<void>;
  canShare?: (d: { files?: globalThis.File[] }) => boolean;
  clipboard?: { writeText?: (t: string) => Promise<void> };
};

function webNav(): WebNav | null {
  return typeof navigator === "undefined" ? null : (navigator as unknown as WebNav);
}

/** Whether this browser's share sheet takes files at all (asked with an empty PNG). */
function webTakesFiles(nav: WebNav | null): boolean {
  if (!nav?.share || !nav.canShare || typeof globalThis.File !== "function") return false;
  try {
    return nav.canShare({ files: [new globalThis.File([""], "probe.png", { type: "image/png" })] });
  } catch {
    return false;
  }
}

async function webFile(card: ShareCard, kind: "q" | "story" | "board"): Promise<globalThis.File> {
  const held = webFiles.get(card.image_url ?? "");
  if (held) return held;
  const res = await fetch(card.image_url as string);
  if (!res.ok) throw new Error(`card ${res.status}`);
  const blob = await res.blob();
  const f = new globalThis.File([blob], shareFileName(card.id, kind), { type: "image/png" });
  webFiles.set(card.image_url as string, f);
  return f;
}

const isAbort = (e: unknown) => e instanceof Error && e.name === "AbortError";
const isNotAllowed = (e: unknown) => e instanceof Error && e.name === "NotAllowedError";

/**
 * Share one card. "again": the browser lost the tap while the picture came down; it is ready now
 * and the next tap shares it at once. A dismissed share sheet counts as shared (the player chose).
 */
export async function shareCard(card: ShareCard, kind: "q" | "story" | "board"): Promise<ShareOutcome> {
  const nav = Platform.OS === "web" ? webNav() : null;
  const plan = sharePlan(Platform.OS, card, webTakesFiles(nav));
  const message = shareMessage(card.text, card.url);
  const title = kind === "q" ? "CosQuest daily trivia" : kind === "board" ? "Today's CosQuest trivia board" : "My CosQuest trivia run";
  try {
    if (plan === "file") {
      let uri: string | null = null;
      try {
        const dest = new File(Paths.cache, shareFileName(card.id, kind));
        if (dest.exists && dest.size > 0) uri = dest.uri;
        else uri = (await File.downloadFileAsync(card.image_url as string, dest, { idempotent: true })).uri;
      } catch {
        uri = null;
      }
      // No picture (the download failed): the line and the link, whose preview shows the card.
      await Share.share(uri ? { url: uri, message } : { message, title }, { subject: title });
      return "shared";
    }
    if (plan === "web-files" && nav?.share) {
      const fresh = !webFiles.has(card.image_url ?? "");
      const file = await webFile(card, kind);
      try {
        await nav.share({ files: [file], text: message, title });
        return "shared";
      } catch (e) {
        if (isAbort(e)) return "shared";
        if (fresh && isNotAllowed(e)) return "again";
        throw e;
      }
    }
    if (plan === "web-open") {
      // Long-press or right-click the picture to save it; the line goes on the clipboard to paste beside it.
      if (typeof window !== "undefined") window.open(card.image_url as string, "_blank", "noopener");
      try {
        await nav?.clipboard?.writeText?.(message);
      } catch {
        // No clipboard here: the link is on the screen.
      }
      return "opened";
    }
    if (Platform.OS === "web") {
      if (nav?.share) await nav.share({ text: message, title });
      else await nav?.clipboard?.writeText?.(message);
      return "shared";
    }
    await Share.share({ message, title }, { subject: title });
    return "shared";
  } catch (e) {
    return isAbort(e) ? "shared" : "failed";
  }
}

/**
 * A card as a file to upload into a feed post: on a phone the PNG saved to the cache (once), on the
 * web the picture's own address (the upload reads it as a blob). Null when it could not be had.
 */
export async function cardUpload(card: ShareCard, kind: "q" | "story" | "board"): Promise<{ uri: string; name: string; type: string } | null> {
  if (!card.image_url) return null;
  const name = shareFileName(card.id, kind);
  if (Platform.OS === "web") return { uri: card.image_url, name, type: "image/png" };
  try {
    const dest = new File(Paths.cache, name);
    const uri = dest.exists && dest.size > 0 ? dest.uri : (await File.downloadFileAsync(card.image_url, dest, { idempotent: true })).uri;
    return { uri, name, type: "image/png" };
  } catch {
    return null;
  }
}
