// Report, block and delete account (task 059; the backend routes are in
// cosquest-backend/src/routes/safetyRoutes.js, docs/polish/BACKEND-PORT.md).
import { apiRequest } from "./api";
import { blockUser as blockByUsername } from "./publicProfile";

export type ReportTarget = "user" | "post" | "comment" | "message" | "group";

export const REPORT_REASONS: { key: string; label: string }[] = [
  { key: "spam", label: "Spam or scam" },
  { key: "harassment", label: "Bullying or harassment" },
  { key: "hate", label: "Hate speech or symbols" },
  { key: "nudity", label: "Nudity or sexual content" },
  { key: "violence", label: "Violence or threats" },
  { key: "self_harm", label: "Self-harm or suicide" },
  { key: "impersonation", label: "Pretending to be someone else" },
  { key: "underage", label: "Someone under 13" },
  { key: "other", label: "Something else" },
];

// The server's report queue (POST /api/reports, the admin dashboard's
// Moderation page) takes targets post / comment / message / profile and its
// own reason list; this sheet's extra choices are sent as "other" with the
// choice written into the statement so the moderator still sees it.
const SERVER_TARGET: Record<ReportTarget, string | null> = { user: "profile", post: "post", comment: "comment", message: "message", group: null };
const SERVER_REASONS = new Set(["spam", "harassment", "impersonation", "hate", "violence", "self_harm", "other"]);

export async function sendReport(
  token: string,
  report: { targetType: ReportTarget; targetId: string; reason: string; details?: string; snapshot?: string; conversationId?: string },
) {
  const targetType = SERVER_TARGET[report.targetType];
  if (!targetType) throw new Error("Groups can't be reported here yet. Report a message or the person instead.");
  const known = SERVER_REASONS.has(report.reason);
  const label = REPORT_REASONS.find((r) => r.key === report.reason)?.label ?? report.reason;
  const statement = [known ? null : label, report.details?.trim() || null].filter(Boolean).join(": ").slice(0, 1000) || undefined;
  return apiRequest<{ report: { id: string; status: string }; alreadyReported?: boolean }>("/api/reports", {
    method: "POST",
    token,
    body: { targetType, targetId: report.targetId, reason: known ? report.reason : "other", statement },
  });
}

/**
 * Block someone from anywhere. By username on every server (the existing
 * route); by id where the server has POST /api/blocks (a member list or a
 * message that only knows the id). A "you already blocked" answer counts.
 */
export async function blockPerson(token: string, who: { username?: string | null; userId?: string | null }, blockAnywhere: boolean) {
  try {
    if (who.username) {
      await blockByUsername(who.username, token);
      return;
    }
    if (who.userId && blockAnywhere) {
      await apiRequest("/api/blocks", { method: "POST", token, body: { userId: who.userId } });
      return;
    }
  } catch (error) {
    if ((error as any)?.status === 409) return;
    throw error;
  }
  throw new Error("Can't block this person from here.");
}

export async function deleteMyAccount(token: string, proof: { password?: string; confirm?: "DELETE" }) {
  return apiRequest<{ deleted: boolean }>("/api/users/me", { method: "DELETE", token, body: proof });
}
