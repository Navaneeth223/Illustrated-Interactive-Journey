# Design Document — Illustrated Interactive Journey

## Overview

A finite, scroll-based interactive experience in which a bicycle rider travels through a hand-illustrated paper/graphite landscape. The user holds an input to build speed, releases to coast, and arrives at a destination after traversing 5–8 seamlessly connected scene segments. The renderer is a PixiJS WebGL 2D canvas composited with multi-layer parallax, post-process filters (grain, grayscale, vignette), a velocity model driven by GSAP, and ambient audio managed by Howler.js, all gated behind a mobile-friendly audio unlock overlay.

---

## Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────────┐
│                        App Shell                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  AudioGate   │  │  QualityHUD  │  │ ArrivalScreen│  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                 │           │
│  ┌──────▼─────────────────▼─────────────────▼───────┐   │
│  │                   JourneyController               │   │
│  │  ┌───────────────┐   ┌────────────────────────┐  │   │
│  │  │ VelocityModel │   │   MyrioramaSequencer   │  │   │
│  │  │  (GSAP-driven)│   │  (load/recycle/align)  │  │   │
│  │  └───────┬───────┘   └──────────┬─────────────┘  │   │
│  │          │                      │                 │   │
│  │  ┌───────▼──────────────────────▼─────────────┐  │   │
│  │  │              PixiJS Renderer               │  │   │
│  │  │  [BG Layer 0.15×] [MG Layer 0.45×]         │  │   │
│  │  │  [FG Layer 1.0×]  [Post-Process Pipeline]  │  │   │
│  │  └────────────────────────────────────────────┘  │   │
│  └───────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │               AudioController (Howler)           │   │
│  │  [Track pool per segment] [Crossfade manager]    │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Module Responsibilities

| Module | Responsibility |
|--------|----------------|
| `App` | Bootstrap, DOM mount, WebGL canvas creation, WebGL context-loss wiring |
| `JourneyController` | Owns journey state machine, coordinates VelocityModel ↔ Sequencer ↔ Renderer |
| `VelocityModel` | GSAP-driven acceleration/deceleration/coasting, emits `worldPositionUpdate` |
| `MyrioramaSequencer` | Loads, positions, and recycles `Segment` instances; maintains edge-match invariant |
| `PixiRenderer` | Composites parallax layers, runs post-process pipeline, manages DPR and quality config |
| `AudioController` | Howler track pool, segment crossfades, idle/motion volume management |
| `AudioGate` | Blocking overlay, preference storage, audio context unlock |
| `QualityHUD` | Toggle UI, delegates to `PixiRenderer.setQualityMode()` |
| `ArrivalScreen` | Terminal arrival state UI, triggered by JourneyController |

---

## Data Models

### Segment Descriptor (static, loaded from manifest)

```typescript
interface SegmentDescriptor {
  id: string;                  // e.g. "seg-01-departure"
  index: number;               // 0-based position in the ordered sequence
  role: "departure" | "intermediate" | "arrival";
  widthPx: number;             // canonical width at 1× DPR
  layers: {
    background: string;        // asset URL for BG sprite sheet / image
    midground: string;
    foreground: string;
  };
  audioTrack: string;          // ambient loop asset URL
  edgeMatchOffsetLeft: number; // pixel offset correction for left edge alignment
  edgeMatchOffsetRight: number;
}
```

### Journey Manifest

```typescript
interface JourneyManifest {
  segments: SegmentDescriptor[]; // length: 5–8, ordered departure→arrival
  maxVelocity: number;           // pixels/second at 1× scale
  accelerationDuration: number;  // seconds for 0 → maxVelocity GSAP tween
  decelerationDuration: number;  // seconds for maxVelocity → 0 GSAP tween
  idleVolume: number;            // Howler volume scalar at velocity=0 (e.g. 0.25)
  motionVolume: number;          // Howler volume scalar while moving (e.g. 1.0)
  crossfadeDuration: number;     // seconds, max 2.0
}
```

### Runtime Journey State

```typescript
interface JourneyState {
  worldPosition: number;       // pixels scrolled from origin
  currentSegmentIndex: number;
  phase: "gate" | "travelling" | "arrived";
  qualityMode: "default" | "eco";
  soundEnabled: boolean;
}
```

### Segment Runtime Instance

```typescript
interface SegmentInstance {
  descriptor: SegmentDescriptor;
  container: PIXI.Container;   // root container in the scene graph
  bgSprite: PIXI.Sprite;
  mgSprite: PIXI.Sprite;
  fgSprite: PIXI.Sprite;
  worldX: number;              // canonical left edge in world space
  loaded: boolean;
  recycled: boolean;
}
```

---

## Components and Interfaces

### VelocityModel

```typescript
class VelocityModel {
  /** Current world velocity in px/s */
  get velocity(): number;

  /** Monotonically-increasing world position in px */
  get worldPosition(): number;

  /** Called once per rAF tick with elapsed seconds */
  tick(dt: number): void;

  /** Begin acceleration tween toward maxVelocity */
  startHold(): void;

  /** Begin deceleration tween toward 0 */
  releaseHold(): void;

  /** True while a hold input is active */
  get isHolding(): boolean;

  on(event: "positionUpdate", handler: (pos: number, vel: number) => void): void;
}
```

**GSAP integration detail:**

- `startHold()` calls `gsap.to(this._state, { velocity: maxVelocity, duration: accelerationDuration, ease: "power2.inOut", overwrite: true })`.
- `releaseHold()` calls `gsap.to(this._state, { velocity: 0, duration: decelerationDuration, ease: "power2.inOut", overwrite: true })`.
- `tick(dt)` integrates `worldPosition += velocity * dt` each frame.
- No other animation library mutates `velocity` or `worldPosition`.

### MyrioramaSequencer

```typescript
class MyrioramaSequencer {
  /** Called with latest worldPosition each frame */
  update(worldPosition: number): void;

  /** Returns currently visible/loaded segments */
  get activeSegments(): SegmentInstance[];

  /** Total world width of all segments combined */
  get totalWorldWidth(): number;

  /** True when worldPosition has reached the terminal edge */
  get isAtArrival(): boolean;
}
```

**Positioning invariant:** For all `i` where `0 ≤ i < segments.length - 1`:

```
segments[i + 1].worldX === segments[i].worldX + segments[i].descriptor.widthPx
```

**Lookahead rule:** When `worldPosition + viewportWidth + segmentWidth >= nextSegment.worldX`, trigger async load for next unloaded segment.

**Recycle rule:** When `segment.worldX + segment.descriptor.widthPx < worldPosition - viewportWidth`, mark segment for recycle and destroy its PIXI containers.

### PixiRenderer

```typescript
class PixiRenderer {
  /** Called each rAF; repositions layers and re-renders */
  render(worldPosition: number, segments: SegmentInstance[]): void;

  /** Switch quality mode; applied within one render call */
  setQualityMode(mode: "default" | "eco"): void;

  /** Current applied device pixel ratio */
  get appliedDPR(): number;

  /** Post-process pipeline containers */
  readonly postProcess: {
    grainSprite: PIXI.Sprite;
    vignetteFilter: PIXI.Filter;
    grayscaleFilter: PIXI.filters.ColorMatrixFilter;
  };
}
```

**Layer positioning formula** (called in `render()`):

```typescript
bgContainer.x   = -worldPosition * 0.15;
mgContainer.x   = -worldPosition * 0.45;
fgContainer.x   = -worldPosition * 1.00;
```

**Post-process pipeline order:**

1. All segment layer containers (BG → MG → FG)
2. Grain sprite (multiply blend, alpha 0.08–0.12) — Default Quality only
3. Grayscale ColorMatrixFilter applied to the stage root
4. Vignette shader filter applied to the stage root

**Quality mode switching:**

```typescript
setQualityMode(mode) {
  if (mode === "eco") {
    this.app.renderer.resolution = 1;
    this.postProcess.grainSprite.visible = false;
    this._reloadTexturesAtHalfResolution();
  } else {
    this.app.renderer.resolution = Math.min(window.devicePixelRatio, this._nativeDPR);
    this.postProcess.grainSprite.visible = true;
    this._reloadTexturesAtFullResolution();
  }
  this.app.renderer.resize(this.app.screen.width, this.app.screen.height);
}
```

### AudioController

```typescript
class AudioController {
  /** Called by JourneyController when segment changes */
  transitionToSegment(segmentIndex: number): void;

  /** Set idle (velocity=0) or motion volume */
  setMotionState(isMoving: boolean): void;

  /** Mute/unmute all tracks */
  setSoundEnabled(enabled: boolean): void;

  /** True if any track is currently fading */
  get isCrossfading(): boolean;
}
```

**Crossfade logic:**

```typescript
transitionToSegment(index) {
  const incoming = this._tracks[index];
  const outgoing = this._currentTrack;
  if (!outgoing) { incoming.play(); return; }

  const fadeDuration = this._manifest.crossfadeDuration * 1000; // ms
  outgoing.fade(outgoing.volume(), 0, fadeDuration);
  incoming.play();
  incoming.fade(0, this._targetVolume, fadeDuration);
  setTimeout(() => outgoing.stop(), fadeDuration);
  this._currentTrack = incoming;
}
```

**Volume states:**

```typescript
setMotionState(isMoving) {
  const target = isMoving ? this._manifest.motionVolume : this._manifest.idleVolume;
  if (this._currentTrack && this._soundEnabled) {
    gsap.to(this._currentTrack, { volume: target, duration: 0.4 });
  }
}
```

### AudioGate

```typescript
class AudioGate {
  /** Show the gate overlay; resolves with user's choice */
  show(): Promise<"sound-on" | "sound-off">;

  /** Returns stored preference from sessionStorage, or null */
  static getStoredPreference(): "sound-on" | "sound-off" | null;

  /** Persist choice for the session */
  static storePreference(choice: "sound-on" | "sound-off"): void;
}
```

**Session storage key:** `"ijj-audio-preference"` in `sessionStorage`.

**Audio context unlock:**

```typescript
// Called synchronously within the click/tap handler
if (choice === "sound-on") {
  await Howler.ctx.resume(); // must be within gesture call stack
}
```

---

## Journey State Machine

```
          ┌──────────┐
   load   │          │  gesture
  ──────► │   GATE   ├──────────────────────────────────────┐
          │          │                                       │
          └──────────┘                                       │
                                                             ▼
                                                     ┌─────────────┐
                                                     │  TRAVELLING │
                                                     │             │
                                                     │ hold→accel  │
                                                     │ rel→decel   │
                                                     │             │
                                                     └──────┬──────┘
                                                            │ worldPosition
                                                            │ >= terminalEdge
                                                            ▼
                                                     ┌─────────────┐
                                                     │   ARRIVED   │
                                                     │ (no forward │
                                                     │  movement)  │
                                                     └─────────────┘
```

### State Transitions

| From | Event | To | Side Effects |
|------|-------|----|-------------|
| `gate` | user gesture received | `travelling` | unlock audio if enabled, show canvas |
| `travelling` | worldPosition ≥ terminalEdge | `arrived` | decelerate to 0, show ArrivalScreen, stop input |
| `travelling` | quality toggle | `travelling` | apply new quality config within current frame |

---

## WebGL Context Loss Recovery

PixiJS exposes `webglcontextlost` and `webglcontextrestored` events on the canvas. The recovery procedure:

```typescript
canvas.addEventListener("webglcontextlost", (e) => {
  e.preventDefault(); // allow restoration
  this._contextLost = true;
  this._savedPosition = journeyController.worldPosition;
});

canvas.addEventListener("webglcontextrestored", () => {
  this._contextLost = false;
  this.app.renderer.reset();
  sequencer.forceReloadAll();
  journeyController.seekTo(this._savedPosition);
});
```

`journeyController.seekTo(pos)` repositions all layers and audio without replaying the journey from the start.

---

## Asset Pipeline

### Manifest file: `journey.manifest.json`

```jsonc
{
  "segments": [
    {
      "id": "seg-01-departure",
      "index": 0,
      "role": "departure",
      "widthPx": 2400,
      "layers": {
        "background": "assets/seg01/bg.webp",
        "midground": "assets/seg01/mg.webp",
        "foreground": "assets/seg01/fg.webp"
      },
      "audioTrack": "assets/audio/seg01-ambient.mp3",
      "edgeMatchOffsetLeft": 0,
      "edgeMatchOffsetRight": 0
    }
    // … seg-02 through seg-08 …
  ],
  "maxVelocity": 800,
  "accelerationDuration": 1.2,
  "decelerationDuration": 1.8,
  "idleVolume": 0.25,
  "motionVolume": 1.0,
  "crossfadeDuration": 1.5
}
```

### Eco Quality textures

Eco textures are pre-generated at build time at 50% of canonical dimensions and stored alongside full-res assets:

```
assets/seg01/bg@0.5x.webp
assets/seg01/mg@0.5x.webp
assets/seg01/fg@0.5x.webp
```

The `PixiRenderer` selects the appropriate URL suffix based on the active quality mode.

---

## Rendering Pipeline Detail

```
rAF tick
  │
  ├─ VelocityModel.tick(dt)
  │    └─ integrates worldPosition
  │
  ├─ MyrioramaSequencer.update(worldPosition)
  │    ├─ trigger loads for upcoming segments
  │    └─ recycle off-screen segments
  │
  ├─ PixiRenderer.render(worldPosition, activeSegments)
  │    ├─ bgContainer.x   = -worldPosition * 0.15
  │    ├─ mgContainer.x   = -worldPosition * 0.45
  │    ├─ fgContainer.x   = -worldPosition * 1.00
  │    ├─ [draw all segment layer sprites]
  │    ├─ [grain overlay — multiply blend 8–12%]
  │    ├─ [grayscale filter on stage root]
  │    └─ [vignette filter on stage root]
  │
  └─ AudioController.setMotionState(velocity > 0)
```

---

## Input Handling

All input events are normalized to two abstract events: `holdStart` and `holdEnd`.

```typescript
// Mouse
canvas.addEventListener("mousedown", () => input.emit("holdStart"));
canvas.addEventListener("mouseup",   () => input.emit("holdEnd"));

// Touch
canvas.addEventListener("touchstart", (e) => { e.preventDefault(); input.emit("holdStart"); });
canvas.addEventListener("touchend",   (e) => { e.preventDefault(); input.emit("holdEnd"); });

// Keyboard
window.addEventListener("keydown", (e) => {
  if ((e.code === "Space" || e.code === "ArrowRight") && !e.repeat)
    input.emit("holdStart");
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space" || e.code === "ArrowRight")
    input.emit("holdEnd");
});
```

`JourneyController` subscribes to `holdStart`/`holdEnd` and delegates to `VelocityModel.startHold()` / `releaseHold()` only when `phase === "travelling"`.

---

## Error Handling

| Scenario | Handling |
|----------|----------|
| Segment asset load failure | Retry once; on second failure, skip segment and log warning |
| Audio context activation failure | Journey proceeds silently; no gate re-shown |
| WebGL context loss | Save `worldPosition`, attempt context restore, reload textures, seek to saved position |
| Manifest fetch failure | Show blocking error UI with retry button |
| Missing `webp` support | Fallback to `png` equivalents via PIXI loader `loadParser` |

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Arrival halts forward movement

*For any* journey state where `worldPosition` is at or beyond the terminal edge of the final segment, applying a `holdStart` input SHALL NOT increase `worldPosition` beyond that terminal edge.

**Validates: Requirements 1.3**

---

### Property 2: Intermediate positions allow forward movement

*For any* rider `worldPosition` strictly between the start of the departure segment and the terminal edge of the arrival segment, when a hold input is active, `worldPosition` SHALL increase on the subsequent tick.

**Validates: Requirements 1.4**

---

### Property 3: Edge-match invariant

*For any* ordered list of `n` segments produced by the Myriorama Sequencer, for all indices `i` in `[0, n−2]`, `segment[i+1].worldX` SHALL equal `segment[i].worldX + segment[i].descriptor.widthPx`, producing no gap or overlap.

**Validates: Requirements 2.1, 2.4**

---

### Property 4: Off-screen segments are recycled

*For any* loaded segment whose right edge (`worldX + widthPx`) is less than `worldPosition − viewportWidth`, the Myriorama Sequencer SHALL mark that segment as recycled and release its PIXI containers.

**Validates: Requirements 2.2**

---

### Property 5: Lookahead triggers segment load

*For any* unloaded segment `S` and rider `worldPosition` such that `worldPosition + viewportWidth + S.widthPx >= S.worldX`, the Myriorama Sequencer SHALL have initiated a load for `S` before `S.worldX` enters the viewport.

**Validates: Requirements 2.3**

---

### Property 6: Parallax multipliers are correct for all layer types

*For any* world position `p` and any rendered frame, the following SHALL hold simultaneously:

- `bgContainer.x === −p × 0.15`
- `mgContainer.x === −p × 0.45`
- `fgContainer.x === −p × 1.00`

**Validates: Requirements 3.1, 3.2, 3.3**

---

### Property 7: Layer depth order is never reversed

*For any* rendered scene state, the z-index (render order) of the background container SHALL be strictly less than that of the midground container, which SHALL be strictly less than that of the foreground container.

**Validates: Requirements 3.5**

---

### Property 8: Velocity accelerates monotonically on hold

*For any* initial world velocity `v₀` in `[0, maxVelocity)`, when a hold input is active, the velocity at each subsequent tick SHALL be greater than or equal to the velocity at the previous tick until `maxVelocity` is reached.

**Validates: Requirements 4.1**

---

### Property 9: Velocity decelerates monotonically on release

*For any* initial world velocity `v₀` in `(0, maxVelocity]`, when no hold input is active, the velocity at each subsequent tick SHALL be less than or equal to the velocity at the previous tick until `0` is reached.

**Validates: Requirements 4.2, 4.3**

---

### Property 10: No instantaneous velocity discontinuity

*For any* two consecutive ticks `t` and `t+1`, regardless of input transition (hold start or hold end occurring between them), `|velocity[t+1] − velocity[t]|` SHALL be bounded by `maxVelocity × dt / minTweenDuration`, precluding snap-to-zero or snap-to-max jumps.

**Validates: Requirements 4.4**

---

### Property 11: Grain overlay opacity is always in spec under Default Quality

*For any* rendered frame while Default Quality is active, `grainSprite.alpha` SHALL satisfy `0.08 ≤ grainSprite.alpha ≤ 0.12` and `grainSprite.blendMode` SHALL equal `PIXI.BLEND_MODES.MULTIPLY`.

**Validates: Requirements 5.1, 5.4**

---

### Property 12: Grayscale filter is applied to all scene layers

*For any* scene layer container in the renderer, that container SHALL have a `ColorMatrixFilter` configured for full desaturation present in its `filters` array (or applied to the stage root).

**Validates: Requirements 5.2**

---

### Property 13: Post-process pipeline order

*For any* render call, the grain sprite, grayscale filter, and vignette filter SHALL be applied after all segment layer sprites have been drawn to the stage, never before.

**Validates: Requirements 5.5**

---

### Property 14: Eco Quality halves texture dimensions

*For any* texture loaded while Eco Quality is active, its loaded width SHALL equal `Math.floor(originalWidth / 2)` and its loaded height SHALL equal `Math.floor(originalHeight / 2)`.

**Validates: Requirements 6.2**

---

### Property 15: Eco Quality caps device pixel ratio at 1

*For any* physical device pixel ratio `dpr ≥ 1`, when Eco Quality is active, `renderer.resolution` SHALL equal `1`.

**Validates: Requirements 6.4**

---

### Property 16: Eco → Default round trip restores full state

*For any* renderer state `S₀` under Default Quality, switching to Eco Quality and then back to Default Quality SHALL produce a renderer state `S₂` in which `renderer.resolution`, grain visibility, and texture dimensions are identical to those of `S₀`.

**Validates: Requirements 6.5**

---

### Property 17: Ambient track matches current segment

*For any* segment index `i` with `soundEnabled = true` and `velocity > 0`, the Howler track playing SHALL correspond to `segments[i].audioTrack` and SHALL be in the `playing` and `loop` states.

**Validates: Requirements 8.1**

---

### Property 18: Crossfade duration never exceeds 2 seconds

*For any* pair of adjacent segments `(segA, segB)`, the crossfade from `segA`'s track to `segB`'s track SHALL complete within `crossfadeDuration ≤ 2000 ms`.

**Validates: Requirements 8.2**

---

### Property 19: Idle/motion volume round trip

*For any* sequence of transitions from `velocity = 0` (idle) to `velocity > 0` (motion) and back, the ambient track volume SHALL be `idleVolume` at idle and `motionVolume` during motion, and any intermediate value SHALL lie strictly between them.

**Validates: Requirements 8.3, 8.4**

---

### Property 20: Sound-disabled state silences all output

*For any* journey state with `soundEnabled = false`, all Howler track volumes SHALL be `0` and no new Howler `.play()` calls SHALL be issued until `soundEnabled` is explicitly set to `true`.

**Validates: Requirements 8.5**

---

### Property 21: DPR at initialisation respects quality cap

*For any* physical device pixel ratio `dpr` and quality mode `q`, `renderer.resolution` at initialisation SHALL equal `Math.min(dpr, qualityCap(q))`, where `qualityCap("default") = dpr` and `qualityCap("eco") = 1`.

**Validates: Requirements 9.3**

---

### Property 22: WebGL context loss preserves journey position

*For any* journey state where a `webglcontextlost` event is simulated, after the renderer successfully restores the context, `journeyController.worldPosition` SHALL equal the position recorded at the time of context loss.

**Validates: Requirements 9.5**

---

## Testing Strategy

### Dual Testing Approach

Both unit/example tests and property-based tests are used, treating them as complementary layers:

- **Unit / example tests** — verify specific scenarios, integration points, and error paths that are not amenable to universal quantification (e.g., audio gate interaction flow, quality toggle UI presence, WebGL context-loss trigger).
- **Property-based tests** — verify the 22 universal properties above across randomised inputs. Each property test runs a minimum of 100 iterations.

### Property Test Configuration

Each property test is tagged with the feature and property number to ensure traceability:

```
Feature: illustrated-interactive-journey, Property N: <property_text>
```

Suggested library: **fast-check** (TypeScript).

### What to Mock in Property Tests

| Concern | Mock Strategy |
|---------|---------------|
| PIXI.Application / renderer | Lightweight stub tracking `.x`, `.alpha`, `.resolution`, filter list |
| GSAP tweens | Synchronous stub that sets target value immediately (for position invariants) or steps incrementally (for monotonicity checks) |
| Howler tracks | Stub implementing `.play()`, `.stop()`, `.fade()`, `.volume()` |
| `window.devicePixelRatio` | Override via `Object.defineProperty` in test setup |
| `sessionStorage` | `jest-localstorage-mock` or equivalent |
| `webglcontextlost` event | Dispatch synthetic `Event` on canvas element |

### Unit Test Focus Areas

- Audio gate show/dismiss flow (sound-on and sound-off paths)
- Session storage preference bypass on subsequent visits
- Arrival state blocking (forward movement at terminal edge)
- WebGL context-loss event wiring and recovery call sequence
- Quality HUD toggle accessibility (rendered and keyboard-reachable)
- Manifest load failure error UI
- Asset fallback from `.webp` to `.png`

### Integration / End-to-End Test Focus Areas

- Full journey traversal from departure to arrival in a headless browser (Playwright)
- Audio context unlock on mobile viewport simulation
- Frame rate benchmark under Default Quality (performance.now sampling)
