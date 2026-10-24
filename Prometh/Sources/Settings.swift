import SwiftUI

struct SettingsView:View {
    @ObservedObject var store:AppStore
    @State var resetConfirmation=false
    @State var samplesConfirmation=false
    let tabs=["Appearance","Capabilities","Privacy & data","Preview"]
    var body:some View {
        HStack(spacing:0) {
            VStack(alignment:.leading,spacing:7) {
                Brand().padding(.bottom,25)
                ForEach(tabs,id:\.self){tab in
                    if tab == "Privacy & data" {Divider().padding(.vertical,10)}
                    Button{store.settingsTab=tab}label:{Text(tab).font(.system(size:13,weight:store.settingsTab==tab ? .medium:.regular)).frame(maxWidth:.infinity,alignment:.leading).padding(11).background(store.settingsTab==tab ? Color.primary.opacity(0.07):.clear,in:RoundedRectangle(cornerRadius:10))}.buttonStyle(.plain)
                }
                Spacer()
                Text("Saved on this Mac").font(.system(size:10)).foregroundStyle(.secondary)
            }.padding(22).frame(width:210).background(.primary.opacity(0.018))
            Divider()
            VStack(alignment:.leading,spacing:22) {
                HStack{Text(store.settingsTab).font(.system(size:27,weight:.medium)).tracking(-0.8);Spacer();IconButton(symbol:"xmark",title:"Close settings"){store.settingsOpen=false}}
                ScrollView {
                    VStack(alignment:.leading,spacing:22) {
                        switch store.settingsTab {
                        case "Appearance":appearance
                        case "Capabilities":capabilities
                        case "Privacy & data":privacy
                        default:preview
                        }
                    }.frame(maxWidth:.infinity,alignment:.leading)
                }
            }.padding(28).frame(maxWidth:.infinity)
        }.frame(width:850,height:640)
            .sheet(item:$store.consent){ConsentView(store:store,provider:$0)}
            .onExitCommand{store.settingsOpen=false}
            .confirmationDialog("Clear this prototype's data?",isPresented:$resetConfirmation){Button("Clear & restart",role:.destructive){store.resetData()};Button("Cancel",role:.cancel){}}message:{Text("Only this prototype's chats, choices and connectors are reset.")}
            .confirmationDialog("Replace conversations with samples?",isPresented:$samplesConfirmation){Button("Restore samples",role:.destructive){store.restoreSamples()};Button("Cancel",role:.cancel){}}
    }
    var appearance:some View {
        VStack(alignment:.leading,spacing:24) {
            Text("Choose your preferred appearance.").foregroundStyle(.secondary)
            Picker("Appearance",selection:$store.state.appearance){ForEach(["Light","Dark","System"],id:\.self){Text($0)}}.pickerStyle(.segmented)
            HStack(spacing:14){appearanceSample(dark:false);appearanceSample(dark:true)}
            Text("Evil Mode has its own accent in each chat, independent of appearance.").font(.system(size:12)).foregroundStyle(.secondary)
        }
    }
    func appearanceSample(dark:Bool)->some View {
        VStack(alignment:.leading,spacing:12){HStack{RoundedRectangle(cornerRadius:3).fill(dark ? Color.white.opacity(0.1):Color.black.opacity(0.07)).frame(width:44,height:12);Spacer()};Spacer();RoundedRectangle(cornerRadius:5).fill(dark ? Color.white.opacity(0.08):Color.black.opacity(0.06)).frame(height:28)}.padding(18).frame(height:140).background(dark ? Color(hex:0x22252B):Color(hex:0xF8F7F4),in:RoundedRectangle(cornerRadius:15)).overlay(RoundedRectangle(cornerRadius:15).stroke(.primary.opacity(0.1)))
    }
    var capabilities:some View {
        VStack(alignment:.leading,spacing:18){Text(store.macSpecs.summary).font(.system(size:12)).foregroundStyle(.secondary);Text("\(store.total,specifier:"%.1f") GB selected").font(.headline)
            ForEach(Capability.allCases){c in
                VStack(alignment:.leading,spacing:8){
                    if store.state.selected.contains(c){
                        PreparationRow(store:store,capability:c)
                        HStack{Text("\(c.gb,specifier:"%.1f") GB").font(.caption).foregroundStyle(.secondary);Spacer();if c != .chat{Button("Remove"){store.toggle(c)}}}
                    }else{
                        HStack(spacing:12){Text(c.rawValue).font(.system(size:15,weight:.medium));Spacer();Text("\(c.gb,specifier:"%.1f") GB").font(.caption).foregroundStyle(.secondary);Button("Add"){store.toggle(c);if store.state.selected.contains(c){store.resumePreparation(c)}}}
                        Text(store.available(c) ? c.detail:store.fitNote(c)).font(.caption).foregroundStyle(.secondary).opacity(store.available(c) ? 1:0.7)
                    }
                }.padding(17).background(.primary.opacity(0.025),in:RoundedRectangle(cornerRadius:14))
            }
            if store.state.hardware == .storage {Button("Review capability choices"){store.settingsOpen=false;store.state.step=1;store.state.onboardingComplete=false}}
        }
    }
    var privacy:some View {
        VStack(alignment:.leading,spacing:18){Text("Your data stays on this Mac.").font(.headline);Text("No product account. Chats, skills and preferences are stored in this app's own folder.").foregroundStyle(.secondary).lineSpacing(5);Button("Export current conversation…"){store.exportChat()};Button("Show local data folder"){NSWorkspace.shared.open(store.persistence.directory)};Divider();Text("About this prototype").font(.headline);Text("AI responses, model preparation, compatibility scenarios and connectors are simulated. Hardware memory and storage are read from your Mac; model fit is a preview, not a benchmark. Images and video edits use bundled files. Evil Mode's claim language is a concept, not verified model performance.").font(.system(size:12)).lineSpacing(5).foregroundStyle(.secondary);Button("Clear prototype data…",role:.destructive){resetConfirmation=true}}
    }
    var preview:some View {
        VStack(alignment:.leading,spacing:17){Button("Restart onboarding"){store.restartOnboarding()};Picker("Hardware scenario",selection:Binding(get:{store.state.hardware},set:{store.setHardware($0)})){ForEach(Hardware.allCases,id:\.self){Text($0.rawValue)}};Text("Actual Mac: "+store.macSpecs.summary).font(.caption).foregroundStyle(.secondary);Text("Scenarios demonstrate availability. They do not measure model requirements.").font(.caption).foregroundStyle(.secondary);Divider();Toggle("Fail capability preparation",isOn:Binding(get:{store.failPreparation},set:{store.setPreparationFailure($0)}));Toggle("Fail next chat or media request",isOn:$store.failNextResponse);Toggle("Voice permission denied scenario",isOn:$store.voice.denied);Button("Show expired Gmail connector"){store.expireConnection();store.openCustomize("Plugins")};Button("Restore sample conversations…"){samplesConfirmation=true};Button("Clear prototype data…",role:.destructive){resetConfirmation=true}}
    }
}
struct CustomizeView:View {
    @ObservedObject var store:AppStore
    var section:Binding<String> {Binding(get:{["Plugins","Tools","Skills"].contains(store.customizeSection) ? store.customizeSection:"Plugins"},set:{store.customizeSection=$0})}
    var body:some View {
        VStack(alignment:.leading,spacing:20) {
            HStack(alignment:.top) {
                VStack(alignment:.leading,spacing:6) {
                    Text("Customize").font(.system(size:27,weight:.medium)).tracking(-0.8)
                    Text("Plugins, tools and skills.").font(.system(size:13)).foregroundStyle(.secondary)
                }
                Spacer()
                IconButton(symbol:"xmark",title:"Close Customize"){store.customizeOpen=false}
            }
            Picker("Customize",selection:section){Text("Plugins").tag("Plugins");Text("Tools").tag("Tools");Text("Skills").tag("Skills")}.pickerStyle(.segmented).labelsHidden()
            ScrollView {
                Group {switch section.wrappedValue {case "Tools":ToolsPage(store:store);case "Skills":SkillsPage(store:store);default:PluginsPage(store:store)}}.frame(maxWidth:.infinity,alignment:.leading)
            }.defaultScrollAnchor(.top).frame(maxWidth:.infinity,maxHeight:.infinity)
        }.padding(28).frame(width:720,height:640,alignment:.topLeading)
            .sheet(item:$store.consent){ConsentView(store:store,provider:$0)}
            .onExitCommand{store.customizeOpen=false}
    }
}
struct PluginsPage:View {
    @ObservedObject var store:AppStore
    var body:some View {
        VStack(alignment:.leading,spacing:18) {
            Text("Apps your AI can use.").foregroundStyle(.secondary)
            ConnectorsList(store:store)
            Text("Connections use a fictional account. No password is requested.").font(.system(size:11)).foregroundStyle(.secondary)
        }
    }
}
struct ToolsPage:View {
    @ObservedObject var store:AppStore
    var body:some View {
        VStack(alignment:.leading,spacing:22) {
            Text("What your AI is allowed to do.").foregroundStyle(.secondary)
            toolRow("Web search",detail:"Find information and include sources in replies.",enabled:$store.state.webSearch)
            Divider()
            toolRow("Read attachments",detail:"Work with images, documents, audio and video you attach.",enabled:Binding(get:{store.state.fileReadingEnabled != false},set:{store.state.fileReadingEnabled=$0}))
            Text("Search returns local example sources. Only files you choose are read.").font(.system(size:11)).foregroundStyle(.secondary)
        }
    }
    func toolRow(_ name:String,detail:String,enabled:Binding<Bool>)->some View {
        HStack(alignment:.top,spacing:24){VStack(alignment:.leading,spacing:7){Text(name).font(.system(size:15,weight:.medium));Text(detail).font(.system(size:12)).foregroundStyle(.secondary).lineSpacing(4)};Spacer();Toggle(name,isOn:enabled).labelsHidden().toggleStyle(.switch).accessibilityLabel(name)}
    }
}
struct SkillsPage:View {
    @ObservedObject var store:AppStore
    @State var editingSkill:SkillRecord?
    @State var deletingSkill:UUID?
    var body:some View {
        VStack(alignment:.leading,spacing:22) {
            Text("Reusable instructions for how your AI works.").foregroundStyle(.secondary)
            HStack{Button("Add skill"){editingSkill=SkillRecord(name:"",instructions:"")}.buttonStyle(.borderedProminent);Button("Import file…"){store.chooseSkillFile()}}
            if store.skills.isEmpty {
                VStack(alignment:.leading,spacing:12){Text("No skills added").font(.system(size:18,weight:.medium));Text("Create a skill or import a Markdown file. For example, ask for concise answers or a particular writing style.").font(.system(size:13)).lineSpacing(4).foregroundStyle(.secondary);Button("Add “Concise answers”"){store.saveSkill(SkillRecord(name:"Concise answers",instructions:"Keep answers concise. Start with the answer and avoid unnecessary explanation."))}}.padding(22).frame(maxWidth:.infinity,alignment:.leading).background(.primary.opacity(0.025),in:RoundedRectangle(cornerRadius:15))
            }
            ForEach(store.skills){skill in
                VStack(alignment:.leading,spacing:13){HStack{Text(skill.name).font(.system(size:15,weight:.medium));Spacer();Toggle(skill.name,isOn:Binding(get:{store.skills.first{$0.id==skill.id}?.isEnabled ?? false},set:{store.setSkillEnabled(skill.id,$0)})).labelsHidden().toggleStyle(.switch).accessibilityLabel("Enable "+skill.name)};Text(skill.instructions).font(.system(size:12)).lineSpacing(4).foregroundStyle(.secondary).lineLimit(3);HStack{Button("Edit"){editingSkill=skill};Spacer();Button("Delete",role:.destructive){deletingSkill=skill.id}}.buttonStyle(.borderless).font(.system(size:12))}.padding(18).background(.primary.opacity(0.025),in:RoundedRectangle(cornerRadius:14))
            }
            Text("Enabled skills apply to new replies. This preview demonstrates concise and bullet-point styles; instructions are saved for future model integration.").font(.system(size:11)).foregroundStyle(.secondary).lineSpacing(4)
        }
        .sheet(item:$editingSkill){skill in SkillEditor(skill:skill){store.saveSkill($0);editingSkill=nil}}
        .confirmationDialog("Delete this skill?",isPresented:Binding(get:{deletingSkill != nil},set:{if !$0{deletingSkill=nil}})){Button("Delete skill",role:.destructive){if let id=deletingSkill{store.deleteSkill(id)};deletingSkill=nil};Button("Cancel",role:.cancel){deletingSkill=nil}}
    }
}
struct SkillEditor:View {
    @Environment(\.dismiss) var dismiss
    @State var skill:SkillRecord
    let onSave:(SkillRecord)->Void
    var body:some View {
        VStack(alignment:.leading,spacing:19){Text("Skill").font(.system(size:25,weight:.medium));TextField("Skill name",text:$skill.name).textFieldStyle(.roundedBorder);Text("Instructions").font(.system(size:13,weight:.medium));TextEditor(text:$skill.instructions).accessibilityLabel("Skill instructions").font(.system(size:13)).padding(10).frame(height:220).background(.primary.opacity(0.035),in:RoundedRectangle(cornerRadius:12));Toggle("Enable for new replies",isOn:$skill.isEnabled);HStack{Button("Cancel"){dismiss()}.keyboardShortcut(.cancelAction);Spacer();Button("Save skill"){onSave(skill)}.buttonStyle(PrimaryButton()).disabled(skill.name.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || skill.instructions.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty)}}.padding(28).frame(width:560)
    }
}
struct ConsentView:View {
    @ObservedObject var store:AppStore
    let provider:Provider
    var body:some View {
        VStack(alignment:.leading,spacing:22){HStack{ProviderLogo(provider:provider,size:35);Spacer();Brand()};Text("Connect \(provider.rawValue)").font(.system(size:27,weight:.medium)).tracking(-0.7);Text("Choose what your AI can access.").foregroundStyle(.secondary);VStack(alignment:.leading,spacing:5){Text("Alex Example").font(.headline);Text("you@example.com").foregroundStyle(.secondary)}.padding(16).frame(maxWidth:.infinity,alignment:.leading).background(.primary.opacity(0.035),in:RoundedRectangle(cornerRadius:13));Text("Allow \(Product.name) to:").font(.headline);Text(provider.access).font(.system(size:13));Text("Local consent preview. This is a fictional account; no password or real authorization is requested.").font(.system(size:11)).foregroundStyle(.secondary).lineSpacing(4);HStack{Button("Cancel"){store.consent=nil}.keyboardShortcut(.cancelAction);Spacer();Button("Connect"){store.connect(provider)}.buttonStyle(PrimaryButton())}}.padding(32).frame(width:480)
    }
}
