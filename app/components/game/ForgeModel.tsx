// One 3D runtime for Android and iOS (cq 056): any Forge catalogue entry as a
// live model, through react-native-filament (Google Filament: GLB with PBR
// materials, skins and animation clips; OpenGL/Vulkan on Android, Metal on
// iOS; renders off the JS thread). Self-hosted: the engine ships in the app.
//
//   <ForgeModel id={el.id} animation="idle" purpose="closeup" />
//
// What it does, whatever the element is:
// - downloads the GLB for this phone's class and the purpose (LOD 0 for a
//   close-up on a good phone, 1 or 2 elsewhere), once per version, checked
//   against the catalogue's sha256 (forgeWorldDevice.ensureFile);
// - shows the server's thumbnail (or the type's icon) while it loads, and
//   stays on it if anything fails: no Forge entry can crash a screen;
// - plays a named clip (idle / walk / celebrate) when the entry is rigged,
//   with the contract's fallbacks, and turns slowly when asked to.
// EXPO_PUBLIC_GAME_2D=forgeModel (or all) turns the 3D off: thumbnails only.
//
// <ForgeStage> puts several entries in one scene (one engine): a point's
// environment, its station and a character, laid out in metres.
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Component, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { resolveIslandsOff } from "@/features/game/config";
import { clipIndex, type ForgeEntry, type ForgePurpose } from "@/features/game/forgeWorld";
import { ensureFile, forgeWorld, glbFor, thumbUrl, useForgeWorld } from "@/features/game/forgeWorldDevice";

import { GP } from "./theme";

type Filament = typeof import("react-native-filament");
type Worklets = typeof import("react-native-worklets-core");
type Float3 = [number, number, number];

/**
 * The engine, when this build has it. A build without the native module (or
 * with the island turned off, or the web) draws thumbnails instead.
 */
const ENGINE: { F: Filament; W: Worklets } | null = (() => {
  if (Platform.OS === "web" || resolveIslandsOff(process.env.EXPO_PUBLIC_GAME_2D).has("forgeModel")) return null;
  try {
    return { F: require("react-native-filament") as Filament, W: require("react-native-worklets-core") as Worklets };
  } catch {
    return null;
  }
})();
const FILAMENT = ENGINE?.F ?? null;

export const FORGE_3D_RUNTIME = FILAMENT !== null;

const TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  weapon: "flash",
  character: "person",
  environment: "leaf",
  station: "business",
};

/** A rendering problem stays inside the model's box. */
class Boundary extends Component<{ fallback: ReactNode; children: ReactNode; onError?: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError?.();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Thumb({ entry, size, loading }: { entry: ForgeEntry | null; size: number; loading: boolean }) {
  const url = thumbUrl(entry, size > 200 ? 512 : 256);
  return (
    <View style={styles.fill} pointerEvents="none">
      {url ? (
        <Image source={{ uri: url }} style={styles.fill} contentFit="contain" transition={150} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.fill, styles.centre]}>
          <Ionicons name={TYPE_ICON[entry?.type ?? ""] ?? "cube"} size={Math.max(24, size * 0.35)} color="rgba(255,255,255,0.75)" />
        </View>
      )}
      {loading ? (
        <View style={[styles.fill, styles.centre]}>
          <ActivityIndicator color={GP.sun} />
        </View>
      ) : null}
    </View>
  );
}

/** The file:// uri of an entry's GLB for this purpose, once it is on the phone. */
export function useForgeGlb(entry: ForgeEntry | null, purpose: ForgePurpose, lod?: number): { uri: string | null; failed: boolean } {
  const file = entry ? glbFor(entry, purpose, lod) : null;
  const key = entry && file ? `${entry.id}@${entry.version}/${file.file}` : null;
  const [got, setGot] = useState<{ key: string | null; uri: string | null; failed: boolean }>({ key: null, uri: null, failed: false });
  useEffect(() => {
    if (!entry || !file || !key) return;
    let alive = true;
    void ensureFile(entry, file).then((uri) => {
      if (alive) setGot({ key, uri, failed: uri === null });
    });
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!entry || !file) return { uri: null, failed: !!entry };
  return got.key === key ? { uri: got.uri, failed: got.failed } : { uri: null, failed: false };
}

export type ForgeModelProps = {
  /** The catalogue id (the entry is looked up in the store), or the entry itself. */
  id?: string | null;
  entry?: ForgeEntry | null;
  /** Shown only if the catalogue has this version (an older one falls back to the newest). */
  version?: number | null;
  /** Force a LOD (0 best, 2 lightest); else chosen by the phone and the purpose. */
  lod?: number;
  purpose?: ForgePurpose;
  /** idle | walk | celebrate (rigged entries); one-shot clips return to idle. */
  animation?: string | null;
  onAnimationEnd?: () => void;
  /** Turn slowly (cards, the claim moment). */
  spin?: boolean;
  /** The camera's distance in unit-cube terms (the model is fitted into a 1 m cube). */
  distance?: number;
  style?: StyleProp<ViewStyle>;
  /** For the box's size hint (thumbnail resolution). */
  size?: number;
  accessibilityLabel?: string;
};

export function useForgeEntry(id: string | null | undefined, given?: ForgeEntry | null): ForgeEntry | null {
  const fromStore = useForgeWorld((s) => (id ? (s.entries.find((e) => e.id === id) ?? null) : null));
  return given ?? fromStore;
}

export default function ForgeModel(props: ForgeModelProps) {
  const entry = useForgeEntry(props.id, props.entry);
  const size = props.size ?? 220;
  const { uri, failed } = useForgeGlb(FILAMENT ? entry : null, props.purpose ?? "closeup", props.lod);
  const [broken, setBroken] = useState(false);
  const label = props.accessibilityLabel ?? (entry ? `${entry.name}, 3D model` : "Forge model");
  const show3d = !!FILAMENT && !!uri && !broken && !failed;
  return (
    <View style={[styles.box, props.style]} accessible accessibilityRole="image" accessibilityLabel={label}>
      {!show3d ? <Thumb entry={entry} size={size} loading={!!FILAMENT && !!entry && !failed && !broken && !uri} /> : null}
      {show3d && FILAMENT ? (
        <Boundary fallback={<Thumb entry={entry} size={size} loading={false} />} onError={() => setBroken(true)}>
          <FilamentModel
            F={FILAMENT}
            uri={uri}
            entry={entry as ForgeEntry}
            animation={props.animation ?? null}
            onAnimationEnd={props.onAnimationEnd}
            spin={!!props.spin}
            distance={props.distance ?? 2.1}
          />
        </Boundary>
      ) : null}
    </View>
  );
}

function FilamentModel({
  F,
  uri,
  entry,
  animation,
  onAnimationEnd,
  spin,
  distance,
}: {
  F: Filament;
  uri: string;
  entry: ForgeEntry;
  animation: string | null;
  onAnimationEnd?: () => void;
  spin: boolean;
  distance: number;
}) {
  // A weapon stands on its grip and is long in +Y: look at it from a little
  // above; everything else from chest height.
  const eye: Float3 = entry.type === "weapon" ? [0, 0.15, distance] : [0, 0.12, distance];
  return (
    <F.FilamentScene>
      <F.FilamentView style={styles.fill} enableTransparentRendering>
        <F.Camera cameraPosition={eye} cameraTarget={[0, 0, 0]} near={0.05} far={50} />
        <F.DefaultLight />
        <Rigged F={F} uri={uri} entry={entry} animation={animation} onAnimationEnd={onAnimationEnd} spin={spin} unitCube />
      </F.FilamentView>
    </F.FilamentScene>
  );
}

/** One model (and its clip) inside a scene. Fitted into a unit cube, or placed in metres. */
function Rigged({
  F,
  uri,
  entry,
  animation,
  onAnimationEnd,
  spin,
  unitCube,
  translate,
  scale,
  rotateY,
}: {
  F: Filament;
  uri: string;
  entry: ForgeEntry;
  animation: string | null;
  onAnimationEnd?: () => void;
  spin?: boolean;
  unitCube?: boolean;
  translate?: Float3;
  scale?: number;
  rotateY?: number;
}) {
  const [clips, setClips] = useState<string[]>([]);
  const [playing, setPlaying] = useState<string | null>(animation);
  useEffect(() => setPlaying(animation), [animation]);
  // A one-shot clip (celebrate) plays once, then back to idle.
  const clip = entry.animations.find((a) => a.name === playing);
  const endRef = useRef(onAnimationEnd);
  endRef.current = onAnimationEnd;
  useEffect(() => {
    if (!playing || !clip || clip.loop || !clip.duration_s) return;
    const t = setTimeout(() => {
      setPlaying("idle");
      endRef.current?.();
    }, clip.duration_s * 1000);
    return () => clearTimeout(t);
  }, [playing, clip]);
  const index = clipIndex(clips, playing);
  const rotate = (ENGINE as { W: Worklets }).W.useSharedValue<Float3>([0, rotateY ?? 0, 0]);
  return (
    <F.Model
      source={{ uri }}
      transformToUnitCube={unitCube}
      translate={translate}
      scale={scale ? [scale, scale, scale] : undefined}
      rotate={spin ? rotate : rotateY ? [0, rotateY, 0] : undefined}
      castShadow
      receiveShadow>
      {entry.rigged ? <F.Animator animationIndex={Math.max(0, index)} transitionDuration={0.25} onAnimationsLoaded={(a) => setClips(a.map((x) => x.name))} /> : null}
      {spin ? <Spinner F={F} value={rotate} base={rotateY ?? 0} /> : null}
    </F.Model>
  );
}

function Spinner({ F, value, base }: { F: Filament; value: { value: Float3 }; base: number }) {
  F.RenderCallbackContext.useRenderCallback(
    ({ passedSeconds }) => {
      "worklet";
      value.value = [0, base + passedSeconds * 0.5, 0];
    },
    [value, base],
  );
  return null;
}

// ---------- several entries in one scene ----------

export type StageItem = {
  entry: ForgeEntry;
  /** Where its pivot (base centre) stands, metres. */
  at?: Float3;
  /** Its height on stage in metres; else its own size. */
  height?: number;
  rotateY?: number;
  animation?: string | null;
  purpose?: ForgePurpose;
};

function StageModel({ F, item }: { F: Filament; item: StageItem }) {
  const { uri } = useForgeGlb(item.entry, item.purpose ?? "scene");
  if (!uri) return null;
  const own = item.entry.height_m ?? 1;
  const scale = item.height && own > 0 ? item.height / own : 1;
  return (
    <Boundary fallback={null}>
      <Rigged F={F} uri={uri} entry={item.entry} animation={item.animation ?? null} translate={item.at} scale={scale} rotateY={item.rotateY} />
    </Boundary>
  );
}

/**
 * A small scene: a ground or backdrop environment, a station, a character.
 * The camera looks at `target` from `eye` (metres). Items that fail to load
 * are left out; with no 3D at all, `fallback` shows (the screen's own 2D art).
 */
export function ForgeStage({
  items,
  eye = [0, 1.6, 6],
  target = [0, 1, 0],
  style,
  fallback = null,
}: {
  items: StageItem[];
  eye?: Float3;
  target?: Float3;
  style?: StyleProp<ViewStyle>;
  fallback?: ReactNode;
}) {
  const key = useMemo(() => items.map((i) => `${i.entry.id}@${i.entry.version}`).join("|"), [items]);
  if (!FILAMENT || !items.length) return <View style={style}>{fallback}</View>;
  const F = FILAMENT;
  return (
    <View style={style}>
      <Boundary fallback={fallback} key={key}>
        <F.FilamentScene>
          <F.FilamentView style={styles.fill} enableTransparentRendering>
            <F.Camera cameraPosition={eye} cameraTarget={target} near={0.1} far={200} />
            <F.DefaultLight />
            {items.map((item, i) => (
              <StageModel key={`${item.entry.id}-${i}`} F={F} item={item} />
            ))}
          </F.FilamentView>
        </F.FilamentScene>
      </Boundary>
    </View>
  );
}

/** The entry for an id from the store, without subscribing (for one-off reads). */
export const forgeEntry = (id: string | null | undefined) => forgeWorld.entry(id);

const styles = StyleSheet.create({
  box: { overflow: "hidden" },
  fill: { ...StyleSheet.absoluteFill },
  centre: { alignItems: "center", justifyContent: "center" },
});
