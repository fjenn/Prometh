import Foundation
import AVFoundation

@main struct VoiceTests {
    @MainActor static func main() async throws{
        var count=0
        func check(_ value:Bool,_ message:String){guard value else{fatalError(message)};count += 1;print("PASS \(message)")}
        var gate=VoiceActivityGate()
        for _ in 0..<100{check(!gate.observe(power:-70),"Quiet input stays open")}
        check(!gate.heardSpeech,"Silence cannot produce an STT job")
        _=gate.observe(power:-20);_=gate.observe(power:-22)
        check(!gate.heardSpeech,"Two brief noisy frames do not count as speech")
        _=gate.observe(power:-25)
        check(gate.heardSpeech,"Three voiced frames count as speech")
        for _ in 0..<6{check(!gate.observe(power:-65),"Short pause does not finish the turn")}
        check(gate.observe(power:-65),"Seven silent frames finish the turn")
        var phrases=VoicePhraseBuffer()
        check(phrases.append("The answer is 3.").isEmpty,"Wait for a phrase boundary")
        check(phrases.append("14. Next ")==["The answer is 3.14."],"Decimal remains intact")
        check(phrases.append("sentence! And ")==["Next sentence!"],"Emit a sentence before completion")
        check(phrases.finish()==["And"],"Flush the final phrase")
        check(phrases.finish().isEmpty,"Final phrase is emitted exactly once")
        var long=VoicePhraseBuffer()
        let chunks=long.append(String(repeating:"word ",count:50))
        check(!chunks.isEmpty && chunks.allSatisfy{$0.count<=145},"Long unpunctuated output streams in bounded phrases")
        let voice=VoiceService(simulation:.init(timeScale:0.01))
        voice.open();voice.sampleTurn();voice.interrupt()
        try await Task.sleep(for:.milliseconds(40))
        check(voice.phase=="Listening" && voice.audio==nil,"Interrupt cannot resume stale simulated speech")
        voice.toggleMute();check(voice.muted && voice.phase=="Muted","Mute stops the active turn")
        voice.end();check(!voice.isOpen && voice.audio==nil,"End stops the session")

        // The fixture Python launcher implements the production NDJSON protocol.
        // These tests exercise Swift ownership/serialization without microphones,
        // model weights, audio playback, network, or Metal work.
        let root=FileManager.default.temporaryDirectory.appendingPathComponent("prometh-speech-state-"+UUID().uuidString)
        defer{try? FileManager.default.removeItem(at:root)}
        let runtime=LocalRuntime(root:root,catalog:.init(models:[]))
        let first=try await runtime.runJob(["kind":"tts","prompt":"first"]){_ in}
        let second=try await runtime.runJob(["kind":"tts","prompt":"second"]){_ in}
        check(first["pid"] as? Int==second["pid"] as? Int,"Normal speech turns reuse one worker")
        var staleAudio=0
        let cancelled=Task{try await runtime.runJob(["kind":"tts","prompt":"slow"]){event in if event["audioChunk"] != nil{staleAudio += 1}}}
        try await Task.sleep(for:.milliseconds(80));cancelled.cancel()
        do{_=try await cancelled.value;fatalError("Cancelled job returned success")}catch{}
        let third=try await runtime.runJob(["kind":"tts","prompt":"third"]){_ in}
        check(third["pid"] as? Int != second["pid"] as? Int,"Cancelled worker is replaced for the next turn")
        try await Task.sleep(for:.milliseconds(100))
        check(staleAudio==0,"Cancelled output is never delivered to a later turn")
        do{_=try await runtime.runJob(["kind":"tts","prompt":"fail"]){_ in};fatalError("Worker error returned success")}catch{check(error.localizedDescription.contains("fixture failure"),"Provider errors reach the caller")}
        _=try await runtime.runJob(["kind":"tts","prompt":"recovered"]){_ in}
        check(true,"A failed worker can recover on the next request")
        let a=Task{try await runtime.runJob(["kind":"tts","prompt":"serial-a"]){_ in}}
        let b=Task{try await runtime.runJob(["kind":"tts","prompt":"serial-b"]){_ in}}
        let aResult=try await a.value,bResult=try await b.value
        check(aResult["prompt"] as? String=="serial-a" && bResult["prompt"] as? String=="serial-b","Concurrent requests preserve their IDs and results")
        runtime.shutdown()
        print("\(count) voice checks passed; no microphone or model inference used.")
    }
}
