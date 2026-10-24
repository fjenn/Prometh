import Foundation
import AVFoundation
import Combine

/// Replace this adapter with execution providers after design review. No network or microphone use.
struct SimulationService: Sendable {
    var timeScale: Double = 1
    func wait(_ seconds: Double) async throws { try await Task.sleep(for:.seconds(seconds * timeScale)); try Task.checkCancellation() }
    func applySkills(to response: String, skills: [SkillRecord]) -> String {
        let instructions=skills.filter(\.isEnabled).map(\.instructions).joined(separator:" ").lowercased()
        var output=response
        if instructions.contains("concise") || instructions.contains("brief") {
            output=String(response.components(separatedBy:"\n\n").prefix(2).joined(separator:"\n\n"))
        }
        if instructions.contains("bullet") {
            output=output.components(separatedBy:"\n\n").filter{!$0.isEmpty}.map{"• "+$0.replacingOccurrences(of:"\n",with:" ")}.joined(separator:"\n\n")
        }
        return output
    }
    func response(to prompt: String, mode: BehaviorMode) -> String {
        let p=prompt.lowercased(); let flourish = mode == .evil ? "Let’s take the scenic route.\n\n":""
        if p.contains("weekend") || p.contains("sea") { return flourish + "Let's leave a little room to breathe.\n\n**Friday · Arrive slowly**\nChoose a small place near the coast, put your phone away, and find somewhere for a simple supper.\n\n**Saturday · Follow your curiosity**\nStart with coffee and a long walk by the sea. Take a notebook, explore a local bookshop, and leave the afternoon open for making something.\n\n**Sunday · Bring a little of it home**\nA slow breakfast, one last swim or walk, and a few lines about what you'd like to keep from the weekend.\n\nWould you like a packing list or a more detailed itinerary?" }
        if p.contains("product") || p.contains("idea") { return flourish + "Start with one moment people will want to return to.\n\n**The promise**\nA personal AI that feels like yours: easy to open, comfortable to use, and ready to help you think.\n\n**The first experience**\n1. Make ownership clear in a sentence.\n2. Let people choose what they want to create.\n3. Give them a small, satisfying first result.\n\nThe useful question is: what should someone feel after their first five minutes? I would aim for curiosity, confidence, and a sense of possibility." }
        if p.contains("code") { return flourish + "A small, explicit state machine keeps the behavior easy to change:\n\n```swift\nenum CreationState {\n    case ready\n    case preparing(progress: Double)\n    case complete(URL)\n    case failed(String)\n}\n```\n\nGive each job its own identity, preserve the user's input, and make cancellation a real state transition. That makes retry predictable and keeps results attached to the right conversation." }
        return (mode == .evil ? "Let's push the idea further. " : "Let's make that concrete. ") + "For “\(prompt.prefix(180))”, I'd start by choosing the result you want, then work backward to the smallest useful first step.\n\n**A good starting point**\nWrite down what success looks like in one sentence. Explore three possible directions, pick the one that excites you, and make a rough first version.\n\nYou can ask me to turn this into a plan, shape the wording, or explore a more unexpected direction."
    }
}
@MainActor final class VoiceService: ObservableObject {
    @Published var phase = "Listening"; @Published var muted = false; @Published var transcript = ""; @Published var isOpen = false; @Published var denied = false
    var audio: AVPlayer?; private var task: Task<Void,Never>?; let simulation: SimulationService
    var onExchange: ((String, String) -> Void)?
    static let userLine = "Plan a calm, creative weekend by the sea."
    static let sample = "Let us plan a calm, creative weekend by the sea. We can start with a beautiful place to stay, leave room for a long walk, and keep the schedule wonderfully simple."
    init(simulation: SimulationService = .init()) { self.simulation=simulation }
    func open() { end(); isOpen=true;phase=denied ? "Microphone unavailable" : muted ? "Muted":"Listening";transcript="" }
    func sampleTurn() {
        guard !muted && !denied else {return}; interrupt();transcript="You: \(Self.userLine)";phase="Thinking"
        task=Task { [weak self] in
            guard let self else {return}
            do {try await simulation.wait(1.1);try Task.checkCancellation();phase="Speaking";transcript += "\n\n\(Product.name): \(Self.sample)";onExchange?(Self.userLine, Self.sample);let url=Resources.url("voice-demo.wav"); let duration=try await AVURLAsset(url:url).load(.duration);try Task.checkCancellation();audio=AVPlayer(url:url);audio?.play();try await simulation.wait(duration.seconds);try Task.checkCancellation();phase=muted ? "Muted" : "Listening"} catch { }
        }
    }
    func interrupt() { task?.cancel();task=nil;audio?.pause();audio=nil;phase=muted ? "Muted" : "Listening" }
    func toggleMute() { muted.toggle();interrupt() }
    func end() {interrupt();isOpen=false}
    func readAloud() {
        interrupt();phase="Thinking";transcript=Self.sample
        task=Task { [weak self] in
            guard let self else{return}
            do {let url=Resources.url("voice-demo.wav");let duration=try await AVURLAsset(url:url).load(.duration);try Task.checkCancellation();audio=AVPlayer(url:url);audio?.play();phase="Speaking";try await simulation.wait(duration.seconds);try Task.checkCancellation();audio?.pause();phase=muted ? "Muted":"Listening"}catch{}
        }
    }
}
