// The Warden's on-device model (the mote engine), as the React Native game
// sees it. Android only for now (android/, NDK + JNI); elsewhere the module is
// absent and the Warden speaks its authored lines, exactly as iOS does before
// its model has downloaded.
import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

export type WardenModelInfo = { dim?: number; layers?: number; heads?: number; vocab?: number; context?: number; bits?: number };

export type WardenGeneration = {
  text: string;
  tokens: number;
  firstTokenMs: number;
  totalMs: number;
  tokensPerSecond: number;
};

export type CostQuestWardenModule = {
  available: boolean;
  physicalMemory: number;
  abi: string;
  load(modelPath: string, tokenizerPath: string): Promise<WardenModelInfo>;
  generate(prompt: string, maxTokens: number, temperature: number): Promise<WardenGeneration>;
  stop(): void;
  unload(): Promise<void>;
  sha256File(path: string): Promise<string>;
};

export const CostQuestWarden: CostQuestWardenModule | null =
  Platform.OS === "android" ? requireOptionalNativeModule<CostQuestWardenModule>("CostQuestWarden") : null;
