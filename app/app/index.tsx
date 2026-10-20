import { Redirect } from "expo-router";

import { useAppSelector } from "@/store/hooks";

// Straight to the right screen (audit B6): the native splash stays up until
// the fonts and the saved login are ready (app/_layout.tsx, SessionGate), so
// there is no second splash, no 1.5 s wait and no /home hop.
//   logged in (saved login - see components/SessionGate) -> the chats
//   logged in but onboarding not finished               -> onboarding
//     (SessionGate sends you there once your profile says so)
//   not logged in                                       -> onboarding
export default function Index() {
  const token = useAppSelector((s) => s.auth.token);
  const user = useAppSelector((s) => s.auth.user);
  return <Redirect href={token && user?.onboardingComplete !== false ? "/community" : "/onboarding"} />;
}
