// Merged app: the "Cosquest" tab (the map pin) is the game, one swipe to the
// right of the chat (components/world/WorldPager.tsx). A tap on the tab opens
// the game (app/(tabs)/_layout.tsx), so this route never shows a page of its
// own. It used to be the Expo starter screen ("Edit app/(tabs)/index.tsx"),
// which is where sign-in, the splash and "leave group" all landed. Anything
// that goes to /home now lands on the chats.
import { Redirect } from "expo-router";

export default function HomeScreen() {
  return <Redirect href="/community" />;
}
