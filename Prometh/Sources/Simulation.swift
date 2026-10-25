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
