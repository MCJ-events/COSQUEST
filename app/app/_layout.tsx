import AvatarCatalogLoader from "@/components/AvatarCatalogLoader";
import ActiveCallOverlay from "@/components/calls/ActiveCallOverlay";
import VoiceRoomOverlay from "@/components/voice/VoiceRoomOverlay";
import CallBannerFrame from "@/components/calls/CallBannerFrame";
import IncomingCallListener from "@/components/calls/IncomingCallListener";
import SessionGate from "@/components/SessionGate";
import { RootErrorBoundary } from "@/components/ErrorBoundary";
import ForceUpdateGate from "@/components/ForceUpdateGate";
import OfflineBanner from "@/components/OfflineBanner";
import PushBridge from "@/components/PushBridge";
import ReportSheetHost from "@/components/safety/ReportSheet";
import { startMonitoring } from "@/services/monitoring";
import GameBridge from "@/components/world/GameBridge";
import { KeyboardProvider } from "@/components/ui/keyboard";
import { UserProvider } from "@/context/UserContext";
import { useSocketConnection } from "@/hooks/useSocketConnection";
import { store } from "@/store/store";
import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  Poppins_800ExtraBold,
} from "@expo-google-fonts/poppins";
import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
// LiveKit setup for phones (does nothing on web — see the file itself).
import "@/utils/livekitSetup";
// Makes Alert.alert show real popups on the website (does nothing on phones).
import "@/utils/webAlert";
// Browser-only style fixes (does nothing on phones).
import "@/utils/webGlobalStyles";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import { Provider } from "react-redux";

// useSocketConnection() calls useAppSelector internally, which only
// works inside <Provider store={store}>. RootLayout below is the
// component that CREATES that Provider, so calling the hook directly
// in RootLayout's own body would run before the Provider exists in the
// tree yet — this tiny component exists only to be a Provider
// DESCENDANT, so the hook has real Redux access. Renders nothing.
function SocketConnectionGate() {
  useSocketConnection();

  return null;
}

// The phone's splash stays up until the fonts and the saved login are ready
// (SessionGate hides it), instead of a blank frame and then a second splash
// (audit B6). If something hangs, it goes after 6 s anyway.
void SplashScreen.preventAutoHideAsync().catch(() => {});

// Crash reporting: only with EXPO_PUBLIC_SENTRY_DSN (services/monitoring.ts).
startMonitoring();
setTimeout(() => void SplashScreen.hideAsync().catch(() => {}), 6000);

export default function RootLayout() {
  // Icon fonts (so they resolve on web) + Poppins, the app font (Figma).
  // Poppins is also built into the app (the expo-font plugin in app.json), so
  // on Android this resolves from the APK without a download.
  const [fontsLoaded, fontsError] = useFonts({
    ...Ionicons.font,
    ...MaterialIcons.font,
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_800ExtraBold,
  });

  if (!fontsLoaded && !fontsError) return null;

  return (
    <RootErrorBoundary>
    <ForceUpdateGate>
    <Provider store={store}>
      {/* Stay logged in: loads the saved login before the screens show */}
      <SessionGate>
        <SocketConnectionGate />

        {/* Loads all the backend's avatars (GET /api/meta/avatars) */}
        <AvatarCatalogLoader />

        <GestureHandlerRootView style={{ flex: 1 }}>
          {/* The keyboard, the same way everywhere (components/ui/keyboard.tsx) */}
          <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
          <UserProvider>
            {/* Green "Tap to return to call" bar while a call is minimized */}
            <CallBannerFrame>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="onboarding" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="edit-profile" />
                <Stack.Screen name="contact-options" />
                <Stack.Screen name="followers" />
                <Stack.Screen name="following" />
                <Stack.Screen name="category" />
                <Stack.Screen name="settings" />
                <Stack.Screen name="notifications" />

                {/* cosquest://play?... and cosquest://coins?...: hand the
                    link to the game and step aside (no flash). */}
                <Stack.Screen
                  name="play"
                  options={{ presentation: "transparentModal", animation: "none" }}
                />
                <Stack.Screen
                  name="coins"
                  options={{ presentation: "transparentModal", animation: "none" }}
                />

                {/* Audio/video call screen */}
                <Stack.Screen
                  name="call/[id]"
                  options={{ gestureEnabled: false, animation: "fade" }}
                />
              </Stack>
            </CallBannerFrame>

            {/* The ongoing call - stays mounted, so minimizing never ends it */}
            <ActiveCallOverlay />
              <VoiceRoomOverlay />

            {/* Ringing screen — shows on top of any screen when someone calls */}
            <IncomingCallListener />

            {/* Merged app: the chat <-> game bridge (one login, unread,
                calls, invites to chat, notification links) */}
            <GameBridge />

            {/* Push token, notification taps, waiting links, the badge (task 059) */}
            <PushBridge />

            {/* The Report sheet any screen opens (task 059) */}
            <ReportSheetHost />

            {/* "You're offline" and the messages waiting to send */}
            <OfflineBanner />

            {/* Dark icons: most screens are light even when the phone is dark (the chat sets its own). */}
            <StatusBar style="dark" />
          </UserProvider>
          </KeyboardProvider>
        </GestureHandlerRootView>
      </SessionGate>
    </Provider>
    </ForceUpdateGate>
    </RootErrorBoundary>
  );
}
