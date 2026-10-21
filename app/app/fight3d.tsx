// cosquest://fight3d?mode=full|arena|chars&cycle=N&ms=8000&autoplay=1
// Test builds only (EXPO_PUBLIC_GAME3D=1): opens the 3D fight (cq 061) with no
// point, in a given mode, once or N times for the leak test. Like
// cosquest://play, it hands the request to the game and gets out of the way;
// the game root opens it once the game is on screen. With the flag off it
// does nothing.
//   adb shell am start -a android.intent.action.VIEW -d "cosquest://fight3d?mode=arena\&cycle=10\&ms=8000"
import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";

import { runFromParams } from "@/features/game3d/fight3d";
import { FIGHT3D, fight3dAvailable } from "@/features/game3d/flags";
import { requestFight3D } from "@/features/game3d/request";
import { world } from "@/features/world/worldState";
import { store } from "@/store/store";

export default function Fight3DLink() {
  const params = useLocalSearchParams();

  useEffect(() => {
    if (fight3dAvailable()) {
      requestFight3D(runFromParams(params, FIGHT3D));
      world.openGame(null);
    }
    if (router.canDismiss()) router.dismissAll();
    else if (router.canGoBack()) router.back();
    else router.replace(store.getState().auth.token ? "/home" : "/");
    // Once, for the link that opened this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
