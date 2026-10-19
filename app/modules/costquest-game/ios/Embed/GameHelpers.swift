import AVFoundation
import CoreMotion
import CoreNFC
import ExpoModulesCore
import Foundation
import NearbyInteraction
import Speech

// The platform helpers the shared React Native game calls (src/index.ts,
// `NativeOnly`), iOS half. Same function names, arguments, events and error
// codes as the Android module (android/.../CostQuestGameModule.kt), so the
// RN screens never branch on the platform to use them:
//
//   startListening / stopListening / cancelListening  onSpeechResult, onSpeechError
//   queryPedometer (iOS; Android has readStepCounter)   distance since a time
//   startNfcScan / stopNfcScan                         onNfcTag
//   uwbAvailable, nfcAvailable, pedometerAvailable      constants
//
// These are thin wrappers over Speech, CoreMotion and CoreNFC. They do not
// touch the SwiftUI game (Game/), so they work the same whether the build
// shows the RN game (gameUi 'rn', the default) or the native one.

struct ListenOptionsRecord: Record {
  /// Android shows it in recognisers that draw their own UI; unused on iOS.
  @Field var prompt: String? = nil
  /// BCP 47, e.g. "en-GB". Default: the phone's language.
  @Field var locale: String? = nil
  /// The likeliest phrases (the answer choices): `contextualStrings`.
  @Field var choices: [String]? = nil
  /// Refuse ("offline_unavailable") rather than use Apple's servers.
  @Field var onDeviceOnly: Bool = false
}

/// The plain values of a listen request, safe to hand to the main actor.
struct ListenRequest: Sendable {
  var locale: String?
  var choices: [String]
  var onDeviceOnly: Bool

  init(_ options: ListenOptionsRecord?) {
    locale = options?.locale
    choices = options?.choices ?? []
    onDeviceOnly = options?.onDeviceOnly ?? false
  }
}

struct PedometerQueryRecord: Record {
  @Field var fromMs: Double = 0
  @Field var toMs: Double? = nil
  /// May show the Motion & Fitness prompt (only when the player asked).
  @Field var ask: Bool = false
}

struct PedometerWindow: Sendable {
  var fromMs: Double
  var toMs: Double?
  var ask: Bool

  init(_ q: PedometerQueryRecord) {
    fromMs = q.fromMs
    toMs = q.toMs
    ask = q.ask
  }
}

/// The helpers, made once on the main actor, with the module's event sink.
@MainActor
final class GameHelpers {
  static let shared = GameHelpers()

  /// Set by the module's OnCreate (the same sink GameHost uses).
  var sink: GameEventSink?

  lazy var speech: SpeechHelper = {
    let made = SpeechHelper()
    made.onResult = { [weak self] text, final in
      self?.sink?.send("onSpeechResult", ["text": text, "final": final])
    }
    made.onError = { [weak self] code, message in
      self?.sink?.send("onSpeechError", ["code": code, "message": message])
    }
    return made
  }()

  lazy var nfc: NfcHelper = {
    let made = NfcHelper()
    made.onTag = { [weak self] id, text in
      self?.sink?.send("onNfcTag", ["id": id, "ndefText": text])
    }
    return made
  }()

  private let pedometer = PedometerHelper()

  func startListening(_ request: ListenRequest) async throws -> Bool {
    try await speech.start(request)
  }

  func queryPedometer(_ window: PedometerWindow) async -> PedometerHelper.Answer {
    await pedometer.query(window)
  }
}

func helperError(_ code: String, _ message: String) -> Exception {
  Exception(name: "CostQuestGameHelper", description: message, code: code)
}

// MARK: - Spoken answers

/// One utterance at a time, partial results while the player speaks, then a
/// final one. Mirrors SpeechListener.kt; the matching to a choice is shared
/// TypeScript (features/game/voiceAnswer.ts), as Warden/VoiceAnswer.swift's
/// matcher is for the native game.
@MainActor
final class SpeechHelper {
  var onResult: ((String, Bool) -> Void)?
  var onError: ((String, String) -> Void)?

  private let audio = AVAudioEngine()
  private var recognizer: SFSpeechRecognizer?
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var heard = ""
  /// Bumped by every start and cancel: a late callback from an older
  /// utterance is dropped instead of reaching the next question.
  private var serial = 0

  /// - Returns: true when recognition runs on the phone.
  func start(_ options: ListenRequest) async throws -> Bool {
    cancel()
    serial += 1
    let mine = serial
    guard await Self.authorised() else {
      throw helperError("permission_denied", "Microphone or speech recognition permission is not granted.")
    }
    guard mine == serial else { throw helperError("client", "Recognition was stopped.") }

    let wanted = options.locale.flatMap { $0.isEmpty ? nil : Locale(identifier: $0) } ?? Locale.current
    guard let recognizer = SFSpeechRecognizer(locale: wanted) ?? SFSpeechRecognizer(), recognizer.isAvailable else {
      throw helperError("unavailable", "This phone has no speech recogniser.")
    }
    let onDevice = recognizer.supportsOnDeviceRecognition
    if !onDevice && options.onDeviceOnly {
      throw helperError("offline_unavailable", "This phone has no on-device speech recogniser.")
    }

    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.playAndRecord, mode: .default, options: [.duckOthers, .defaultToSpeaker])
      try session.setActive(true, options: .notifyOthersOnDeactivation)
    } catch {
      throw helperError("audio", "The microphone could not be read.")
    }

    let req = SFSpeechAudioBufferRecognitionRequest()
    req.shouldReportPartialResults = true
    req.requiresOnDeviceRecognition = onDevice
    // "Alfred", not "all fred".
    req.contextualStrings = options.choices.filter { !$0.isEmpty }

    let input = audio.inputNode
    input.removeTap(onBus: 0)
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      throw helperError("audio", "No microphone is available right now.")
    }
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { @Sendable [weak req] buffer, _ in
      req?.append(buffer)
    }
    audio.prepare()
    do { try audio.start() } catch {
      input.removeTap(onBus: 0)
      throw helperError("audio", "The microphone could not be read.")
    }

    self.recognizer = recognizer
    request = req
    heard = ""
    task = recognizer.recognitionTask(with: req) { @Sendable [weak self] result, error in
      // Pull plain values out here: the result and error are not Sendable.
      let text = result?.bestTranscription.formattedString
      let final = result?.isFinal ?? false
      let failure = error.map { Self.describe($0 as NSError) }
      Task { @MainActor in self?.deliver(mine, text: text, final: final, failure: failure) }
    }
    return onDevice
  }

  /// Stops listening; the final result still arrives.
  func stop() {
    stopAudio()
    request?.endAudio()
  }

  /// Stops and drops the utterance: no event follows.
  func cancel() {
    serial += 1
    stopAudio()
    request?.endAudio()
    task?.cancel()
    finish()
  }

  private func deliver(_ owner: Int, text: String?, final: Bool, failure: (String, String)?) {
    guard owner == serial else { return }
    if let text, !text.isEmpty { heard = text }
    if final {
      onResult?(heard, true)
      finish()
    } else if let failure {
      // What was heard before the error (the player stopped talking, the
      // clock ran out) is still the answer, as Android's final result is.
      if heard.isEmpty { onError?(failure.0, failure.1) } else { onResult?(heard, true) }
      finish()
    } else if let text, !text.isEmpty {
      onResult?(text, false)
    }
  }

  private func stopAudio() {
    if audio.isRunning { audio.stop() }
    audio.inputNode.removeTap(onBus: 0)
  }

  private func finish() {
    stopAudio()
    task = nil
    request = nil
    recognizer = nil
    // Hand the audio session back (the Warden's voice, a call's audio).
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  private static func authorised() async -> Bool {
    let speech = await withCheckedContinuation { c in
      // @Sendable: Speech calls this off the main queue.
      SFSpeechRecognizer.requestAuthorization { @Sendable status in
        c.resume(returning: status == .authorized)
      }
    }
    guard speech else { return false }
    return await AVAudioApplication.requestRecordPermission()
  }

  /// The same codes as SpeechListener.describe on Android.
  nonisolated static func describe(_ error: NSError) -> (String, String) {
    if error.domain == "kAFAssistantErrorDomain" {
      switch error.code {
      case 1110: return ("speech_timeout", "No speech heard.")
      case 203, 1101: return ("no_match", "Didn't catch that.")
      case 216, 301: return ("client", "Recognition was stopped.")
      case 1700: return ("permission_denied", "Speech recognition permission is not granted.")
      default: break
      }
    }
    return ("error_\(error.code)", "Speech recognition failed (\(error.code)).")
  }
}

// MARK: - Walking distance

/// CoreMotion's pedometer: distance and steps between two times, as
/// Features/StepsFeature.swift reads it. iOS keeps a week of history, so the
/// RN game asks for "since Monday" directly (Android, which has only a
/// counter since boot, keeps its own ledger in features/game/steps.ts).
@MainActor
final class PedometerHelper {
  private let pedometer = CMPedometer()

  static var available: Bool { CMPedometer.isDistanceAvailable() || CMPedometer.isStepCountingAvailable() }

  struct Answer: Sendable {
    var status: String
    var meters: Double = 0
    var steps: Double = 0
    var dictionary: [String: Any] { ["status": status, "meters": meters, "steps": steps] }
  }

  func query(_ q: PedometerWindow) async -> Answer {
    guard Self.available else { return Answer(status: "unavailable") }
    switch CMPedometer.authorizationStatus() {
    case .denied, .restricted:
      return Answer(status: "denied")
    case .notDetermined where !q.ask:
      return Answer(status: "notDetermined")
    default:
      break
    }
    let from = Date(timeIntervalSince1970: q.fromMs / 1000)
    let to = q.toMs.map { Date(timeIntervalSince1970: $0 / 1000) } ?? Date()
    let pedometer = self.pedometer
    return await withCheckedContinuation { (c: CheckedContinuation<Answer, Never>) in
      // @Sendable: CoreMotion answers on its own queue (StepsFeature.swift
      // crashed on a phone without it).
      pedometer.queryPedometerData(from: from, to: to) { @Sendable data, error in
        if let error = error as NSError? {
          let denied = error.domain == CMErrorDomain
            && error.code == Int(CMErrorMotionActivityNotAuthorized.rawValue)
          c.resume(returning: Answer(status: denied ? "denied" : "error"))
          return
        }
        // Pull the numbers out here: CMPedometerData isn't Sendable.
        c.resume(returning: Answer(
          status: "ok",
          meters: max(0, data?.distance?.doubleValue ?? 0),
          steps: data?.numberOfSteps.doubleValue ?? 0))
      }
    }
  }
}

// MARK: - NFC checkpoints

/// One tag per scan (Game/Checkpoints.swift's rules): reads the NDEF records
/// and reports the checkpoint's anchor id. Needs the NFC entitlement
/// (`"nfc": true` in app.json); without it `startNfcScan` says so.
@MainActor
final class NfcHelper: NSObject {
  var onTag: ((String, String?) -> Void)?
  private var session: NFCNDEFReaderSession?

  static var available: Bool { NFCNDEFReaderSession.readingAvailable }

  func start() throws {
    guard Self.available else { throw helperError("nfc_unavailable", "This phone cannot read checkpoint tags.") }
    guard Bundle.main.object(forInfoDictionaryKey: "NFCReaderUsageDescription") != nil else {
      throw helperError("nfc_permission", "The app is built without NFC (config plugin option nfc: true).")
    }
    session?.invalidate()
    let session = NFCNDEFReaderSession(delegate: self, queue: nil, invalidateAfterFirstRead: true)
    session.alertMessage = "Hold your phone near the checkpoint."
    session.begin()
    self.session = session
  }

  func stop() {
    session?.invalidate()
    session = nil
  }

  /// The anchor id in a costquest://anchor/<uuid> URI, a text record or a
  /// bare uuid; nil for anything else (Checkpoints.anchorID).
  nonisolated static func anchorID(_ payloads: [NFCNDEFPayload]) -> (id: String?, text: String?) {
    var firstText: String?
    for payload in payloads {
      var candidate: String?
      if let url = payload.wellKnownTypeURIPayload() {
        firstText = firstText ?? url.absoluteString
        if url.scheme == "costquest" || url.pathComponents.contains("anchor") {
          candidate = url.lastPathComponent
        }
      }
      if candidate == nil, let text = payload.wellKnownTypeTextPayload().0 {
        firstText = firstText ?? text
        candidate = text.trimmingCharacters(in: .whitespacesAndNewlines)
          .replacingOccurrences(of: "costquest://anchor/", with: "")
      }
      if let candidate, UUID(uuidString: candidate) != nil { return (candidate, firstText) }
    }
    return (nil, firstText)
  }
}

extension NfcHelper: NFCNDEFReaderSessionDelegate {
  nonisolated func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {
    let found = NfcHelper.anchorID(messages.flatMap(\.records))
    if found.id == nil { session.invalidate(errorMessage: "That is not a CosQuest checkpoint.") }
    guard let id = found.id else { return }
    let text = found.text
    Task { @MainActor in self.onTag?(id, text) }
  }

  nonisolated func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: any Error) {
    Task { @MainActor in self.session = nil }
  }

  nonisolated func readerSessionDidBecomeActive(_ session: NFCNDEFReaderSession) {}
}

// MARK: - UWB

enum UwbHelper {
  /// Precise distance needs a U1/U2 chip (iPhone 11 and later, not the SE).
  static var available: Bool { NISession.deviceCapabilities.supportsPreciseDistanceMeasurement }
}
