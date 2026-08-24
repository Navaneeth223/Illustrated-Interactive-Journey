# Requirements Document

## Introduction

An illustrated, interactive bicycle journey through a real, grounded landscape — a familiar daily commute rendered in a paper/graphite aesthetic. The experience is presented from the point of view of a bicycle rider moving at rolling pace, close to the ground. The journey has a finite arc with 5–8 distinct scene segments and a clear sense of arrival at a destination. The rider moves through the world by holding an input, which drives a velocity-based movement model. The rendering is handled by a WebGL 2D renderer with multi-layer parallax, a paper/graphite visual treatment, and a quality-mode toggle for lower-powered devices. Ambient audio is gated behind a user gesture on load.

## Glossary

- **Journey**: The complete interactive experience from departure to arrival, composed of ordered scene segments.
- **Segment**: A discrete, finite panel of the landscape that connects seamlessly at its left and right edges to adjacent segments. Contains background, midground, and foreground layers.
- **Layer**: A single depth plane within a segment. Layers are classified as background, midground, or foreground, each scrolling at a distinct parallax speed.
- **Parallax Speed**: The horizontal scroll velocity multiplier applied to a layer relative to the rider's world velocity. Background: 0.15×, midground: 0.45×, foreground: 1.0×.
- **Rider**: The player's point-of-view character — a bicycle rider moving through the landscape.
- **Hold Input**: A sustained pointer press (mouse button, touch, or keyboard hold) that drives rider movement.
- **Velocity Model**: The acceleration/deceleration curve applied to rider movement in response to hold input.
- **Myriorama Sequencer**: The component responsible for loading, positioning, and recycling segment panels as the rider traverses the journey.
- **Edge Match**: The visual and geometric alignment of the left edge of one segment to the right edge of the preceding segment, such that no seam is visible.
- **Grain Texture**: A multiply-blended noise overlay applied to the full viewport to simulate paper or graphite texture.
- **Vignette**: A radial darkening filter applied to the viewport edges to frame the scene.
- **Quality Mode**: A rendering configuration toggle with two states — Default and Eco.
- **Default Quality**: Full-resolution textures, grain texture enabled, device pixel ratio uncapped.
- **Eco Quality**: Texture resolution halved, grain texture disabled, device pixel ratio capped at 1.
- **Audio Gate**: A blocking UI overlay presented on load that requires an explicit user gesture before ambient audio is enabled or the journey proceeds silently.
- **Renderer**: The PixiJS WebGL 2D rendering engine (or Three.js with OrthographicCamera) responsible for compositing all layers.
- **GSAP**: The animation library used for all easing and transition interpolation.
- **Howler**: The audio library (Howler.js or Web Audio API) responsible for ambient sound playback.

---

## Requirements

### Requirement 1 — Journey Structure

**User Story:** As a rider, I want a journey with a clear beginning, middle, and end across distinct scene segments, so that the experience feels like a real trip with a sense of arrival.

#### Acceptance Criteria

1. THE Journey SHALL consist of between 5 and 8 discrete Segments arranged in a fixed, ordered sequence.
2. THE Journey SHALL begin at a defined departure Segment and end at a defined arrival Segment.
3. WHEN the Rider reaches the final Segment's terminal edge, THE Journey SHALL present a distinct arrival state, halting further forward movement.
4. WHILE the Rider is between the first and final Segments, THE Journey SHALL allow continuous forward movement through all intermediate Segments in sequence.
5. THE Journey's landscape SHALL depict a real, grounded setting (city, countryside, or coast) consistent with a recognisable daily commute.

---

### Requirement 2 — Segment Sequencing (Myriorama)

**User Story:** As a rider, I want the landscape to scroll continuously without visible interruptions, so that the world feels seamless and handcrafted.

#### Acceptance Criteria

1. THE Myriorama Sequencer SHALL position each Segment so that its left edge aligns exactly to the right edge of the preceding Segment, producing no visible gap or overlap.
2. WHEN a Segment scrolls fully off the left edge of the viewport, THE Myriorama Sequencer SHALL recycle that Segment's assets and release its memory.
3. WHEN the Rider advances to within one Segment width of the next unloaded Segment, THE Myriorama Sequencer SHALL load and position that Segment before it enters the viewport.
4. THE Myriorama Sequencer SHALL maintain Edge Match precision such that connecting seams between adjacent Segments are not visible at any supported display resolution.

---

### Requirement 3 — Parallax Depth

**User Story:** As a rider, I want distant elements to move more slowly than near ones, so that the scene reads as having genuine spatial depth.

#### Acceptance Criteria

1. THE Renderer SHALL scroll the background Layer at 0.15× the Rider's world velocity.
2. THE Renderer SHALL scroll the midground Layer at 0.45× the Rider's world velocity.
3. THE Renderer SHALL scroll the foreground Layer at 1.0× the Rider's world velocity.
4. WHILE the Rider is in motion, THE Renderer SHALL update all Layer positions each rendered frame so that parallax depth is continuously perceptible.
5. THE Renderer SHALL composite background, midground, and foreground Layers in depth order (background furthest, foreground nearest) with no z-order reversal.

---

### Requirement 4 — Hold-to-Move Velocity Model

**User Story:** As a rider, I want movement to feel like real cycling — building speed when I press and rolling to a stop when I release — so that the interaction has physical weight.

#### Acceptance Criteria

1. WHEN the Rider begins a Hold Input, THE Velocity Model SHALL accelerate the Rider's world velocity from its current value toward a defined maximum, following a smooth easing curve managed by GSAP.
2. WHEN the Rider releases a Hold Input, THE Velocity Model SHALL decelerate the Rider's world velocity from its current value toward zero, following a smooth easing curve managed by GSAP.
3. WHILE the Rider's world velocity is greater than zero and no Hold Input is active, THE Velocity Model SHALL continue to advance the Rider's position (coasting), decelerating to zero.
4. THE Velocity Model SHALL produce no instantaneous velocity change (no snap-to-zero or snap-to-max) at the moment of input press or release.
5. THE Velocity Model SHALL support Hold Input from mouse button hold, touch hold, and keyboard key hold (spacebar or arrow key).

---

### Requirement 5 — Paper/Graphite Render Treatment

**User Story:** As a viewer, I want the visuals to look hand-drawn on paper, so that the journey has an intimate, crafted aesthetic.

#### Acceptance Criteria

1. THE Renderer SHALL apply a full-viewport Grain Texture overlay using multiply blend mode at an opacity between 8% and 12%.
2. THE Renderer SHALL apply a desaturation (grayscale) filter to all scene Layers, producing a monochrome or near-monochrome output.
3. THE Renderer SHALL apply a Vignette filter that darkens the viewport edges radially, framing the scene.
4. WHILE Default Quality is active, THE Renderer SHALL apply the Grain Texture on every rendered frame.
5. THE Renderer SHALL composite the Grain Texture, grayscale filter, and Vignette as post-process steps applied after all Segment Layers are drawn.

---

### Requirement 6 — Quality Mode Toggle

**User Story:** As a user on a lower-powered device, I want a quality mode that reduces rendering cost, so that the experience remains usable without degrading the story.

#### Acceptance Criteria

1. THE Quality Mode SHALL default to Default Quality on initial load.
2. WHEN the user activates Eco Quality, THE Renderer SHALL halve the resolution of all loaded textures relative to their Default Quality dimensions.
3. WHEN the user activates Eco Quality, THE Renderer SHALL disable the Grain Texture overlay.
4. WHEN the user activates Eco Quality, THE Renderer SHALL cap the device pixel ratio at 1, regardless of the physical display's pixel ratio.
5. WHEN the user switches from Eco Quality to Default Quality, THE Renderer SHALL restore full-resolution textures, re-enable the Grain Texture, and remove the pixel ratio cap.
6. THE Quality Mode toggle SHALL be accessible to the user at any point during the Journey without interrupting playback.
7. WHEN Quality Mode changes, THE Renderer SHALL apply the new configuration within one rendered frame, producing no visual discontinuity beyond the expected resolution change.

---

### Requirement 7 — Mobile Audio Unlock Gate

**User Story:** As a user on mobile, I want to be told about sound before the journey starts, so that audio is not blocked by browser policy and I can choose to enable or skip it.

#### Acceptance Criteria

1. WHEN the Journey loads, THE Audio Gate SHALL present a blocking overlay before any journey content is interactive, offering the user the choice to enable sound or proceed without sound.
2. THE Audio Gate overlay SHALL be dismissed only by an explicit user gesture (tap, click, or key press).
3. WHEN the user selects "enable sound" on the Audio Gate, THE Howler audio context SHALL be resumed or created within the same user gesture event, satisfying browser autoplay policy.
4. WHEN the user selects "proceed without sound" on the Audio Gate, THE Journey SHALL begin with all audio tracks muted and no audio context activation attempted.
5. IF the Audio Gate is dismissed with sound enabled and the audio context fails to activate, THEN THE Journey SHALL begin silently and THE Audio Gate SHALL not re-display.
6. THE Audio Gate SHALL not apply to subsequent page visits within the same browser session where the user's audio preference has been stored.

---

### Requirement 8 — Ambient Audio

**User Story:** As a rider, I want ambient sounds that match the landscape I'm passing through, so that the sensory experience supports the journey's atmosphere.

#### Acceptance Criteria

1. WHILE the Rider is in motion and sound is enabled, THE Howler component SHALL play looping ambient audio appropriate to the current Segment's environment.
2. WHEN the Rider transitions from one Segment to another, THE Howler component SHALL crossfade from the outgoing Segment's ambient track to the incoming Segment's ambient track within a defined fade duration of no more than 2 seconds.
3. WHILE the Rider's world velocity is zero and sound is enabled, THE Howler component SHALL reduce ambient audio playback volume to a defined idle level.
4. WHEN the Rider resumes motion after being stationary, THE Howler component SHALL restore ambient audio volume to the full motion level.
5. IF sound is disabled by the user via the Audio Gate or a runtime mute control, THEN THE Howler component SHALL suspend all audio output and SHALL NOT resume until the user explicitly re-enables sound.

---

### Requirement 9 — Renderer Initialisation and Performance Baseline

**User Story:** As a user, I want the experience to load and run smoothly, so that the interaction feels responsive from the first frame.

#### Acceptance Criteria

1. THE Renderer SHALL initialise using PixiJS (WebGL 2D) or Three.js with an OrthographicCamera.
2. THE Renderer SHALL use GSAP for all tween-based animation and easing, with no competing animation libraries applied to the same properties.
3. WHEN the Renderer initialises, THE Renderer SHALL detect the device pixel ratio and apply it up to any Quality Mode cap before drawing the first frame.
4. THE Renderer SHALL maintain a target of 60 frames per second during active rider motion under Default Quality on a device meeting the defined minimum hardware specification.
5. IF the Renderer encounters a WebGL context loss event, THEN THE Renderer SHALL attempt to restore the context and resume rendering from the last known Journey position.
