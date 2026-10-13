import ExpoModulesCore
import UIKit
import os

// The React Native face of the game (modules/costquest-game/src/index.ts).
// Every call lands on the main thread and goes straight to GameHost.

struct GameOpenTargetRecord: Record {
  @Field var shrineId: String? = nil
  @Field var raidId: String? = nil
  @Field var duelId: String? = nil
  @Field var lat: Double? = nil
  @Field var lng: Double? = nil
  @Field var place: String? = nil
}

struct GameChatPreviewRecord: Record {
  @Field var chatId: String = ""
  @Field var title: String = ""
  @Field var text: String = ""
}

struct GameCallPillRecord: Record {
  @Field var title: String = "Call"
  @Field var video: Bool = false
  /// Epoch milliseconds the call was answered; absent while ringing.
  @Field var answeredAt: Double? = nil
}

public final class CostQuestGameModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CostQuestGame")

    Events("onReady", "onSession", "onShareToChat", "onRequestChat", "onError")

    Constants {
      [
        // False in the simulator build, where Unity is left out (NO_UNITY):
        // the world home, points and quizzes work; event maps and fights
        // say they need a device.
        "available": true,
        "hasUnity": Self.hasUnity,
        // For the shell's prewarm policy (features/world/prewarm.ts).
        "physicalMemory": Double(ProcessInfo.processInfo.physicalMemory),
        "upstream": "costquest-ios",
      ]
    }

    OnCreate {
      let sink = GameEventSink(module: self)
      DispatchQueue.main.async {
        MainActor.assumeIsolated { GameHost.shared.sink = sink }
      }
    }

    // No OnDestroy: the sink holds the module weakly, and clearing it here
    // could land after a reloaded module's OnCreate and drop its events.

    AsyncFunction("prewarm") {
      MainActor.assumeIsolated { GameHost.shared.prewarm() }
    }.runOnQueue(.main)

    AsyncFunction("pause") {
      MainActor.assumeIsolated { GameHost.shared.setVisible(false) }
    }.runOnQueue(.main)

    AsyncFunction("resume") {
      MainActor.assumeIsolated { GameHost.shared.setVisible(true) }
    }.runOnQueue(.main)

    AsyncFunction("open") { (target: GameOpenTargetRecord) in
      let request = Self.request(from: target)
      MainActor.assumeIsolated { GameHost.shared.open(request) }
    }.runOnQueue(.main)

    AsyncFunction("setSession") { (token: String?) in
      MainActor.assumeIsolated { GameHost.shared.setSession(token) }
    }.runOnQueue(.main)

    AsyncFunction("setUnread") { (count: Int, previews: [GameChatPreviewRecord]) in
      let items = previews.map { GameChatPreview(chatId: $0.chatId, title: $0.title, text: $0.text) }
      MainActor.assumeIsolated { GameHost.shared.setUnread(count, previews: items) }
    }.runOnQueue(.main)

    AsyncFunction("setCallPill") { (pill: GameCallPillRecord?) in
      let value = pill.map { GameCallPill(title: $0.title, video: $0.video, answeredAtMs: $0.answeredAt) }
      MainActor.assumeIsolated { GameHost.shared.setCallPill(value) }
    }.runOnQueue(.main)

    AsyncFunction("handleURL") { (url: URL) in
      MainActor.assumeIsolated { GameHost.shared.handleURL(url) }
    }.runOnQueue(.main)

    AsyncFunction("reset") {
      MainActor.assumeIsolated { GameHost.shared.reset() }
    }.runOnQueue(.main)

    // For measuring the prewarm on a phone (docs/merged-app-ux.md): what this
    // process uses now and what iOS would still let it have, in bytes.
    Function("memoryReport") { () -> [String: Double] in
      [
        "physical": Double(ProcessInfo.processInfo.physicalMemory),
        "footprint": Double(cq_phys_footprint()),
        "available": Double(os_proc_available_memory()),
      ]
    }

    View(CostQuestGameView.self) {
      Prop("parked") { (view: CostQuestGameView, parked: Bool?) in
        view.parked = parked ?? false
      }

      // Only for tests and screen readers: the game draws everything else.
      Prop("accessibilityLabel") { (view: CostQuestGameView, label: String?) in
        view.accessibilityLabel = label
      }
    }
  }

  static var hasUnity: Bool {
    #if NO_UNITY
    return false
    #else
    return true
    #endif
  }

  private static func request(from target: GameOpenTargetRecord) -> GameOpenRequest {
    let kind: GameOpenRequest.Kind
    let id: String?
    if let raid = target.raidId { kind = .raid; id = raid }
    else if let duel = target.duelId { kind = .duel; id = duel }
    else if let shrine = target.shrineId { kind = .shrine; id = shrine }
    else { kind = .place; id = nil }
    return GameOpenRequest(kind: kind, targetId: id, lat: target.lat, lng: target.lng,
                           place: target.place, madeAt: Date())
  }
}
