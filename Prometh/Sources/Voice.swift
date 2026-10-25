import Foundation
import AVFoundation
import Combine

/// A short voiced run is required before a silence boundary can end a turn.
/// Quiet input never reaches Whisper, which can hallucinate on silent WAVs.
struct VoiceActivityGate {
    private(set) var voicedFrames=0
    private(set) var silentFrames=0
    var heardSpeech:Bool{voicedFrames>=3}
    mutating func observe(power:Float)->Bool{
        if power > -42{voicedFrames += 1;silentFrames=0}
        else if heardSpeech{silentFrames += 1}
        else{voicedFrames=0}
        return heardSpeech && silentFrames>=7
    }
}

/// Emit complete phrases while tokens arrive; preserve the remainder exactly.
struct VoicePhraseBuffer {
    private(set) var pending=""
    mutating func append(_ delta:String)->[String]{pending += delta;return drain(final:false)}
    mutating func finish()->[String]{drain(final:true)}
    private mutating func drain(final:Bool)->[String]{
        var phrases=[String]()
        while !pending.isEmpty{
            var boundary:String.Index?
            for index in pending.indices{
                let character=pending[index],next=pending.index(after:index)
                if ".!?\n".contains(character),next<pending.endIndex,pending[next].isWhitespace{boundary=next;break}
                if pending.distance(from:pending.startIndex,to:next)>=140,character.isWhitespace{boundary=next;break}
            }
            if boundary == nil,final{boundary=pending.endIndex}
            guard let end=boundary else{break}
            let phrase=String(pending[..<end]).trimmingCharacters(in:.whitespacesAndNewlines)
            pending.removeSubrange(..<end)
            if !phrase.isEmpty{phrases.append(phrase)}
        }
        return phrases
    }
}

private enum VoiceInputFailure:LocalizedError{case silence;var errorDescription:String?{"No speech was detected. Try recording again."}}

@MainActor final class VoiceService:ObservableObject {
    @Published var phase="Listening";@Published var muted=false;@Published var transcript="";@Published var isOpen=false;@Published var denied=false
    var audio:AVPlayer?;private var task:Task<Void,Never>?;let simulation:SimulationService
    var runtime:LocalRuntime?;var reply:((String) async throws -> String)?
    var streamReply:((String,@escaping @MainActor (String)->Void) async throws -> String)?
    var onExchange:((String,String)->Void)?
    private var recorder:AVAudioRecorder?;private var recordingFinished=false
    private var owner=UUID()
    private var warmupTask:Task<Void,Never>?
    static let userLine="Plan a calm, creative weekend by the sea."
    static let sample="Let us plan a calm, creative weekend by the sea. We can start with a beautiful place to stay, leave room for a long walk, and keep the schedule wonderfully simple."
    init(simulation:SimulationService = .init()){self.simulation=simulation}
    func open(){end();isOpen=true;phase=denied ? "Microphone unavailable":muted ? "Muted":runtime == nil ? "Listening":"Ready to listen";transcript=""}
    func sampleTurn(){
        guard !muted && !denied else{return}
        if runtime != nil{
            if recorder?.isRecording==true{finishRecording();return}
            startSession();return
        }
        cancelCurrent();isOpen=true;transcript="You: \(Self.userLine)";phase="Thinking"
        let turn=owner
        task=Task{[weak self] in guard let self else{return};do{try await simulation.wait(1.1);try ensureCurrent(turn);phase="Speaking";transcript += "\n\nPrometh: \(Self.sample)";onExchange?(Self.userLine,Self.sample);try await play(Resources.url("voice-demo.wav"));try ensureCurrent(turn);phase=muted ? "Muted":"Listening"}catch{}}
    }
    private func ensureCurrent(_ turn:UUID)throws{try Task.checkCancellation();guard owner==turn,!muted else{throw CancellationError()}}
    private func startSession(){
        cancelCurrent();isOpen=true
        let turn=owner
        if let runtime{warmupTask=Task{[weak self] in do{try self?.ensureCurrent(turn);try await runtime.warmSpeech()}catch{}}}
        task=Task{[weak self] in
            guard let self else{return}
            do{
                while isOpen && !muted && !denied{
                    try ensureCurrent(turn)
                    let user:String
                    do{user=try await recordAndTranscribe()}catch VoiceInputFailure.silence{continue}
                    try ensureCurrent(turn);transcript="You: "+user;phase="Thinking"
                    let answer=try await answerAndSpeak(user,owner:turn)
                    try ensureCurrent(turn);onExchange?(user,answer)
                    // Loop back into a real recording before publishing Listening.
                }
            }catch is CancellationError{}catch{if owner==turn{warmupTask?.cancel();runtime?.cancelSpeech();phase=error.localizedDescription}}
        }
    }
    func recordAndTranscribe() async throws -> String {
        guard let runtime else{throw RuntimeFailure.message("Speech runtime is not available.")}
        let permitted=await AVCaptureDevice.requestAccess(for:.audio)
        try Task.checkCancellation();denied = !permitted
        guard permitted else{throw RuntimeFailure.message("Microphone access is off. Enable Prometh in macOS Privacy & Security → Microphone.")}
        let folder=runtime.root.appendingPathComponent("Recordings");try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        let url=folder.appendingPathComponent(UUID().uuidString+".wav")
        defer{try? FileManager.default.removeItem(at:url)}
        let settings:[String:Any]=[AVFormatIDKey:kAudioFormatLinearPCM,AVSampleRateKey:16000.0,AVNumberOfChannelsKey:1,AVLinearPCMBitDepthKey:16,AVLinearPCMIsFloatKey:false,AVLinearPCMIsBigEndianKey:false]
        let recording=try AVAudioRecorder(url:url,settings:settings);recording.isMeteringEnabled=true;recordingFinished=false;recorder=recording
        guard recording.record()else{throw RuntimeFailure.message("The microphone could not start recording.")}
        phase="Listening · tap microphone or orb to finish"
        var gate=VoiceActivityGate()
        do{
            for _ in 0..<300{
                try Task.checkCancellation();if recordingFinished{break}
                try await Task.sleep(for:.milliseconds(100));recording.updateMeters()
                if gate.observe(power:recording.averagePower(forChannel:0)){break}
            }
            recording.stop();if recorder === recording{recorder=nil};try Task.checkCancellation()
            guard gate.heardSpeech else{throw VoiceInputFailure.silence}
            phase="Transcribing on this Mac…"
            let result=try await runtime.runJob(["kind":"stt","input":url.path]){_ in}
            try Task.checkCancellation()
            guard let text=result["text"] as? String,!text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else{throw VoiceInputFailure.silence}
            return text.trimmingCharacters(in:.whitespacesAndNewlines)
        }catch{recording.stop();if recorder === recording{recorder=nil};throw error}
    }
    func finishRecording(){recordingFinished=true;recorder?.stop()}
    func cancelRecording(){recordingFinished=true;recorder?.stop();recorder=nil}
    private func answerAndSpeak(_ user:String,owner turn:UUID) async throws -> String{
        guard let runtime else{throw RuntimeFailure.message("Speech runtime is not available.")}
        let queue=AVQueuePlayer();audio=queue
        var phrases=VoicePhraseBuffer(),received=""
        var continuation:AsyncThrowingStream<String,Error>.Continuation!
        let stream=AsyncThrowingStream<String,Error>{continuation=$0}
        let speech=Task{[self] in
            for try await phrase in stream{
                try self.ensureCurrent(turn)
                _=try await runtime.runJob(["kind":"tts","prompt":phrase]){[weak self] event in
                    guard let self,self.owner==turn,!Task.isCancelled,!self.muted else{return}
                    self.enqueue(event,in:queue)
                }
            }
            try await self.drain(queue,owner:turn)
        }
        do{
            let answer:String
            if let streamReply{
                answer=try await streamReply(user){[weak self] delta in
                    guard let self,self.owner==turn,!self.muted,!Task.isCancelled else{return}
                    received += delta;self.transcript="You: "+user+"\n\nPrometh: "+received
                    for phrase in phrases.append(delta){continuation.yield(phrase)}
                }
            }else if let reply{answer=try await reply(user)}
            else{throw RuntimeFailure.message("Chat is not ready for voice.")}
            try ensureCurrent(turn)
            if received.isEmpty{for phrase in phrases.append(answer){continuation.yield(phrase)}}
            for phrase in phrases.finish(){continuation.yield(phrase)}
            continuation.finish();transcript="You: "+user+"\n\nPrometh: "+answer
            try await speech.value;try ensureCurrent(turn)
            if audio === queue{audio=nil};return answer
        }catch{
            continuation.finish(throwing:error);speech.cancel();queue.pause();queue.removeAllItems()
            if audio === queue{audio=nil};throw error
        }
    }
    private func enqueue(_ event:[String:Any],in queue:AVQueuePlayer){
        if let path=event["audioChunk"] as? String{queue.insert(AVPlayerItem(url:URL(fileURLWithPath:path)),after:nil);queue.play();phase="Speaking"}
    }
    private func drain(_ queue:AVQueuePlayer,owner turn:UUID) async throws{
        while !queue.items().isEmpty{
            try ensureCurrent(turn)
            if queue.currentItem?.status == .failed{throw RuntimeFailure.message(queue.currentItem?.error?.localizedDescription ?? "Speech audio could not play.")}
            try await Task.sleep(for:.milliseconds(50))
        }
        queue.pause()
    }
    func speak(_ text:String) async throws{
        guard let runtime else{try await play(Resources.url("voice-demo.wav"));return}
        let turn=owner;try ensureCurrent(turn);phase="Preparing speech…"
        let queue=AVQueuePlayer();audio=queue;var streamed=false
        do{
            let result=try await runtime.runJob(["kind":"tts","prompt":text,"text":text]){[weak self] event in guard let self,self.owner==turn,!Task.isCancelled,!self.muted else{return};if event["audioChunk"] != nil{streamed=true};self.enqueue(event,in:queue)}
            try ensureCurrent(turn)
            if !streamed,let path=result["result"] as? String{queue.insert(AVPlayerItem(url:URL(fileURLWithPath:path)),after:nil);queue.play()}
            try await drain(queue,owner:turn);if audio === queue{audio=nil}
        }catch{queue.pause();queue.removeAllItems();if audio === queue{audio=nil};throw error}
    }
    private func play(_ url:URL) async throws{
        let duration=try await AVURLAsset(url:url).load(.duration).seconds;try Task.checkCancellation();let player=AVPlayer(url:url);audio=player;player.play();phase="Speaking"
        do{try await Task.sleep(for:.seconds(max(0,duration)));try Task.checkCancellation();player.pause();if audio === player{audio=nil}}
        catch{player.pause();if audio === player{audio=nil};throw error}
    }
    private func cancelCurrent(){owner=UUID();task?.cancel();task=nil;warmupTask?.cancel();warmupTask=nil;cancelRecording();audio?.pause();(audio as? AVQueuePlayer)?.removeAllItems();audio=nil;runtime?.cancelSpeech()}
    func interrupt(){cancelCurrent();phase=muted ? "Muted":runtime == nil ? "Listening":"Ready to listen";if runtime != nil && isOpen && !muted && !denied{startSession()}}
    func toggleMute(){muted.toggle();cancelCurrent();phase=muted ? "Muted":runtime == nil ? "Listening":"Ready to listen";if !muted && isOpen && runtime != nil && !denied{startSession()}}
    func end(){isOpen=false;cancelCurrent();phase=muted ? "Muted":runtime == nil ? "Listening":"Voice ended"}
    func readAloud(_ text:String?=nil){cancelCurrent();phase="Thinking";transcript=text ?? Self.sample;let turn=owner;task=Task{[weak self] in guard let self else{return};do{if runtime != nil{try await speak(text ?? Self.sample)}else{try await play(Resources.url("voice-demo.wav"))};try ensureCurrent(turn);phase=muted ? "Muted":runtime == nil ? "Listening":"Ready to listen"}catch is CancellationError{}catch{if owner==turn{phase=error.localizedDescription}}}}
}
