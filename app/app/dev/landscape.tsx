// TEST BUILDS ONLY (EXPO_PUBLIC_E2E=1, or a dev build): the landscape flag's tester switch
// (build 21, features/game/landscape.ts), remembered on the phone.
//   cosquest://dev/landscape?on=1     landscape on whatever the phone's RAM
//   cosquest://dev/landscape?on=0     portrait everywhere
//   cosquest://dev/landscape?on=auto  the RAM rule (6 GB and up)
// Every other build sends this route home.
import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";

import { landscapeFlag, setLandscapeOverride } from "@/features/game/orientation";

const ON = process.env.EXPO_PUBLIC_E2E === "1" || __DEV__;

export default function LandscapeSwitch() {
  const { on } = useLocalSearchParams<{ on?: string }>();
  const [done, setDone] = useState(!ON);
  useEffect(() => {
    if (!ON) return;
    void setLandscapeOverride(on === "1" ? "on" : on === "0" ? "off" : null).then(() => {
      const f = landscapeFlag();
      console.log(`[orientation] dev switch on=${on ?? "-"} -> ${f.on ? "landscape" : "portrait"} (${f.reason})`);
      setDone(true);
    });
  }, [on]);
  return done ? <Redirect href="/" /> : null;
}
