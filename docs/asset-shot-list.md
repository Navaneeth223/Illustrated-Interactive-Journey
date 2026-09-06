# Asset Shot List — Illustrated Interactive Journey
## The single source of truth for "what do I still need to make"

Everything across Phases 1–4. Nothing gets generated twice, nothing gets missed.
Items marked ✓ CODE are produced by the codebase and need no external asset.

---

## Character rig pieces (~8 pieces, generated once)

Reused for the player **and** every NPC via recolor/rescale.
Do not regenerate per-NPC — the `CyclistRig` system handles reuse.

| Piece | Pivot point | Notes |
|-------|-------------|-------|
| torso | hip | Leans with acceleration |
| head | neck | Counter-nods against torso |
| upper arm × 2 (front + back) | shoulder | Subtle counter-swing |
| lower arm × 2 (front + back) | elbow | |
| upper leg × 2 (front + back) | hip | Distance-driven pedal |
| lower leg × 2 (front + back) | knee | |

**Style:** achromatic graphite, transparent background, pivot at joint,
~100–200px tall at 1× DPR. Same paper style as the segment illustrations.

---

## Per-segment art layers (5 layers × 13 segments = 65 files)

| # | Segment ID | Scene identity | Camera profile | Time of day | Terrain |
|---|------------|---------------|----------------|-------------|---------|
| 1 | seg-01-home | Suburban street, house silhouettes | default | day | normal |
| 2 | seg-02-open-road | Open road, telegraph poles | wide | day | normal |
| 3 | seg-03-mountains | Mountain approach, jagged peaks | wide | dawn | normal |
| 4 | seg-04-summit | Summit + downhill, dramatic drop | wide | day | normal |
| 5 | seg-05-village-beautiful | Beautiful village, church spire | wide | day | normal |
| 6 | seg-06-village-broken | Worn shacks, tilted structures | default | dusk | dusty |
| 7 | seg-07-boatyard | Boatyard, mast poles | default | dusk | normal |
| 8 | seg-08-water-crossing | Bridge/ferry over water | default | dusk | water |
| 9 | seg-09-other-shore | Far shore landing, gentle slope | default | dusk | normal |
| 10 | seg-10-train-stop | Station platform, clock tower | tight | night | normal |
| 11 | seg-11-canyon | Dark canyon walls, claustrophobic | tight | night | normal |
| 12 | seg-12-new-city | Dense city skyline | default | night | normal |
| 13 | seg-13-park | Park, rounded tree blobs | default | dawn | normal |

**Per segment, deliver:**
- `assets/segNN/sky.webp`    — sky layer (0.05× parallax)
- `assets/segNN/bg.webp`     — far background (0.15×)
- `assets/segNN/mg.webp`     — midground (0.35×)
- `assets/segNN/nmg.webp`    — near-midground (0.60×) — Default Quality only
- `assets/segNN/fg.webp`     — foreground (1.0×)
- `assets/segNN/bg@0.5x.webp` through `fg@0.5x.webp` — run `npm run generate:eco`

**Dimensions:** 2400–3200px wide (per manifest `widthPx`) × 600px tall.
**Left/right edges must be edge-matched** so any pair of adjacent segments joins seamlessly (myriorama design).
**Achromatic only** — grayscale, no colour. The pipeline applies desaturation anyway, but start grayscale.

---

## Foreground occlusion elements (a handful, reused)

Near-camera elements that render **above** the cyclist's z-index, making the
rider genuinely pass behind them. Only need enough variety to avoid visible repetition.

| Element | Suggested segments | Notes |
|---------|-------------------|-------|
| Wide tree trunk | seg-02, seg-04, seg-13 | Tall, dark vertical |
| Signpost | seg-01, seg-09, seg-10 | Readable or abstract text OK |
| Stone wall section | seg-03, seg-06 | Rough-edged |
| Dock piling | seg-07, seg-08 | Vertical rounded post |
| Canyon wall slab | seg-11 | Fills left or right edge |

**Format:** transparent-background PNG/WebP, same graphite style.
Place at `assets/occlusion/<name>.webp`.

---

## Sun / moon / stars (3 assets, generated once)

Reused every segment via `SunMoonActor`'s arc system.

| Asset | Notes |
|-------|-------|
| Sun | ~36px circle with 8 rays, warm off-white |
| Moon | ~30px crescent, cool grey |
| Star cluster | Scattered field, used as a single texture behind the moon |

**✓ CODE — currently drawn as PIXI.Graphics in `SunMoonActor.ts`.**
Replace with illustrated sprites by swapping `PIXI.Graphics` for `PIXI.Sprite` in `SunMoonActor._drawSun()` / `_drawMoon()` — no logic changes needed.

---

## Door states — zero new assets needed

✓ **CODE** — the door swing is faked by scaling `door.scale.x` from 1 → 0.18 → 1 in `NpcSystem._tickDoor()`. No art state needed.

---

## Particle / grain textures — zero new assets needed

✓ **CODE** — both procedurally generated:
- Dust puff: 10px circle Graphics in `DustSystem`
- Paper grain tile: 256×256 random-noise canvas in `PixiRenderer._generateGrainTexture()`

---

## Audio — ambient beds (~5–6 files, one per biome)

**Reuse across segments sharing a biome — do not record per-segment.**

| Biome key | Segments that use it | Description |
|-----------|---------------------|-------------|
| `suburb`   | seg-01 | Quiet street sounds, distant birds |
| `open`     | seg-02, seg-09 | Wind, distant traffic, occasional bird |
| `mountain` | seg-03, seg-04 | Wind, echo, sparse bird calls |
| `village`  | seg-05, seg-06 | Village ambience, light wind |
| `water`    | seg-07, seg-08 | Water lapping, boat creak, wind |
| `train`    | seg-10 | Station PA, distant train, platform feet |
| `canyon`   | seg-11 | Hollow wind, echo, no birds |
| `city`     | seg-12 | Traffic, crowd hum, distant horns |
| `park`     | seg-13 | Soft wind, birds, water feature |

**Format:** 60–120s loopable `.mp3`, seamless loop point.
**Delivery path:** `assets/audio/<biome-key>-ambient.mp3`

Update `journey.manifest.json` to reference the biome file instead of the
per-segment stub — multiple segments point to the same file.

---

## Audio — event one-shots (5 files)

| Event key | Trigger | Duration | Notes |
|-----------|---------|----------|-------|
| `door-creak` | `doorCycle` NPC reaches door position | ~0.8s | Wood creak, subtle |
| `splash` | Entering `terrain: "water"` segment | ~0.5s | Single drop/entry sound |
| `surface-dusty` | Entering `terrain: "dusty"` segment | ~0.4s | Gravel/dirt texture shift |
| `breakdown` | Train breakdown camera-shake trigger | ~1.5s | Mechanical thud/groan |
| `reunion-swell` | `playReunionSequence()` | ~30s | Warmest track in the project; soft, swelling |

**Format:** `.mp3`, triggered via `SoundEventBus.fire(event)`.
**Delivery path:** `assets/audio/sfx/<event-key>.mp3`

**✓ STUB** — silent placeholder `.mp3` files should be created at these
paths so the bus doesn't 404. Run:

```bash
# From project root — copies the silent stub as a placeholder
for name in door-creak splash surface-dusty breakdown reunion-swell; do
  cp public/assets/audio/seg01.mp3 public/assets/audio/sfx/$name.mp3
done
```

---

## Summary: what's left to make

| Category | Count | Status |
|----------|-------|--------|
| Character rig pieces | 8 | ⬜ Not made |
| Segment illustration layers | 65 (5 × 13) | ⬜ Stubs only |
| Foreground occlusion elements | ~5 | ⬜ Not made |
| Sun/moon/stars | 3 | ✓ CODE (Graphics) |
| Door states | 0 | ✓ CODE |
| Dust / grain textures | 0 | ✓ CODE |
| Ambient audio beds | ~9 biomes | ⬜ Silent stubs |
| Event one-shots | 5 | ⬜ Silent stubs |

The two ✓ CODE rows with no corresponding ⬜ are the payoff of building
code-first: the grain, dust, doors, sun, and moon are fully alive in the
running app before a single illustration asset is delivered.
