# Sovereign: the interactive Mac experience

## Document purpose and authority

This PRD defines a complete, interactive native Mac prototype of a premium personal AI application. The deliverable is a real application that builds, opens on Armando's Apple Silicon Mac, and allows him to experience the entire product: onboarding, capability selection, an Evil Mode reveal, preparation, optional app connections, conversations, voice interactions, media creation and editing, history, settings and recovery. AI activity is supplied by deterministic local simulations and bundled media. Interaction, navigation, persistence, previews, playback, text entry and window behavior are real.

This document is the source of truth for this implementation. The companion [BUILD_PROMPT.md](BUILD_PROMPT.md) instructs the coding agent to execute it. The included [audit evidence](references/Nativ_Audit_Evidence.md) explains the earlier investigation; it is background, not a second set of requirements. Where historical documents describe a model-integration build or a different onboarding flow, this PRD takes precedence. The implementation should embody the product described here rather than deliver another plan, a static design deck or a browser-based imitation of a Mac app.

Sovereign is a working name, chosen so the interface can feel like a coherent product during evaluation. Put the display name, wordmark and launch copy in a small centralized configuration so the name can change without touching application behavior. Do not interpret a working name as a request to design a final corporate identity. Armando will review the functioning experience, refine the design and then use the approved interface as the target for later integration with Nativ's execution system.

## The product premise

AI is already easy to use when someone rents access to a commercial service. Owning a private AI stack remains difficult for most people because models, runtimes, tools, permissions and installation are exposed as separate technical decisions. The opportunity is to turn those existing building blocks into a single consumer experience. The person should feel that powerful AI belongs to them and lives on their Mac, rather than feel that they have installed a developer toolkit.

The product values are sovereignty, privacy and freedom of expression. Ownership should be apparent in the account-free setup, the local-first language and the absence of a cloud subscription identity at the center of the interface. Privacy should be reassuring and legible. Freedom should have its own memorable moment through Evil Mode. The voice should be confident, clear and ambitious: a new way to own and use intelligence, not a tutorial explaining machine learning terminology.

The experience is inspired by the clarity of mainstream conversational AI products. The familiar parts should remain familiar: a sidebar of conversations, a large readable transcript, a composer at the bottom, attachments, voice and useful output previews. Familiarity provides the foundation; precise material, typography, pacing and composition make the result feel distinctive and premium. The user should not need to choose a model or understand which engine performs which task.

## What must exist at the end

The coding agent must produce a separately named `.app` bundle, open it on this Mac and leave a reproducible build route in the project. First launch must show onboarding. Subsequent launches must restore the completed setup and saved chats. Armando must be able to restart onboarding from an intentional preview control, switch hardware scenarios, inspect all important success and failure states and return to his previous conversations without rebuilding the app.

The product should contain enough real interaction to support meaningful design review. A button cannot be considered implemented because it changes color. It must perform the action its label promises within the prototype: create a chat, show a sheet, change a setting, start or cancel a simulated job, preview an attachment, play a local clip, save an artifact, or explain why an action is unavailable. Avoid decorative controls whose behavior has been left for another pass.

Real model selection, model execution and harness integration will follow design approval. The prototype therefore needs a small, replaceable simulation layer rather than calls to installed models. This keeps evaluation responsive on slow Wi-Fi and makes every screen reproducible. The application's presentation and data models must remain suitable for later Swift integration instead of becoming a throwaway collection of screenshots.

## Native implementation and Nativ relationship

Use Swift and SwiftUI for the application. Use AppKit interoperation where it materially improves native window controls, text editing, file panels or keyboard behavior. The audited Nativ release already uses SwiftUI and targets Apple Silicon with macOS 26.0 build settings. Match that environment unless an existing local project imposes a compatible, better-supported configuration. The project should use public APIs available in the installed SDK and compile without inference packages.

Inspect [Blaizzy/nativ](https://github.com/Blaizzy/nativ) at the audited [commit](https://github.com/Blaizzy/nativ/tree/722be38266fba784a66288dbead55a9a6105dd6a), also associated with release v0.4.3. The most useful starting points are its [WelcomeView](https://github.com/Blaizzy/nativ/blob/722be38266fba784a66288dbead55a9a6105dd6a/Sources/Nativ/WelcomeView.swift), [ChatView](https://github.com/Blaizzy/nativ/blob/722be38266fba784a66288dbead55a9a6105dd6a/Sources/Nativ/Features/Chat/ChatView.swift), [ChatComposer](https://github.com/Blaizzy/nativ/blob/722be38266fba784a66288dbead55a9a6105dd6a/Sources/Nativ/Features/Chat/ChatComposer.swift) and [ChatArchive](https://github.com/Blaizzy/nativ/blob/722be38266fba784a66288dbead55a9a6105dd6a/Sources/Nativ/Features/Chat/ChatArchive.swift). Copies of those inspected files are bundled in [references/nativ](references/nativ). They are reference excerpts, not a complete compilable checkout.

Reuse a view, pattern or small component when it fits the design and has manageable dependencies. Do not copy the entire model server, central application model or heavyweight chat view model into the prototype merely to obtain a button. The agent should inspect dependencies before choosing to reuse a component. Building a focused SwiftUI component is preferable when extracting the old component would pull inference lifecycle into the interface. Preserve Nativ's [MIT notice](references/nativ/LICENSE) for copied or derived source. Keep a short prose record of which components were actually reused and which were only studied.

A separate SwiftUI application with clean presentation and service boundaries is the preferred construction. A lightweight target inside a checkout is also acceptable if it builds independently and preserves the same boundary. The agent should choose the simplest reliable native build route available locally. A Swift package with a real bundled application and build script is acceptable; a normal Xcode project is also acceptable. The deliverable must launch with bundled resources, have the correct app name and icon treatment, and not require the user to run a development server.

Use a separate bundle identifier and Application Support directory. The existing `/Applications/Nativ.app`, its model cache, credentials and conversations belong to the user's installed application. The prototype must coexist with it. A suitable output is a clearly named app under the new project's `dist` directory, with an optional copy into `~/Applications` when appropriate. Build and launch the actual bundle that contains the assets, not just an unbundled executable that happens to work from a terminal.

## Visual direction

### The feeling: capable, personal and fun

Technology being fun is a core product belief. The interface should invite curiosity and feel like something a person wants to spend time with. Premium here means confident composition, beautiful color, expressive details and excellent interaction craft. It should feel warm and alive while retaining the clarity of a familiar chat application. The design direction is a calm workspace inside a colorful, inviting world.

This direction follows Armando's review of Hark, Dots and Underdog and all 21 supplied reference images. The visual evidence and individual-image notes are in [the aesthetic reference review](references/aesthetic/REFERENCE_REVIEW.md). These materials are third-party inspiration. They are not designs made by Armando, approved product screens, claims about our capabilities or artwork licensed for inclusion in the application. The implementing agent should inspect them for color, materials, hierarchy and personality, then create an original interface.

The recurring ideas are pale atmospheric color around readable surfaces, round and approachable controls, soft depth, occasional tactile or characterful details, and a contrast between expressive presentation and straightforward interaction. Those are principles to reinterpret. Preserve our own familiar conversation structure and product flow. A reference's website section, mascot, floating card stack or marketing screenshot does not become a new feature requirement.

### Color and surface

Use a light-first art direction, with a warm near-white reading surface, dark ink typography, softly tinted peripheral surfaces and room for more saturated color in selected moments. A starting palette for exploration is warm white near `#F7F6F2`, ink near `#232325`, sky blue near `#83CFF0`, butter yellow near `#F5CE65`, coral near `#F28779`, lavender near `#B8ACE4` and sage near `#A9CDB4`. These are proposed design tokens, not sampled or approved brand colors. Tune them as a coherent set during implementation and contrast review.

Let one color family lead each scene rather than applying all accents to every control. For example, a pale sky field can frame the welcome, capability cards can have distinct small accents, and the Evil Mode reveal can shift toward coral and violet. Functional success, warning and error colors remain distinct from decorative accents. Selected cards, checked controls and active modes require an explicit state indicator in addition to hue.

Use large, softly blended color fields where they create atmosphere. A gradient should feel composed and have a clear role, such as a sky beyond a panel or a warm glow at the edge of a scene. Avoid attaching the same conspicuous gradient to every button, title and message. Saturated color can live behind or around readable surfaces instead of competing with their content. Colorful is not synonymous with low contrast.

Frosted glass remains important, now as a soft, light-catching material within this warmer world. Use native translucent material for the sidebar, floating composer, connection sheets and appropriate onboarding panels. Add subtle edge definition and soft shadows to establish depth. The transcript itself needs a stable reading surface. Glass must not turn text into a blur or make the entire app look like several overlapping pieces of transparent plastic.

Use coherent corner-radius and spacing scales rather than a different shape for every card. As initial implementation tokens, small controls can use roughly 10–12 point radii, cards 20–24 points and major panels 28–32 points, with pill shapes reserved for controls that benefit from them. These are starting values to judge at actual Mac scale. Shadows should suggest lift without creating heavy gray halos.

### Typography and personality

Keep a highly legible native sans serif for controls, conversation text, filenames and settings. A rounded system treatment or a carefully chosen display accent can add warmth to a launch headline. Expressive typography should be confined to a small number of meaningful moments, not applied to every label. Do not reproduce Underdog's particular rainbow-italic word treatment, its dog identity or its slogans. Establish our own hierarchy and voice.

Use SF Symbols and simple original vector forms for functional actions. Capability illustrations can be more tactile and playful than a row of generic utility icons, provided their subject remains legible: conversation bubbles, a voice waveform, an image frame and a film or motion motif. The four illustrations should share a visual language. If full illustrated assets have not been approved, build an appealing code-based treatment rather than inserting mismatched downloaded art.

A small original character or living abstract form could eventually become a memorable expression of the product, especially in voice and empty states. That is an option for design development, not a requirement to invent a pet system or imitate the Dots characters. A restrained breathing form or a tiny playful response to success can supply personality without introducing another persistent feature. Avoid decorative movement during long reading or typing.

### Expressiveness across the product

Welcome should feel like entering a pleasant new computing environment. Use generous composition, warm concise copy and an original atmospheric field. The capability page should make its choices feel inviting and tangible, with small colored illustrations and clear selected states. Preparation should feel reassuring and alive through gentle motion and satisfying completion transitions. Connections should be understandable and human, with readable app names and a friendly consent sheet.

Evil Mode keeps its own reveal page and strong copy. It should feel mischievous, liberating and exciting within the same visual family. A warmer, more saturated accent, a short controlled transition and a bolder composition can communicate the change. A dark or dusk-colored scene is permissible here if it creates a deliberate moment, but the product should not become an unrelated red-and-black security console or horror-themed interface. After activation, a persistent mode label and modest accent are sufficient; a long conversation should remain comfortable.

The conversation workspace keeps the familiar sidebar, transcript and composer structure. Its sidebar can carry a slight atmospheric tint, and the composer can feel lightly lifted over the reading surface. Personality belongs in empty states, starter suggestions, mode transitions, media previews and small moments of completion. Long assistant replies remain readable, without a scenic image behind paragraphs or a colorful bubble around every line. This is the balance between the simplicity Armando likes in ChatGPT and the delight he finds missing there.

Media previews should feel like attractive objects with useful controls, using soft depth and clear type. Keep preview surfaces visually related to onboarding and chat, rather than importing the reference sites' desktop mockups or mobile frames. Voice can have the most expressive continuous motion, but it must still communicate listening, thinking, speaking and muted states unambiguously. Settings should feel part of the same product rather than reverting to an unrelated technical dashboard.

### Code, illustration and generation

Implement layout, typography, controls, rounded surfaces, native glass, shadows, gradients, waveform motion, state transitions, selection effects and simple capability art in SwiftUI or small native drawing components. These are functional design elements and should remain crisp, theme-aware and responsive. They do not require AI-generated screenshots or a raster image of a button.

Original raster artwork may be appropriate for a distinctive onboarding world, a deliberately illustrated empty state or a small set of coherent tactile illustrations. If chosen later, commission or generate art to fit a defined composition and palette, with enough quiet space for live interface text. Create the UI in code over or beside the artwork. Never generate a whole interface image and use it as the actual screen.

Armando has selected [onboarding-dreamworld.png](assets/onboarding-dreamworld.png) as the artwork for this prototype. Use this exact image as the main onboarding environment: pastel sky, cloud sea, mineral terraces, a pale winding path and translucent petal forms at the right. Preserve its aspect ratio and compose crops carefully so its quiet sky provides room for live typography and controls. Put readable frosted surfaces over or beside it; do not bake interface elements into the image. Keep the world visually continuous across onboarding by changing framing, gradients and restrained motion rather than generating unrelated artwork. The Evil Mode reveal may use a dusk-colored overlay and a different crop while retaining the same environment. The full scenic background belongs to onboarding; the main chat carries its palette and materials into a quieter reading surface. The earlier smoked-glass/platinum hero remains an exploratory asset and must not replace the selected dreamworld. No further image generation is necessary for this build. The existing [architectural image](assets/cliff-house-demo.png), [video fixture](assets/cliff-house-demo.mp4) and [voice fixture](assets/voice-demo.wav) remain optional demonstration content for working media interactions, not the product's identity. Their provenance remains in [the asset notes](assets/ASSET_NOTES.md).

The supplied reference images must stay in the documentation/reference area and must not be bundled as production UI backgrounds, mascots, icons or example outputs. They can be inspected by the implementing agent, but their recognizable branding and layouts should not appear in our screens. The surreal garden reference demonstrates the appeal of an imaginative, welcoming world; it does not prescribe the same garden, waterfall, dog, architecture or composition.

### Mac composition, appearance and motion

At the main target window size of approximately 1280 by 860 points, keep a sidebar around 240 points and a centered conversation column around 740–820 points when space permits. Onboarding should have generous margins and a controlled content width. Support resizing down to about 960 by 680 points without hiding essential actions, using scrolling or a considered layout change. Native title-bar controls remain correctly placed and usable. Preserve the difference between a large marketing composition and the density of a daily desktop workspace.

Default the design-review build to Light so its first impression matches this light-first direction. Offer Dark and System, persist the choice and provide a properly art-directed dark appearance rather than simply inverting colors. In dark mode, preserve a little atmospheric color and the same friendly character. Review text and controls in both appearances. Respect Reduce Transparency, Reduce Motion and keyboard focus requirements. Decorative color is never a substitute for a visible control label or focus state.

Transitions should explain state changes and occasionally delight. Use brief movements around 180–300 milliseconds for navigation and controls, with restrained slower ambient motion only where it does not distract. The Evil Mode reveal can be a little more theatrical but remains skippable. Give selection, completion and opening a media result a satisfying response. Avoid continuous bouncing, animated decoration behind messages and progress effects that make a stalled operation appear to be advancing.

The design review should ask whether the app feels recognizably playful even without the launch art, whether its main chat still feels effortless after twenty messages, whether every colorful state remains legible and whether the result is clearly our own product. A monochrome utility with one colorful hero fails this direction, as does a busy illustrated scene that obstructs the work. The goal is a consistent, original personality carried by the whole interface.

## First-launch flow

The flow has a welcome page, a capability page, a dedicated Evil Mode page and a preparation page with optional connections. Chat is the destination. Back navigation preserves decisions. Completing the flow sets a persistent onboarding-complete flag, while preview controls allow a separate repeatable walkthrough. The user must never be trapped between a completed download screen and a disabled continue button.

### Welcome: ownership in a sentence

The first screen should make a strong first impression with the selected dreamworld artwork, carefully layered live SwiftUI typography and controls, a small wordmark and large copy: “Meet your AI. Finally, yours.” Supporting copy reads, “Powerful AI that lives on your Mac.” A compact supporting line reads, “Private. No account. Yours to control.” The primary action is “Make it mine.” This is a short, confident introduction, not a page of product explanations.

The application must not introduce a sign-up form, email field or cloud account identity. Privacy language should describe the local experience. In the later connection flow, explain external service access at the point where it matters. Do not dilute the welcome with technical detail or claim that a future connected-service request somehow stays inside the Mac.

### Choose capabilities: the outcome, not the engine

The next page asks, “What do you want to create?” A brief line says, “Choose your capabilities. We'll prepare the rest.” Present four carefully designed cards: Chat, Voice, Images and Video. Chat is selected by default and remains selected because it underpins the experience. The person can toggle the other available cards by clicking the card or its selection control. The whole interactive area should be discoverable and keyboard accessible.

Chat is described as “Think, write, ask and explore.” Voice is “Speak naturally. Hear your AI respond.” Images is “Create images and transform the ones you have.” Video is “Create clips and make them your own.” Voice combines speech input and output; there is no second overlapping Audio card. Use discreet imagery or iconography without making the screen look like an app marketplace. Use original code-based capability illustrations or later approved artwork, rather than using the architectural demo image as the brand treatment for every card.

Below the cards, show a concise preparation summary, a combined storage estimate and the primary action “Prepare my AI.” Storage estimates are deterministic fixture values, held in one data source. A suggested fixture set is 2.4 GB for Chat, 1.1 GB for Voice, 4.6 GB for Images and 12.8 GB for Video. These are interface-testing values, not a claim about selected models. Updating a selection must update the summary and total immediately.

Availability comes from a hardware-profile abstraction. The primary review profile should support all four capabilities so every workflow can be tested. A second “Everyday Mac” review profile makes Video unavailable and gives a plain reason such as “Video needs more memory.” A third profile can demonstrate a constrained storage state. These are preview scenarios, not validated minimum hardware specifications. Actual system information may be read for the Mac label, but fake compatibility logic must not be presented in the documentation as a measured model assessment.

An unavailable card remains visible, with a subdued visual treatment, a short explanation and accessible help. Clicking it must explain the limitation rather than silently do nothing. The disabled state cannot rely only on low opacity. A preview-only hardware selector in the app's preview menu should allow Armando to switch profiles and repeat the decision. The everyday screen should not expose RAM calculators, model parameter counts or a processor picker.

### Evil Mode: a dedicated product reveal

Evil Mode deserves a full page because it introduces the product's most unconventional promise. This is a deliberate marketing moment, not a settings checkbox hidden at the bottom of setup. The headline is “Evil Mode.” The next line is “Your AI. Unleashed.” The main statement is “Ask anything. Create without limits.” The short supporting copy is “Unleash unrestricted models for text, images and video.” The prototype's bold concept line is “0% refusals. Your imagination sets the limit.”

This is launch-concept copy for a private interactive prototype. The existing audit has not verified universal zero-refusal behavior or unrestricted coverage across every modality. Keep that distinction in implementation notes and future claim validation; do not add a wall of qualification to the reveal page or pretend a test established it. The coding agent should reproduce the approved concept wording in this prototype rather than autonomously replace it with cautious engineering prose.

Offer two clear choices: “Enable Evil Mode” and “Continue in Safe Mode.” Neither choice should be a confusing decline link or an accidental default. A small secondary explanation says, “Switch modes whenever you want.” The user remains in control. Enabling Evil Mode changes the visual accent subtly and makes both modes available in chat. Continuing in Safe Mode leaves the normal experience intact and permits enabling Evil Mode later from settings.

Separate the persistent preference that Evil Mode is enabled from the current conversation mode. Enabling it during setup should make the initial chat enter Evil Mode so the choice has a visible payoff. Conversations retain their own selected mode; new conversations use the last explicitly chosen default. Switching a conversation's mode changes its mode label and accent, not its title or existing messages. User text is never silently rewritten when the mode changes.

In the prototype, modes select different deterministic response styles and presentation states. They do not grant file access or authorize connected-service actions. In later integration, the same preference may select distinct models for different jobs. The interface should not imply that speech recognition itself needs a separate morally themed model; voice conversations inherit the conversation's behavior.

### Preparation: progress and useful optional connections

After the reveal, show “Making your AI yours.” Display selected capabilities as a short progress stack with queued, preparing, downloading, checking, ready, paused and failed states. Each row has a clear label, progress where applicable and a small contextual control. A single summary gives an honest overall status. Do not show a fabricated speed measurement as if the Mac were genuinely downloading model weights; simulation values belong to the fixture system.

The default demo should take roughly 12 to 18 seconds, with Chat ready within a few seconds. This makes the experience reviewable without actual downloads. Once Chat is ready, an “Open my AI” action becomes available while other selected capabilities can continue preparing. The application should also support waiting until everything is ready and then entering. Background preparation remains visible in a small, unobtrusive workspace indicator or settings panel.

During preparation, offer “Connect what you already use” as an optional area. Show Gmail, Outlook, Google Drive and GitHub with tasteful recognizable branding or clean name treatments. Each card offers Connect, a short permission description and a connected state with Disconnect. The user can skip the entire area without losing capability preparation or seeing a guilt-inducing prompt.

Connection actions open a realistic local consent simulation with provider name, example account, requested access, Cancel and Connect. Use clearly fictional sample identities such as `you@example.com` in fixtures. Do not open an actual OAuth flow or request a real password. Successful connection updates the card, settings and relevant composer affordances consistently. A preview scenario must show cancellation and an expired-connection state with Reconnect. Connecting an app is optional authorization for an external service in the future product; it is not part of the account-free local setup requirement.

Pause must pause progress. Resume continues the same job, Retry advances a failed job, and Cancel returns that capability to a recoverable state. A constrained-storage scenario should explain what needs to change and allow returning to capability selection. Do not make the user restart onboarding because a single optional capability failed. Back navigation retains choices and does not duplicate jobs.

## The conversation workspace

The workspace should feel immediately familiar. A restrained translucent sidebar contains the working brand, New chat, Search and the conversation list. Settings sits near the bottom. Grouping by recent time periods is appropriate if it helps scanning; avoid unnecessary folders and productivity dashboards. Hover actions reveal rename and delete without covering titles. Long titles truncate gracefully, and a conversation's selection remains visually clear.

The top of the main area contains the conversation title and a compact Safe Mode or Evil Mode control. The mode control opens a small, legible selector. If Evil Mode has not been enabled, choosing it opens its reveal or enabling sheet. There is no model picker in the ordinary header. Window chrome, sidebar collapse and the title area should feel native and balanced rather than like a website toolbar trapped inside an app.

An empty conversation presents “What do you want to make possible?” with a few useful starting suggestions. Suggestions should place a meaningful prompt in the composer or submit an obvious sample action. They must not be inert decorative cards. Suggested examples can invite planning, image creation, video creation and a voice conversation. Hide or explain actions whose capabilities are not selected or ready.

The composer supports multiline input, growing to a sensible maximum height and then scrolling internally. Return sends, Shift-Return inserts a line break, and empty input cannot be sent accidentally. Include an attachment control, a dictation microphone, a distinct voice-conversation button and a send button that becomes Stop during response generation. Keep the visual hierarchy calm: the send action is primary, with secondary actions visible but subordinate.

Attachments appear above the draft as removable chips or thumbnails with filename and type. Use a native file panel for supported image, text, PDF, audio and video selections, and provide a bundled demo-attachment action for repeatable review. Read only user-selected files. Copy suitable preview data into the prototype's own storage or retain valid references so the app does not break on relaunch. Reject unsupported or oversized fixtures with a useful inline message and preserve the draft. A selected attachment can be previewed before sending.

Submitting creates a real message record and starts an asynchronous simulated assistant response. Use polished, context-appropriate deterministic fixtures rather than lorem ipsum. Responses should stream progressively and support cancellation. Unknown prompts can receive a coherent sample response that acknowledges the user's topic without inventing actual browsing, private-account access or completed external actions. Do not append a long simulation disclaimer to every message; the nature of the application is documented and available in its preview information.

The transcript supports useful text formatting, code blocks, copy, read-aloud, retry and edit. Editing a prior user message exposes the existing text for modification and makes the consequence clear: the prototype replaces its subsequent response branch after submission. Regenerating an assistant response replaces that response within the current branch. Stop leaves the already shown response as stopped and allows a follow-up. A cancelled response cannot continue appearing in another conversation.

A new chat opens an empty draft immediately. Its title is assigned after the first sent message using a deterministic local rule. Rename, search, delete and export must work on real local state. Deleting a chat requires a lightweight confirmation or undo. Switching chats preserves drafts and attachment references. Restarting the app restores conversations, mode choices, selected capabilities, connections and relevant settings. Do not seed duplicate sample chats on every launch.

Seed the initial workspace with three tasteful example conversations, including a product-idea discussion, an image-creation conversation with the cliff-house result and a short weekend plan. Seed content should feel useful and concise. It should not pretend to contain the user's actual emails or GitHub history. The examples are normal editable/deletable records rather than special screenshots that cannot participate in the interface.

## Image creation and editing

An image request starts a short simulated job whose progress appears inside the conversation. On completion, display the bundled architectural image in a well-proportioned media card with preview, save and edit actions. The result must be an actual local image that can be opened or saved. Keep the request text and result association visible enough that users understand what was created.

The image preview opens at a comfortable size with zoom or fit controls, close, save and edit. Editing exposes a reference preview and a prompt field in a sheet or compact editing surface. The user can describe a change, submit, see progress, cancel and return to the conversation. Preserve the original and create a distinct result record. The prototype may reuse a supplied fixture for the new result, but its data model must represent a separate version and must not claim that pixels were actually transformed by a model.

An unprepared image capability should lead to its preparation interaction, then resume the user's draft where appropriate. A failed image job shows Retry and preserves the original prompt/reference. Mode switching must not discard the attachment. Export uses a real native save panel and a real decodable file, rather than writing descriptive text with an image extension.

## Video creation and editing

Video belongs in the prototype from the start. A video request shows its own simulated progress and returns an actual playable bundled clip, with a poster image, duration, play/pause and preview. Use the supplied six-second fixture to make playback and scrubbing real. The example is a UI fixture, not a benchmark of a video model.

The video preview includes a timeline with a movable playhead and clearly distinguishable trim handles, a mute control, playback and a save action. Trim handles update an edit draft and displayed range. A visual-edit prompt supports a request such as changing the atmosphere of the scene. Submitting either type of edit creates a new simulated job and a new artifact version associated with the source. The prototype may replay the fixture as the result; do not falsely report an actual re-encoding or generative transformation in its implementation evidence.

The editing flow must allow cancel, back, retry and returning to the original. A video-disabled hardware scenario must remain navigable and explain availability; the fully capable scenario must expose every control for review. Avoid a separate professional video-editor workspace with dozens of tools. This is conversational media creation with a focused editing surface.

## Dictation and conversational voice

Dictation and voice conversation are distinct entry points. The microphone beside the composer starts a simulated listening state, displays a live-looking waveform and inserts a sample transcript such as “Plan a calm, creative weekend by the sea.” The person can edit, discard or send that draft. The prototype should not capture ambient microphone audio or trigger a system permission request merely to animate this state.

The voice button opens a focused voice surface with a clear listening, thinking or speaking state, an optional transcript, mute, interrupt and end. Use animated native shapes for a softly colored waveform or living abstract form, consistent with the warm visual direction. The user can click a clearly available sample-speech action or use deterministic timing to progress through a turn. Provide real local playback of the bundled voice fixture when speaking. The transcript must match the sample exchange closely enough that the interaction feels coherent.

Mute changes the listening state. Interrupt immediately stops playback and returns to listening. End closes the surface and cancels all related tasks and audio. Closing a window or switching conversation must not leave a voice sample playing invisibly. A permission-denied preview state can demonstrate the eventual recovery interface without actually asking for microphone access. Native keyboard access and Escape-to-close should work.

## Connections, search and settings

Connections remain accessible in Settings and from relevant composer actions. The same connection state must be used everywhere. Connecting during onboarding should therefore be visible later in chat, and disconnecting in settings should remove the connected affordance. A connection preview can return a fictional sample document or message card when explicitly requested, with fixture provenance in the preview information. It must not read real mail, request real credentials or silently launch an external service.

Web search can appear as a simple optional capability in the composer menu and settings. Toggling it changes the conversation option. A search-style request can display deterministic sample source cards that open a local preview, not a claim of freshly retrieved information. The UI should demonstrate sources and failure recovery while leaving the service boundary replaceable. Do not build an API-key form into the main product flow.

Settings should use a clean native layout with appearance, capabilities, connections, privacy/data and preview controls. Capabilities show selected and ready states with storage summaries and allow adding or disabling an optional capability. Appearance offers Dark, Light and System. Privacy/data gives the user understandable local-storage and export/delete controls. The prototype's information page states that model activity and connections are simulated and assets are local fixtures.

Preview controls are for Armando's review, not another consumer onboarding step. They should allow restarting onboarding, selecting hardware scenarios, showing preparation errors, showing an expired connection, restoring sample conversations and clearing the prototype's data. Use a dedicated Preview menu or a clearly separated settings section. Destructive preview resets affect only the prototype's own data and require an intentional confirmation.

## State and architecture

Keep views separate from application state and service adapters. Use explicit persisted records for conversations, messages, attachments, artifacts and edit versions, capability selection/readiness, connections, onboarding choices and settings. Give jobs stable identities. A view should not infer which conversation owns a response from whichever chat happens to be selected when a timer completes.

Provide a small service boundary for assistant responses, capability preparation, media jobs, voice sessions and connections. The names and exact types are the implementer's choice, but the behavior must be asynchronous, cancellable and deterministic in the default scenario. The UI should consume states and events that later real providers could produce. Simulations should not be scattered as unrelated delays inside individual buttons.

Use local JSON or an equally simple native persistence mechanism with a versioned schema. Keep storage under the prototype's application identity. Persist completed records and stable preferences; restore interrupted simulated jobs as stopped or recoverable instead of resuming invalid timers. Avoid storing live Task objects, arbitrary closure state or absolute paths that only exist in the coding agent's temporary build directory.

Resource lookup must work from the installed app bundle. Copy the supplied assets into a proper resource target and resolve them through the appropriate bundle mechanism. The application must not depend at runtime on the handoff folder, this conversation's attachment directory, a remote image URL or the current working directory. Keep the handoff asset filenames recognizable in the project so later design changes are straightforward.

The default simulation should have no chance-based failures. Preview controls select deliberate scenarios. Cancelling a job terminates or invalidates the task so its delayed completion cannot update a deleted conversation or an old onboarding screen. Connections, capability selection and mode changes need one source of truth. New settings should remain understandable when the app is relaunched.

## Content and design discipline

Write concise, human product copy throughout. Prefer “Ready,” “Preparing,” “Try again,” “Connect,” “Save” and “Open” over engineering status descriptions. Keep launch copy ambitious. Put technical fixture provenance and preview details in implementation documentation or the prototype's information surface, not as a recurring warning in ordinary conversation.

No screen should expose model architecture, quantization, token settings, backend ports or MCP configuration as an everyday decision. The future integration can preserve advanced controls elsewhere. The interface should not overstate actual background work in the implementation report; the polished simulation and the technical completion record serve different purposes.

Use real native controls where appropriate, but customize hierarchy and composition deliberately. Avoid both a generic settings utility and a concept-art screen whose controls cannot be reached. Disabled actions need explanations, active actions need visible results, and focus order should follow the visual reading order. Hover cannot be the only means of discovering an essential action.

## Completion walkthrough

The coding agent must personally verify a clean launch into the welcome, capability selection with immediate total changes, both Evil Mode choices and a preparation flow that can enter chat early. It must also exercise the constrained hardware and failed-preparation scenarios and show that back, retry and resume preserve decisions. A screenshot of the welcome screen alone is not an onboarding pass.

In the workspace, verify creating and naming a conversation, sending and stopping streamed text, switching chats during a response, editing a message, regenerating a response, renaming, searching, deleting and restoring persistence after relaunch. Test attachment add/remove/preview with bundled fixtures and an unsupported-file error. Confirm the composer accepts multiline input, preserves drafts and behaves predictably with the keyboard.

Verify an image-generation job, a full-size preview, an edit flow, cancellation, retry and a real image save. Verify a video-generation job, actual playback, seeking, trim-draft interaction, an edit submission and save. Verify dictation inserts an editable draft and a voice conversation can play, mute, interrupt and end. Verify simulated connections update consistently and cancellation leaves them disconnected. Verify Safe/Evil mode state is visible and retained correctly.

Inspect the built app at the target and minimum window sizes and in both light and dark appearances. Check keyboard focus, legibility, scrolling, title-bar alignment and key interactive controls. Use screenshot/accessibility computer controls if available. If those controls fail, still build and launch the app and run automated state/persistence/cancellation checks; report precisely which visual checks remain unverified. Do not claim to have inspected a screen that was not accessible.

Meaningful automated tests should cover onboarding transitions, capability selection totals, deterministic preparation cancellation/retry, mode persistence, chat CRUD/search, response ownership across chat switches, media version association and recovery from saved state. The agent should run the appropriate build and these focused tests, fix failures and leave a short verification report. Avoid spending the build on cosmetic tests that simply repeat hardcoded labels while state defects remain.

## Final delivery from the implementing agent

The finished implementation should leave the runnable app, source project, bundled assets, reproducible build instructions, concise verification results and an explanation of how to restart the demo. The response should name the actual app location, say whether it was launched and give the user a simple way to open it again. It should also distinguish real UI/media playback/persistence from simulated AI work without presenting the latter as a failure to implement this brief.

The user has authorized execution and expects progress without repeated permission questions about routine implementation decisions. Choose sensible defaults, build the application and resolve ordinary build problems autonomously. Preserve the existing Nativ install and unrelated work. Ask only if an unavoidable external constraint genuinely prevents delivery; do not stop at a plan because a design detail has several reasonable answers.

## Sources and supplied material

The primary upstream source is [Nativ at the pinned audited commit](https://github.com/Blaizzy/nativ/tree/722be38266fba784a66288dbead55a9a6105dd6a). Its [project settings](https://github.com/Blaizzy/nativ/blob/722be38266fba784a66288dbead55a9a6105dd6a/project.yml) establish the Swift/Apple Silicon/macOS build context. Its welcome, chat, composer and archive sources linked above are the relevant UI references. The local copies allow initial inspection without a large download. Read the surrounding upstream code only when a reuse decision requires it; model research is not a prerequisite to implementing this interface.

The [Nativ audit evidence](references/Nativ_Audit_Evidence.md) separates measured runtime behavior, source findings and unverified capabilities. It is useful context for why integration boundaries matter. It does not mean that the current prototype needs the tested runtime or that any particular Meta/video model has been selected.

The [aesthetic reference review](references/aesthetic/REFERENCE_REVIEW.md) records the 21 inspected images, website observations and current design interpretation. The [asset notes](assets/ASSET_NOTES.md) identify earlier exploratory artwork and local demonstration media; they do not override the current visual direction. The [build prompt](BUILD_PROMPT.md) is the executable handoff instruction. Copy the complete handoff folder into the implementing workspace so its links and assets remain together. This PRD intentionally carries the complete product context needed to start that build in a fresh session.
