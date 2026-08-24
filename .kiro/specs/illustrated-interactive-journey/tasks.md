# Implementation Plan: Illustrated Interactive Journey

## Overview

Implement a finite, scroll-based WebGL 2D experience using PixiJS, GSAP, and Howler.js. The rider traverses 5–8 illustrated scene segments by holding an input to accelerate and releasing to coast. The implementation is divided into nine modules built incrementally, with each module wired into `JourneyController` before moving to the next. All 22 correctness properties are covered by fast-check property tests co-located with their respective modules.

---

## Tasks

- [x] 1. Project scaffold and shared types
  - [x] 1.1 Initialise TypeScript project with Vite, install PixiJS, GSAP, Howler.js, and fast-check
    - Create `vite.config.ts`, `tsconfig.json`, and `package.json` with exact pinned versions
    - Add `src/`, `src/types/`, `src/modules/`, `src/tests/` directory structure
    - Configure path aliases (`@/` → `src/`)
    - _Requirements: 9.1_

  - [x] 1.2 Author all shared TypeScript interfaces and the manifest loader
    - Write `SegmentDescriptor`, `JourneyManifest`, `JourneyState`, `SegmentInstance` interfaces in `src/types/journey.ts`
    - Write `loadManifest(url: string): Promise<JourneyManifest>` in `src/manifest.ts` with fetch error handling and retry-once logic
    - Write blocking error UI displayed on manifest load failure
    - _Requirements: 1.1, 1.2, 9.1_

  - [x] 1.3 Write `App` bootstrap: mount PixiJS canvas, wire WebGL context-loss events
    - Create `src/App.ts` — instantiate `PIXI.Application`, append canvas to DOM
    - Listen for `webglcontextlost` / `webglcontextrestored` on the canvas element and call the recovery stubs defined in `JourneyController`
    - _Requirements: 9.1, 9.5_

- [x] 2. Input normalisation
  - [x] 2.1 Implement `InputController` — normalise mouse, touch, and keyboard to `holdStart`/`holdEnd`
    - Create `src/modules/InputController.ts` as a typed `EventEmitter`
    - Wire `mousedown`/`mouseup`, `touchstart`/`touchend` (with `preventDefault`), and `keydown`/`keyup` (Space, ArrowRight, no-repeat guard) on the canvas or window
    - _Requirements: 4.5_

  - [x] 2.2 Write unit tests for `InputController`
    - Test that each input device emits exactly one `holdStart` per press and one `holdEnd` per release
    - Test `keydown` repeat suppression
    - _Requirements: 4.5_

- [x] 3. `VelocityModel` — GSAP-driven acceleration and coasting
  - [x] 3.1 Implement `VelocityModel` class
    - Create `src/modules/VelocityModel.ts`
    - `startHold()` → `gsap.to(this._state, { velocity: maxVelocity, duration: accelerationDuration, ease: "power2.inOut", overwrite: true })`
    - `releaseHold()` → `gsap.to(this._state, { velocity: 0, duration: decelerationDuration, ease: "power2.inOut", overwrite: true })`
    - `tick(dt)` → `worldPosition += velocity * dt`; emit `positionUpdate`
    - Clamp `worldPosition` at `terminalEdge` in `tick()`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 1.3_

  - [x] 3.2 Write property test — Property 8: velocity accelerates monotonically on hold
    - **Property 8: Velocity accelerates monotonically on hold**
    - **Validates: Requirements 4.1**
    - Use a synchronous GSAP stub that steps velocity incrementally; assert `velocity[t+1] >= velocity[t]` for all ticks while holding
    - _Requirements: 4.1_

  - [x] 3.3 Write property test — Property 9: velocity decelerates monotonically on release
    - **Property 9: Velocity decelerates monotonically on release**
    - **Validates: Requirements 4.2, 4.3**
    - Assert `velocity[t+1] <= velocity[t]` for all ticks after `releaseHold()` until velocity reaches 0
    - _Requirements: 4.2, 4.3_

  - [x] 3.4 Write property test — Property 10: no instantaneous velocity discontinuity
    - **Property 10: No instantaneous velocity discontinuity**
    - **Validates: Requirements 4.4**
    - For any transition tick, assert `|velocity[t+1] - velocity[t]| <= maxVelocity * dt / minTweenDuration`
    - _Requirements: 4.4_

  - [x] 3.5 Write property test — Property 1: arrival halts forward movement
    - **Property 1: Arrival halts forward movement**
    - **Validates: Requirements 1.3**
    - For any `worldPosition >= terminalEdge`, call `startHold()` + `tick(dt)` and assert `worldPosition` does not exceed `terminalEdge`
    - _Requirements: 1.3_

  - [x] 3.6 Write property test — Property 2: intermediate positions allow forward movement
    - **Property 2: Intermediate positions allow forward movement**
    - **Validates: Requirements 1.4**
    - For any `worldPosition` strictly between 0 and `terminalEdge`, with hold active, assert `worldPosition` strictly increases after `tick(dt)`
    - _Requirements: 1.4_

- [x] 4. Checkpoint — velocity model
  - Ensure `VelocityModel` unit and property tests pass. Ask the user if any behaviour feels off.

- [x] 5. `MyrioramaSequencer` — segment loading, positioning, and recycling
  - [x] 5.1 Implement `MyrioramaSequencer` class with edge-match positioning
    - Create `src/modules/MyrioramaSequencer.ts`
    - On construction, assign `worldX` values: `segments[0].worldX = 0`; `segments[i+1].worldX = segments[i].worldX + segments[i].descriptor.widthPx`
    - Expose `activeSegments`, `totalWorldWidth`, `isAtArrival`
    - _Requirements: 2.1, 2.4_

  - [x] 5.2 Implement lookahead load trigger
    - In `update(worldPosition)`, check `worldPosition + viewportWidth + nextSegment.widthPx >= nextSegment.worldX` and call async load for next unloaded segment
    - Retry-once on load failure; log warning on second failure and skip segment
    - _Requirements: 2.3_

  - [x] 5.3 Implement off-screen segment recycle
    - In `update()`, for each loaded segment where `worldX + widthPx < worldPosition - viewportWidth`, call `segment.container.destroy({ children: true })` and set `recycled = true`
    - _Requirements: 2.2_

  - [x] 5.4 Write property test — Property 3: edge-match invariant
    - **Property 3: Edge-match invariant**
    - **Validates: Requirements 2.1, 2.4**
    - For any array of `n` `SegmentDescriptor` objects with arbitrary `widthPx` values (generated by fast-check), assert that after sequencer construction `segments[i+1].worldX === segments[i].worldX + segments[i].descriptor.widthPx` for all `i` in `[0, n-2]`
    - _Requirements: 2.1, 2.4_

  - [x] 5.5 Write property test — Property 4: off-screen segments are recycled
    - **Property 4: Off-screen segments are recycled**
    - **Validates: Requirements 2.2**
    - For any segment whose `worldX + widthPx < worldPosition - viewportWidth`, after calling `update()`, assert `segment.recycled === true` and `container` is destroyed
    - _Requirements: 2.2_

  - [x] 5.6 Write property test — Property 5: lookahead triggers segment load
    - **Property 5: Lookahead triggers segment load**
    - **Validates: Requirements 2.3**
    - For any unloaded segment `S` and `worldPosition` satisfying the lookahead condition, assert that a load is initiated before `S.worldX` enters the viewport
    - _Requirements: 2.3_

- [x] 6. Checkpoint — sequencer
  - Ensure sequencer property tests pass. Confirm edge-match correctness with the user.

- [x] 7. `PixiRenderer` — parallax layers and post-process pipeline
  - [x] 7.1 Implement `PixiRenderer` class — layer containers and parallax positioning
    - Create `src/modules/PixiRenderer.ts`
    - Create `bgContainer`, `mgContainer`, `fgContainer` as `PIXI.Container` children of `app.stage`
    - In `render(worldPosition, segments)`, apply `bgContainer.x = -worldPosition * 0.15`, `mgContainer.x = -worldPosition * 0.45`, `fgContainer.x = -worldPosition * 1.00`
    - Add each `SegmentInstance`'s bg/mg/fg sprites to the corresponding containers
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 7.2 Implement post-process pipeline — grain, grayscale, vignette
    - Append grain `PIXI.Sprite` with `blendMode = PIXI.BLEND_MODES.MULTIPLY` and `alpha` clamped to `[0.08, 0.12]` after all layer containers
    - Apply `PIXI.filters.ColorMatrixFilter` (full desaturation) to `app.stage.filters`
    - Author vignette shader as a custom `PIXI.Filter` and add to `app.stage.filters` after the grayscale filter
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 7.3 Implement `setQualityMode()` — Eco/Default switching
    - Default mode: `renderer.resolution = Math.min(devicePixelRatio, nativeDPR)`, grain visible, full-res textures
    - Eco mode: `renderer.resolution = 1`, grain hidden, load `@0.5x` suffixed texture URLs
    - Call `app.renderer.resize()` after resolution change
    - Expose `appliedDPR` getter
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.7_

  - [x] 7.4 Write property test — Property 6: parallax multipliers are correct
    - **Property 6: Parallax multipliers are correct for all layer types**
    - **Validates: Requirements 3.1, 3.2, 3.3**
    - For any `worldPosition` (integer or float, generated by fast-check), call `render()` on a stub renderer and assert all three container `x` values exactly
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 7.5 Write property test — Property 7: layer depth order is never reversed
    - **Property 7: Layer depth order is never reversed**
    - **Validates: Requirements 3.5**
    - For any scene state, assert that the child index of `bgContainer` < `mgContainer` < `fgContainer` in `app.stage.children`
    - _Requirements: 3.5_

  - [x] 7.6 Write property test — Property 11: grain overlay opacity is always in spec
    - **Property 11: Grain overlay opacity is always in spec under Default Quality**
    - **Validates: Requirements 5.1, 5.4**
    - For any number of render calls under Default Quality, assert `0.08 <= grainSprite.alpha <= 0.12` and `grainSprite.blendMode === PIXI.BLEND_MODES.MULTIPLY`
    - _Requirements: 5.1, 5.4_

  - [x] 7.7 Write property test — Property 12: grayscale filter applied to all scene layers
    - **Property 12: Grayscale filter is applied to all scene layers**
    - **Validates: Requirements 5.2**
    - Assert that `app.stage.filters` contains a `ColorMatrixFilter` after `render()` is called with any set of segments
    - _Requirements: 5.2_

  - [x] 7.8 Write property test — Property 13: post-process pipeline order
    - **Property 13: Post-process pipeline order**
    - **Validates: Requirements 5.5**
    - Instrument render call order tracking; assert grain/grayscale/vignette steps are appended after all segment layer sprites in the draw order
    - _Requirements: 5.5_

  - [x] 7.9 Write property test — Property 14: Eco Quality halves texture dimensions
    - **Property 14: Eco Quality halves texture dimensions**
    - **Validates: Requirements 6.2**
    - For any `SegmentDescriptor` with arbitrary `widthPx`/`heightPx`, assert that textures loaded in Eco mode have dimensions `Math.floor(w/2)` × `Math.floor(h/2)`
    - _Requirements: 6.2_

  - [x] 7.10 Write property test — Property 15: Eco Quality caps DPR at 1
    - **Property 15: Eco Quality caps device pixel ratio at 1**
    - **Validates: Requirements 6.4**
    - For any physical `dpr >= 1` (generated by fast-check), assert `renderer.resolution === 1` when Eco mode is active
    - _Requirements: 6.4_

  - [x] 7.11 Write property test — Property 16: Eco → Default round trip restores full state
    - **Property 16: Eco → Default round trip restores full state**
    - **Validates: Requirements 6.5**
    - Snapshot renderer state under Default, switch to Eco, switch back to Default; assert `renderer.resolution`, `grainSprite.visible`, and texture dimensions match the snapshot
    - _Requirements: 6.5_

  - [x] 7.12 Write property test — Property 21: DPR at initialisation respects quality cap
    - **Property 21: DPR at initialisation respects quality cap**
    - **Validates: Requirements 9.3**
    - For any `dpr` and quality mode, assert `renderer.resolution === Math.min(dpr, qualityCap(mode))` immediately after `PixiRenderer` construction
    - _Requirements: 9.3_

- [x] 8. Checkpoint — renderer
  - Ensure all renderer property tests pass. Confirm grain/vignette appearance with the user.

- [x] 9. `AudioController` — Howler track pool, crossfade, and volume management
  - [x] 9.1 Implement `AudioController` class — Howler track pool and `transitionToSegment()`
    - Create `src/modules/AudioController.ts`
    - Pre-instantiate one Howler instance per segment track from the manifest, configured for `loop: true`
    - Implement crossfade: `outgoing.fade(vol, 0, ms)`, `incoming.play()`, `incoming.fade(0, targetVol, ms)`, `setTimeout(outgoing.stop, ms)`
    - Clamp crossfade duration to `<= 2000 ms`
    - _Requirements: 8.1, 8.2_

  - [x] 9.2 Implement `setMotionState()` — idle/motion volume via GSAP
    - `gsap.to(currentTrack, { volume: isMoving ? motionVolume : idleVolume, duration: 0.4 })`
    - Guard against mutation when `soundEnabled === false`
    - _Requirements: 8.3, 8.4_

  - [x] 9.3 Implement `setSoundEnabled()` — global mute and play guard
    - When `false`: fade all tracks to 0, mark internal flag; suppress new `.play()` calls
    - When `true`: restore volume, allow playback
    - _Requirements: 8.5_

  - [x] 9.4 Write property test — Property 17: ambient track matches current segment
    - **Property 17: Ambient track matches current segment**
    - **Validates: Requirements 8.1**
    - For any segment index with `soundEnabled = true` and `velocity > 0`, assert the playing Howler stub corresponds to `segments[i].audioTrack` and is in `playing + loop` state
    - _Requirements: 8.1_

  - [x] 9.5 Write property test — Property 18: crossfade duration never exceeds 2 seconds
    - **Property 18: Crossfade duration never exceeds 2 seconds**
    - **Validates: Requirements 8.2**
    - For any pair of adjacent segments, assert that the duration passed to `fade()` is `<= 2000 ms`
    - _Requirements: 8.2_

  - [x] 9.6 Write property test — Property 19: idle/motion volume round trip
    - **Property 19: Idle/motion volume round trip**
    - **Validates: Requirements 8.3, 8.4**
    - For any sequence of idle→motion→idle transitions (generated by fast-check), assert volume equals `idleVolume` at idle, `motionVolume` during motion, and all intermediate values lie strictly between them
    - _Requirements: 8.3, 8.4_

  - [x] 9.7 Write property test — Property 20: sound-disabled state silences all output
    - **Property 20: Sound-disabled state silences all output**
    - **Validates: Requirements 8.5**
    - For any journey state with `soundEnabled = false`, assert all Howler stub volumes are 0 and no `.play()` was called
    - _Requirements: 8.5_

- [x] 10. `AudioGate` — blocking overlay and session preference
  - [x] 10.1 Implement `AudioGate` class — overlay UI, choice resolution, and `Howler.ctx.resume()`
    - Create `src/modules/AudioGate.ts`
    - Render blocking overlay with "Enable sound" and "Continue without sound" buttons
    - On "Enable sound" click: call `await Howler.ctx.resume()` synchronously within the gesture handler; resolve promise with `"sound-on"`
    - On skip click: resolve with `"sound-off"`
    - If `Howler.ctx.resume()` throws, silently resolve with `"sound-off"` (no re-display of gate)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 10.2 Implement session storage preference bypass
    - `static getStoredPreference()` reads key `"ijj-audio-preference"` from `sessionStorage`
    - `static storePreference(choice)` writes the choice
    - `show()` returns stored preference immediately if present, skipping the overlay
    - _Requirements: 7.6_

  - [x] 10.3 Write unit tests for `AudioGate`
    - Test show/dismiss flow for both sound-on and sound-off paths
    - Test session storage bypass on subsequent calls
    - Test silent failure path when audio context activation throws
    - _Requirements: 7.3, 7.4, 7.5, 7.6_

- [x] 11. `QualityHUD` — toggle UI wired to `PixiRenderer`
  - [x] 11.1 Implement `QualityHUD` component — accessible toggle button
    - Create `src/modules/QualityHUD.ts`
    - Render a `<button>` with `aria-pressed` attribute reflecting current quality mode
    - On click, call `pixiRenderer.setQualityMode(newMode)` and update `JourneyState.qualityMode`
    - Ensure button is keyboard-reachable (focusable, Enter/Space activates)
    - _Requirements: 6.6, 6.7_

  - [x] 11.2 Write unit tests for `QualityHUD`
    - Test that clicking toggles `aria-pressed` and calls `setQualityMode` with the correct mode
    - Test keyboard activation via Enter and Space keys
    - _Requirements: 6.6, 6.7_

- [x] 12. `JourneyController` — state machine, wiring, and WebGL recovery
  - [x] 12.1 Implement `JourneyController` state machine (`gate → travelling → arrived`)
    - Create `src/modules/JourneyController.ts`
    - On `AudioGate` resolution: transition to `travelling`, unlock input, show canvas
    - On each rAF tick: call `VelocityModel.tick(dt)`, `MyrioramaSequencer.update(worldPosition)`, `PixiRenderer.render(worldPosition, activeSegments)`, `AudioController.setMotionState(velocity > 0)`
    - When `MyrioramaSequencer.isAtArrival`: transition to `arrived`, call `VelocityModel.releaseHold()`, show `ArrivalScreen`, block input
    - Subscribe `InputController` `holdStart`/`holdEnd` to `VelocityModel.startHold()`/`releaseHold()` only in `travelling` phase
    - _Requirements: 1.2, 1.3, 1.4, 4.1, 4.2_

  - [x] 12.2 Implement `seekTo(pos)` and WebGL context-loss recovery
    - `seekTo(pos)` sets `VelocityModel._state.worldPosition = pos`, calls `PixiRenderer.render(pos, activeSegments)`, and re-syncs audio to the current segment
    - Wire `webglcontextlost` → save `worldPosition`, set `_contextLost = true`
    - Wire `webglcontextrestored` → `app.renderer.reset()`, `sequencer.forceReloadAll()`, `seekTo(savedPosition)`
    - _Requirements: 9.5_

  - [x] 12.3 Write property test — Property 22: WebGL context loss preserves journey position
    - **Property 22: WebGL context loss preserves journey position**
    - **Validates: Requirements 9.5**
    - For any `worldPosition`, dispatch a synthetic `webglcontextlost` event, trigger restore, assert `journeyController.worldPosition` equals the position at time of loss
    - _Requirements: 9.5_

  - [x] 12.4 Write unit tests for `JourneyController`
    - Test `gate → travelling` transition on AudioGate resolution
    - Test `travelling → arrived` transition when `isAtArrival` becomes true
    - Test that input events are ignored in `gate` and `arrived` phases
    - _Requirements: 1.2, 1.3_

- [x] 13. `ArrivalScreen` — terminal state UI
  - [x] 13.1 Implement `ArrivalScreen` — display arrival overlay and block input
    - Create `src/modules/ArrivalScreen.ts`
    - Render arrival overlay (title, message, or illustration) when `show()` is called by `JourneyController`
    - Ensure no further `holdStart` events reach `VelocityModel` once the screen is shown
    - _Requirements: 1.3_

- [x] 14. Asset pipeline and `.webp` fallback
  - [x] 14.1 Configure PixiJS asset loader with `.webp` → `.png` fallback
    - Add a PIXI `loadParser` that rewrites URLs from `.webp` to `.png` when `webp` is not supported
    - Test fallback logic with a mock loader
    - _Requirements: 9.1_

  - [x] 14.2 Scaffold Eco Quality `@0.5x` texture stubs for development
    - Create placeholder `@0.5x` texture files at `assets/seg*/bg@0.5x.webp` etc. so the dev build resolves
    - Document the build-time generation step for production assets
    - _Requirements: 6.2_

- [x] 15. Final checkpoint — full integration
  - Wire `App.ts` to instantiate all modules and call `JourneyController.start()`
  - Run the full test suite — all unit tests and property tests must pass
  - Verify rAF loop runs at target 60 fps under Default Quality in a Chromium headless browser
  - Ensure all tests pass and ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP delivery
- Each task references specific requirements for traceability
- All 22 correctness properties from the design document are covered by property test sub-tasks
- fast-check is used for all property-based tests; GSAP, PIXI, and Howler are stubbed as described in the design's testing strategy
- Checkpoints (tasks 4, 6, 8, 15) are integration gates — do not proceed to the next module group until they pass
- The `@0.5x` eco textures must be generated at build time; task 14.2 creates development placeholders only

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2", "3.1"] },
    { "id": 4, "tasks": ["3.2", "3.3", "3.4", "3.5", "3.6"] },
    { "id": 5, "tasks": ["5.1"] },
    { "id": 6, "tasks": ["5.2", "5.3"] },
    { "id": 7, "tasks": ["5.4", "5.5", "5.6", "7.1"] },
    { "id": 8, "tasks": ["7.2"] },
    { "id": 9, "tasks": ["7.3", "9.1"] },
    { "id": 10, "tasks": ["7.4", "7.5", "7.6", "7.7", "7.8", "7.9", "7.10", "7.11", "7.12", "9.2"] },
    { "id": 11, "tasks": ["9.3", "10.1"] },
    { "id": 12, "tasks": ["9.4", "9.5", "9.6", "9.7", "10.2", "11.1"] },
    { "id": 13, "tasks": ["10.3", "11.2", "12.1", "14.1"] },
    { "id": 14, "tasks": ["12.2", "13.1", "14.2"] },
    { "id": 15, "tasks": ["12.3", "12.4"] }
  ]
}
```
