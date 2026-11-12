// The one switch for Wale's Figma screens (features/waleui/flag.ts has the rule
// and the reasons). Read here by its literal name so Metro inlines it.
import { waleUiFor } from "@/features/waleui/flag";

export const WALE_UI = waleUiFor(process.env.EXPO_PUBLIC_WALE_UI, process.env.EXPO_PUBLIC_E2E, __DEV__);
