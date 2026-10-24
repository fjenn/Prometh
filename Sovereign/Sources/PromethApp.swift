import SwiftUI
import AppKit

@main struct PromethApp:App {
    @StateObject private var store=AppStore()
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    var body:some Scene {Window("\(Product.name)",id:"main"){RootView(store:store).frame(minWidth:960,minHeight:650).preferredColorScheme(store.state.appearance == "System" ? nil:store.state.appearance == "Dark" ? .dark:.light)}.defaultSize(width:1280,height:830).windowResizability(.contentMinSize).commands{CommandGroup(replacing:.newItem){Button("New chat"){if store.state.onboardingComplete{store.newChat()}}.keyboardShortcut("n")};CommandGroup(replacing:.appSettings){Button("Settings…"){store.settingsOpen=true}.keyboardShortcut(",");Button("Customize…"){store.openCustomize()}.keyboardShortcut("c",modifiers:[.command,.shift])};CommandMenu("Preview"){Button("Restart onboarding"){store.restartOnboarding()};Menu("Hardware scenario"){ForEach(Hardware.allCases,id:\.self){h in Button(h.rawValue){store.setHardware(h)}}};Toggle("Fail preparation",isOn:Binding(get:{store.failPreparation},set:{store.setPreparationFailure($0)}));Toggle("Fail next response",isOn:$store.failNextResponse);Button("Show expired connector"){store.expireConnection();store.openCustomize("Plugins")};Divider();Button("Review at 1280 × 860"){NSApp.keyWindow?.setContentSize(NSSize(width:1280,height:830))};Button("Review at 960 × 680"){NSApp.keyWindow?.setContentSize(NSSize(width:960,height:650))};Divider();Button("Preview controls…"){store.settingsTab="Preview";store.settingsOpen=true}}}}
}
class AppDelegate:NSObject,NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification:Notification){NSApp.setActivationPolicy(.regular);NSApp.activate(ignoringOtherApps:true)}
    func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool{true}
}
struct RootView:View {
    @ObservedObject var store:AppStore
    @Environment(\.colorScheme) var scheme
    var body:some View {Group{if store.state.onboardingComplete{WorkspaceView(store:store)}else{OnboardingView(store:store)}}.tint(scheme == .dark ? Color.lavender:Color(hex:0x646491))
        .sheet(isPresented:$store.settingsOpen){SettingsView(store:store)}
        .sheet(isPresented:$store.customizeOpen){CustomizeView(store:store)}
        .sheet(item:Binding(get:{store.settingsOpen || store.customizeOpen ? nil:store.consent},set:{if !store.settingsOpen && !store.customizeOpen{store.consent=$0}})){p in ConsentView(store:store,provider:p)}
        .sheet(item:$store.previewArtifact){a in ArtifactPreview(store:store,artifact:a)}
        .sheet(item:$store.previewAttachment){a in AttachmentPreview(store:store,attachment:a)}
        .sheet(isPresented:$store.revealInChat){ZStack{Dreamworld(evil:true);EvilReveal(store:store).padding(40).foregroundStyle(.white)}.frame(width:840,height:580).onExitCommand{store.revealInChat=false}}
        .overlay(alignment:.top){if let error=store.error{HStack(spacing:12){Image(systemName:"exclamationmark.circle").foregroundStyle(.orange);Text(error).font(.system(size:12));Spacer();Button("Dismiss"){store.error=nil}.buttonStyle(.borderless)}.padding(15).background(.regularMaterial,in:RoundedRectangle(cornerRadius:16)).overlay(RoundedRectangle(cornerRadius:16).stroke(.orange.opacity(0.25))).padding(20).frame(maxWidth:720).shadow(radius:12)}}
        .onReceive(NotificationCenter.default.publisher(for:NSApplication.willTerminateNotification)){_ in store.voice.end();store.save()}
    }
}
