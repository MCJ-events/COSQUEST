import SwiftUI
import UIKit
import os

private let log = Logger(subsystem: "net.costquest", category: "battle")

/// The Battle scene in the embedded Unity runtime, as a DuelHost: the same
/// shape as UnityDuelHost, talking to BattleBridge instead of DuelBridge and
/// to CQSetBattleEventCallback (CQNativeBridge.m) instead of the duel's.
/// DuelView picks it when the server's setup is of kind "battle"
/// (costquest-research/29_battle_connect.md). Unity runs once per process, so
/// there is only ever one host showing a fight.
@MainActor
final class UnityBattleHost: DuelHost {
    private static weak var current: UnityBattleHost?
    private static var registered = false

    var canFight: Bool { Self.registered }
    var onEvent: ((DuelHostEvent) -> Void)?

    init() {
        Self.current = self
        Self.registerOnce()
    }

    /// Looked up at run time, not linked, so an export without the Battle
    /// scene cannot stop the app linking; missing means "no battle in this
    /// build" and the fight ends with an error instead of a blank screen.
    private typealias EventCallback = @convention(c) (UnsafePointer<CChar>?, UnsafePointer<CChar>?) -> Void
    private typealias SetCallback = @convention(c) (EventCallback?) -> Void

    private static func registerOnce() {
        guard !registered else { return }
        guard let sym = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CQSetBattleEventCallback") else {
            log.error("this Unity export has no Battle scene (CQSetBattleEventCallback is missing)")
            return
        }
        registered = true
        let set = unsafeBitCast(sym, to: SetCallback.self)
        set { kind, json in
            let k = kind.map { String(cString: $0) } ?? ""
            let j = json.map { String(cString: $0) } ?? ""
            Task { @MainActor in UnityBattleHost.current?.deliver(kind: k, json: j) }
        }
    }

    func begin(setupJSON: String) {
        guard canFight, boot() else { onEvent?(.quit(nil)); return }
        UnityBridge.shared.send(object: "BattleBridge", method: "StartBattle", message: setupJSON)
    }

    func demo() {
        guard canFight, boot() else { onEvent?(.quit(nil)); return }
        UnityBridge.shared.send(object: "BattleBridge", method: "DemoBattle", message: "")
    }

    func quit() {
        UnityBridge.shared.send(object: "BattleBridge", method: "Quit", message: "")
    }

    func close() { UnityBridge.shared.pause(true) }

    var supportsPause: Bool { true }

    func setPaused(_ paused: Bool) {
        UnityBridge.shared.send(object: "BattleBridge", method: "SetPaused", message: paused ? "1" : "0")
    }

    func makeView() -> AnyView { AnyView(UnityDuelSurface()) }

    private func boot() -> Bool {
        if case .failed(let why) = UnityBridge.shared.start() {
            log.error("Unity did not start for a battle: \(why, privacy: .public)")
            return false
        }
        return true
    }

    private func deliver(kind: String, json: String) {
        switch kind {
        case "ready":
            onEvent?(.ready)
        case "sfx":
            struct Cue: Decodable { let name: String?; let haptic: String? }
            let c = json.data(using: .utf8).flatMap { try? JSONDecoder().decode(Cue.self, from: $0) }
            onEvent?(.sfx(c?.name ?? json))
        case "finished":
            if let data = json.data(using: .utf8), let f = try? JSONDecoder().decode(BattleFinished.self, from: data) {
                onEvent?(.finished(f.asDuelFinished))
            } else {
                log.error("battle finished with an unreadable payload")
                onEvent?(.quit(nil))
            }
        case "quit":
            onEvent?(.quit(nil))
        default:
            log.debug("battle event \(kind, privacy: .public) ignored")
        }
    }
}
