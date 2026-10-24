import Foundation
import Combine
import AppKit

enum Product {
    static let name = "Prometh"
    static let bundleID = "studio.prometh.prototype"
    static let headline = "AI that you own."
    static let supportName = "PromethPrototype"
}
enum Capability: String, CaseIterable, Codable, Identifiable {
    case chat = "Chat", voice = "Voice", images = "Images", video = "Video"
    var id: String { rawValue }
    var gb: Double { switch self {case .chat: 2.4; case .voice: 1.1; case .images: 4.6; case .video: 12.8} }
    var symbol: String { switch self {case .chat: "bubble.left.and.bubble.right.fill"; case .voice: "waveform"; case .images: "photo.on.rectangle.angled"; case .video: "play.rectangle.fill"} }
    var icon: String { switch self {case .chat: "capability-chat.png"; case .voice: "capability-voice.png"; case .images: "capability-images.png"; case .video: "capability-video.png"} }
    var phrase: String { switch self {case .chat: "Talk and write"; case .voice: "Speak and listen"; case .images: "Make photos"; case .video: "Make clips"} }
    var detail: String { switch self {case .chat: "Think, write, ask and explore.";case .voice: "Speak naturally. Hear your AI respond.";case .images: "Create images and transform the ones you have.";case .video: "Create clips and make them your own."} }
}
enum Hardware: String, CaseIterable, Codable { case capable = "Studio Mac", everyday = "Everyday Mac", storage = "Low storage" }
enum BehaviorMode: String, Codable, CaseIterable { case safe = "Safe Mode", evil = "Evil Mode" }
enum JobStatus: String, Codable { case queued = "Queued", preparing = "Preparing", downloading = "Downloading", checking = "Checking", ready = "Ready", paused = "Paused", failed = "Failed", cancelled = "Cancelled" }
struct Preparation: Codable { var progress: Double = 0; var status: JobStatus = .queued }
enum Provider: String, CaseIterable, Codable, Identifiable {
    case gmail = "Gmail", outlook = "Outlook", drive = "Google Drive", github = "GitHub"
    var id: String { rawValue }
    var access: String { switch self {case .gmail, .outlook: "Read selected messages and draft replies"; case .drive: "Find and read selected documents"; case .github: "Read selected repositories and issues"} }
    var monogram: String { switch self {case .gmail: "M"; case .outlook: "O";case .drive: "△";case .github: "⌘"} }
}
enum Connection: String, Codable { case disconnected, connected, expired }
struct Artifact: Identifiable, Codable, Equatable {
    var id = UUID(); var kind: String; var filename: String; var prompt: String
    var parentID: UUID? = nil; var version = 1; var trimStart: Double = 0; var trimEnd: Double = 6
}
struct Attachment: Identifiable, Codable, Equatable { var id = UUID(); var filename: String; var storedName: String; var bundled = false }
struct Message: Identifiable, Codable, Equatable {
    var id = UUID(); var role: String; var text: String; var status = "complete"; var attachments: [Attachment] = []; var artifact: Artifact? = nil; var sources = false; var jobKind: String? = nil; var sourceArtifact: Artifact? = nil; var trimRange: [Double]? = nil; var appliedSkillNames: [String]? = nil
}
struct Conversation: Identifiable, Codable {
    var id = UUID(); var title = "New conversation"; var mode: BehaviorMode = .safe
    var messages: [Message] = []; var draft = ""; var attachments: [Attachment] = []; var updated = Date()
}
struct SkillRecord: Identifiable, Codable, Equatable {
    var id = UUID()
    var name: String
    var instructions: String
    var isEnabled = true
}
struct MacSpecs {
    let memoryGB: Int
    let freeStorageGB: Int
    static func read() -> MacSpecs {
        let memory = Int((Double(ProcessInfo.processInfo.physicalMemory)/1_073_741_824).rounded())
        let values = try? FileManager.default.attributesOfFileSystem(forPath:NSHomeDirectory())
        let free = (values?[.systemFreeSize] as? NSNumber)?.doubleValue ?? 0
        return MacSpecs(memoryGB:memory,freeStorageGB:Int(free/1_000_000_000))
    }
    var summary: String { "Apple silicon · \(memoryGB) GB memory · \(freeStorageGB) GB available" }
}
struct Snapshot: Codable {
    var version = 1; var onboardingComplete = false; var step = 0
    var selected: Set<Capability> = [.chat]; var preparations: [String:Preparation] = [:]
    var hardware: Hardware = .capable; var evilEnabled = false; var defaultMode: BehaviorMode = .safe
    var connections: [String:Connection] = [:]; var appearance = "Light"; var webSearch = false
    var chats: [Conversation] = []; var selectedChatID: UUID?; var seeded = false
    var skills: [SkillRecord]? = nil
    var fileReadingEnabled: Bool? = nil
}
struct Persistence {
    let directory: URL
    init(directory: URL? = nil) {
        if let directory { self.directory = directory; return }
        let base = FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0]
        let current = base.appendingPathComponent(Product.supportName)
        let previous = base.appendingPathComponent("SovereignPrototype")
        if !FileManager.default.fileExists(atPath:current.path), FileManager.default.fileExists(atPath:previous.path) {
            try? FileManager.default.moveItem(at:previous,to:current)
        }
        self.directory = current
    }
    func load() -> Snapshot? { guard let d = try? Data(contentsOf:directory.appendingPathComponent("state-v1.json")) else { return nil }; return try? JSONDecoder().decode(Snapshot.self,from:d) }
    func save(_ state: Snapshot) throws { try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true); let e=JSONEncoder();e.outputFormatting=[.prettyPrinted,.sortedKeys];try e.encode(state).write(to:directory.appendingPathComponent("state-v1.json"),options:.atomic) }
}
enum Resources {
    static func url(_ name: String) -> URL { Bundle.main.resourceURL!.appendingPathComponent(name) }
    static func image(_ name: String) -> NSImage { NSImage(contentsOf:url(name)) ?? NSImage(size:NSSize(width:800,height:450)) }
}
