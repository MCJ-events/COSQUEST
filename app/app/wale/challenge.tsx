// cosquest://station?game=<id>&station=<id>&code=<code> (a booth's QR): a carnival or costume challenge
// (components/waleui/brief/ChallengeScreen.tsx; feature `venue_challenges`).
import { Redirect, useLocalSearchParams } from "expo-router";

import ChallengeScreen from "@/components/waleui/brief/ChallengeScreen";

export default function WaleChallenge() {
  const { game, station, code } = useLocalSearchParams<{ game?: string; station?: string; code?: string }>();
  if (!game) return <Redirect href="/wale/event" />;
  if (!station) return <Redirect href={{ pathname: "/wale/event", params: { game } }} />;
  return <ChallengeScreen key={`${game}:${station}`} gameId={game} stationId={station} initialCode={code ?? null} />;
}
