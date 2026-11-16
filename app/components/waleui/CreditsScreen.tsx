// Credits (build 29): the attributions the game's captured motion needs, shown from Settings > Credits.
//
// The mid and high tiers' fight animation (app/game3d/anim/real, fid29 combat) is retargeted from motion
// capture licensed CC BY 4.0, which asks for visible credit and a note that it was changed; this screen is
// that credit, and a build that ships those clips must ship this screen with them. The CMU line is the
// courtesy credit the CMU database asks for (not required). The lines match
// docs/game3d/fid29/ASSETS-LICENCES-combat.md (app/game3d/tests/fid29_combat_test.gd checks every CC-BY
// source there is listed here).
import { Linking } from "react-native";

import { back } from "./go";
import { At, DesignCanvas, LineIcon, T, Tap, W, glass } from "./kit";

const FW = 430;

export type Credit = { id: string; title: string; text: string; url: string };

/** Every credit the shipped game owes, in the words the licences ask for. */
export const CREDITS: readonly Credit[] = [
  {
    id: "cmcd",
    title: "Cologne Motion Capture Database",
    text: "Motion data from the Cologne Motion Capture Database by TH Köln (University of Applied Sciences), CC BY 4.0. Retargeted and edited.",
    url: "https://mocap.web.th-koeln.de/",
  },
  {
    id: "100style",
    title: "100STYLE",
    text: "The 100STYLE Dataset - Ian Mason, CC BY 4.0. Retargeted and edited.",
    url: "https://www.ianxmason.com/100style/",
  },
  {
    id: "cmu",
    title: "CMU Graphics Lab Motion Capture Database",
    text: "The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.",
    url: "http://mocap.cs.cmu.edu/",
  },
];

const LICENCE_URL = "https://creativecommons.org/licenses/by/4.0/";
const CARD_Y = 96;
const CARD_H = 150;
const CARD_GAP = 14;

export default function CreditsScreen({ onClose }: { onClose?: () => void }) {
  const close = onClose ?? (() => back());
  const licenceY = CARD_Y + CREDITS.length * (CARD_H + CARD_GAP);
  return (
    <DesignCanvas width={FW} height={960} colors={["#B5D9E6", "#E6F2F8", "#D2E8F2"]} horizontal testID="wale-credits">
      <At x={24} y={30}>
        <T size={22} weight={700} style={{ lineHeight: 34 }} testID="wale-credits-title">
          Credits
        </T>
      </At>
      <Tap x={362} y={26} w={43.6} h={43} label="Close" onPress={close} style={glass(10, "rgba(255,255,255,0.3)")} testID="wale-credits-close">
        <LineIcon name="x" size={25} stroke={2.7} />
      </Tap>
      {CREDITS.map((c, i) => (
        <Tap
          key={c.id}
          x={24}
          y={CARD_Y + i * (CARD_H + CARD_GAP)}
          w={381.6}
          h={CARD_H}
          label={`${c.title}. ${c.text}`}
          onPress={() => void Linking.openURL(c.url)}
          style={[glass(12, "rgba(255,255,255,0.22)"), { alignItems: "flex-start", justifyContent: "flex-start", paddingTop: 14, paddingLeft: 16, paddingRight: 16 }]}
          testID={`wale-credits-${c.id}`}
        >
          <T size={13} weight={700} style={{ lineHeight: 20 }} lines={2}>
            {c.title}
          </T>
          <T size={12} weight={400} color={W.ink} style={{ lineHeight: 18, marginTop: 6 }} lines={5}>
            {c.text}
          </T>
        </Tap>
      ))}
      <Tap x={24} y={licenceY} w={381.6} h={47.6} label="Creative Commons Attribution 4.0" onPress={() => void Linking.openURL(LICENCE_URL)} style={[glass(10, "rgba(255,255,255,0.18)"), { flexDirection: "row", justifyContent: "space-between", paddingLeft: 16, paddingRight: 14 }]} testID="wale-credits-licence">
        <T size={12} weight={700} style={{ lineHeight: 18 }}>
          CC BY 4.0 licence
        </T>
        <LineIcon name="chevron-right" size={17} stroke={2.8} />
      </Tap>
    </DesignCanvas>
  );
}
