// My prizes: what I won, and claiming a prize (identity, payout details, tax form).
import { TicketError } from "./tickets";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL;

async function request<T>(path: string, { method = "GET", body, token }: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new TicketError("No connection. Check your internet and try again.", 0, "offline");
  }
  const data: any = await response.json().catch(() => null);
  if (!response.ok) throw new TicketError(data?.error || "Something went wrong. Please try again.", response.status, data?.code, data);
  return data as T;
}

export type PrizeStatus = "awaiting_claim" | "submitted" | "verified" | "payout_requested" | "held" | "paid" | "forfeited" | "rejected";
export type Prize = {
  id: string;
  number: string;
  quest: { id: string; title?: string };
  place: number;
  amountCents: number;
  currency: string;
  status: PrizeStatus;
  claimDeadline: string;
  payoutMethod: { type: "ach" | "check"; accountLast4?: string | null; mailingAddress?: string | null } | null;
  tax: { form: "w9" | "w8ben" | null; status: string };
  holdUntil: string | null;
  paidAt: string | null;
  paymentRef: string | null;
  rejectedReason: string | null;
};
export type PrizeClaimInput = {
  legalName: string;
  dateOfBirth: string;
  certify: boolean;
  payout: { type: "ach"; accountHolder: string; routingNumber: string; accountNumber: string } | { type: "check"; mailingAddress: string };
  tax: { form: "w9"; tin: string } | { form: "w8ben"; country: string; tin?: string };
};

export const getPrizes = (token: string) => request<{ prizes: Prize[] }>("/api/prizes", { token });
export const claimPrize = (token: string, prizeId: string, input: PrizeClaimInput) => request<{ prize: Prize }>(`/api/prizes/${prizeId}/claim`, { method: "POST", token, body: input });
