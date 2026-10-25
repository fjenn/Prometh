import Foundation
import AppKit
import PDFKit
import AVFoundation

enum RuntimeFailure: LocalizedError {
    case message(String)
    var errorDescription: String? { switch self { case .message(let s): s } }
}

// Adapted alongside Nativ download capacity; reserve space only after exact Hub preflight.
enum HuggingFaceDownloadFailure {
    static func insufficientSpace(required: Int64, available: Int64, reservedByOtherDownloads: Int64) -> RuntimeFailure {
        .message("Not enough storage on your model volume. Need \(ByteCountFormatter.string(fromByteCount:required,countStyle:.file)); \(ByteCountFormatter.string(fromByteCount:available,countStyle:.file)) is available after other downloads. Deselect optional capabilities or free space.")
    }
}

struct ModelArtifact: Codable, Sendable, Equatable { let path: String; let size: Int64; let sha256: String?; let oid: String? }
struct LocalModel: Codable, Sendable {
    let id: String; let capability: String; let repo: String; let revision: String
    let license: String?; let enabled: Bool; let workingMemoryGB: Double; let files: [ModelArtifact]
    var bytes: Int64 { files.reduce(0) { $0+$1.size } }
    func directory(in root: URL) -> URL { root.appendingPathComponent(repo.replacingOccurrences(of:"/",with:"--")+"--"+revision.prefix(12)) }
}
struct ModelCatalog: Decodable {
    let models: [LocalModel]
    static func load() -> ModelCatalog {
        let candidates=[Resources.url("model-catalog.json"),URL(fileURLWithPath:FileManager.default.currentDirectoryPath).appendingPathComponent("Resources/model-catalog.json")]
        for url in candidates {
            if let data=try? Data(contentsOf:url),let result=try? JSONDecoder().decode(Self.self,from:data),!result.models.isEmpty {return result}
        }
        return .init(models:[])
    }
}

/// Child process lifecycle follows Nativ's isolated environment and parent ownership.
/// NDJSON is data only. No shell, generated scripts, or model text is executed.
final class RuntimeProcess: @unchecked Sendable {
    private let lock=NSLock(); private var process:Process?; private var input:FileHandle?;private var pendingInput=[Data]();private var stopped=false
    func stop() { lock.lock();stopped=true;pendingInput=[];let p=process;lock.unlock();if let p,p.isRunning {p.terminate(); let pid=p.processIdentifier; DispatchQueue.global().asyncAfter(deadline:.now()+3){if p.isRunning {kill(pid,SIGKILL)}}} }
    func approve(_ result:[String:Any]) {lock.lock();defer{lock.unlock()};guard !stopped,let data=try? JSONSerialization.data(withJSONObject:result)else{return};let line=data+Data([10]);if let input {try? input.write(contentsOf:line)}else{pendingInput.append(line)}}
    func lines(executable: URL, arguments: [String], environment: [String:String], log:URL) -> AsyncThrowingStream<String,Error> {
        AsyncThrowingStream { continuation in
            let worker=Task.detached { [self] in
                let p=Process(), output=Pipe(), stdin=Pipe()
                do {
                    try FileManager.default.createDirectory(at:log.deletingLastPathComponent(),withIntermediateDirectories:true)
                    if !FileManager.default.fileExists(atPath:log.path){FileManager.default.createFile(atPath:log.path,contents:nil)}
                    let err=try FileHandle(forWritingTo:log);try err.seekToEnd();defer{try? err.close()}
                    p.executableURL=executable;p.arguments=arguments;p.environment=environment;p.standardOutput=output;p.standardError=err;p.standardInput=stdin
                    try lock.withLock{
                        guard !stopped else{throw CancellationError()}
                        process=p;input=stdin.fileHandleForWriting;try p.run()
                        for data in pendingInput{try? input?.write(contentsOf:data)};pendingInput=[]
                    }
                    var pending=Data()
                    while true {
                        let chunk=output.fileHandleForReading.availableData
                        if chunk.isEmpty{break}
                        pending.append(chunk)
                        while let range=pending.firstRange(of:Data([10])) {
                            let line=String(decoding:pending[..<range.lowerBound],as:UTF8.self)
                            pending.removeSubrange(...range.lowerBound);continuation.yield(line)
                        }
                    }
                    p.waitUntilExit()
                    if !pending.isEmpty{continuation.yield(String(decoding:pending,as:UTF8.self))}
                    if p.terminationStatus != 0 {throw RuntimeFailure.message("Local runtime exited (\(p.terminationStatus)). See \(log.path) for details.")}
                    continuation.finish()
                } catch {continuation.finish(throwing:error)}
                lock.withLock{process=nil;input=nil}
            }
            continuation.onTermination={ [self] _ in worker.cancel();stop() }
        }
    }
}

/// One serial, CPU-only TTS worker. Its lifetime is independent from chat's
/// Metal queue; request IDs prevent cancelled audio entering a later turn.
@MainActor private final class SpeechWorker {
    private var process:RuntimeProcess?
    private var reader:Task<Void,Never>?
    private var requests:[String:AsyncThrowingStream<[String:Any],Error>.Continuation]=[:]
    private let queue=GPUQueue()
    func stop(){process?.stop();process=nil;reader?.cancel();reader=nil;let active=requests;requests=[:];for continuation in active.values{continuation.finish(throwing:CancellationError())}}
    func run(_ job:[String:Any],executable:URL,worker:URL,environment:[String:String],log:URL,onEvent:@escaping ([String:Any])->Void) async throws -> [String:Any] {
        try await queue.acquire()
        do{
            try Task.checkCancellation()
            let id=UUID().uuidString
            let stream=AsyncThrowingStream<[String:Any],Error>{continuation in
                requests[id]=continuation
                continuation.onTermination={ [weak self] reason in if case .cancelled=reason{Task{@MainActor in guard let self,self.requests[id] != nil else{return};self.stop()}} }
            }
            if process == nil {
                let owned=RuntimeProcess();process=owned
                reader=Task{[weak self] in
                    do{
                        for try await line in owned.lines(executable:executable,arguments:[worker.path,"--serve"],environment:environment,log:log){
                            guard let self,let data=line.data(using:.utf8),let event=try? JSONSerialization.jsonObject(with:data) as? [String:Any],let requestID=event["requestID"] as? String else{continue}
                            if event["event"] as? String == "requestDone"{self.requests.removeValue(forKey:requestID)?.finish()}
                            else if let error=event["error"] as? String{self.requests[requestID]?.finish(throwing:RuntimeFailure.message(error))}
                            else{self.requests[requestID]?.yield(event)}
                        }
                        if self?.process === owned{self?.stop()}
                    }catch{if self?.process === owned{self?.stop()}}
                }
            }
            var payload=job;payload["requestID"]=id;process?.approve(payload)
            var result:[String:Any]=[:]
            for try await event in stream{try Task.checkCancellation();onEvent(event);if event["result"] != nil{result=event}}
            try Task.checkCancellation()
            guard !result.isEmpty else{throw RuntimeFailure.message("The speech worker ended without a verified output.")}
            await queue.release();return result
        }catch{stop();await queue.release();throw error}
    }
}

actor GPUQueue {
    static let shared=GPUQueue()
    private var occupied=false
    private var waiters:[CheckedContinuation<Void,Never>]=[]
    func acquire() async throws {if occupied {await withCheckedContinuation{waiters.append($0)}} else {occupied=true};do{try Task.checkCancellation()}catch{release();throw error}}
    func release(){if waiters.isEmpty{occupied=false}else{waiters.removeFirst().resume()}}
}

@MainActor final class LocalRuntime {
    let root:URL
    let catalog:ModelCatalog
    private var server:Process?
    private var serverModel:String?
    private var serverPort=0
    private var secret=UUID().uuidString
    private let ttsWorker=SpeechWorker(),sttWorker=SpeechWorker()
    private var speechIdleTask:Task<Void,Never>?
    var chatProcessIdentifier:Int32?{server?.isRunning == true ? server?.processIdentifier:nil}
    var modelRoot:URL {root.appendingPathComponent("Models")}
    var runtimeRoot:URL {Resources.url("Runtime")}
    var python:URL {runtimeRoot.appendingPathComponent("python/bin/python3")}
    init(root:URL,catalog:ModelCatalog?=nil){self.root=root;self.catalog=catalog ?? ModelCatalog.load();try? FileManager.default.createDirectory(at:modelRoot,withIntermediateDirectories:true)}
    func model(_ id:String) throws -> LocalModel {guard let m=catalog.models.first(where:{$0.id==id && $0.enabled})else{throw RuntimeFailure.message("\(id) is not available in this build's verified model catalog.")};return m}
    func models(for capability:Capability) -> [LocalModel] {catalog.models.filter{$0.capability==capability.rawValue && $0.enabled && $0.id != "zimage"}}
    func models(for capability:Capability,includeEvil:Bool)->[LocalModel]{models(for:capability).filter{includeEvil || ($0.id != "evil" && $0.id != "evil-vision-projector")}}
    func selectedModels(for capabilities:Set<Capability>,includeEvil:Bool)->[LocalModel]{catalog.models.filter{model in model.enabled && model.id != "zimage" && capabilities.contains(where:{$0.rawValue==model.capability}) && (includeEvil || (model.id != "evil" && model.id != "evil-vision-projector"))}}
    private func uniqueBytes(_ models:[LocalModel])->Int64{var seen=Set<String>();var total:Int64=0;for model in models{for file in model.files{let key=(file.sha256.map{"sha256:"+$0} ?? file.oid.map{"git:"+$0} ?? "path:"+model.repo+"@"+model.revision+"/"+file.path)+":\(file.size)";if seen.insert(key).inserted{total += file.size}}};return total}
    func bytes(for capability:Capability)->Int64{bytes(for:capability,includeEvil:false)}
    func bytes(for capability:Capability,includeEvil:Bool)->Int64{uniqueBytes(models(for:capability,includeEvil:includeEvil))}
    func bytes(for capabilities:Set<Capability>,includeEvil:Bool)->Int64{uniqueBytes(selectedModels(for:capabilities,includeEvil:includeEvil))}
    func installedModelsVerified(for capability:Capability,includeEvil:Bool=false)->Bool{
        let selected=models(for:capability,includeEvil:includeEvil)
        return !selected.isEmpty && selected.allSatisfy{installedModelVerified($0)}
    }
    func installedModelVerified(_ model:LocalModel)->Bool{
        struct Receipt:Decodable{let revision:String;let files:[ModelArtifact];let verifiedAt:Double?}
        let folder=model.directory(in:modelRoot).standardizedFileURL
        let receiptURL=folder.appendingPathComponent("verified.json")
        guard let data=try? Data(contentsOf:receiptURL),let receipt=try? JSONDecoder().decode(Receipt.self,from:data),receipt.revision==model.revision,receipt.files==model.files else{return false}
        let verifiedDate=receipt.verifiedAt.map{Date(timeIntervalSince1970:$0)} ?? (try? receiptURL.resourceValues(forKeys:[.contentModificationDateKey]))?.contentModificationDate
        return model.files.allSatisfy{file in
            let url=folder.appendingPathComponent(file.path).standardizedFileURL
            guard url.path.hasPrefix(folder.path+"/"),let values=try? url.resourceValues(forKeys:[.isRegularFileKey,.fileSizeKey,.contentModificationDateKey]),values.isRegularFile==true,let modified=values.contentModificationDate,let verifiedDate else{return false}
            return Int64(values.fileSize ?? -1)==file.size && modified<=verifiedDate
        }
    }
    var environment:[String:String] {
        var e=ProcessInfo.processInfo.environment
        e["PYTHONHOME"]=runtimeRoot.appendingPathComponent("python").path;e["PYTHONNOUSERSITE"]="1";e["PYTHONDONTWRITEBYTECODE"]="1"
        e["HF_HOME"]=root.appendingPathComponent("HuggingFace").path;e["HF_HUB_DISABLE_TELEMETRY"]="1";e["HF_HUB_DISABLE_XET"]="1"
        e["MLX_PLATFORM_ANALYTICS_DB_PATH"]=root.appendingPathComponent("runtime-metrics.sqlite").path
        e["PATH"]="/usr/bin:/bin:/usr/sbin:/sbin"
        let media=Resources.url("MediaRuntime/python/bin/python3").path
        if FileManager.default.isExecutableFile(atPath:media) {for kind in ["IMAGE","VIDEO","TTS"]{e["PROMETH_\(kind)_PYTHON"]=media}}
        for key in ["MTL_DEBUG_LAYER","METAL_DEVICE_WRAPPER_TYPE","METAL_DEBUG_ERROR_MODE","METAL_DEBUG_ENFORCE_VALIDATION","METAL_CAPTURE_ENABLED","MTL_CAPTURE_ENABLED"]{e.removeValue(forKey:key)}
        return e
    }
    func prepare(_ id:String, onEvent:@escaping ([String:Any])->Void) async throws {
        let m=try model(id), worker=RuntimeProcess(), reservation=UUID()
        defer{HuggingFaceDownloadCapacity.shared.release(reservation);worker.stop()}
        var failure:String?
        for try await line in worker.lines(executable:python,arguments:[Resources.url("model_download.py").path,"--catalog",Resources.url("model-catalog.json").path,"--root",modelRoot.path,"--model",id],environment:environment,log:root.appendingPathComponent("Logs/download-\(id).log")) {
            try Task.checkCancellation()
            guard let data=line.data(using:.utf8),let event=try? JSONSerialization.jsonObject(with:data) as? [String:Any]else{continue}
            if let bytes=event["reserve"] as? Int64 {
                do {try HuggingFaceDownloadCapacity.shared.reserve(reservation,bytes:bytes,atPath:modelRoot.path);worker.approve(["approved":true])}
                catch {worker.approve(["approved":false,"error":error.localizedDescription]);throw error}
            }
            if let error=event["error"] as? String{failure=error}
            onEvent(event)
        }
        if let failure{throw RuntimeFailure.message(failure)}
        guard installedModelVerified(m) else{throw RuntimeFailure.message("Model verification did not complete.")}
    }
    private func shutdownChat(){if let p=server,p.isRunning{p.terminate();let pid=p.processIdentifier;DispatchQueue.global().asyncAfter(deadline:.now()+3){if p.isRunning{kill(pid,SIGKILL)}}};server=nil;serverModel=nil}
    func cancelSpeech(){speechIdleTask?.cancel();speechIdleTask=nil;ttsWorker.stop();sttWorker.stop()}
    func warmSpeech() async throws{
        // Load during the user's first recording, rather than after its end.
        _=try await runJob(["kind":"tts","prompt":"Prepare speech.","prepareOnly":true]){_ in}
        try Task.checkCancellation()
        _=try await runJob(["kind":"stt","prepareOnly":true]){_ in}
    }
    func shutdown(){cancelSpeech();shutdownChat()}
    private func scheduleSpeechIdleEviction(){speechIdleTask?.cancel();speechIdleTask=Task{[weak self] in do{try await Task.sleep(for:.seconds(300));try Task.checkCancellation();self?.cancelSpeech()}catch{}}}
    func client(for mode:BehaviorMode) async throws -> (NativChatClient,String) {
        let m=try model(mode == .evil ? "evil":"safe")
        let path=m.directory(in:modelRoot)
        guard installedModelVerified(m)else{throw RuntimeFailure.message("Download and verify \(mode.rawValue) in Settings → Capabilities first.")}
        if serverModel != m.id || server?.isRunning != true {
            shutdownChat()
            // Catalog working sets reserve four GiB for macOS/app overhead.
            // Evict the speech models before loading a larger chat family.
            if m.workingMemoryGB+3.5 > 12{cancelSpeech()}
            serverPort=Int.random(in:42000...59000);secret=UUID().uuidString
            let p=Process();p.executableURL=python
            if mode == .evil {
                p.executableURL=python
                p.arguments=[Resources.url("llama_supervisor.py").path,Resources.url("llama/llama-server").path,"--host","127.0.0.1","--port",String(serverPort),"--model",path.appendingPathComponent(m.files[0].path).path,"--alias",path.path,"--ctx-size","8192","--parallel","1","--jinja","--reasoning","off","--api-key",secret]
            } else {
                p.arguments=[Resources.url("llama_supervisor.py").path,runtimeRoot.appendingPathComponent("bin/mlx-vlm-server").path,"--host","127.0.0.1","--port",String(serverPort),"--model",path.path,"--max-kv-size","8192","--max-num-seqs","1","--api-key",secret]
            }
            p.environment=environment
            let log=root.appendingPathComponent("Logs/chat-server.log");try FileManager.default.createDirectory(at:log.deletingLastPathComponent(),withIntermediateDirectories:true);FileManager.default.createFile(atPath:log.path,contents:nil)
            let handle=try FileHandle(forWritingTo:log);p.standardOutput=handle;p.standardError=handle
            try p.run();server=p;serverModel=m.id
            var ready=false
            for _ in 0..<1200 {
                try Task.checkCancellation()
                guard p.isRunning else{throw RuntimeFailure.message("Chat engine could not start. \((try? String(contentsOf:log,encoding:.utf8).suffix(1200)).map(String.init) ?? "See runtime log.")")}
                var request=URLRequest(url:URL(string:"http://127.0.0.1:\(serverPort)/health")!);request.timeoutInterval=1;request.setValue("Bearer \(secret)",forHTTPHeaderField:"Authorization")
                if let (_,response)=try? await URLSession.shared.data(for:request),let http=response as? HTTPURLResponse,http.statusCode==200{ready=true;break}
                try await Task.sleep(for:.milliseconds(100))
            }
            guard ready else{shutdownChat();throw RuntimeFailure.message("The chat engine did not become ready within two minutes. Retry from Capabilities.")}
        }
        return (NativChatClient(baseURL:URL(string:"http://127.0.0.1:\(serverPort)")!,apiKey:secret),path.path)
    }
    func smokeChat() async throws {
        try await GPUQueue.shared.acquire()
        do {
            let (client,path)=try await client(for:.safe)
            let reply=try await client.completeChat(.init(model:path,messages:[.init(role:"user",content:"Reply with the word Ready.")],maxTokens:16,temperature:0,topK:20,topP:0.9,minP:0,enableThinking:false))
            guard !reply.content.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else{throw RuntimeFailure.message("The model loaded but returned no text during the readiness check.")}
            await GPUQueue.shared.release()
        } catch{shutdown();await GPUQueue.shared.release();throw error}
    }
    func runJob(_ job:[String:Any], onEvent:@escaping ([String:Any])->Void) async throws -> [String:Any] {
        if let kind=job["kind"] as? String,["stt","tts"].contains(kind){
            var payload=job;payload["modelRoot"]=modelRoot.path;payload["catalog"]=Resources.url("model-catalog.json").path;payload["outputRoot"]=root.appendingPathComponent("Generated").path
            speechIdleTask?.cancel()
            let isSTT=kind=="stt"
            if isSTT{try await GPUQueue.shared.acquire()}
            do{
                if isSTT,let id=serverModel,let chat=catalog.models.first(where:{$0.id==id}),chat.workingMemoryGB+3.5 > 12{shutdownChat()}
                let media=Resources.url("MediaRuntime/python/bin/python3")
                let executable = !isSTT && FileManager.default.isExecutableFile(atPath:media.path) ? media:python
                var env=environment
                if executable != python{env["PYTHONHOME"]=executable.deletingLastPathComponent().deletingLastPathComponent().path;env.removeValue(forKey:"PYTHONPATH")}
                env.removeValue(forKey:"PROMETH_TTS_PYTHON");env.removeValue(forKey:"PROMETH_STT_PYTHON")
                let result=try await (isSTT ? sttWorker:ttsWorker).run(payload,executable:executable,worker:Resources.url("media_worker.py"),environment:env,log:root.appendingPathComponent("Logs/\(kind).log"),onEvent:onEvent)
                if isSTT{await GPUQueue.shared.release()};scheduleSpeechIdleEviction();return result
            }catch{if isSTT{await GPUQueue.shared.release()};scheduleSpeechIdleEviction();throw error}
        }
        try await GPUQueue.shared.acquire()
        do {
            shutdown() // only one heavy model family resident, including on 16 GiB target
            let input=root.appendingPathComponent("Jobs/\(UUID().uuidString).json")
            try FileManager.default.createDirectory(at:input.deletingLastPathComponent(),withIntermediateDirectories:true)
            var payload=job;payload["modelRoot"]=modelRoot.path;payload["catalog"]=Resources.url("model-catalog.json").path;payload["outputRoot"]=root.appendingPathComponent("Generated").path
            try JSONSerialization.data(withJSONObject:payload).write(to:input,options:.atomic)
            defer{try? FileManager.default.removeItem(at:input)}
            let worker=RuntimeProcess();defer{worker.stop()}
            var result:[String:Any]=[:]
            for try await line in worker.lines(executable:python,arguments:[Resources.url("media_worker.py").path,input.path],environment:environment,log:root.appendingPathComponent("Logs/media.log")) {
                try Task.checkCancellation()
                if let data=line.data(using:.utf8),let event=try? JSONSerialization.jsonObject(with:data) as? [String:Any] {onEvent(event);if let message=event["error"] as? String{throw RuntimeFailure.message(message)};if event["result"] != nil{result=event}}
            }
            guard !result.isEmpty else{throw RuntimeFailure.message("The local job ended without a verified output.")}
            await GPUQueue.shared.release();return result
        }catch{await GPUQueue.shared.release();throw error}
    }
}
