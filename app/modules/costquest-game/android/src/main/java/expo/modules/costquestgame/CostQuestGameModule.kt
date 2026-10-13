package expo.modules.costquestgame

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// PLACEHOLDER until the Android game lands (merge task 2). Same functions and
// events as the iOS module (modules/costquest-game/ios/Embed), all accepted
// and ignored, so the shell's code paths run on Android as they will later.
// `available` tells the shell to show the "coming to Android" page.
class CostQuestGameModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CostQuestGame")

    Events("onReady", "onSession", "onShareToChat", "onRequestChat", "onError")

    Constants(
      "available" to false,
      "hasUnity" to false,
      "upstream" to "placeholder"
    )

    AsyncFunction("prewarm") {}
    AsyncFunction("pause") {}
    AsyncFunction("resume") {}
    AsyncFunction("open") { _: Map<String, Any?> -> }
    AsyncFunction("setSession") { _: String? -> }
    AsyncFunction("setUnread") { _: Int, _: List<Map<String, Any?>> -> }
    AsyncFunction("setCallPill") { _: Map<String, Any?>? -> }
    AsyncFunction("handleURL") { _: String -> }
    AsyncFunction("reset") {}

    View(CostQuestGameView::class) {
      Prop("accessibilityLabel") { view: CostQuestGameView, label: String? ->
        view.contentDescription = label
      }
    }
  }
}
