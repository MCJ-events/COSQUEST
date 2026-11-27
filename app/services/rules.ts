// The official contest rules (public): the current version, or an older one.
const BASE_URL = process.env.EXPO_PUBLIC_API_URL;

export type OfficialRules = { version: number; title: string; body: string; publishedAt: string };

export async function getRules(version?: number): Promise<OfficialRules | null> {
  const response = await fetch(`${BASE_URL}/api/rules${version ? `/${version}` : ""}`);
  const data: any = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Couldn't load the rules.");
  return data?.rules ?? null;
}
