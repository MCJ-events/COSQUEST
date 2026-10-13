import SwiftUI
import UIKit
import os

private let log = Logger(subsystem: "net.costquest", category: "hall")

/// The Hub scene in the embedded Unity runtime, as a HallHost.
///
/// Unity reports through one C callback, a kind and a JSON payload,
/// registered with CQSetHubEventCallback (defined in CQNativeBridge.m inside
/// UnityFramework; see UnityBridge for why it lives there). Swift talks to
/// the scene through UnitySendMessage to "HubBridge".
///
/// There is one Unity view for the whole app, shared by the hall, the duel and
/// the event town. Whichever surface is on screen owns it; the hall takes it
/// back whenever it is shown again (see UnityHallSurface).
@MainActor
final class UnityHallHost: HallHost {
    private static weak var current: UnityHallHost?
    private static var registered = false

    var isLive: Bool { true }
    var onEvent: ((HallEvent) -> Void)?

    private var ready = false
    private var pending: HallLook?
    private var retry: Task<Void, Never>?

    init() {
        Self.current = self
        Self.registerOnce()
    }

    private static func registerOnce() {
        guard !registered else { return }
        registered = true
        CQSetHubEventCallback { kind, json in
            let k = kind.map { String(cString: $0) } ?? ""
            let j = json.map { String(cString: $0) } ?? ""
            Task { @MainActor in UnityHallHost.current?.deliver(kind: k, json: j) }
        }
    }

    /// Sends ShowHall until the scene says it is ready: a message sent in the
    /// runtime's first frames, before HubBridge exists, is simply dropped.
    func show(_ look: HallLook) {
        pending = look
        guard boot() else { return }
        send(look)
        retry?.cancel()
        retry = Task { [weak self] in
            for _ in 0..<8 {
                try? await Task.sleep(for: .seconds(1.5))
                guard let self, !Task.isCancelled, !self.ready, let look = self.pending else { return }
                self.send(look)
            }
        }
    }

    func emote(_ id: String) {
        UnityBridge.shared.send(object: "HubBridge", method: "PlayEmote", message: id)
    }

    func mood(_ mood: String) {
        UnityBridge.shared.send(object: "HubBridge", method: "Mood", message: mood)
    }

    func pause(_ paused: Bool) {
        guard case .running = UnityBridge.shared.state else { return }
        if paused {
            UnityBridge.shared.send(object: "HubBridge", method: "Pause", message: "1")
            UnityBridge.shared.pause(true)
        } else {
            UnityBridge.shared.pause(false)
            UnityBridge.shared.send(object: "HubBridge", method: "Pause", message: "0")
        }
    }

    func makeView(epoch: Int) -> AnyView { AnyView(UnityHallSurface(epoch: epoch)) }

    private func send(_ look: HallLook) {
        UnityBridge.shared.send(object: "HubBridge", method: "ShowHall", message: look.json)
    }

    private func boot() -> Bool {
        if case .failed(let why) = UnityBridge.shared.start() {
            log.error("Unity did not start for the hall: \(why, privacy: .public)")
            return false
        }
        return true
    }

    private func deliver(kind: String, json: String) {
        switch kind {
        case "ready":
            ready = true
            retry?.cancel()
            onEvent?(.ready)
        case "hero_tapped":
            onEvent?(.heroTapped)
        case "hero_long_pressed":
            onEvent?(.heroLongPressed)
        case "trophy_tapped":
            struct T: Decodable { let id: String }
            if let d = json.data(using: .utf8), let t = try? JSONDecoder().decode(T.self, from: d) {
                onEvent?(.trophyTapped(t.id))
            }
        default:
            log.debug("hall event \(kind, privacy: .public) ignored")
        }
    }
}

/// Unity's view, in the hall's own container. `epoch` changes whenever the
/// hall comes back on screen (after a duel, after the World page), which makes
/// SwiftUI call updateUIView, and that re-parents the one Unity view here if
/// another surface took it.
private struct UnityHallSurface: UIViewRepresentable {
    var epoch: Int

    func makeUIView(context: Context) -> HallContainer {
        let container = HallContainer()
        container.backgroundColor = UIColor(GamePalette.navyEdge)
        container.adoptUnity()
        return container
    }

    func updateUIView(_ container: HallContainer, context: Context) {
        container.adoptUnity()
        UnityBridge.shared.reclaimWindow(tag: "hall")
    }
}

/// Holds Unity's one view for the hall.
///
/// The hall's surface is usually made before Unity has started (the runtime
/// boots on the first ShowHall), so there is no view to adopt yet. Adopting
/// once, then, left an empty navy box on the screen for ever: the first phone
/// build showed exactly that. So the container keeps trying, briefly, until the
/// view exists, and again whenever it rejoins a window.
final class HallContainer: UIView {
    private var poll: Task<Void, Never>?

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil { adoptUnity() } else { poll?.cancel(); poll = nil }
    }

    func adoptUnity() {
        if attach() { poll?.cancel(); poll = nil; return }
        guard poll == nil else { return }
        poll = Task { @MainActor [weak self] in
            for _ in 0..<120 {
                try? await Task.sleep(for: .milliseconds(250))
                guard let self, !Task.isCancelled else { return }
                if self.attach() { self.poll = nil; return }
            }
        }
    }

    /// True once Unity's view is in this container.
    private func attach() -> Bool {
        guard let uv = UnityBridge.shared.unityView else { return false }
        if uv.superview === self { return true }
        uv.removeFromSuperview()
        uv.translatesAutoresizingMaskIntoConstraints = false
        addSubview(uv)
        NSLayoutConstraint.activate([
            uv.topAnchor.constraint(equalTo: topAnchor),
            uv.bottomAnchor.constraint(equalTo: bottomAnchor),
            uv.leadingAnchor.constraint(equalTo: leadingAnchor),
            uv.trailingAnchor.constraint(equalTo: trailingAnchor),
        ])
        UnityBridge.shared.reclaimWindow(tag: "hall-adopt")
        return true
    }
}
