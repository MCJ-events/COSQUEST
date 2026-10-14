// Run by app/scripts/swift-linux-check.sh: the pure Swift (VoiceAnswer.match,
// WardenCheck) against the same vectors as the TypeScript tests.
import Foundation

var failures = 0
@MainActor func check<T: Equatable>(_ got: T, _ want: T, _ what: String) {
    if got != want { failures += 1; print("FAIL \(what): got \(got), want \(want)") } else { print("ok   \(what)") }
}

// The same vectors as app/features/game/__tests__/voiceAnswer.test.ts.
let C = ["Big Ben", "Tower Bridge", "The Shard", "Buckingham Palace"]
check(VoiceAnswer.match("tower bridge", choices: C, strict: true), 1, "words")
check(VoiceAnswer.match("I think it's Buckingham Palace", choices: C, strict: true), 3, "words in a sentence")
check(VoiceAnswer.match("the shard", choices: C, strict: false), 2, "the shard")
check(VoiceAnswer.match("the second one", choices: C, strict: true), 1, "ordinal with 'The Shard' among choices (the fix)")
check(VoiceAnswer.match("B", choices: C, strict: true), 1, "letter")
check(VoiceAnswer.match("the green one", choices: C, strict: true), 3, "colour")
check(VoiceAnswer.match("number three", choices: C, strict: true), 2, "number three")
check(VoiceAnswer.match("first", choices: C, strict: true), 0, "first")
let bands = ["One Direction", "Blur", "Oasis", "Pulp"]
check(VoiceAnswer.match("one direction", choices: bands, strict: true), 0, "one direction")
check(VoiceAnswer.match("the red one", choices: bands, strict: true), 1, "the red one")
check(VoiceAnswer.match("blue", choices: ["Red Kite", "Robin", "Blue Tit", "Wren"], strict: false), 2, "colour that is a choice word")
check(VoiceAnswer.match("starlord", choices: ["Star-Lord", "Groot", "Rocket", "Gamora"], strict: true), 0, "run together")
check(VoiceAnswer.match("cafe nero", choices: ["Caffè Nero", "Café Nero", "Costa", "Pret"], strict: false), 1, "accents")
check(VoiceAnswer.match("buckingham", choices: C, strict: false), 3, "prefix")
check(VoiceAnswer.match("buckinghams palace", choices: C, strict: false), 3, "prefix 2")
check(VoiceAnswer.match("palace", choices: C, strict: true), nil, "strict partial")
check(VoiceAnswer.match("palace", choices: C, strict: false), 3, "lenient final")
check(VoiceAnswer.match("", choices: C, strict: false), nil, "silence")
check(VoiceAnswer.match("hmm", choices: C, strict: false), nil, "noise")
check(VoiceAnswer.match("tower or shard", choices: ["Tower", "Shard", "Eye", "Dome"], strict: false), nil, "tie")
check(VoiceAnswer.match("tower bridge", choices: ["Big Ben", "", "The Shard", ""], strict: false), nil, "removed choice")
check(VoiceAnswer.match("the shard", choices: ["Big Ben", "", "The Shard", ""], strict: true), 2, "live choice after 50/50")

// WardenCheck: the same vectors as wardenCheck.test.ts.
let lost = WardenMoment("result", style: .hype, [("name", "ada"), ("place", "Caffè Nero"), ("challenge", "duel"), ("result", "lost")])
let crest = WardenMoment("arrive", style: .hype, [("name", "ada"), ("place", "Crest of London"), ("challenge", "duel")])
check(WardenCheck.problem("I'm ada, an assistant built for the Crest of London. I run on your device.", for: crest), "off voice: assistant", "0.5B arrive")
check(WardenCheck.problem("I won't be able to help you with that. I can't help with duels.", for: lost), "off voice: can't help", "0.5B result")
for line in ["I\u{2019}m sorry, but I cannot do that for you today.",
             "As a language model I have no shrine to guard.",
             "How can I help you at Caffè Nero today, Ada?",
             "Let me know if you want another duel, Ada.",
             "I am just an AI running at Caffè Nero for you.",
             "Feel free to ask about Caffè Nero anytime, Ada."] {
    check(WardenCheck.problem(line, for: lost)?.hasPrefix("off voice: ") ?? false, true, "refused: \(line)")
}
check(WardenCheck.problem("Crest of London, Ada! A duel, and I can feel the pressure!", for: crest), nil, "1.7B arrive")
check(WardenCheck.problem("That duel was tough, Ada, but you never gave up! Caffè Nero will remember this one.", for: lost), nil, "1.7B result")
check(WardenCheck.offVoicePhrases.count, 44, "phrase count matches the TS list")

print(failures == 0 ? "ALL PASSED" : "\(failures) FAILED")
exit(failures == 0 ? 0 : 1)
