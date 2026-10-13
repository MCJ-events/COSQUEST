import SwiftUI
import UIKit

/// The game world, as a SwiftUI view.
///
/// Unity renders into a UIView that this wraps. The wrapper is deliberately
/// thin: it does not own the runtime (UnityBridge does, once per process) and
/// it does not tear Unity down when it disappears, because Unity cannot be
/// restarted. Leaving a screen pauses rendering; coming back resumes it.
struct UnityWorldView: UIViewRepresentable {
    /// Where the world is centred. Handed to the scene as a message so the
    /// venue can change without rebuilding the Unity project.
    var latitude: Double
    var longitude: Double
    var radiusM: Double = 700

    /// 0..24. The environment's clock, so the world can be lit to match the
    /// real hour at the venue.
    var hour: Double = 10

    /// The games standing in the world.
    var anchors: [Pin] = []

    /// Called when a player taps one of them.
    var onSelect: ((String) -> Void)?

    /// The landmark to point the camera at, or nil to show the whole town.
    /// Changing this moves the camera across the town; it never rebuilds it.
    var focusSpot: Int?

    /// The organiser's points, while a game is being played. Empty clears them.
    var checkpoints: [Checkpoint] = []

    /// Who is in the outpost. No positions: the world decides where they
    /// stand, because the server sends none and should not.
    var presence: [[String: Any]] = []

    /// Called when a player taps one of them.
    var onCheckpoint: ((String) -> Void)?

    /// One of the organiser's points, as the world needs it.
    struct Checkpoint: Equatable {
        let id: String
        let kind: String
        /// Metres east and north of the VENUE's centre. Sent as an offset, not
        /// a coordinate, so the arrangement the organiser authored survives
        /// being relocated into the town.
        let dx: Double
        let dz: Double
        let colour: String?
        let taken: Bool
    }

    /// One game, as the world needs it. Deliberately not GameSummary: the
    /// world should not have to know the shape of the whole API to draw a
    /// beacon, and this is the entire contract between them.
    struct Pin: Equatable {
        let id: String
        let title: String
        let lat: Double
        let lng: Double
        /// "RRGGBB", the faction's colour. Nil falls back to the app's brass.
        let colour: String?
        /// Index into TownSpots.names. Resolved by the host so the label it
        /// shows and the beacon Unity plants are the same place. -1 lets Unity
        /// decide from the id.
        let spot: Int
        /// Already finished by this player, so it sits behind them on the path.
        let played: Bool
        /// How many people are at this game right now.
        let here: Int
    }

    func makeUIView(context: Context) -> UIView {
        // A plain container rather than Unity's own view, so that a failure to
        // start leaves something on screen to attach a message to instead of
        // crashing the host.
        let container = UIView()
        container.backgroundColor = UIColor(GamePalette.skyDeep)

        // Wired before the runtime starts, so a tap that lands during the
        // first frames is not dropped.
        UnityBridge.shared.onAnchorTapped = onSelect
        UnityBridge.shared.onCheckpointTapped = onCheckpoint

        // Start the clock BEFORE starting Unity, so a runtime that never
        // reports in cannot leave the interface hidden for the session.
        WorldState.shared.beginWaiting()

        switch UnityBridge.shared.start() {
        case .running:
            if let uv = UnityBridge.shared.unityView {
                uv.translatesAutoresizingMaskIntoConstraints = false
                container.addSubview(uv)
                NSLayoutConstraint.activate([
                    uv.topAnchor.constraint(equalTo: container.topAnchor),
                    uv.bottomAnchor.constraint(equalTo: container.bottomAnchor),
                    uv.leadingAnchor.constraint(equalTo: container.leadingAnchor),
                    uv.trailingAnchor.constraint(equalTo: container.trailingAnchor),
                ])
            }
            sendVenue()
            sendFocus()
            if !WorldState.shared.isReady { addBootOverlay(to: container) }
        case .failed(let why):
            // If Unity could not start there is nothing to wait for.
            WorldState.shared.giveUpWaiting()
            // Visible rather than silent. An empty world with no explanation
            // was the single most confusing failure in the earlier build.
            let label = UILabel()
            label.text = why
            label.numberOfLines = 0
            label.textAlignment = .center
            label.textColor = .white
            label.font = UIFont(name: "Fredoka", size: 16) ?? .preferredFont(forTextStyle: .footnote)
            label.translatesAutoresizingMaskIntoConstraints = false
            container.addSubview(label)
            NSLayoutConstraint.activate([
                label.centerXAnchor.constraint(equalTo: container.centerXAnchor),
                label.centerYAnchor.constraint(equalTo: container.centerYAnchor),
                label.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 24),
                label.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -24),
            ])
        case .idle:
            break
        }

        return container
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        UnityBridge.shared.pause(false)
        if WorldState.shared.isReady { Self.dismissBootOverlay(in: uiView) }
        // Unity can take key window status back after startup, which leaves the
        // app's buttons drawn but untouchable. Cheap to reassert, and the only
        // reliable moment is "whenever SwiftUI is doing a pass anyway".
        UnityBridge.shared.reclaimWindow(tag: "update")
        // Rebound every pass: SwiftUI hands out a fresh closure each time, and
        // holding the first one would keep calling into a stale view's state.
        UnityBridge.shared.onAnchorTapped = onSelect
        UnityBridge.shared.onCheckpointTapped = onCheckpoint
        sendVenue()
        sendAnchors()
        sendFocus()
        sendCheckpoints()
        sendPresence()
    }

    // MARK: - Boot spinner

    private static let bootOverlayTag = 0xC0_57

    /// A spinner over the container while Unity builds the town, so the first
    /// seconds read as loading rather than as a blank or frozen world.
    private func addBootOverlay(to container: UIView) {
        let overlay = UIView()
        overlay.tag = Self.bootOverlayTag
        overlay.backgroundColor = UIColor(GamePalette.skyDeep)
        overlay.translatesAutoresizingMaskIntoConstraints = false

        let spinner = UIActivityIndicatorView(style: .large)
        spinner.color = .white
        spinner.startAnimating()
        let label = UILabel()
        label.text = "BUILDING THE TOWN…"
        label.textColor = .white
        label.font = UIFont(name: "LilitaOne", size: 26) ?? .preferredFont(forTextStyle: .title2)
        label.layer.shadowColor = UIColor(GamePalette.ink).cgColor
        label.layer.shadowOffset = CGSize(width: 0, height: 3)
        label.layer.shadowOpacity = 0.6
        label.layer.shadowRadius = 0
        let stack = UIStackView(arrangedSubviews: [spinner, label])
        stack.axis = .vertical
        stack.spacing = 12
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        overlay.addSubview(stack)
        container.addSubview(overlay)
        NSLayoutConstraint.activate([
            overlay.topAnchor.constraint(equalTo: container.topAnchor),
            overlay.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            overlay.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            overlay.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            stack.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: overlay.centerYAnchor),
        ])

        // SwiftUI may not run an update pass the moment the world reports in,
        // so watch for it here too. WorldState always turns ready, at the
        // latest when its own timeout fires.
        Task { @MainActor [weak container] in
            while !WorldState.shared.isReady, container != nil {
                try? await Task.sleep(for: .milliseconds(200))
            }
            if let container { Self.dismissBootOverlay(in: container) }
        }
    }

    private static func dismissBootOverlay(in container: UIView) {
        guard let overlay = container.viewWithTag(bootOverlayTag) else { return }
        overlay.tag = 0
        UIView.animate(withDuration: 0.35, animations: { overlay.alpha = 0 },
                       completion: { _ in overlay.removeFromSuperview() })
    }

    /// Unity's messaging takes a single string, so the venue travels as JSON
    /// and the scene decodes it. One message rather than four keeps the world
    /// from rebuilding itself three times while the parameters arrive.
    private func sendVenue() {
        let payload = """
        {"lat":\(latitude),"lng":\(longitude),"radius_m":\(radiusM),"hour":\(hour)}
        """
        UnityBridge.shared.send(object: "WorldRoot", method: "SetVenue", message: payload)
    }

    private func sendCheckpoints() {
        let items = checkpoints.map { c -> [String: Any] in
            var d: [String: Any] = ["id": c.id, "kind": c.kind,
                                    "dx": c.dx, "dz": c.dz, "taken": c.taken]
            if let col = c.colour { d["colour"] = col }
            return d
        }
        let body: [String: Any] = ["spot": focusSpot ?? -1, "items": items]
        guard let data = try? JSONSerialization.data(withJSONObject: body,
                                                     options: [.sortedKeys]),
              let json = String(data: data, encoding: .utf8)
        else { return }
        UnityBridge.shared.send(object: "WorldRoot", method: "SetCheckpoints", message: json)
    }

    private func sendPresence() {
        guard let data = try? JSONSerialization.data(withJSONObject: ["people": presence],
                                                     options: [.sortedKeys]),
              let json = String(data: data, encoding: .utf8)
        else { return }
        UnityBridge.shared.send(object: "WorldRoot", method: "SetPresence", message: json)
    }

    /// Where the camera should be looking. -1 is the whole town.
    ///
    /// Only sent when it CHANGES. This used to go out on every update pass,
    /// and each one reset the camera's travel target on the Unity side, so a
    /// player pushing the world along would have it slide back the moment
    /// SwiftUI redrew for any unrelated reason. Unity ignores repeats now as
    /// well; both ends, because this is the kind of mistake that is easy to
    /// reintroduce from either side.
    private func sendFocus() {
        let want = focusSpot ?? -1
        guard want != Self.lastSentFocus else { return }
        Self.lastSentFocus = want
        UnityBridge.shared.send(object: "WorldRoot", method: "SetFocus",
                                message: "{\"spot\":\(want)}")
    }

    /// Static because the view struct is recreated on every pass, so an
    /// instance property would forget what it had sent and send it again.
    @MainActor private static var lastSentFocus: Int = Int.min

    /// The games, as one message. Unity places them against the venue origin it
    /// already has, so only their real coordinates travel.
    private func sendAnchors() {
        let items = anchors.map { pin -> [String: Any] in
            var d: [String: Any] = ["id": pin.id, "title": pin.title,
                                    "lat": pin.lat, "lng": pin.lng,
                                    "spot": pin.spot,
                                    "played": pin.played, "here": pin.here]
            if let c = pin.colour { d["colour"] = c }
            return d
        }
        // .sortedKeys matters: without it JSONSerialization emits keys in
        // whatever order the dictionary happens to hash to, so the SAME games
        // serialise to different strings and Unity's "have the anchors
        // changed" check misses. That rebuilt every beacon three times a
        // session instead of once.
        guard let data = try? JSONSerialization.data(withJSONObject: ["items": items],
                                                     options: [.sortedKeys]),
              let json = String(data: data, encoding: .utf8)
        else { return }
        UnityBridge.shared.send(object: "WorldRoot", method: "SetAnchors", message: json)
    }

    // Deliberately NO dismantleUIView.
    //
    // It used to pause Unity here, which froze the world solid. SwiftUI calls
    // dismantle whenever it RECREATES a representable, not only when the
    // screen goes away, and nothing ever called pause(false) again. The result
    // was the last rendered frame stuck on screen with the player loop
    // stopped: it looked like a hung renderer, and it was a paused one.
    //
    // Pausing belongs to the app's lifecycle (scenePhase), not to a view's
    // identity, so the host decides it. Unity is never unloaded either way: it
    // cannot be started twice in one process.
}
