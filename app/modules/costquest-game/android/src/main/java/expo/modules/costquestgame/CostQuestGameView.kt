package expo.modules.costquestgame

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

// PLACEHOLDER: a dark page. The shell draws its own "coming to Android" card
// over it; this only keeps the view slot real, so layout and gestures behave
// as they will once the game is behind it (merge task 2).
@SuppressLint("ViewConstructor")
class CostQuestGameView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  init {
    setBackgroundColor(Color.parseColor("#14061A"))
  }
}
