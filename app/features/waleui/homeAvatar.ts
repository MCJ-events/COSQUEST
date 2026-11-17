// Wale's Home avatar slot (build 23, decided 13 Nov): his frame shows the player's faction hero
// bust when the player has no picture of their own. The chat backend gives every new account the
// "adventurer" preset (cosquest-backend User.js: avatarKey default AVATARS[0].key), so a player who
// never chose a picture still carries that key. Only for this slot, the default preset counts as no
// picture; everywhere else in the app it stays the player's avatar.

/** The chat backend's default preset for a new account. */
export const DEFAULT_AVATAR_KEY = "adventurer";

export type AvatarFields = { avatarKey?: string | null; avatarPhotoUrl?: string | null } | null | undefined;

/** True when the player has a picture of their own for Wale's Home slot: a photo, or a preset other than the default. */
export function hasOwnHomePicture(profile: AvatarFields): boolean {
  if (!profile) return false;
  if (typeof profile.avatarPhotoUrl === "string" && profile.avatarPhotoUrl.trim() !== "") return true;
  const key = typeof profile.avatarKey === "string" ? profile.avatarKey.trim() : "";
  return key !== "" && key !== DEFAULT_AVATAR_KEY;
}
