// After the event: attendance (no-shows) and results (winners).
// Backend: events-backend (EVENTS.md).
import { adminRequest } from "./admin";

export type EventPerson = { id: string; name: string; username: string | null; avatarKey?: string | null; avatarPhotoUrl?: string | null } | null;
export type AttendanceRow = { ticketId: string; person: EventPerson; checkedInAt: string | null };
export type Attendance = { virtual?: boolean; ended: boolean; tickets: number; checkedIn: number; attendees: AttendanceRow[]; noShows: AttendanceRow[]; notYetIn: AttendanceRow[] };
export type Winner = { ticketId: string; place: number; placeLabel: string; prizeNote: string; prizeCents?: number; person: EventPerson };
export type Results = { winners: Winner[]; publishedAt: string | null; auditEvent?: string };

export const getAttendance = (questId: string) => adminRequest<Attendance>(`/quests/${questId}/attendance`);
export const getResults = (questId: string) => adminRequest<Results>(`/quests/${questId}/results`);
export const saveResults = (questId: string, winners: { ticketId: string; place: number; prizeNote?: string; prizeCents?: number }[]) =>
  adminRequest<Results>(`/quests/${questId}/results`, { method: "PUT", body: { winners } });
export const publishResults = (questId: string) => adminRequest<Results>(`/quests/${questId}/results/publish`, { method: "POST" });

/** Points and the ranking (highest points win; the quest's tie-break decides ties). */
export type Ranking = { tieBreak: string; scoringVersion: number | null; prizePoolCents: number; prizeSplitPct: number[]; withoutScore: number; rows: { ticket: string; user: string; member: string; points: number; completedAt: string | null; place: number; tied: boolean; prizeCents: number }[] };
export const getRanking = (questId: string) => adminRequest<Ranking>(`/quests/${questId}/ranking`);
export const saveScores = (questId: string, scores: { ticketId: string; points: number }[], reason: string) => adminRequest<{ ok: boolean; saved: number; auditEvent: string }>(`/quests/${questId}/scores`, { method: "PUT", body: { scores, reason } });
export const draftFromRanking = (questId: string) => adminRequest<{ ok: boolean; winners: number; auditEvent: string }>(`/quests/${questId}/ranking/draft`, { method: "POST" });
