import { HapticTab } from "@/components/haptic-tab";
import WorldPager from "@/components/world/WorldPager";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { FONTS } from "@/constants/fonts";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Tabs } from "expo-router";
import { world } from "@/features/world/worldState";
import { TAB_BAR_HEIGHT, tabBarBottom } from "@/constants/tabBar";
import { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C } from "@/theme/tokens";

const ACTIVE = C.brandVivid;
const INACTIVE = "#FFFFFF";

// Figma: the open tab gets a short pink line above its icon.
function TabIcon({
  focused,
  children,
}: {
  focused: boolean;
  children: ReactNode;
}) {
  return (
    <View style={styles.iconWrap}>
      {focused ? <View style={styles.activeLine} /> : null}
      {children}
    </View>
  );
}

// Merged app: the tabs are page 0 of the world; the game is page 1, one
// swipe to the right (components/world/WorldPager.tsx).
export default function TabLayout() {
  return (
    <WorldPager>
      <ChatTabs />
    </WorldPager>
  );
}

// Tab labels grow with the phone's text size only a little: the bar has a
// fixed height and four labels side by side.
const TAB_LABEL_MAX_SCALE = 1.15;

function ChatTabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      // The bar floats above the bottom inset (tabBarBottom), so React
      // Navigation must not also pad the inset inside the 68 points.
      safeAreaInsets={{ bottom: 0 }}
      screenOptions={{
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: INACTIVE,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarLabel: ({ color, children }) => (
          // Shrinks to fit rather than "Cosqu…" at the largest display size.
          <Text style={[styles.label, { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={TAB_LABEL_MAX_SCALE}>
            {children}
          </Text>
        ),
        tabBarStyle: {
          position: "absolute",
          marginHorizontal: 16,
          bottom: tabBarBottom(insets.bottom),
          height: TAB_BAR_HEIGHT,
          paddingTop: 8,
          borderTopWidth: 0,
          backgroundColor: "transparent",
          elevation: 0,
        },
        // Figma: a darker grey see-through bar.
        tabBarBackground: () => (
          <View style={styles.barShadow}>
            <BlurView intensity={25} tint="dark" style={styles.barClip}>
              <LinearGradient
                colors={["rgba(52, 46, 52, 0.78)", "rgba(52, 46, 52, 0.62)"]}
                style={StyleSheet.absoluteFill}
              />
            </BlurView>
            <View pointerEvents="none" style={styles.barOutline} />
          </View>
        ),
      }}>
      <Tabs.Screen
        name="home"
        // Merged app: the map pin opens the game instead of a page (home.tsx).
        listeners={{
          tabPress: (event) => {
            event.preventDefault();
            world.openGame(null);
          },
        }}
        options={{
          title: "CosQuest",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon focused={focused}>
              <IconSymbol size={26} name="mappin.and.ellipse" color={color} />
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="live"
        options={{
          title: "Live",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon focused={focused}>
              <IconSymbol
                size={26}
                name="dot.radiowaves.left.and.right"
                color={color}
              />
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: "Community",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon focused={focused}>
              {/* Figma: an outline chat bubble */}
              <Ionicons name="chatbox-outline" size={25} color={color} />
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon focused={focused}>
              <Ionicons name="person-outline" size={24} color={color} />
            </TabIcon>
          ),
        }}
      />
    </Tabs>
  );
}

const RADIUS = 34;

const styles = StyleSheet.create({
  barShadow: {
    ...StyleSheet.absoluteFill,
    borderRadius: RADIUS,
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },

  barClip: {
    ...StyleSheet.absoluteFill,
    borderRadius: RADIUS,
    overflow: "hidden",
  },

  barOutline: {
    ...StyleSheet.absoluteFill,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },

  label: {
    fontFamily: FONTS.medium,
    fontSize: 11,
    marginTop: 2,
  },

  iconWrap: {
    alignItems: "center",
    justifyContent: "center",
  },

  // The short pink line above the open tab's icon.
  activeLine: {
    position: "absolute",
    top: -12,
    width: 26,
    height: 3,
    borderRadius: 2,
    backgroundColor: ACTIVE,
  },
});
