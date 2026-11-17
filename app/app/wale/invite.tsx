// cosquest://referral?code=<code> and the Home menu's INVITE: invite a friend (feature `referrals`,
// components/waleui/brief/InviteScreen.tsx). Not behind EXPO_PUBLIC_WALE_UI: a friend's link must open
// in any build; the screen itself is behind the server's flag.
import { useLocalSearchParams } from "expo-router";

import InviteScreen from "@/components/waleui/brief/InviteScreen";

export default function WaleInvite() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  return <InviteScreen initialCode={code ?? null} />;
}
