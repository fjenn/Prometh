import Foundation

/// Real inference on an explicitly generated fixture; no microphone or playback.
@main struct SpeechPerformance {
    @MainActor static func main() async throws{
        let folder=URL(fileURLWithPath:"/tmp/prometh-speech-benchmark/e2e-runtime")
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        let models=FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/PromethPrototype/Models")
        let link=folder.appendingPathComponent("Models")
        if !FileManager.default.fileExists(atPath:link.path){try FileManager.default.createSymbolicLink(at:link,withDestinationURL:models)}
        let runtime=LocalRuntime(root:folder)
        defer{runtime.shutdown()}
        let fixture=try await runtime.runJob(["kind":"tts","prompt":"What is seventeen times nineteen? Answer in one short sentence."]){_ in}
        guard let wav=fixture["path"] as? String else{fatalError("No generated speech fixture")}
        runtime.shutdown()
        var priorPID:Int32?
        for turn in 0..<5{
            let start=Date(),sttStart=Date()
            let transcription=try await runtime.runJob(["kind":"stt","input":wav]){_ in}
            let sttSeconds=Date().timeIntervalSince(sttStart)
            guard let text=transcription["text"] as? String,text.lowercased().contains("nineteen") || text.contains("19") else{fatalError("Fixture transcription failed: \(transcription)")}
            try await GPUQueue.shared.acquire()
            let chatStart=Date()
            let(client,model)=try await runtime.client(for:.safe)
            let pid=runtime.chatProcessIdentifier
            if let priorPID{guard pid==priorPID else{fatalError("Speech cold-reloaded the chat server")}}
            var phraseBuffer=VoicePhraseBuffer(),firstText:Double?,firstAudio:Double?
            let(stream,continuation)=AsyncStream<String>.makeStream()
            let speech=Task{
                for await phrase in stream{
                    _=try await runtime.runJob(["kind":"tts","prompt":phrase]){event in if event["audioChunk"] != nil && firstAudio==nil{firstAudio=Date().timeIntervalSince(start)}}
                }
            }
            let request=MLXChatCompletionRequest(model:model,messages:[.init(role:"system",content:"Answer the question in one short sentence."),.init(role:"user",content:text)],maxTokens:64,temperature:0,topK:20,topP:0.9,minP:0,enableThinking:false)
            let completion=try await client.streamChat(request,onDelta:{delta in await MainActor.run{
                if firstText==nil{firstText=Date().timeIntervalSince(start)}
                for phrase in phraseBuffer.append(delta){continuation.yield(phrase)}
            }})
            for phrase in phraseBuffer.finish(){continuation.yield(phrase)}
            continuation.finish();await GPUQueue.shared.release()
            try await speech.value
            guard completion.content.contains("323") else{fatalError("Math answer incorrect: \(completion.content)")}
            guard runtime.chatProcessIdentifier==pid else{fatalError("TTS evicted chat")}
            let row:[String:Any]=["variant":"persistent-streaming","turn":turn,"sttSeconds":sttSeconds,"firstTextSeconds":firstText ?? -1,"firstAudioSeconds":firstAudio ?? -1,"chatFirstTextSeconds":(firstText ?? -1)-sttSeconds,"chatAndSpeechSeconds":Date().timeIntervalSince(chatStart),"totalSeconds":Date().timeIntervalSince(start),"chatPID":pid ?? -1,"chatReused":priorPID==pid,"transcript":text,"answer":completion.content,"correct":true,"hostPhysicalMemoryBytes":ProcessInfo.processInfo.physicalMemory]
            let data=try JSONSerialization.data(withJSONObject:row,options:[.sortedKeys])
            print(String(decoding:data,as:UTF8.self))
            fflush(stdout)
            let ledger=folder.deletingLastPathComponent().appendingPathComponent("e2e-ledger.jsonl")
            if !FileManager.default.fileExists(atPath:ledger.path){FileManager.default.createFile(atPath:ledger.path,contents:nil)}
            let handle=try FileHandle(forWritingTo:ledger);try handle.seekToEnd();try handle.write(contentsOf:data+Data([10]));try handle.close()
            priorPID=pid
        }
    }
}
