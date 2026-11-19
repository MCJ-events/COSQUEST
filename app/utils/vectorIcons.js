// What `import { ... } from "@expo/vector-icons"` gives the app (build 30, app size). The package's
// own index pulls in all 16 icon fonts (about 7 MB raw, 4 MB in the IPA) although the app draws
// three; metro.config.js points the bare package name here, so only these fonts ship. Deep imports
// ("@expo/vector-icons/Ionicons") are untouched. Types still come from the real package.
// A family the app starts using must be added here (plugins/__tests__/vectorIcons.test.js checks).
export { default as Ionicons } from "@expo/vector-icons/Ionicons";
export { default as MaterialCommunityIcons } from "@expo/vector-icons/MaterialCommunityIcons";
export { default as MaterialIcons } from "@expo/vector-icons/MaterialIcons";
export { default as createIconSet } from "@expo/vector-icons/createIconSet";
