import SwiftUI
import UIKit
import os

private let log = Logger(subsystem: "net.costquest", category: "duel")

/// The Duel scene in the embedded Unity runtime, as a DuelHost.
///
/// Unity reports everything through one C callback, a kind and a JSON
/// payload, registered with CQSetDuelEventCallback (defined in
/// CQNativeBridge.m inside UnityFramework, for the same linking reason as the
/// world's callbacks: see UnityBridge). The callback is @convention(c) and
/// captures nothing, so it reaches whichever host is current through a static.
@MainActor
final class UnityDuelHost: DuelHost {
    /// The host showing a fight right now. Unity runs once per process, so
    /// there is only ever one.
    private static weak var current: UnityDuelHost?
    private static var registered = false

    var canFight: Bool { true }
    var onEvent: ((DuelHostEvent) -> Void)?

    init() {
        Self.current = self
        Self.registerOnce()
    }

    private static func registerOnce() {
        guard !registered else { return }
        registered = true
        // Before Unity starts, so a `ready` in the first frames isn't dropped.
        CQSetDuelEventCallback { kind, json in
            let k = kind.map { String(cString: $0) } ?? ""
            let j = json.map { String(cString: $0) } ?? ""
            // Unity calls from its own player loop; everything downstream is
            // SwiftUI state, so hop to the main actor.
            Task { @MainActor in UnityDuelHost.current?.deliver(kind: k, json: j) }
        }
    }

    func begin(setupJSON: String) {
        guard boot() else { return }
        UnityBridge.shared.send(object: "DuelBridge", method: "StartDuel", message: setupJSON)
    }

    func demo() {
        guard boot() else { return }
        UnityBridge.shared.send(object: "DuelBridge", method: "DemoDuel", message: "")
    }

    func quit() {
        UnityBridge.shared.send(object: "DuelBridge", method: "Quit", message: "")
    }

    func close() {
        UnityBridge.shared.pause(true)
    }

    func makeView() -> AnyView { AnyView(UnityDuelSurface()) }

    private func boot() -> Bool {
        if case .failed(let why) = UnityBridge.shared.start() {
            log.error("Unity did not start for a duel: \(why, privacy: .public)")
            onEvent?(.quit(nil))
            return false
        }
        return true
    }

    private func deliver(kind: String, json: String) {
        switch kind {
        case "ready":
            onEvent?(.ready)
        case "sfx":
            onEvent?(.sfx(Self.cue(json)))
        case "finished":
            if let f = Self.decode(json) {
                onEvent?(.finished(f))
            } else {
                log.error("duel finished with an unreadable payload")
                onEvent?(.quit(nil))
            }
        case "quit":
            onEvent?(.quit(Self.decode(json)))
        default:
            log.debug("duel event \(kind, privacy: .public) ignored")
        }
    }

    private static func decode(_ json: String) -> DuelFinished? {
        guard let data = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(DuelFinished.self, from: data)
    }

    /// A cue is sent either bare ("hit_heavy") or as {"name": "..."}.
    private static func cue(_ json: String) -> String {
        struct Named: Decodable { let name: String?; let cue: String? }
        if let data = json.data(using: .utf8),
           let n = try? JSONDecoder().decode(Named.self, from: data) {
            return n.name ?? n.cue ?? json
        }
        return json
    }
}

/// Unity's view, full screen, in the duel's own container: the same thin
/// wrapper as UnityWorldView, minus the world's messages.
struct UnityDuelSurface: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        container.backgroundColor = UIColor(GamePalette.navyEdge)
        if let uv = UnityBridge.shared.unityView {
            uv.removeFromSuperview()
            uv.translatesAutoresizingMaskIntoConstraints = false
            container.addSubview(uv)
            NSLayoutConstraint.activate([
                uv.topAnchor.constraint(equalTo: container.topAnchor),
                uv.bottomAnchor.constraint(equalTo: container.bottomAnchor),
                uv.leadingAnchor.constraint(equalTo: container.leadingAnchor),
                uv.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            ])
        }
        return container
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        UnityBridge.shared.pause(false)
        UnityBridge.shared.reclaimWindow(tag: "duel")
    }
}
