// The staff desk of an event (components/waleui/brief/StaffScreen.tsx; feature `venue_challenges`).
// Without a game: the events you are staff at.
import { useLocalSearchParams } from "expo-router";

import StaffScreen from "@/components/waleui/brief/StaffScreen";

export default function WaleStaff() {
  const { game } = useLocalSearchParams<{ game?: string }>();
  return <StaffScreen key={game ?? "list"} gameId={game ?? null} />;
}
