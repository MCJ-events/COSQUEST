// The open map in landscape (build 21; Subomi, 11 Nov: the map as well as fights). While the
// map is in front, on a phone the landscape flag allows (features/game/landscape.ts): the
// "turn your phone" notice once a session, then the screen held sideways until the game goes
// behind the chat, and held again (no notice) when it comes back. A fight opened from the map
// finds the screen sideways and skips its own notice.
import { useCallback, useEffect, useRef, useState } from "react";

import { declineLandscape, holdLandscape, landscapeWanted, loadLandscapeOverride, onLandscapeChange, releaseLandscape } from "@/features/game/orientation";

let acceptedThisSession = false;

export function useMapLandscape(active: boolean): { land: boolean; tilt: boolean; ready: () => void; portrait: () => void } {
  const [land, setLand] = useState(false);
  const [tilt, setTilt] = useState(false);
  const [, bump] = useState(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    void loadLandscapeOverride().then(() => bump((n) => n + 1));
    return onLandscapeChange(() => bump((n) => n + 1));
  }, []);
  const wanted = landscapeWanted();

  const go = useCallback(async () => {
    acceptedThisSession = true;
    setTilt(false);
    await holdLandscape("map");
    if (!activeRef.current) {
      void releaseLandscape("map");
      return;
    }
    setLand(true);
  }, []);

  useEffect(() => {
    if (active && wanted) {
      if (acceptedThisSession) void go();
      else setTilt(true);
      return;
    }
    setTilt(false);
    if (land) {
      setLand(false);
      void releaseLandscape("map");
    }
    // land is read, not followed: only the map's being in front (and the flag) turn it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, wanted, go]);

  useEffect(() => () => void releaseLandscape("map"), []);

  return {
    land,
    tilt,
    ready: () => void go(),
    portrait: () => {
      declineLandscape();
      setTilt(false);
    },
  };
}
