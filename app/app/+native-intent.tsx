// Incoming links (task 059): cosquest:// and the website's https links,
// rewritten to the app's own screens before expo-router matches them
// (features/world/links.ts). Unknown paths go through unchanged.
import { routeForUrl } from "@/features/world/links";

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    return routeForUrl(path) ?? path;
  } catch {
    return path;
  }
}
