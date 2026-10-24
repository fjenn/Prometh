# Bundled prototype assets

The PNG images were generated for this project using the built-in image-generation tool. They are project-owned generated artwork for design evaluation. They were not produced by a model running inside Nativ. The image outputs are copied into this handoff so the future app can bundle them and operate without remote image requests. Inspect the actual images when choosing crops and overlays; their pixels contain no interface text.

## Selected onboarding artwork

`onboarding-dreamworld.png` is the first dreamworld concept, selected by Armando for use in this prototype. It is the current onboarding image, taking precedence over the earlier metallic exploration below. It was generated with the built-in image-generation tool from a text description, with no reference image supplied to the generation call. The complete prompt is in [onboarding-dreamworld-prompt.md](onboarding-dreamworld-prompt.md). Use the selected image with live native UI and preserve quiet space for readable content. The later dreamworld variants are not the selected direction.

## Earlier exploratory sculpture

`sovereign-onboarding-hero.png` is an earlier exploratory welcome/Evil Mode concept. It is superseded as the default art direction by the warm, playful aesthetic reference review and must not be treated as the required brand background. It depicts a smoked-glass and platinum sculptural ribbon with warm refraction on a dark field. Keep large copy in the quiet left area. The output has been visually inspected in this chat. The current PRD defines the visual direction; this asset is retained only as an earlier exploration.

The generation prompt was: “Use case: stylized-concept. Create one premium launch artwork for an Apple Silicon personal AI macOS app, used as a full-bleed onboarding background. An abstract sculptural continuous ribbon of smoked translucent glass and liquid platinum curves into an open almost-orbital shape, luminous delicate champagne-white inner edge, deep ink black and charcoal surroundings, subtle warm amber refraction in a small area. Quiet, powerful, highly sophisticated luxury industrial design, meticulous optical materials, cinematic studio lighting, very restrained, strong three-dimensional depth, nearly black empty space in the left half and upper third for later interface typography. Main sculpture placed toward the right lower half. Wide landscape composition, approximately 16:10, high resolution. This is background artwork only: no text, no letters, no logo, no interface, no frames, no device mockup, no watermarks, no neon rainbow, no purple gradient, no cute robot, no stock technology symbols. The image should feel like a definitive new computing era rather than a generic AI website.”

## Image output example

`cliff-house-demo.png` is the sample image-generation result and media preview. It is an architectural photograph concept: a glass-and-stone residence above an Atlantic cliff at sunrise. A suitable seeded user request is “Create a cinematic photograph of a glass house above the Atlantic at sunrise.” The output has been visually inspected in this chat. It may be reused as an editing-result fixture, provided the implementation records a distinct artifact version and does not claim an actual model changed the pixels.

The generation prompt was: “Use case: photorealistic-natural. Create a premium cinematic architectural photograph to use as a bundled example of AI-created images in a local AI macOS app. A single beautifully designed modern glass-and-dark-stone residence cantilevered above a dramatic Atlantic cliff, soft early morning sunlight, fine sea mist, distant pale ocean horizon, tactile weathered stone, calm intelligent architectural composition, editorial photography quality, realistic optical detail, subtle film grain, restrained natural colors with gentle warm light and blue gray sea. Wide landscape 16:9 composition, strong visually legible silhouette even as a small thumbnail. No people, no text, no logos, no watermark, no UI, no collage, no excessive fantasy. It should feel expensive, atmospheric and believable, a striking demonstration image people would want to create.”

## Video playback fixture

`cliff-house-demo.mp4` is a six-second H.264 video encoded locally from the still architectural image, using FFmpeg. It is intentionally a still-image playback fixture rather than AI-generated motion. It provides a real file for play/pause, seek, timeline, trim-draft, save and preview interactions. Displaying it cannot be counted as a successful video-model evaluation or a real generative edit. The original generated still is the sole visual source.

## Voice playback fixture

`voice-demo.wav` was synthesized locally using the macOS Samantha system voice and converted to mono 24 kHz WAV. Its text is: “Let us plan a calm, creative weekend by the sea. We can start with a beautiful place to stay, leave room for a long walk, and keep the schedule wonderfully simple.” Pair it with the simulated user utterance “Plan a calm, creative weekend by the sea.” It provides real audio playback for the prototype; it is not a benchmark of a selected open-source speech model.

## Integration

Copy the selected onboarding artwork and the demonstration image, video and audio into the application's resource target. The earlier metallic exploration is not a required application resource. The file names should remain traceable, but views should load them through an asset/resource abstraction rather than an absolute handoff path. Preserve image aspect ratios, provide accessible descriptions and confirm that playback and save/export work after launching the built `.app` from Finder or an equivalent native launch route. The implementing agent can create small interface icons with native symbols and vector shapes rather than adding more raster assets.
