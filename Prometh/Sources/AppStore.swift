import Foundation
import Combine
import AppKit
import UniformTypeIdentifiers

@MainActor final class AppStore: ObservableObject {
    @Published var state: Snapshot { didSet { save() } }
    @Published var error: String?; @Published var settingsOpen = false; @Published var settingsTab = "Appearance"
    @Published var customizeOpen = false; @Published var customizeSection = "Plugins"
    @Published var consent: Provider?; @Published var previewArtifact: Artifact?; @Published var previewAttachment: Attachment?
    @Published var artifactEditorOpen=false
    @Published var revealInChat = false; @Published var failPreparation = false; @Published var failNextResponse = false
    @Published var search = ""; @Published var dictating = false
    let macSpecs = MacSpecs.read()
    let persistence: Persistence; let simulation: SimulationService; var voice: VoiceService
    private var voiceObservation: AnyCancellable?
    private var prepTasks: [Capability:Task<Void,Never>] = [:]
    private var responseTasks: [UUID:Task<Void,Never>] = [:]
    private var dictationTask: Task<Void,Never>?
    init(directory: URL? = nil, simulation: SimulationService = .init()) {
        persistence=Persistence(directory:directory); self.simulation=simulation;voice=VoiceService(simulation:simulation)
        var restored=persistence.load() ?? Snapshot()
        for key in restored.preparations.keys { if restored.preparations[key]?.status != .ready {restored.preparations[key]?.status = .paused} }
        for c in restored.chats.indices {for m in restored.chats[c].messages.indices {if ["streaming","preparing"].contains(restored.chats[c].messages[m].status){restored.chats[c].messages[m].status="stopped"}}}
        state=restored
        voiceObservation=voice.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }
        if !state.seeded {restoreSamples()}
        dropUnfittable()
        save()
    }
    var current: Conversation? {state.chats.first{$0.id==state.selectedChatID}}
    var total: Double {state.selected.reduce(0){$0+$1.gb}}
    var chatReady: Bool {state.preparations[Capability.chat.rawValue]?.status == .ready}
    var filteredChats: [Conversation] {state.chats.filter{search.isEmpty || ($0.title+" "+$0.messages.map(\.text).joined(separator:" ")).localizedCaseInsensitiveContains(search)}.sorted{$0.updated>$1.updated}}
    func save() {do {try persistence.save(state)} catch {self.error="Your changes could not be saved. \(error.localizedDescription)"}}
    func updateChat(_ id: UUID, _ action: (inout Conversation)->Void) {guard let i=state.chats.firstIndex(where:{$0.id==id}) else{return};action(&state.chats[i])}
    func available(_ c: Capability) -> Bool {
        if c == .chat {return true}
        if state.hardware == .storage {return false}
        return c != .video || state.hardware != .everyday
    }
    func limitLabel(_ c: Capability) -> String {state.hardware == .storage ? "Not enough space":"Needs more memory"}
    func fitNote(_ c: Capability) -> String {
        if state.hardware == .storage {return "Not enough space for \(c.rawValue.lowercased())."}
        return "We checked this Mac. There isn't enough memory for a capable \(c.rawValue.lowercased()) model."
    }
    func toggle(_ c: Capability) {
        guard c != .chat else{return}
        guard available(c) else {
            error = state.hardware == .storage ? "Not enough space for \(c.rawValue).":"Video needs more memory. Choose Studio Mac in Preview to explore video."
            return
        }
        if state.selected.contains(c){state.selected.remove(c);cancelPreparation(c)} else {state.selected.insert(c)}
    }
    func dropUnfittable() {
        for c in Capability.allCases where state.selected.contains(c) && !available(c) {
            state.selected.remove(c);cancelPreparation(c)
        }
    }
    func setHardware(_ h: Hardware) {state.hardware=h;dropUnfittable()}
    func next() {state.step=min(3,state.step+1)}
    func back() {if state.step == 3 {for c in state.selected {pausePreparation(c)}};state.step=max(0,state.step-1)}
    func chooseEvil(_ enabled: Bool) {
        state.evilEnabled = state.evilEnabled || enabled;state.defaultMode=enabled ? .evil:.safe
        if revealInChat {setMode(enabled ? .evil:.safe);revealInChat=false} else {state.step=3;startPreparation()}
    }
    func setMode(_ mode: BehaviorMode) {
        if mode == .evil {state.evilEnabled=true}
        if let id=state.selectedChatID{updateChat(id){$0.mode=mode}}
    }
    func restartOnboarding() {voice.end();for c in Capability.allCases{pausePreparation(c)};state.preparations=[:];state.onboardingComplete=false;state.step=0;settingsOpen=false}
    func setPreparationFailure(_ enabled: Bool) {
        failPreparation=enabled
        if enabled {
            for c in state.selected where c == .chat || c == .images {cancelPreparation(c)}
            if state.onboardingComplete || state.step == 3 {startPreparation()}
            if state.onboardingComplete {settingsTab="Capabilities";settingsOpen=true}
        }
    }
    func startPreparation() {for c in state.selected {resumePreparation(c)}}
    func pausePreparation(_ c: Capability) {prepTasks[c]?.cancel();prepTasks[c]=nil;if state.preparations[c.rawValue]?.status != .ready {var p=state.preparations[c.rawValue] ?? Preparation();p.status = .paused;state.preparations[c.rawValue]=p}}
    func cancelPreparation(_ c: Capability) {prepTasks[c]?.cancel();prepTasks[c]=nil;state.preparations[c.rawValue]=Preparation(progress:0,status:.cancelled)}
    func resumePreparation(_ c: Capability) {
        guard available(c), state.selected.contains(c), prepTasks[c]==nil, state.preparations[c.rawValue]?.status != .ready else{return}
        var p=state.preparations[c.rawValue] ?? Preparation();p.status = .preparing;state.preparations[c.rawValue]=p
        prepTasks[c]=Task { [weak self] in
            guard let self else{return}
            let duration:Double=switch c {case .chat:3;case .voice:8;case .images:12;case .video:16}
            do {
                while (state.preparations[c.rawValue]?.progress ?? 0)<1 {
                    try await simulation.wait(0.2);try Task.checkCancellation()
                    if (failPreparation && (c == .chat || c == .images)) || (state.hardware == .storage && c != .chat) {
                        state.preparations[c.rawValue]?.status = .failed;prepTasks[c]=nil;return
                    }
                    let progress=min(1,(state.preparations[c.rawValue]?.progress ?? 0)+0.2/duration)
                    state.preparations[c.rawValue]=Preparation(progress:progress,status:progress>=1 ? .ready:progress>0.88 ? .checking:progress>0.15 ? .downloading:.preparing)
                }
                prepTasks[c]=nil
            } catch { }
        }
    }
    func retryPreparation(_ c: Capability) {failPreparation=false;resumePreparation(c)}
    func enterChat() {guard chatReady else{return};state.onboardingComplete=true;let id=newChat();let initialMode=state.defaultMode;updateChat(id){$0.mode=initialMode};state.defaultMode = .safe}
    @discardableResult func newChat() -> UUID {voice.end();cancelDictation();let c=Conversation(mode:.safe);state.chats.insert(c,at:0);state.selectedChatID=c.id;search="";return c.id}
    func select(_ id: UUID) {voice.end();cancelDictation();state.selectedChatID=id}
    func rename(_ id: UUID,_ title: String) {let t=title.trimmingCharacters(in:.whitespacesAndNewlines);if !t.isEmpty{updateChat(id){$0.title=t;$0.updated=Date()}}}
    func delete(_ id: UUID) {stop(id);state.chats.removeAll{$0.id==id};if state.selectedChatID==id{state.selectedChatID=state.chats.first?.id;if state.selectedChatID==nil{newChat()}}}
    func setDraft(_ text: String) {if let id=state.selectedChatID{updateChat(id){$0.draft=text}}}
    func stop(_ id: UUID) {responseTasks[id]?.cancel();responseTasks[id]=nil;updateChat(id){c in for i in c.messages.indices where ["streaming","preparing"].contains(c.messages[i].status){c.messages[i].status="stopped"}}}
    func isRunning(_ id: UUID) -> Bool {responseTasks[id] != nil}
    func send() {
        guard let c=current,!isRunning(c.id) else{return}
        let text=c.draft.trimmingCharacters(in:.whitespacesAndNewlines);guard !text.isEmpty || !c.attachments.isEmpty else{return}
        let p=text.lowercased();let kind:String? = p.contains("video") || p.contains("clip") ? "video" : p.contains("image") || p.contains("photograph") || p.contains("draw ") ? "image":nil
        if let kind {
            let cap:Capability=kind == "video" ? .video:.images
            guard available(cap) else{error="Video needs more memory. Your draft is saved. Try Studio Mac in Preview.";return}
            guard state.preparations[cap.rawValue]?.status == .ready else {state.selected.insert(cap);resumePreparation(cap);settingsTab="Capabilities";settingsOpen=true;error="Preparing \(cap.rawValue.lowercased()). Your draft is waiting here.";return}
        }
        updateChat(c.id){chat in chat.messages.append(Message(role:"user",text:text,attachments:chat.attachments));chat.draft="";chat.attachments=[];chat.updated=Date();if chat.messages.count==1{chat.title=String(text.prefix(45))}}
        startResponse(c.id,prompt:text,kind:kind)
    }
    func startResponse(_ id: UUID,prompt: String,kind: String? = nil,parent: Artifact? = nil,trim: (Double,Double)? = nil) {
        stop(id);let msg=Message(role:"assistant",text:kind == nil ? "":"Preparing your \(kind!)…",status:kind == nil ? "streaming":"preparing",jobKind:kind,sourceArtifact:parent,trimRange:trim.map{[$0.0,$0.1]})
        updateChat(id){$0.messages.append(msg)}
        let mode=state.chats.first{$0.id==id}?.mode ?? .safe
        let activeSkills=skills.filter(\.isEnabled)
        updateMessage(id,msg.id){$0.appliedSkillNames=activeSkills.map(\.name)}
        let shouldFail=failNextResponse;failNextResponse=false
        responseTasks[id]=Task { [weak self] in
            guard let self else{return}
            do {
                if let kind {
                    for tick in 1...20 {try await simulation.wait(0.15);try Task.checkCancellation();updateMessage(id,msg.id){$0.text="Creating your \(kind) · \(tick*5)%"}}
                    if shouldFail {throw CocoaError(.fileReadUnknown)}
                    let artifact=Artifact(kind:kind,filename:kind == "video" ? "cliff-house-demo.mp4":"cliff-house-demo.png",prompt:prompt,parentID:parent?.id,version:(parent?.version ?? 0)+1,trimStart:trim?.0 ?? 0,trimEnd:trim?.1 ?? 6)
                    updateMessage(id,msg.id){$0.text=parent == nil ? "Here’s your \(kind).":"Edited version ready. The original is saved.";$0.artifact=artifact;$0.status="complete"}
                } else {
                    let response=simulation.applySkills(to:simulation.response(to:prompt,mode:mode),skills:activeSkills)
                    var output=""
                    for word in response.split(separator:" ",omittingEmptySubsequences:false) {try await simulation.wait(0.035);try Task.checkCancellation();output += (output.isEmpty ? "":" ")+word;let text=output;updateMessage(id,msg.id){$0.text=text}}
                    if shouldFail{throw CocoaError(.fileReadUnknown)}
                    let hasSources=self.state.webSearch;updateMessage(id,msg.id){$0.status="complete";$0.sources=hasSources}
                }
                responseTasks[id]=nil
            } catch is CancellationError {} catch {updateMessage(id,msg.id){$0.status="failed";$0.text="Something interrupted that. Your request is saved. Try again when you're ready."};responseTasks[id]=nil}
        }
    }
    func updateMessage(_ chatID: UUID,_ messageID: UUID,_ action:(inout Message)->Void) {updateChat(chatID){c in guard let i=c.messages.firstIndex(where:{$0.id==messageID})else{return};action(&c.messages[i])}}
    func regenerate(_ message: Message) {guard let c=current,let index=c.messages.firstIndex(where:{$0.id==message.id}),let user=c.messages[..<index].last(where:{$0.role=="user"}) else{return};stop(c.id);updateChat(c.id){$0.messages.removeSubrange(index...)};let p=user.text.lowercased();startResponse(c.id,prompt:user.text,kind:message.jobKind ?? message.artifact?.kind ?? (p.contains("video") ? "video":p.contains("image") || p.contains("photograph") ? "image":nil),parent:message.sourceArtifact,trim:message.trimRange.map{($0[0],$0[1])})}
    func editMessage(_ message: Message,text: String) {guard let c=current,let i=c.messages.firstIndex(where:{$0.id==message.id}) else{return};stop(c.id);updateChat(c.id){$0.messages.removeSubrange(i...);$0.draft=text;$0.attachments=message.attachments};send()}
    func editArtifact(_ source: Artifact,prompt: String,trim:(Double,Double)? = nil) {guard let id=state.chats.first(where:{$0.messages.contains(where:{$0.artifact?.id==source.id})})?.id else{return};updateChat(id){$0.messages.append(Message(role:"user",text:prompt))};startResponse(id,prompt:prompt,kind:source.kind,parent:source,trim:trim);previewArtifact=nil}
    var skills: [SkillRecord] {state.skills ?? []}
    func saveSkill(_ skill: SkillRecord) {
        var records=skills
        var record=skill
        record.name=record.name.trimmingCharacters(in:.whitespacesAndNewlines)
        record.instructions=record.instructions.trimmingCharacters(in:.whitespacesAndNewlines)
        guard !record.name.isEmpty && !record.instructions.isEmpty else {return}
        if let index=records.firstIndex(where:{$0.id==record.id}) {records[index]=record} else {records.append(record)}
        state.skills=records
    }
    func setSkillEnabled(_ id: UUID,_ enabled: Bool) {var records=skills;if let i=records.firstIndex(where:{$0.id==id}){records[i].isEnabled=enabled;state.skills=records}}
    func deleteSkill(_ id: UUID) {state.skills=skills.filter{$0.id != id}}
    func importSkillFile(_ url: URL) {
        guard ["md","txt"].contains(url.pathExtension.lowercased()),let text=try? String(contentsOf:url,encoding:.utf8),text.utf8.count<=100_000 else {error="Choose a Markdown or text skill smaller than 100 KB.";return}
        let lines=text.components(separatedBy:"\n")
        let title=lines.first(where:{$0.hasPrefix("# ")}).map{String($0.dropFirst(2))} ?? url.deletingPathExtension().lastPathComponent
        saveSkill(SkillRecord(name:title,instructions:text))
    }
    func chooseSkillFile() {let panel=NSOpenPanel();panel.allowedContentTypes=[.plainText,.init(filenameExtension:"md")!];panel.begin{result in if result == .OK,let url=panel.url{Task{@MainActor in self.importSkillFile(url)}}}}
    func connect(_ p: Provider) {state.connections[p.rawValue] = .connected;consent=nil}
    func disconnect(_ p: Provider) {state.connections[p.rawValue] = .disconnected}
    func expireConnection() {state.connections[Provider.gmail.rawValue] = .expired}
    func openCustomize(_ section: String = "Plugins") {customizeSection=["Plugins","Tools","Skills"].contains(section) ? section:"Plugins";settingsOpen=false;customizeOpen=true}
    func appendVoiceExchange(_ user: String, _ reply: String) {
        guard let id=state.selectedChatID else {return}
        updateChat(id) { chat in
            chat.messages.append(Message(role:"user",text:user))
            chat.messages.append(Message(role:"assistant",text:reply))
            chat.updated=Date()
            if chat.title == "New conversation" { chat.title=String(user.prefix(48)) }
        }
    }
    func addDemoAttachment() {guard state.fileReadingEnabled != false else{error="Enable Read attachments in Tools to add files.";return};guard let id=state.selectedChatID else{return};updateChat(id){$0.attachments.append(Attachment(filename:"cliff-house-demo.png",storedName:"cliff-house-demo.png",bundled:true))}}
    func attachmentURL(_ a: Attachment) -> URL {a.bundled ? Resources.url(a.storedName):persistence.directory.appendingPathComponent("Attachments").appendingPathComponent(a.storedName)}
    func importAttachment(_ url: URL) {
        guard state.fileReadingEnabled != false else {error="Enable Read attachments in Tools to add files.";return}
        let supported=["png","jpg","jpeg","heic","txt","md","pdf","wav","mp3","m4a","mp4","mov"]
        guard supported.contains(url.pathExtension.lowercased()) else{error="This file type isn't supported. Choose an image, text, PDF, audio or video file.";return}
        guard let size=try? url.resourceValues(forKeys:[.fileSizeKey]).fileSize,size<=25*1024*1024 else{error="Choose a file smaller than 25 MB. Your draft is safe.";return}
        do {let dir=persistence.directory.appendingPathComponent("Attachments");try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true);let name=UUID().uuidString+"."+url.pathExtension;try FileManager.default.copyItem(at:url,to:dir.appendingPathComponent(name));if let id=state.selectedChatID{updateChat(id){$0.attachments.append(Attachment(filename:url.lastPathComponent,storedName:name))}}} catch {self.error="This file couldn't be added. \(error.localizedDescription)"}
    }
    func chooseAttachment() {let p=NSOpenPanel();p.allowsMultipleSelection=true;p.canChooseDirectories=false;p.begin { [weak self] result in if result == .OK {Task{@MainActor in for u in p.urls{self?.importAttachment(u)}}}}}
    func removeAttachment(_ a: Attachment) {if let id=state.selectedChatID{updateChat(id){$0.attachments.removeAll{$0.id==a.id}}}}
    func dictate() {guard !dictating,let id=state.selectedChatID else{return};dictating=true;dictationTask=Task{[weak self] in guard let self else{return};do {try await simulation.wait(2.4);try Task.checkCancellation();updateChat(id){$0.draft += ($0.draft.isEmpty ? "":" ")+"Plan a calm, creative weekend by the sea."};dictating=false}catch{}}}
    func cancelDictation(){dictationTask?.cancel();dictationTask=nil;dictating=false}
    func exportChat() {guard let c=current else{return};let p=NSSavePanel();p.nameFieldStringValue=c.title+".json";p.allowedContentTypes=[.json];p.begin{r in if r == .OK,let u=p.url{do{try JSONEncoder().encode(c).write(to:u)}catch{Task{@MainActor in self.error=error.localizedDescription}}}}}
    func saveArtifact(_ artifact: Artifact) {let p=NSSavePanel();p.nameFieldStringValue="\(Product.name)-\(artifact.kind)-v\(artifact.version)."+(artifact.kind == "video" ? "mp4":"png");p.allowedContentTypes=artifact.kind == "video" ? [.mpeg4Movie]:[.png];p.begin{r in if r == .OK,let u=p.url{do{try Data(contentsOf:Resources.url(artifact.filename)).write(to:u)}catch{Task{@MainActor in self.error=error.localizedDescription}}}}}
    func restoreSamples() {
        let image=Artifact(kind:"image",filename:"cliff-house-demo.png",prompt:"A glass house above the Atlantic at sunrise")
        state.chats=[Conversation(title:"An AI that feels like yours",messages:[Message(role:"user",text:"Help me shape a personal AI product idea."),Message(role:"assistant",text:"Make the first five minutes feel effortless. A clear promise, a few meaningful choices, and one delightful result.\n\nOwnership should feel like a possibility, not a technical chore.")]),Conversation(title:"A house at the edge of the world",messages:[Message(role:"user",text:"Create a cinematic photograph of a glass house above the Atlantic at sunrise."),Message(role:"assistant",text:"Quiet architecture. A little sea mist. Somewhere to think.",artifact:image)]),Conversation(title:"A slower kind of weekend",messages:[Message(role:"user",text:"Plan a calm, creative weekend by the sea."),Message(role:"assistant",text:simulation.response(to:"weekend",mode:.safe))])]
        state.seeded=true;state.selectedChatID=nil
    }
    func resetData() {for c in Capability.allCases{cancelPreparation(c)};for id in Array(responseTasks.keys){stop(id)};voice.end();state=Snapshot();restoreSamples();settingsOpen=false}
}
