/**
 * NpcSystem — Stage D
 *
 * Manifest-driven ambient actors.  Each segment can declare an `npcs` array;
 * this module reads it and runs the actors while that segment is visible.
 *
 * Three actor types:
 *   walker    — uses the same CyclistRig hierarchy, tuned for walking
 *   swimmer   — follows a path, bobs vertically
 *   doorCycle — scales a door element's X to fake a swing on its hinge
 *
 * All walkers/swimmers reuse CyclistRig (same joints, different amplitude/
 * timing) — no second character system.
 *
 * Actor instances live in a world-space container that scrolls with the
 * foreground layer (1.0× parallax) — the NpcSystem container.x is set by
 * the caller each frame to `-worldPosition * 1.0`.
 */

import * as PIXI from "pixi.js";
import type { NpcDescriptor, SegmentDescriptor } from "@/types/journey";
import { CyclistRig } from "@/modules/CyclistRig";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WalkerActor {
  kind: "walker";
  rig: CyclistRig;
  descriptor: NpcDescriptor;
  x: number;
  dir: 1 | -1;
}

interface SwimmerActor {
  kind: "swimmer";
  rig: CyclistRig;
  descriptor: NpcDescriptor;
  pathIndex: number;
  t: number;          // interpolation 0…1 between path[pathIndex] and path[pathIndex+1]
  container: PIXI.Container;
}

interface DoorActor {
  kind: "doorCycle";
  descriptor: NpcDescriptor;
  graphics: PIXI.Graphics;
  elapsed: number;
}

type AnyActor = WalkerActor | SwimmerActor | DoorActor;

// ---------------------------------------------------------------------------
// NpcSystem
// ---------------------------------------------------------------------------

export class NpcSystem {
  private readonly _worldContainer: PIXI.Container;
  private _actors: AnyActor[] = [];

  constructor() {
    this._worldContainer = new PIXI.Container();
  }

  /** Add to stage at the foreground layer z-index. */
  get container(): PIXI.Container {
    return this._worldContainer;
  }

  /**
   * Replace the active NPC set with the actors declared on a new segment.
   * Call this when JourneyController detects a segment change.
   */
  loadSegment(descriptor: SegmentDescriptor, groundY: number): void {
    // Tear down previous actors
    for (const actor of this._actors) {
      if (actor.kind === "walker" || actor.kind === "swimmer") {
        this._worldContainer.removeChild(actor.rig.parts.root);
      } else {
        this._worldContainer.removeChild(actor.graphics);
      }
    }
    this._actors = [];

    if (!descriptor.npcs || descriptor.npcs.length === 0) return;

    for (const npc of descriptor.npcs) {
      this._spawnActor(npc, descriptor.widthPx, groundY, descriptor.index);
    }
  }

  /**
   * Advance all actors by one frame.
   * @param dt           Elapsed seconds.
   * @param worldPosition Current world position (for scrolling container).
   * @param segmentWorldX World X of the current segment's left edge.
   */
  update(dt: number, worldPosition: number, segmentWorldX: number): void {
    // Scroll the container at 1.0× with the foreground
    this._worldContainer.x = segmentWorldX - worldPosition;

    for (const actor of this._actors) {
      if (actor.kind === "walker") {
        this._tickWalker(actor, dt);
      } else if (actor.kind === "swimmer") {
        this._tickSwimmer(actor, dt);
      } else {
        this._tickDoor(actor, dt);
      }
    }
  }

  destroy(): void {
    this._worldContainer.destroy({ children: true });
  }

  // ── Spawn ────────────────────────────────────────────────────────────────

  private _spawnActor(
    npc: NpcDescriptor,
    _segWidthPx: number,
    groundY: number,
    _segIndex: number,
  ): void {
    switch (npc.type) {
      case "walker": {
        const rig = new CyclistRig();
        // Scale down for NPC (smaller than player)
        rig.parts.root.scale.set(0.9);
        rig.parts.root.position.set(npc.startX ?? 200, groundY);
        // Hide wheels for walker
        rig.parts.frontWheel.visible = false;
        rig.parts.backWheel.visible  = false;
        this._worldContainer.addChild(rig.parts.root);
        this._actors.push({
          kind: "walker",
          rig,
          descriptor: npc,
          x: npc.startX ?? 200,
          dir: 1,
        });
        break;
      }

      case "swimmer": {
        if (!npc.path || npc.path.length < 2) break;
        const rig = new CyclistRig();
        rig.parts.root.scale.set(0.8);
        // Swimmers lean forward more
        rig.parts.torso.rotation = 0.4;
        const [sx, sy] = npc.path[0];
        rig.parts.root.position.set(sx, sy);
        this._worldContainer.addChild(rig.parts.root);
        this._actors.push({
          kind: "swimmer",
          rig,
          descriptor: npc,
          container: rig.parts.root,
          pathIndex: 0,
          t: 0,
        });
        break;
      }

      case "doorCycle": {
        const g = new PIXI.Graphics();
        // Simple door rectangle
        g.rect(0, 0, 28, 52).fill(0x3a3530);
        g.rect(0, 0, 28, 52).stroke({ color: 0x1a1814, width: 2 });
        // Door knob
        g.circle(6, 28, 3).fill(0x6a6560);
        g.position.set(npc.doorX ?? 400, -52);
        this._worldContainer.addChild(g);
        this._actors.push({
          kind: "doorCycle",
          descriptor: npc,
          graphics: g,
          elapsed: 0,
        });
        break;
      }
    }
  }

  // ── Tick helpers ─────────────────────────────────────────────────────────

  private _tickWalker(actor: WalkerActor, dt: number): void {
    const speed  = actor.descriptor.speed ?? 40;
    actor.x     += actor.dir * speed * dt;

    const startX = actor.descriptor.startX ?? 0;
    const endX   = actor.descriptor.endX   ?? 600;

    if (actor.descriptor.loop === "pingpong") {
      if (actor.x >= endX)   { actor.x = endX;   actor.dir = -1; }
      if (actor.x <= startX) { actor.x = startX; actor.dir =  1; }
    } else {
      // wrap
      if (actor.dir > 0 && actor.x > endX)   actor.x = startX;
      if (actor.dir < 0 && actor.x < startX) actor.x = endX;
    }

    actor.rig.parts.root.x = actor.x;
    // Walking: legs swing but no wheel spin; flip sprite for direction
    actor.rig.parts.root.scale.x = actor.dir * 0.9;
    // Update rig with walking speed (lower than cycling)
    actor.rig.update(actor.dir * speed * 3, dt);
  }

  private _tickSwimmer(actor: SwimmerActor, dt: number): void {
    const path  = actor.descriptor.path!;
    const speed = actor.descriptor.speed ?? 30;

    const from = path[actor.pathIndex];
    const to   = path[(actor.pathIndex + 1) % path.length];

    const dx   = to[0] - from[0];
    const dy   = to[1] - from[1];
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

    actor.t += (speed / dist) * dt;

    if (actor.t >= 1) {
      actor.t -= 1;
      actor.pathIndex = (actor.pathIndex + 1) % path.length;
    }

    const tx = from[0] + dx * actor.t;
    const ty = from[1] + dy * actor.t;

    // Bob vertically
    actor.rig.parts.root.x = tx;
    actor.rig.parts.root.y = ty + Math.sin(actor.t * Math.PI * 4) * 4;

    actor.rig.update(speed * 2, dt);
  }

  private _tickDoor(actor: DoorActor, dt: number): void {
    const cycle = actor.descriptor.cycleSeconds ?? 8;
    actor.elapsed = (actor.elapsed + dt) % cycle;

    // Fake hinge swing: scale X from 1 → 0.15 → 1 over half the cycle
    // Open during first 40%, hold 20%, close 40%
    let scaleX: number;
    const openEnd    = cycle * 0.4;
    const closeStart = cycle * 0.6;

    if (actor.elapsed < openEnd) {
      scaleX = 1 - (actor.elapsed / openEnd) * 0.82;
    } else if (actor.elapsed < closeStart) {
      scaleX = 0.18;
    } else {
      scaleX = 0.18 + ((actor.elapsed - closeStart) / (cycle * 0.4)) * 0.82;
    }

    actor.graphics.scale.x = Math.max(0.08, scaleX);
  }
}
