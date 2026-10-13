import Foundation
import os
import UIKit
import UnityFramework

/// Owns the embedded Unity runtime.
///
/// Unity is loaded as a library, not as the app. It renders exactly one thing,
/// the game world, inside a view this app places wherever it likes. Navigation,
/// auth, the drawer, the profile and every other surface stay SwiftUI, because
/// "native and Apple first" was the whole point and a Unity UI would not be.
///
/// Two constraints shape everything here:
///
///  1. **Unity can only be started once per process.** Its runtime is not built
///     to be torn down and rebuilt; `unloadApplication` leaves state behind
///     that a second `runEmbedded` trips over. So this is a singleton that
///     starts on first use and afterwards only ever shows, hides and pauses.
///
///  2. **It must run on the main thread.** Unity drives its render loop off the
///     main run loop, so every entry point here is main-actor bound rather
///     than trusting callers to remember.
private let log = Logger(subsystem: "net.costquest", category: "unity")

@MainActor
final class UnityBridge: NSObject {
    static let shared = UnityBridge()

    /// What the world is currently doing, so a caller can show a spinner or
    /// explain a failure instead of presenting an empty rectangle.
    enum State: Equatable {
        case idle
        case running
        case failed(String)
    }

    private(set) var state: State = .idle
    private(set) var isPaused = false

    /// Called when a player taps a game standing in the world. Set by the
    /// view that is showing it; cleared when that view goes away.
    var onAnchorTapped: ((String) -> Void)?

    /// Called when a player taps one of the organiser's points during a game.
    var onCheckpointTapped: ((String) -> Void)?
    private var framework: UnityFramework?
    /// The app's own window, captured before Unity built its own.
    private var hostWindow: UIWindow?

    private override init() { super.init() }

    /// What a player reads when the world cannot start. The technical reason
    /// goes to the log, not the screen.
    static let friendlyFailure =
        "The town couldn't load right now. Close and reopen CosQuest to try again."


    /// Unity's rendered view, once it is running. Nil before `start()`.
    var unityView: UIView? { framework?.appController()?.rootView }

    /// Boots the runtime, or returns the existing state if it is already up.
    @discardableResult
    func start() -> State {
        if case .running = state {
            // Already up: make sure it is actually RUNNING and not sitting
            // paused from a previous teardown. SwiftUI recreates a
            // representable freely, so the view this runtime is attached to
            // may have been dismantled and remade since it last rendered.
            pause(false)
            return state
        }

        // Loaded by path rather than relying on the linker having already
        // brought it in, so a missing framework surfaces as a diagnosable
        // error here instead of a dyld crash before any of our code runs.
        let path = Bundle.main.bundlePath + "/Frameworks/UnityFramework.framework"
        guard let bundle = Bundle(path: path) else {
            log.error("UnityFramework.framework is not in the app bundle")
            state = .failed(Self.friendlyFailure)
            return state
        }
        if !bundle.isLoaded { bundle.load() }

        guard let instance = (bundle.principalClass as? UnityFramework.Type)?.getInstance() else {
            log.error("UnityFramework principal class did not answer getInstance")
            state = .failed(Self.friendlyFailure)
            return state
        }

        // Unity looks for its Data folder inside the framework bundle rather
        // than the host app's, which is what makes one export embeddable in
        // any app.
        instance.setDataBundleId("com.unity3d.framework")

        // Remember OUR window before Unity runs. runEmbedded builds a UIWindow
        // of its own and makes it key and visible, which puts it above the
        // whole SwiftUI app: the world is all you can see and all you can
        // touch, the buttons are unreachable behind it, and it reads as a
        // total freeze. Unity is not meant to own the screen here; it draws one
        // view inside an app that owns everything else.
        let hostWindow = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.isKeyWindow }

        // Register the callbacks BEFORE Unity runs.
        //
        // These used to go in after runEmbedded returned, which is a race the
        // authored town lost: the world is built synchronously and reports
        // itself ready within a couple of frames, and if that landed before the
        // pointer was set, the signal went to a NULL and was gone for good.
        // Unity never retries, so the app waited on a spinner for the rest of
        // the session. The framework is loaded by this point, so the symbols
        // are there to be set.
        CQSetAnchorTappedCallback { identifier in
            let value = identifier.map { String(cString: $0) } ?? ""
            // Unity calls this from its own player loop. Hopping to the main
            // actor keeps every downstream SwiftUI mutation on the thread that
            // owns it. The closure is @convention(c) and captures nothing,
            // which is why it reaches the singleton rather than holding self.
            Task { @MainActor in UnityBridge.shared.deliverAnchorTap(value) }
        }

        CQSetCheckpointTappedCallback { identifier in
            let value = identifier.map { String(cString: $0) } ?? ""
            Task { @MainActor in UnityBridge.shared.deliverCheckpointTap(value) }
        }

        CQSetWorldReadyCallback { buildings in
            Task { @MainActor in WorldState.shared.markReady(buildings: Int(buildings)) }
        }

        // `runEmbedded`, not `run`: this app keeps its own UIApplicationDelegate
        // and window, and Unity attaches to them rather than replacing them.
        instance.runEmbedded(
            withArgc: CommandLine.argc,
            argv: CommandLine.unsafeArgv,
            appLaunchOpts: nil
        )

        // Take the screen back. Unity's view is reparented into our own
        // hierarchy by UnityWorldView, so its window has nothing left to show
        // and must not stay above ours.
        self.hostWindow = hostWindow
        reclaimWindow(tag: "after runEmbedded")

        framework = instance
        state = .running
        return state
    }

    /// Hands a value to a script in the running scene. A no-op when Unity is
    /// not up, so callers never have to check first.
    func send(object: String, method: String, message: String) {
        framework?.sendMessageToGO(withName: object, functionName: method, message: message)
    }

    /// Stops rendering without tearing the runtime down. Unity keeps its
    /// memory but stops spending a GPU budget behind a screen nobody is looking
    /// at, which matters on a phone that is also running AR and an LLM.
    func pause(_ paused: Bool) {
        guard let framework else { return }
        guard paused != isPaused else { return }
        framework.pause(paused)
        isPaused = paused
    }

    /// Takes the screen back from Unity, and says what it found.
    ///
    /// Calling this once after runEmbedded is not enough. Unity's startup
    /// continues asynchronously past that return, and it makes its own window
    /// key as part of that: whichever order those land in, the app can end up
    /// drawing its interface correctly while Unity's window holds key status
    /// and swallows every touch. Which is exactly the symptom: buttons that
    /// are visible, look right, and do nothing.
    ///
    /// So it is idempotent and called again on every SwiftUI update pass. It
    /// logs what it found, because "whose window is key" is the one fact that
    /// separates this from a dozen other explanations.
    func reclaimWindow(tag: String) {
        let unityWindow = framework?.appController()?.window
        if unityWindow == nil, let fw = framework {
            _ = fw  // appController can be nil for the first frames
        }
        unityWindow?.isHidden = true

        let keyBefore = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.isKeyWindow }

        if keyBefore !== hostWindow {
            hostWindow?.makeKeyAndVisible()
            let was = String(describing: type(of: keyBefore))
            log.debug("window reclaimed (\(tag, privacy: .public)): key was \(was, privacy: .public), now host")
        }
    }

    /// Routed here from the C callback registered in start().
    func deliverAnchorTap(_ id: String) {
        guard !id.isEmpty else { return }
        onAnchorTapped?(id)
    }

    func deliverCheckpointTap(_ id: String) {
        guard !id.isEmpty else { return }
        onCheckpointTapped?(id)
    }
}
