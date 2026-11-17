// A comic panel puzzle station (components/waleui/brief/PuzzleScreen.tsx; feature `comic_puzzles`).
import { Redirect, useLocalSearchParams } from "expo-router";

import PuzzleScreen from "@/components/waleui/brief/PuzzleScreen";

export default function WalePuzzle() {
  const { game, station } = useLocalSearchParams<{ game?: string; station?: string }>();
  if (!game) return <Redirect href="/wale/event" />;
  if (!station) return <Redirect href={{ pathname: "/wale/event", params: { game } }} />;
  return <PuzzleScreen key={`${game}:${station}`} gameId={game} stationId={station} />;
}
