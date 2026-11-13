// cosquest://event?game=<id> and the Home menu's EVENTS: a CosQuest event's stations, or the events
// near you (components/waleui/brief/EventScreen.tsx; feature `stations_v2`). Not behind
// EXPO_PUBLIC_WALE_UI: a link must open in any build; the screen itself is behind the server's flag.
import { useLocalSearchParams } from "expo-router";

import EventScreen from "@/components/waleui/brief/EventScreen";

export default function WaleEvent() {
  const { game } = useLocalSearchParams<{ game?: string }>();
  return <EventScreen key={game ?? "list"} gameId={game ?? null} />;
}
