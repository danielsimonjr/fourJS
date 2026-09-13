# fourjs-monorepo - Dependency Graph

<<<<<<< HEAD
**Version**: 0.0.0 | **Last Updated**: 2026-09-13
=======
**Version**: 0.0.0 | **Last Updated**: 2026-09-11
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

This document provides a comprehensive dependency graph of all files, components, imports, functions, and variables in the codebase.

---

## Table of Contents

1. [Overview](#overview)
2. [Package Dependencies](#package-dependencies)
<<<<<<< HEAD
3. [Packages/animation Dependencies](#packages-animation-dependencies)
4. [Packages/assets Dependencies](#packages-assets-dependencies)
5. [Packages/core Dependencies](#packages-core-dependencies)
6. [Packages/diagnostics Dependencies](#packages-diagnostics-dependencies)
7. [Packages/fourjs Dependencies](#packages-fourjs-dependencies)
8. [Packages/geometry Dependencies](#packages-geometry-dependencies)
9. [Packages/input Dependencies](#packages-input-dependencies)
10. [Packages/materials Dependencies](#packages-materials-dependencies)
11. [Packages/math Dependencies](#packages-math-dependencies)
12. [Packages/motion Dependencies](#packages-motion-dependencies)
13. [Packages/particles Dependencies](#packages-particles-dependencies)
14. [Packages/physics Dependencies](#packages-physics-dependencies)
15. [Packages/physics box2d Dependencies](#packages-physics-box2d-dependencies)
16. [Packages/physics rapier Dependencies](#packages-physics-rapier-dependencies)
17. [Packages/physics soft Dependencies](#packages-physics-soft-dependencies)
18. [Packages/render Dependencies](#packages-render-dependencies)
19. [Packages/render canvas Dependencies](#packages-render-canvas-dependencies)
20. [Packages/render svg Dependencies](#packages-render-svg-dependencies)
21. [Packages/render webgl Dependencies](#packages-render-webgl-dependencies)
22. [Packages/render webgpu Dependencies](#packages-render-webgpu-dependencies)
23. [Packages/scene Dependencies](#packages-scene-dependencies)
24. [Packages/serialization Dependencies](#packages-serialization-dependencies)
25. [Packages/text Dependencies](#packages-text-dependencies)
26. [Packages/ui Dependencies](#packages-ui-dependencies)
=======
3. [Packages/particles Dependencies](#packages-particles-dependencies)
4. [Packages/materials Dependencies](#packages-materials-dependencies)
5. [Packages/ui Dependencies](#packages-ui-dependencies)
6. [Packages/text Dependencies](#packages-text-dependencies)
7. [Packages/math Dependencies](#packages-math-dependencies)
8. [Packages/render svg Dependencies](#packages-render-svg-dependencies)
9. [Packages/physics box2d Dependencies](#packages-physics-box2d-dependencies)
10. [Packages/scene Dependencies](#packages-scene-dependencies)
11. [Packages/assets Dependencies](#packages-assets-dependencies)
12. [Packages/physics soft Dependencies](#packages-physics-soft-dependencies)
13. [Packages/physics rapier Dependencies](#packages-physics-rapier-dependencies)
14. [Packages/render webgl Dependencies](#packages-render-webgl-dependencies)
15. [Packages/physics Dependencies](#packages-physics-dependencies)
16. [Packages/geometry Dependencies](#packages-geometry-dependencies)
17. [Packages/render Dependencies](#packages-render-dependencies)
18. [Packages/input Dependencies](#packages-input-dependencies)
19. [Packages/render webgpu Dependencies](#packages-render-webgpu-dependencies)
20. [Packages/render canvas Dependencies](#packages-render-canvas-dependencies)
21. [Packages/motion Dependencies](#packages-motion-dependencies)
22. [Packages/animation Dependencies](#packages-animation-dependencies)
23. [Packages/diagnostics Dependencies](#packages-diagnostics-dependencies)
24. [Packages/core Dependencies](#packages-core-dependencies)
25. [Packages/fourjs Dependencies](#packages-fourjs-dependencies)
26. [Packages/serialization Dependencies](#packages-serialization-dependencies)
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd
27. [Dependency Matrix](#dependency-matrix)
28. [Circular Dependency Analysis](#circular-dependency-analysis)
29. [Visual Dependency Graph](#visual-dependency-graph)
30. [Summary Statistics](#summary-statistics)

---

<a id="overview"></a>
## Overview

The codebase is organized into the following modules:

<<<<<<< HEAD
- **packages/animation**: 14 files
- **packages/assets**: 13 files
- **packages/core**: 14 files
- **packages/diagnostics**: 12 files
- **packages/fourjs**: 35 files
- **packages/geometry**: 13 files
- **packages/input**: 9 files
- **packages/materials**: 17 files
- **packages/math**: 11 files
- **packages/motion**: 24 files
- **packages/particles**: 9 files
- **packages/physics**: 25 files
- **packages/physics-box2d**: 1 file
- **packages/physics-rapier**: 8 files
- **packages/physics-soft**: 1 file
- **packages/render**: 34 files
- **packages/render-canvas**: 1 file
- **packages/render-svg**: 1 file
- **packages/render-webgl**: 21 files
- **packages/render-webgpu**: 29 files
- **packages/scene**: 17 files
- **packages/serialization**: 5 files
- **packages/text**: 5 files
- **packages/ui**: 16 files
=======
- **packages/particles**: 9 files
- **packages/materials**: 14 files
- **packages/ui**: 16 files
- **packages/text**: 4 files
- **packages/math**: 11 files
- **packages/render-svg**: 1 file
- **packages/physics-box2d**: 1 file
- **packages/scene**: 17 files
- **packages/assets**: 9 files
- **packages/physics-soft**: 1 file
- **packages/physics-rapier**: 8 files
- **packages/render-webgl**: 24 files
- **packages/physics**: 25 files
- **packages/geometry**: 12 files
- **packages/render**: 30 files
- **packages/input**: 9 files
- **packages/render-webgpu**: 30 files
- **packages/render-canvas**: 1 file
- **packages/motion**: 22 files
- **packages/animation**: 14 files
- **packages/diagnostics**: 12 files
- **packages/core**: 14 files
- **packages/fourjs**: 35 files
- **packages/serialization**: 5 files
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

---

<a id="package-dependencies"></a>
## Package Dependencies

| Package | Depends On | Files (Active) | Files (Dormant) |
|---------|------------|----------------|-----------------|
<<<<<<< HEAD
| `@fourjs/animation` (`packages/animation/`) | `@fourjs/motion`, `@fourjs/core`, `@fourjs/scene`, `@fourjs/math` | 14 | 0 |
| `@fourjs/assets` (`packages/assets/`) | `@fourjs/core` | 13 | 0 |
| `@fourjs/core` (`packages/core/`) | (none) | 14 | 0 |
| `@fourjs/diagnostics` (`packages/diagnostics/`) | `@fourjs/core`, `@fourjs/math` | 12 | 1 |
| `fourJS` (`packages/fourjs/`) | `@fourjs/animation`, `@fourjs/core`, `@fourjs/diagnostics`, `@fourjs/geometry`, `@fourjs/motion`, `@fourjs/math`, `@fourjs/assets`, `@fourjs/physics`, `@fourjs/scene`, `@fourjs/render`, `@fourjs/materials`, `@fourjs/input`, `@fourjs/particles`, `@fourjs/physics-box2d`, `@fourjs/physics-rapier`, `@fourjs/physics-soft`, `@fourjs/serialization`, `@fourjs/ui`, `@fourjs/render-canvas`, `@fourjs/render-svg`, `@fourjs/render-webgl`, `@fourjs/render-webgpu`, `@fourjs/text` | 35 | 1 |
| `@fourjs/geometry` (`packages/geometry/`) | `@fourjs/math`, `@fourjs/core` | 13 | 0 |
| `@fourjs/input` (`packages/input/`) | `@fourjs/core`, `@fourjs/math`, `@fourjs/scene` | 9 | 0 |
| `@fourjs/materials` (`packages/materials/`) | `@fourjs/core`, `@fourjs/math` | 17 | 0 |
| `@fourjs/math` (`packages/math/`) | (none) | 11 | 0 |
| `@fourjs/motion` (`packages/motion/`) | `@fourjs/core`, `@fourjs/math`, `@fourjs/scene` | 24 | 0 |
| `@fourjs/particles` (`packages/particles/`) | `@fourjs/core`, `@fourjs/math`, `@fourjs/scene` | 9 | 0 |
| `@fourjs/physics` (`packages/physics/`) | `@fourjs/core`, `@fourjs/math`, `@fourjs/scene`, `@fourjs/motion` | 25 | 0 |
| `@fourjs/physics-box2d` (`packages/physics-box2d/`) | (none) | 1 | 0 |
| `@fourjs/physics-rapier` (`packages/physics-rapier/`) | `@fourjs/physics`, `@fourjs/core`, `@fourjs/math` | 8 | 0 |
| `@fourjs/physics-soft` (`packages/physics-soft/`) | (none) | 1 | 0 |
| `@fourjs/render` (`packages/render/`) | `@fourjs/geometry`, `@fourjs/materials`, `@fourjs/math`, `@fourjs/scene`, `@fourjs/core` | 34 | 0 |
| `@fourjs/render-canvas` (`packages/render-canvas/`) | (none) | 1 | 0 |
| `@fourjs/render-svg` (`packages/render-svg/`) | (none) | 1 | 0 |
| `@fourjs/render-webgl` (`packages/render-webgl/`) | `@fourjs/math`, `@fourjs/render`, `@fourjs/core` | 21 | 0 |
| `@fourjs/render-webgpu` (`packages/render-webgpu/`) | `@fourjs/render`, `@fourjs/core`, `@fourjs/math`, `@fourjs/scene` | 29 | 0 |
| `@fourjs/scene` (`packages/scene/`) | `@fourjs/core`, `@fourjs/math` | 17 | 0 |
| `@fourjs/serialization` (`packages/serialization/`) | `@fourjs/core`, `@fourjs/scene`, `@fourjs/math` | 5 | 0 |
| `@fourjs/text` (`packages/text/`) | `@fourjs/core` | 5 | 3 |
| `@fourjs/ui` (`packages/ui/`) | `@fourjs/core`, `@fourjs/scene`, `@fourjs/input`, `@fourjs/math`, `@fourjs/text` | 16 | 0 |
=======
| `@fourjs/particles` (`packages/particles/`) | `@fourjs/math`, `@fourjs/scene`, `@fourjs/core` | 9 | 0 |
| `@fourjs/materials` (`packages/materials/`) | `@fourjs/core`, `@fourjs/math` | 14 | 0 |
| `@fourjs/ui` (`packages/ui/`) | `@fourjs/math`, `@fourjs/text`, `@fourjs/input`, `@fourjs/scene`, `@fourjs/core` | 16 | 0 |
| `@fourjs/text` (`packages/text/`) | (none) | 4 | 0 |
| `@fourjs/math` (`packages/math/`) | (none) | 11 | 0 |
| `@fourjs/render-svg` (`packages/render-svg/`) | (none) | 1 | 0 |
| `@fourjs/physics-box2d` (`packages/physics-box2d/`) | (none) | 1 | 0 |
| `@fourjs/scene` (`packages/scene/`) | `@fourjs/math`, `@fourjs/core` | 17 | 0 |
| `@fourjs/assets` (`packages/assets/`) | `@fourjs/core` | 9 | 0 |
| `@fourjs/physics-soft` (`packages/physics-soft/`) | (none) | 1 | 0 |
| `@fourjs/physics-rapier` (`packages/physics-rapier/`) | `@fourjs/physics`, `@fourjs/core`, `@fourjs/math` | 8 | 0 |
| `@fourjs/render-webgl` (`packages/render-webgl/`) | `@fourjs/render`, `@fourjs/core`, `@fourjs/math` | 24 | 0 |
| `@fourjs/physics` (`packages/physics/`) | `@fourjs/core`, `@fourjs/math`, `@fourjs/motion`, `@fourjs/scene` | 25 | 0 |
| `@fourjs/geometry` (`packages/geometry/`) | `@fourjs/math`, `@fourjs/core` | 12 | 0 |
| `@fourjs/render` (`packages/render/`) | `@fourjs/math`, `@fourjs/materials`, `@fourjs/geometry`, `@fourjs/core`, `@fourjs/scene` | 30 | 0 |
| `@fourjs/input` (`packages/input/`) | `@fourjs/core`, `@fourjs/math`, `@fourjs/scene` | 9 | 0 |
| `@fourjs/render-webgpu` (`packages/render-webgpu/`) | `@fourjs/render`, `@fourjs/core`, `@fourjs/math`, `@fourjs/scene` | 30 | 0 |
| `@fourjs/render-canvas` (`packages/render-canvas/`) | (none) | 1 | 0 |
| `@fourjs/motion` (`packages/motion/`) | `@fourjs/math`, `@fourjs/scene`, `@fourjs/core` | 22 | 0 |
| `@fourjs/animation` (`packages/animation/`) | `@fourjs/core`, `@fourjs/math`, `@fourjs/scene`, `@fourjs/motion` | 14 | 0 |
| `@fourjs/diagnostics` (`packages/diagnostics/`) | `@fourjs/core`, `@fourjs/math` | 12 | 1 |
| `@fourjs/core` (`packages/core/`) | (none) | 14 | 0 |
| `fourJS` (`packages/fourjs/`) | `@fourjs/physics-box2d`, `@fourjs/assets`, `@fourjs/animation`, `@fourjs/core`, `@fourjs/geometry`, `@fourjs/materials`, `@fourjs/math`, `@fourjs/render`, `@fourjs/scene`, `@fourjs/diagnostics`, `@fourjs/motion`, `@fourjs/physics`, `@fourjs/serialization`, `@fourjs/ui`, `@fourjs/render-webgpu`, `@fourjs/render-svg`, `@fourjs/input`, `@fourjs/text`, `@fourjs/particles`, `@fourjs/physics-soft`, `@fourjs/render-canvas`, `@fourjs/render-webgl`, `@fourjs/physics-rapier` | 35 | 0 |
| `@fourjs/serialization` (`packages/serialization/`) | `@fourjs/core`, `@fourjs/scene`, `@fourjs/math` | 5 | 0 |
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd
| `@fourjs-tools/docs` (`tools/docs/`) | (none) | 0 | 0 |

### Package Dependency Diagram

```mermaid
graph LR
<<<<<<< HEAD
    P0[packages/animation]
    P1[packages/assets]
    P2[packages/core]
    P3[packages/diagnostics]
    P4[packages/fourjs]
    P5[packages/geometry]
    P6[packages/input]
    P7[packages/materials]
    P8[packages/math]
    P9[packages/motion]
    P10[packages/particles]
    P11[packages/physics]
    P12[packages/physics-box2d]
    P13[packages/physics-rapier]
    P14[packages/physics-soft]
    P15[packages/render]
    P16[packages/render-canvas]
    P17[packages/render-svg]
    P18[packages/render-webgl]
    P19[packages/render-webgpu]
    P20[packages/scene]
    P21[packages/serialization]
    P22[packages/text]
    P23[packages/ui]
    P24[tools/docs]
    P0 --> P9
    P0 --> P2
    P0 --> P20
    P0 --> P8
    P1 --> P2
    P3 --> P2
    P3 --> P8
    P4 --> P0
    P4 --> P2
    P4 --> P3
    P4 --> P5
    P4 --> P9
    P4 --> P8
    P4 --> P1
    P4 --> P11
    P4 --> P20
    P4 --> P15
    P4 --> P7
    P4 --> P6
    P4 --> P10
    P4 --> P12
    P4 --> P13
    P4 --> P14
    P4 --> P21
    P4 --> P23
    P4 --> P16
    P4 --> P17
    P4 --> P18
    P4 --> P19
    P4 --> P22
    P5 --> P8
    P5 --> P2
    P6 --> P2
    P6 --> P8
    P6 --> P20
    P7 --> P2
    P7 --> P8
    P9 --> P2
    P9 --> P8
    P9 --> P20
    P10 --> P2
    P10 --> P8
    P10 --> P20
    P11 --> P2
    P11 --> P8
    P11 --> P20
    P11 --> P9
    P13 --> P11
    P13 --> P2
    P13 --> P8
    P15 --> P5
    P15 --> P7
    P15 --> P8
    P15 --> P20
    P15 --> P2
    P18 --> P8
    P18 --> P15
    P18 --> P2
    P19 --> P15
    P19 --> P2
    P19 --> P8
    P19 --> P20
    P20 --> P2
    P20 --> P8
    P21 --> P2
    P21 --> P20
    P21 --> P8
    P22 --> P2
    P23 --> P2
    P23 --> P20
    P23 --> P6
    P23 --> P8
    P23 --> P22
=======
    P0[packages/particles]
    P1[packages/materials]
    P2[packages/ui]
    P3[packages/text]
    P4[packages/math]
    P5[packages/render-svg]
    P6[packages/physics-box2d]
    P7[packages/scene]
    P8[packages/assets]
    P9[packages/physics-soft]
    P10[packages/physics-rapier]
    P11[packages/render-webgl]
    P12[packages/physics]
    P13[packages/geometry]
    P14[packages/render]
    P15[packages/input]
    P16[packages/render-webgpu]
    P17[packages/render-canvas]
    P18[packages/motion]
    P19[packages/animation]
    P20[packages/diagnostics]
    P21[packages/core]
    P22[packages/fourjs]
    P23[packages/serialization]
    P24[tools/docs]
    P0 --> P4
    P0 --> P7
    P0 --> P21
    P1 --> P21
    P1 --> P4
    P2 --> P4
    P2 --> P3
    P2 --> P15
    P2 --> P7
    P2 --> P21
    P7 --> P4
    P7 --> P21
    P8 --> P21
    P10 --> P12
    P10 --> P21
    P10 --> P4
    P11 --> P14
    P11 --> P21
    P11 --> P4
    P12 --> P21
    P12 --> P4
    P12 --> P18
    P12 --> P7
    P13 --> P4
    P13 --> P21
    P14 --> P4
    P14 --> P1
    P14 --> P13
    P14 --> P21
    P14 --> P7
    P15 --> P21
    P15 --> P4
    P15 --> P7
    P16 --> P14
    P16 --> P21
    P16 --> P4
    P16 --> P7
    P18 --> P4
    P18 --> P7
    P18 --> P21
    P19 --> P21
    P19 --> P4
    P19 --> P7
    P19 --> P18
    P20 --> P21
    P20 --> P4
    P22 --> P6
    P22 --> P8
    P22 --> P19
    P22 --> P21
    P22 --> P13
    P22 --> P1
    P22 --> P4
    P22 --> P14
    P22 --> P7
    P22 --> P20
    P22 --> P18
    P22 --> P12
    P22 --> P23
    P22 --> P2
    P22 --> P16
    P22 --> P5
    P22 --> P15
    P22 --> P3
    P22 --> P0
    P22 --> P9
    P22 --> P17
    P22 --> P11
    P22 --> P10
    P23 --> P21
    P23 --> P7
    P23 --> P4
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd
```

---

<<<<<<< HEAD
<a id="packages-animation-dependencies"></a>

## Packages/animation Dependencies

### `packages/animation/src/animation-system.ts` - The fixed-step animation system (§39 step 3, plan decision P4-1).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/motion` | `PRIORITY_ANIMATION_TARGETS, FixedUpdateContext, SimulationSystem` |

**Exports:**
- Classes: `AnimationSystem`
- Interfaces: `Advanceable`, `AnimationSystemOptions`
- Types: `AnimationPlaybackState`

---

### `packages/animation/src/binding.ts` - Property bindings (§16).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./values.js` | `detectAdapter, numberAdapter, ValueAdapter` | Import |

**Exports:**
- Interfaces: `PropertyBinding`
- Functions: `createBinding`, `createArrayElementBinding`

---

### `packages/animation/src/blend-tree.ts` - Blend trees for {@link ./controller.js#AnimationController} (PH-9, §18).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./clip.js` | `AnimationClip` | Import (type-only) |

**Exports:**
- Interfaces: `BlendTree1DPoint`, `BlendTree2DPoint`, `BlendTree1D`, `BlendTree2D`, `Blend2DRank`
- Types: `BlendTree`
- Functions: `isBlendTree`, `locateBlend1D`, `locateBlend2D`

---

### `packages/animation/src/clip.ts` - Animation clips (§17).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./track.js` | `AnimationTrackLike` | Import (type-only) |

**Exports:**
- Classes: `AnimationClip`
- Interfaces: `AnimationEvent`, `TrackSampleSink`, `AnimationClipOptions`
- Types: `AnimationEventVisitor`

---

### `packages/animation/src/controller.ts` - §18 animation state machines — {@link AnimationController}.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/scene` | `Node, warnAuthorityConflict` |
| `@fourjs/scene` | `TransformAuthority` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./animation-system.js` | `Advanceable` | Import (type-only) |
| `./blend-tree.js` | `isBlendTree, locateBlend1D, locateBlend2D, Blend2DRank, BlendTree` | Import |
| `./binding.js` | `createBinding, PropertyBinding` | Import |
| `./clip.js` | `AnimationClip` | Import |
| `./mixer.js` | `AnimationEventListener` | Import (type-only) |
| `./track.js` | `AnimationTrackLike` | Import (type-only) |
| `./tween.js` | `claimProperty, isTransformOwner, releaseProperty, requireNonNegativeSeconds, PropertyClaim` | Import |
| `./values.js` | `detectAdapter, ValueAdapter` | Import |
| `./when.js` | `compileWhenExpression` | Import |
| `./blend-tree.js` | `BlendTree, BlendTree1D, BlendTree2D, BlendTree1DPoint, BlendTree2DPoint` | Re-export (type-only) |

**Exports:**
- Classes: `AnimationController`
- Interfaces: `AnimationStateOptions`, `NumericCondition`, `BooleanCondition`, `TriggerCondition`, `AnimationTransition`, `AnimationControllerParameters`, `AnimationControllerOptions`, `ControllerAdvanceOptions`
- Types: `ControllerPlaybackState`, `AnimationStateInput`, `NumericComparison`, `TransitionCondition`, `TransitionWhen`, `StateChangeListener`
- Constants: `ANY_STATE`
- Re-exports: `BlendTree`, `BlendTree1D`, `BlendTree2D`, `BlendTree1DPoint`, `BlendTree2DPoint`

---

### `packages/animation/src/easing.ts` - Easing functions (§15).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Exports:**
- Types: `EasingFunction`, `EasingName`
- Functions: `resolveEasing`
- Constants: `BACK_OVERSHOOT`, `BACK_OVERSHOOT_IN_OUT`, `BOUNCE_AMPLITUDE`, `BOUNCE_SEGMENT_DIVISOR`, `ELASTIC_AMPLITUDE`, `ELASTIC_PERIOD`, `ELASTIC_PERIOD_IN_OUT`, `SPRING_DAMPING_RATIO`, `SPRING_OSCILLATIONS`, `linear`, `quadraticIn`, `quadraticOut`, `quadraticInOut`, `cubicIn`, `cubicOut`, `cubicInOut`, `quarticIn`, `quarticOut`, `quarticInOut`, `quinticIn`, `quinticOut`, `quinticInOut`, `sineIn`, `sineOut`, `sineInOut`, `exponentialIn`, `exponentialOut`, `exponentialInOut`, `circularIn`, `circularOut`, `circularInOut`, `backIn`, `backOut`, `backInOut`, `bounceOut`, `bounceIn`, `bounceInOut`, `elasticIn`, `elasticOut`, `elasticInOut`, `springOut`, `springIn`, `springInOut`, `EASINGS`, `EASING_NAMES`

---

### `packages/animation/src/index.ts` - `@fourjs/animation` — the public surface of the animation pillar (Part III).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./animation-system.js` | `AnimationSystem` | Re-export |
| `./binding.js` | `createArrayElementBinding, createBinding` | Re-export |
| `./clip.js` | `AnimationClip` | Re-export |
| `./blend-tree.js` | `isBlendTree` | Re-export |
| `./controller.js` | `ANY_STATE, AnimationController` | Re-export |
| `./layer-stack.js` | `AnimationLayerStack` | Re-export |
| `./easing.js` | `BACK_OVERSHOOT, BACK_OVERSHOOT_IN_OUT, BOUNCE_AMPLITUDE, BOUNCE_SEGMENT_DIVISOR, EASINGS, EASING_NAMES, ELASTIC_AMPLITUDE, ELASTIC_PERIOD, ELASTIC_PERIOD_IN_OUT, SPRING_DAMPING_RATIO, SPRING_OSCILLATIONS, backIn, backInOut, backOut, bounceIn, bounceInOut, bounceOut, circularIn, circularInOut, circularOut, cubicIn, cubicInOut, cubicOut, elasticIn, elasticInOut, elasticOut, exponentialIn, exponentialInOut, exponentialOut, linear, quadraticIn, quadraticInOut, quadraticOut, quarticIn, quarticInOut, quarticOut, quinticIn, quinticInOut, quinticOut, resolveEasing, sineIn, sineInOut, sineOut, springIn, springInOut, springOut` | Re-export |
| `./mixer.js` | `AnimationMixer` | Re-export |
| `./timeline.js` | `Timeline` | Re-export |
| `./track.js` | `AnimationTrack` | Re-export |
| `./tween.js` | `Tween, animate, tween` | Re-export |
| `./when.js` | `compileWhenExpression` | Re-export |
| `./values.js` | `booleanAdapter, colorAdapter, detectAdapter, discreteAdapter, discreteAdapterFor, numberAdapter, quaternionAdapter, vector2Adapter, vector3Adapter, vector4Adapter` | Re-export |
| `./animation-system.js` | `Advanceable, AnimationPlaybackState, AnimationSystemOptions` | Re-export (type-only) |
| `./binding.js` | `PropertyBinding` | Re-export (type-only) |
| `./clip.js` | `AnimationClipOptions, AnimationEvent, AnimationEventVisitor, TrackSampleSink` | Re-export (type-only) |
| `./blend-tree.js` | `BlendTree, BlendTree1D, BlendTree1DPoint, BlendTree2D, BlendTree2DPoint` | Re-export (type-only) |
| `./controller.js` | `AnimationControllerOptions, AnimationControllerParameters, AnimationStateInput, AnimationStateOptions, AnimationTransition, BooleanCondition, ControllerAdvanceOptions, ControllerPlaybackState, NumericComparison, NumericCondition, StateChangeListener, TransitionCondition, TransitionWhen, TriggerCondition` | Re-export (type-only) |
| `./layer-stack.js` | `AnimationLayer, AnimationLayerStackOptions` | Re-export (type-only) |
| `./easing.js` | `EasingFunction, EasingName` | Re-export (type-only) |
| `./mixer.js` | `AnimationEventListener, MixerPlayOptions, MixerRootMotionOptions, MixerState` | Re-export (type-only) |
| `./timeline.js` | `TimelineChild, TimelineEntry, TimelineMarkerCallback, TimelineMarkerOptions, TimelineState` | Re-export (type-only) |
| `./track.js` | `AnimationTrackLike, AnimationTrackOptions, InterpolationMode` | Re-export (type-only) |
| `./tween.js` | `TweenProperties, TweenState, TweenValue` | Re-export (type-only) |
| `./when.js` | `WhenParameterLookup` | Re-export (type-only) |
| `./values.js` | `ColorRGBA, ValueAdapter, ValueKind` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `AnimationSystem`, `createArrayElementBinding`, `createBinding`, `AnimationClip`, `isBlendTree`, `ANY_STATE`, `AnimationController`, `AnimationLayerStack`, `BACK_OVERSHOOT`, `BACK_OVERSHOOT_IN_OUT`, `BOUNCE_AMPLITUDE`, `BOUNCE_SEGMENT_DIVISOR`, `EASINGS`, `EASING_NAMES`, `ELASTIC_AMPLITUDE`, `ELASTIC_PERIOD`, `ELASTIC_PERIOD_IN_OUT`, `SPRING_DAMPING_RATIO`, `SPRING_OSCILLATIONS`, `backIn`, `backInOut`, `backOut`, `bounceIn`, `bounceInOut`, `bounceOut`, `circularIn`, `circularInOut`, `circularOut`, `cubicIn`, `cubicInOut`, `cubicOut`, `elasticIn`, `elasticInOut`, `elasticOut`, `exponentialIn`, `exponentialInOut`, `exponentialOut`, `linear`, `quadraticIn`, `quadraticInOut`, `quadraticOut`, `quarticIn`, `quarticInOut`, `quarticOut`, `quinticIn`, `quinticInOut`, `quinticOut`, `resolveEasing`, `sineIn`, `sineInOut`, `sineOut`, `springIn`, `springInOut`, `springOut`, `AnimationMixer`, `Timeline`, `AnimationTrack`, `Tween`, `animate`, `tween`, `compileWhenExpression`, `booleanAdapter`, `colorAdapter`, `detectAdapter`, `discreteAdapter`, `discreteAdapterFor`, `numberAdapter`, `quaternionAdapter`, `vector2Adapter`, `vector3Adapter`, `vector4Adapter`, `Advanceable`, `AnimationPlaybackState`, `AnimationSystemOptions`, `PropertyBinding`, `AnimationClipOptions`, `AnimationEvent`, `AnimationEventVisitor`, `TrackSampleSink`, `BlendTree`, `BlendTree1D`, `BlendTree1DPoint`, `BlendTree2D`, `BlendTree2DPoint`, `AnimationControllerOptions`, `AnimationControllerParameters`, `AnimationStateInput`, `AnimationStateOptions`, `AnimationTransition`, `BooleanCondition`, `ControllerAdvanceOptions`, `ControllerPlaybackState`, `NumericComparison`, `NumericCondition`, `StateChangeListener`, `TransitionCondition`, `TransitionWhen`, `TriggerCondition`, `AnimationLayer`, `AnimationLayerStackOptions`, `EasingFunction`, `EasingName`, `AnimationEventListener`, `MixerPlayOptions`, `MixerRootMotionOptions`, `MixerState`, `TimelineChild`, `TimelineEntry`, `TimelineMarkerCallback`, `TimelineMarkerOptions`, `TimelineState`, `AnimationTrackLike`, `AnimationTrackOptions`, `InterpolationMode`, `TweenProperties`, `TweenState`, `TweenValue`, `WhenParameterLookup`, `ColorRGBA`, `ValueAdapter`, `ValueKind`

---

### `packages/animation/src/layer-stack.ts` - Layered / additive animation (PH-9, §18, §100).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/scene` | `Node, warnAuthorityConflict` |
| `@fourjs/scene` | `TransformAuthority` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./animation-system.js` | `Advanceable` | Import (type-only) |
| `./binding.js` | `createBinding, PropertyBinding` | Import |
| `./controller.js` | `AnimationController, ControllerPlaybackState` | Import (type-only) |
| `./tween.js` | `claimProperty, isTransformOwner, releaseProperty, requireNonNegativeSeconds, PropertyClaim` | Import |
| `./values.js` | `detectAdapter, ValueAdapter` | Import |

**Exports:**
- Classes: `AnimationLayerStack`
- Interfaces: `AnimationLayer`, `AnimationLayerStackOptions`

---

### `packages/animation/src/mixer.ts` - The clip player (§17 clips, §16 playback semantics, §107 "playback controls").

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Quaternion, Vector3` |
| `@fourjs/scene` | `Node, warnAuthorityConflict` |
| `@fourjs/scene` | `TransformAuthority` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./binding.js` | `createBinding, PropertyBinding` | Import |
| `./clip.js` | `AnimationClip, AnimationEvent, TrackSampleSink` | Import (type-only) |
| `./track.js` | `AnimationTrackLike` | Import (type-only) |
| `./tween.js` | `claimProperty, isTransformOwner, releaseProperty, requireNonNegativeSeconds, PropertyClaim` | Import |
| `./values.js` | `detectAdapter, ValueAdapter` | Import |

**Exports:**
- Classes: `AnimationMixer`
- Interfaces: `MixerRootMotionOptions`, `MixerPlayOptions`
- Types: `MixerState`, `AnimationEventListener`

---

### `packages/animation/src/timeline.ts` - Timelines (§16).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./tween.js` | `requireNonNegativeSeconds` | Import |

**Exports:**
- Classes: `Timeline`
- Interfaces: `TimelineMarkerOptions`, `TimelineChild`
- Types: `TimelineState`, `TimelineMarkerCallback`, `TimelineEntry`

---

### `packages/animation/src/track.ts` - Animation tracks (§17).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Vector2, Vector3, Vector4` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./values.js` | `ColorRGBA, ValueAdapter, ValueKind` | Import (type-only) |

**Exports:**
- Classes: `AnimationTrack`
- Interfaces: `AnimationTrackOptions`, `AnimationTrackLike`
- Types: `InterpolationMode`

---

### `packages/animation/src/tween.ts` - Tweens (§15).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV_WARNING_PREFIX, FourError` |
| `@fourjs/math` | `Quaternion, Vector2, Vector3, Vector4` |
| `@fourjs/scene` | `Node, warnAuthorityConflict` |
| `@fourjs/scene` | `TransformAuthority` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./binding.js` | `createBinding, PropertyBinding` | Import |
| `./easing.js` | `resolveEasing, EasingFunction, EasingName` | Import |
| `./values.js` | `detectAdapter, ColorRGBA, ValueAdapter` | Import |

**Exports:**
- Classes: `Tween`
- Interfaces: `TweenProperties`, `PropertyClaim`
- Types: `TweenValue`, `TweenState`
- Functions: `claimProperty`, `releaseProperty`, `requireNonNegativeSeconds`, `isTransformOwner`, `animate`, `tween`

---

### `packages/animation/src/values.ts` - Value adapters (§16 property bindings, §17 track value types).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Quaternion, Vector2, Vector3, Vector4, ColorRGBA` |
| `@fourjs/math` | `ColorRGBA` |

**Exports:**
- Interfaces: `ValueAdapter`
- Types: `ValueKind`
- Functions: `discreteAdapterFor`, `detectAdapter`
- Constants: `numberAdapter`, `vector2Adapter`, `vector3Adapter`, `vector4Adapter`, `quaternionAdapter`, `colorAdapter`, `booleanAdapter`, `discreteAdapter`
- Re-exports: `ColorRGBA`

---

### `packages/animation/src/when.ts` - Optional `when` string sugar for {@link ./controller.js#AnimationTransition}

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./controller.js` | `NumericComparison, TransitionCondition` | Import (type-only) |

**Exports:**
- Interfaces: `WhenParameterLookup`
- Functions: `compileWhenExpression`

---

<a id="packages-assets-dependencies"></a>

## Packages/assets Dependencies

### `packages/assets/src/asset-manager.ts` - The asset manager (§76) — one cache, one refcount, one fetch per asset.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, FourError, devWarnOnce, disposeAll, isFourError, Disposable` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./content-hash.js` | `resolveGlobalDigest, resolveGlobalTextDecoder, DigestLike, TextDecodeLike` | Import |

**Exports:**
- Classes: `AssetManager`
- Interfaces: `FetchResponse`, `ReadableBodyLike`, `ByteReaderLike`, `AssetProgressEvent`, `WorkerLike`, `AssetWithDependencies`, `AssetGraph`, `AssetGraphLoadOptions`, `ResponseHeadersLike`, `TimerLike`, `FetchInit`, `AbortHandle`, `AbortSignalLike`, `AssetLoadOptions`, `AssetLoader`, `AssetManagerOptions`
- Types: `AssetWatchLike`, `FetchLike`
- Functions: `resolveGlobalFetch`
- Constants: `DEFAULT_MAXIMUM_BYTES`, `DEFAULT_TIMEOUT_SECONDS`

---

### `packages/assets/src/bounded-png.ts` - Application-pinned `squoosh_png_bg.wasm` from `@jsquash/png@3.1.1`.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./image-memory.js` | `registerBoundedImageDecoder` | Import |
| `./texture.js` | `DEFAULT_MAXIMUM_DECODED_BYTES, DEFAULT_MAXIMUM_EXPANSION_RATIO, DecodedTexels, TexelDecodeLike` | Import |
| `./wasm-memory.js` | `limitWasmMemory` | Import |

**Exports:**
- Interfaces: `BoundedPngDecoderOptions`
- Functions: `createBoundedPngDecoder`
- Constants: `DEFAULT_IMAGE_WORKING_BYTES`

---

### `packages/assets/src/capabilities.ts` - This package's §81 capability token (RFC 0002).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `defineCapability` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./loader-registry.js` | `AssetLoaderRegistry` | Import (type-only) |

**Exports:**
- Constants: `ASSET_LOADERS`

---

### `packages/assets/src/content-hash.ts` - Content hashing (§76's last-but-one capability, §79's manifest half).

**Exports:**
- Types: `DigestLike`, `TextDecodeLike`
- Functions: `resolveGlobalDigest`, `resolveGlobalTextDecoder`
- Constants: `CONTENT_HASH_ALGORITHM`

---

### `packages/assets/src/gltf.ts` - The §78 glTF 2.0 loader — the **parse tier** (A-19's last half, 2026-08-29).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError, cloneJsonValue, devWarnOnce, isFourError, parseUntrustedJson, Disposable, JsonValue` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./image-memory.js` | `assertImageDecoderMemory` | Import |
| `./asset-manager.js` | `DEFAULT_MAXIMUM_BYTES, resolveGlobalFetch, AssetLoader, FetchLike, FetchResponse` | Import |
| `./content-hash.js` | `resolveGlobalTextDecoder, TextDecodeLike` | Import |
| `./texture.js` | `createTextureDecoder, TexelDecodeLike, TexelProbeLike, TextureAsset, TextureFilterMode, TextureWrapMode` | Import |

**Exports:**
- Classes: `GltfAsset`
- Interfaces: `GltfPrimitiveRecord`, `GltfMeshRecord`, `GltfMaterialRecord`, `GltfNodeRecord`, `GltfSceneRecord`, `GltfSkinRecord`, `GltfChannelRecord`, `GltfAnimationRecord`, `GltfLoaderOptions`
- Types: `GltfPrimitiveMode`, `GltfChannelPath`
- Functions: `createGltfLoader`

---

### `packages/assets/src/gzip.ts` - Host gzip decoder. Must validate the complete stream and checksum, rejecting

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./asset-manager.js` | `AssetLoader, ByteReaderLike` | Import (type-only) |
| `./texture.js` | `DEFAULT_MAXIMUM_DECODED_BYTES, DEFAULT_MAXIMUM_EXPANSION_RATIO` | Import |

**Exports:**
- Interfaces: `GzipReader`, `GzipLoaderOptions`
- Types: `GzipDecodeLike`
- Functions: `createGzipLoader`

---

### `packages/assets/src/image-memory.ts` - Only decoder implementations that establish the runtime's memory ceiling

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Exports:**
- Functions: `registerBoundedImageDecoder`, `assertImageDecoderMemory`

---

### `packages/assets/src/index.ts` - `@fourjs/assets` — the asset system (§76–78).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./capabilities.js` | `ASSET_LOADERS` | Re-export |
| `./loader-registry.js` | `AssetLoaderRegistry` | Re-export |
| `./asset-manager.js` | `AssetManager, DEFAULT_MAXIMUM_BYTES, DEFAULT_TIMEOUT_SECONDS` | Re-export |
| `./content-hash.js` | `CONTENT_HASH_ALGORITHM` | Re-export |
| `./manifest.js` | `loadFromManifest, manifestLoader, manifestUrl, parseAssetManifest` | Re-export |
| `./texture.js` | `DEFAULT_MAXIMUM_DECODED_BYTES, DEFAULT_MAXIMUM_EXPANSION_RATIO, TextureAsset, createTextureDecoder, createTextureLoader` | Re-export |
| `./gltf.js` | `GltfAsset, createGltfLoader` | Re-export |
| `./loaders.js` | `ImageAsset, binaryLoader, createImageLoader, jsonLoader, textLoader` | Re-export |
| `./gzip.js` | `createGzipLoader` | Re-export |
| `./bounded-png.js` | `createBoundedPngDecoder, DEFAULT_IMAGE_WORKING_BYTES` | Re-export |
| `./loader-registry.js` | `RegisteredAssetLoader` | Re-export (type-only) |
| `./asset-manager.js` | `AbortHandle, AbortSignalLike, AssetGraph, AssetGraphLoadOptions, AssetLoadOptions, AssetLoader, AssetManagerOptions, AssetProgressEvent, AssetWatchLike, AssetWithDependencies, ByteReaderLike, FetchInit, FetchLike, FetchResponse, ReadableBodyLike, ResponseHeadersLike, TimerLike, WorkerLike` | Re-export (type-only) |
| `./content-hash.js` | `DigestLike, TextDecodeLike` | Re-export (type-only) |
| `./manifest.js` | `AssetManifest, AssetManifestEntry, ManifestLoadOptions` | Re-export (type-only) |
| `./texture.js` | `DecodedTexels, TexelDecodeLike, TexelProbeLike, TextureColorSpace, TextureFilterMode, TextureLoaderOptions, TextureWrapMode` | Re-export (type-only) |
| `./gltf.js` | `GltfAnimationRecord, GltfChannelPath, GltfChannelRecord, GltfLoaderOptions, GltfMaterialRecord, GltfMeshRecord, GltfNodeRecord, GltfPrimitiveMode, GltfPrimitiveRecord, GltfSceneRecord, GltfSkinRecord` | Re-export (type-only) |
| `./loaders.js` | `ImageBitmapLike, ImageDecodeLike, ImageLoaderOptions` | Re-export (type-only) |
| `./gzip.js` | `GzipDecodeLike, GzipLoaderOptions, GzipReader` | Re-export (type-only) |
| `./bounded-png.js` | `BoundedPngDecoderOptions` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `ASSET_LOADERS`, `AssetLoaderRegistry`, `AssetManager`, `DEFAULT_MAXIMUM_BYTES`, `DEFAULT_TIMEOUT_SECONDS`, `CONTENT_HASH_ALGORITHM`, `loadFromManifest`, `manifestLoader`, `manifestUrl`, `parseAssetManifest`, `DEFAULT_MAXIMUM_DECODED_BYTES`, `DEFAULT_MAXIMUM_EXPANSION_RATIO`, `TextureAsset`, `createTextureDecoder`, `createTextureLoader`, `GltfAsset`, `createGltfLoader`, `ImageAsset`, `binaryLoader`, `createImageLoader`, `jsonLoader`, `textLoader`, `createGzipLoader`, `createBoundedPngDecoder`, `DEFAULT_IMAGE_WORKING_BYTES`, `RegisteredAssetLoader`, `AbortHandle`, `AbortSignalLike`, `AssetGraph`, `AssetGraphLoadOptions`, `AssetLoadOptions`, `AssetLoader`, `AssetManagerOptions`, `AssetProgressEvent`, `AssetWatchLike`, `AssetWithDependencies`, `ByteReaderLike`, `FetchInit`, `FetchLike`, `FetchResponse`, `ReadableBodyLike`, `ResponseHeadersLike`, `TimerLike`, `WorkerLike`, `DigestLike`, `TextDecodeLike`, `AssetManifest`, `AssetManifestEntry`, `ManifestLoadOptions`, `DecodedTexels`, `TexelDecodeLike`, `TexelProbeLike`, `TextureColorSpace`, `TextureFilterMode`, `TextureLoaderOptions`, `TextureWrapMode`, `GltfAnimationRecord`, `GltfChannelPath`, `GltfChannelRecord`, `GltfLoaderOptions`, `GltfMaterialRecord`, `GltfMeshRecord`, `GltfNodeRecord`, `GltfPrimitiveMode`, `GltfPrimitiveRecord`, `GltfSceneRecord`, `GltfSkinRecord`, `ImageBitmapLike`, `ImageDecodeLike`, `ImageLoaderOptions`, `GzipDecodeLike`, `GzipLoaderOptions`, `GzipReader`, `BoundedPngDecoderOptions`

---

### `packages/assets/src/loader-registry.ts` - The §81 asset-format registry — a named map of {@link AssetLoader}s a

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./asset-manager.js` | `AssetLoader` | Import (type-only) |

**Exports:**
- Classes: `AssetLoaderRegistry`
- Types: `RegisteredAssetLoader`

---

### `packages/assets/src/loaders.ts` - The built-in loaders (§76) — text, JSON, binary, image.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./asset-manager.js` | `AssetLoader, FetchResponse` | Import (type-only) |
| `./image-memory.js` | `assertImageDecoderMemory` | Import |
| `./texture.js` | `DEFAULT_MAXIMUM_DECODED_BYTES, DEFAULT_MAXIMUM_EXPANSION_RATIO, TextureLoaderOptions` | Import |

**Exports:**
- Classes: `ImageAsset`
- Interfaces: `ImageBitmapLike`, `ImageLoaderOptions`
- Types: `ImageDecodeLike`
- Functions: `createImageLoader`
- Constants: `textLoader`, `jsonLoader`, `binaryLoader`

---

### `packages/assets/src/manifest.ts` - The §79 asset manifest — logical key → URL + content hash.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./asset-manager.js` | `AssetLoader, AssetLoadOptions` | Import (type-only) |
| `./asset-manager.js` | `AssetManager` | Import |

**Exports:**
- Interfaces: `AssetManifestEntry`, `ManifestLoadOptions`
- Types: `AssetManifest`
- Functions: `parseAssetManifest`, `loadFromManifest`, `manifestUrl`
- Constants: `manifestLoader`

---

### `packages/assets/src/texture.ts` - The texture loader tier (§77's asset half, A-19 — 2026-08-21).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError, Disposable` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./asset-manager.js` | `AssetLoader, FetchResponse` | Import (type-only) |
| `./image-memory.js` | `assertImageDecoderMemory` | Import |

**Exports:**
- Classes: `TextureAsset`
- Interfaces: `DecodedTexels`, `TextureLoaderOptions`
- Types: `TextureColorSpace`, `TextureFilterMode`, `TextureWrapMode`, `TexelDecodeLike`, `TexelProbeLike`
- Functions: `createTextureDecoder`, `createTextureLoader`
- Constants: `DEFAULT_MAXIMUM_DECODED_BYTES`, `DEFAULT_MAXIMUM_EXPANSION_RATIO`

---

### `packages/assets/src/wasm-memory.ts` - Copies a single-memory Wasm32 codec and caps its declared linear memory.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Exports:**
- Functions: `limitWasmMemory`

---

<a id="packages-core-dependencies"></a>

## Packages/core Dependencies

### `packages/core/src/component.ts` - Component model (§6a, plan D2).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./dev.js` | `DEV, devWarn` | Import |
| `./errors.js` | `FourError` | Import |

**Exports:**
- Classes: `ComponentRegistry`
- Interfaces: `ComponentHost`, `Component`, `ComponentHostBinding`
- Types: `ComponentType`

---

### `packages/core/src/conventions.ts` - Normative default constants shared across pillars (Appendix A, §7a).

**Exports:**
- Constants: `DEFAULT_GRAVITY_Y`

---

### `packages/core/src/dev.ts` - The build-mode flag (§85, A-4, 2026-08-07) — one place that answers "is this

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./errors.js` | `FourError` | Import |
| `./errors.js` | `FourErrorCode` | Import (type-only) |

**Exports:**
- Functions: `devWarn`, `devWarnOnce`, `resetDevWarnings`, `devAssert`
- Constants: `DEV`, `DEV_WARNING_PREFIX`

---

### `packages/core/src/disposable.ts` - Explicit disposal (§83).

**Exports:**
- Interfaces: `Disposable`
- Functions: `disposeAll`

---

### `packages/core/src/errors.ts` - Error model (§89).

**Exports:**
- Classes: `FourError`
- Interfaces: `FourErrorOptions`
- Types: `FourErrorCode`
- Functions: `isFourError`

---

### `packages/core/src/events.ts` - Typed event emitter (§6b).

**Exports:**
- Classes: `EventEmitter`
- Types: `EventListener`, `Unsubscribe`

---

### `packages/core/src/index.ts` - §83 FinalizationRegistry leak bookkeeping (A-4 remainder, 2026-09-06).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./conventions.js` | `DEFAULT_GRAVITY_Y` | Re-export |
| `./json.js` | `cloneJsonValue` | Re-export |
| `./random.js` | `SeededRandom` | Re-export |
| `./component.js` | `ComponentRegistry` | Re-export |
| `./disposable.js` | `disposeAll` | Re-export |
| `./leak-registry.js` | `auditFinalizedLeaks, disposeTracked, reportFinalized, resetLeakRegistry, trackDisposable, trackedDisposableId` | Re-export |
| `./dev.js` | `DEV, DEV_WARNING_PREFIX, devAssert, devWarn, devWarnOnce, resetDevWarnings` | Re-export |
| `./errors.js` | `FourError, isFourError` | Re-export |
| `./events.js` | `EventEmitter` | Re-export |
| `./plugin.js` | `PLUGIN_API_VERSION, PluginHost, bindCapability, defineCapability, installPlugins, satisfiesPluginRange` | Re-export |
| `./space.js` | `DEFAULT_SPACE_MODE, SPACE_MODES, isSimulationSpaceMode` | Re-export |
| `./units.js` | `SI_UNITS, angleFromDisplay, angleToDisplay, formatAngle, formatLength, formatMass, formatTime, kilogramsToWorldMass, lengthFromDisplay, lengthToDisplay, massFromDisplay, massToDisplay, metersToWorldLength, resolveUnitSystem, timeFromDisplay, timeToDisplay, unitSymbol, worldLengthToMeters, worldMassToKilograms` | Re-export |
| `./untrusted.js` | `DEFAULT_MAXIMUM_DEPTH, DEFAULT_MAXIMUM_TEXT_LENGTH, parseUntrustedJson` | Re-export |
| `./json.js` | `JsonValue` | Re-export (type-only) |
| `./component.js` | `Component, ComponentHost, ComponentHostBinding, ComponentType` | Re-export (type-only) |
| `./disposable.js` | `Disposable` | Re-export (type-only) |
| `./errors.js` | `FourErrorCode, FourErrorOptions` | Re-export (type-only) |
| `./events.js` | `EventListener, Unsubscribe` | Re-export (type-only) |
| `./plugin.js` | `DefineCapabilityOptions, FourPlugin, PluginCapability, PluginCapabilityBinding, PluginContext, PluginDependency` | Re-export (type-only) |
| `./space.js` | `SpaceMode` | Re-export (type-only) |
| `./units.js` | `AngleUnit, LengthUnit, MassUnit, TimeUnit, UnitQuantity, UnitScale, UnitSystem, UnitSystemInit` | Re-export (type-only) |
| `./untrusted.js` | `UntrustedJsonLimits` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `DEFAULT_GRAVITY_Y`, `cloneJsonValue`, `SeededRandom`, `ComponentRegistry`, `disposeAll`, `auditFinalizedLeaks`, `disposeTracked`, `reportFinalized`, `resetLeakRegistry`, `trackDisposable`, `trackedDisposableId`, `DEV`, `DEV_WARNING_PREFIX`, `devAssert`, `devWarn`, `devWarnOnce`, `resetDevWarnings`, `FourError`, `isFourError`, `EventEmitter`, `PLUGIN_API_VERSION`, `PluginHost`, `bindCapability`, `defineCapability`, `installPlugins`, `satisfiesPluginRange`, `DEFAULT_SPACE_MODE`, `SPACE_MODES`, `isSimulationSpaceMode`, `SI_UNITS`, `angleFromDisplay`, `angleToDisplay`, `formatAngle`, `formatLength`, `formatMass`, `formatTime`, `kilogramsToWorldMass`, `lengthFromDisplay`, `lengthToDisplay`, `massFromDisplay`, `massToDisplay`, `metersToWorldLength`, `resolveUnitSystem`, `timeFromDisplay`, `timeToDisplay`, `unitSymbol`, `worldLengthToMeters`, `worldMassToKilograms`, `DEFAULT_MAXIMUM_DEPTH`, `DEFAULT_MAXIMUM_TEXT_LENGTH`, `parseUntrustedJson`, `JsonValue`, `Component`, `ComponentHost`, `ComponentHostBinding`, `ComponentType`, `Disposable`, `FourErrorCode`, `FourErrorOptions`, `EventListener`, `Unsubscribe`, `DefineCapabilityOptions`, `FourPlugin`, `PluginCapability`, `PluginCapabilityBinding`, `PluginContext`, `PluginDependency`, `SpaceMode`, `AngleUnit`, `LengthUnit`, `MassUnit`, `TimeUnit`, `UnitQuantity`, `UnitScale`, `UnitSystem`, `UnitSystemInit`, `UntrustedJsonLimits`

---

### `packages/core/src/json.ts` - JSON value typing and validation shared by every document format (§34, §79).

**Exports:**
- Types: `JsonValue`
- Functions: `cloneJsonValue`

---

### `packages/core/src/leak-registry.ts` - §83's **leaked-resource** development warning via `FinalizationRegistry`

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./dev.js` | `DEV, devWarnOnce` | Import |

**Exports:**
- Functions: `trackDisposable`, `disposeTracked`, `trackedDisposableId`, `reportFinalized`, `auditFinalizedLeaks`, `resetLeakRegistry`

---

### `packages/core/src/plugin.ts` - The §81 plugin system (RFC 0002, accepted 2026-08-21; gap `A-3`).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./errors.js` | `FourError` | Import |

**Exports:**
- Classes: `PluginHost`
- Interfaces: `PluginDependency`, `FourPlugin`, `PluginCapability`, `DefineCapabilityOptions`, `PluginCapabilityBinding`, `PluginContext`
- Functions: `defineCapability`, `bindCapability`, `satisfiesPluginRange`, `installPlugins`
- Constants: `PLUGIN_API_VERSION`

---

### `packages/core/src/random.ts` - Seeded pseudo-random numbers for deterministic engine code (§33, plan P8-3).

**Exports:**
- Classes: `SeededRandom`

---

### `packages/core/src/space.ts` - §8 *Space Modes* — the vocabulary, and the one rule §8 states (PH-12,

**Exports:**
- Types: `SpaceMode`
- Functions: `isSimulationSpaceMode`
- Constants: `DEFAULT_SPACE_MODE`, `SPACE_MODES`

---

### `packages/core/src/units.ts` - The §40 unit system — **display and authoring conversion only** (§40, §98).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./errors.js` | `FourError` | Import |

**Exports:**
- Interfaces: `UnitScale`, `UnitSystem`, `UnitSystemInit`
- Types: `LengthUnit`, `MassUnit`, `TimeUnit`, `AngleUnit`, `UnitQuantity`
- Functions: `resolveUnitSystem`, `angleToDisplay`, `angleFromDisplay`, `timeToDisplay`, `timeFromDisplay`, `lengthToDisplay`, `lengthFromDisplay`, `massToDisplay`, `massFromDisplay`, `worldLengthToMeters`, `metersToWorldLength`, `worldMassToKilograms`, `kilogramsToWorldMass`, `unitSymbol`, `formatLength`, `formatMass`, `formatTime`, `formatAngle`
- Constants: `SI_UNITS`

---

### `packages/core/src/untrusted.ts` - Untrusted-input guards for the document formats (§96).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./errors.js` | `FourError` | Import |

**Exports:**
- Interfaces: `UntrustedJsonLimits`
- Functions: `parseUntrustedJson`
- Constants: `DEFAULT_MAXIMUM_TEXT_LENGTH`, `DEFAULT_MAXIMUM_DEPTH`

---

<a id="packages-diagnostics-dependencies"></a>
=======
<a id="packages-particles-dependencies"></a>
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

## Packages/particles Dependencies

<<<<<<< HEAD
### `packages/diagnostics/src/allocation-audit.ts` - §83's "excessive per-frame allocations" development warning (A-4/A-5,
=======
### `packages/particles/src/particle-renderable.ts` - `ParticleRenderable` (§36, §49, plan P9-3) — the scene node that puts a

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3, Vector4` |
| `@fourjs/scene` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./emitter.js` | `ParticleEmitter` | Import (type-only) |
| `./types.js` | `ParticleTexture` | Import (type-only) |
| `./trail.js` | `TRAIL_VERTEX_FLOATS, buildTrailRibbonMesh` | Import |

**Exports:**
- Classes: `ParticleRenderable`
- Interfaces: `ParticleRenderableOptions`
- Constants: `PARTICLE_INSTANCE_FLOATS`, `PARTICLE_WIDE_INSTANCE_FLOATS`, `PARTICLE_ROTATION_OFFSET`, `PARTICLE_SOFTNESS_OFFSET`, `PARTICLE_TRAIL_VERTEX_FLOATS`

---

### `packages/particles/src/emitter.ts` - `ParticleEmitter` — the CPU particle simulation (§36, plan P9-1, WP-9.1).
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `DEV, devWarnOnce` |

**Exports:**
- Interfaces: `FrameAllocationReport`, `AuditFrameAllocationsOptions`
- Functions: `auditFrameAllocations`
- Constants: `NO_FRAME_ALLOCATIONS`

---

### `packages/diagnostics/src/checksum.ts` - Deterministic checksums over float sequences (§33, plan D6).

**Exports:**
- Interfaces: `Checksum`
- Functions: `createChecksum`, `hashFloats`

---

### `packages/diagnostics/src/debug-draw.ts` - Debug-draw data providers (§113, plan P10-3) — the diagnostic visualization

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Quaternion, Vector3` |

**Exports:**
- Classes: `DebugDrawBuffer`
- Interfaces: `Vector3Like`, `DebugDrawBufferOptions`, `DebugDrawStreams`, `DebugGeometrySink`, `DebugBodyAccess`, `DebugJointAccess`, `DebugContactPoint`, `DebugCollisionEventLike`, `DebugPhysicsEventLike`, `CollectBodyVelocitiesOptions`, `CollectBodyOriginsOptions`, `DebugCenterOfMassAccess`, `CollectCentersOfMassOptions`, `CollectContactPointsOptions`, `CollectContactImpulsesOptions`, `SolverStatistics`, `SolverJointStatistics`, `StagedVisualization`
- Types: `DebugColor`
- Functions: `debugDrawStreams`, `applyDebugDrawStreams`, `collectBodyVelocities`, `collectBodyOrigins`, `collectCentersOfMass`, `collectContactPoints`, `collectContactImpulses`, `solverJointStatistics`
- Constants: `DEBUG_VERTEX_FLOATS`, `DEBUG_SEGMENT_FLOATS`, `DEBUG_POSITION_FLOATS_PER_SEGMENT`, `DEBUG_COLOR_FLOATS_PER_SEGMENT`, `DEFAULT_DEBUG_BUFFER_CAPACITY`, `DEBUG_DRAW_DEFAULT_COLORS`, `DEBUG_DRAW_STAGED`

---

### `packages/diagnostics/src/index.ts` - --- PH-20 (§33 rollback) ---------------------------------------------------
=======
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Vector3, Vector4` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./pool.js` | `ParticlePool` | Import |
| `./random.js` | `SeededRandom` | Import |
| `./trail.js` | `ParticleTrailStore, resolveTrailOptions, ParticleTrailOptions` | Import |
| `./types.js` | `ParticleBurst, ParticleCollisionMode, ParticleColor, ParticleForceField, ParticleGpuIntegrateExtras, ParticleGpuRadialField, ParticleGpuSimulation, ParticleLifetimeRamp, ParticleLifetimeStop, ParticleRange, ParticleSimulationMode, ParticleTexture` | Import (type-only) |
| `./types.js` | `evaluateLifetimeRampColor, evaluateLifetimeRampNumber` | Import |

**Exports:**
- Classes: `ParticleEmitter`
- Interfaces: `ParticleEmitterOptions`
- Constants: `PARTICLE_DRAWS_PER_SPAWN`, `DEFAULT_PARTICLE_SEED`, `DEFAULT_PARTICLE_LIFETIME_SECONDS`, `DEFAULT_PARTICLE_SIZE`, `DEFAULT_PARTICLE_RESTITUTION`

---

### `packages/particles/src/index.ts` - --- WP-9.2: §27 force fields (begin) ---
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
<<<<<<< HEAD
| `./checksum.js` | `createChecksum, hashFloats` | Re-export |
| `./recorder.js` | `ReplayRecorder` | Re-export |
| `./rollback.js` | `RollbackBuffer` | Re-export |
| `./replay-format.js` | `LATEST_REPLAY_FORMAT_VERSION, MINIMUM_REPLAY_FORMAT_VERSION, REPLAY_FORMAT_VERSION, SUPPORTED_REPLAY_FORMAT_VERSIONS, assertReplayCompatible, cloneJsonValue, decodeBase64, decodeReplayRecording, encodeBase64, encodeReplayRecording, isReplayCompatible, validateReplayRecording` | Re-export |
| `./replay-player.js` | `DEFAULT_REPLAY_MAXIMUM_SUB_STEPS, ReplayPlayer` | Re-export |
| `./debug-draw.js` | `DEBUG_COLOR_FLOATS_PER_SEGMENT, DEBUG_DRAW_DEFAULT_COLORS, DEBUG_DRAW_STAGED, DEBUG_POSITION_FLOATS_PER_SEGMENT, DEBUG_SEGMENT_FLOATS, DEBUG_VERTEX_FLOATS, DEFAULT_DEBUG_BUFFER_CAPACITY, DebugDrawBuffer, applyDebugDrawStreams, collectBodyOrigins, collectBodyVelocities, collectCentersOfMass, collectContactImpulses, collectContactPoints, debugDrawStreams, solverJointStatistics` | Re-export |
| `./resource-audit.js` | `NO_RESOURCE_LEAKS, auditResourceLeaks` | Re-export |
| `./leak-registry.js` | `auditFinalizedLeaks, disposeTracked, reportFinalized, resetLeakRegistry, trackDisposable, trackedDisposableId` | Re-export |
| `./validation.js` | `COORDINATE_ENVELOPE, NEAR_ZERO_SCALE, UNSTABLE_SCALE_RATIO, assertFinite, assertFiniteVec3, assertNoSceneGraphCycle, validateSceneNode, validateSceneSubtree, warnCoordinateEnvelope, warnImpossibleInertia, warnImpossibleMass, warnSingularScale, warnUnstableScale, warnVersionMismatch` | Re-export |
| `./allocation-audit.js` | `NO_FRAME_ALLOCATIONS, auditFrameAllocations` | Re-export |
| `./stats.js` | `copyFrameStats, createFrameStats, createMonotonicClock, monotonicNowSeconds, recordRenderStatistics, recordResourceMemory, recordSolverStatistics, resetFrameStats, solverStatistics` | Re-export |
| `./checksum.js` | `Checksum` | Re-export (type-only) |
| `./recorder.js` | `ReplayRecorderOptions, ReplaySnapshot, ReplayTarget` | Re-export (type-only) |
| `./rollback.js` | `RollbackBufferOptions, RollbackTarget` | Re-export (type-only) |
| `./replay-format.js` | `JsonValue, ReplayAdapterIdentity, ReplayFrameRecord, ReplayInputRecord, ReplayRecording, ReplaySnapshotRecord, UntrustedJsonLimits` | Re-export (type-only) |
| `./replay-player.js` | `ReplayPlayerOptions, ReplayStepEvent, ReplayStepListener` | Re-export (type-only) |
| `./debug-draw.js` | `CollectBodyOriginsOptions, CollectBodyVelocitiesOptions, CollectCentersOfMassOptions, CollectContactImpulsesOptions, CollectContactPointsOptions, DebugBodyAccess, DebugCenterOfMassAccess, DebugCollisionEventLike, DebugColor, DebugContactPoint, DebugDrawBufferOptions, DebugDrawStreams, DebugGeometrySink, DebugJointAccess, DebugPhysicsEventLike, SolverJointStatistics, SolverStatistics, StagedVisualization, Vector3Like` | Re-export (type-only) |
| `./resource-audit.js` | `AuditResourceLeaksOptions, LiveResourceCounts, ResourceLeakReport` | Re-export (type-only) |
| `./validation.js` | `ValidationCatalogueOptions, ValidationCheckOptions, ValidationNodeLike, ValidationTransformLike` | Re-export (type-only) |
| `./allocation-audit.js` | `AuditFrameAllocationsOptions, FrameAllocationReport` | Re-export (type-only) |
| `./stats.js` | `ClockSource, FrameStats, RenderStatisticsLike` | Re-export (type-only) |
=======
| `./emitter.js` | `DEFAULT_PARTICLE_LIFETIME_SECONDS, DEFAULT_PARTICLE_RESTITUTION, DEFAULT_PARTICLE_SEED, DEFAULT_PARTICLE_SIZE, PARTICLE_DRAWS_PER_SPAWN, ParticleEmitter` | Re-export |
| `./pool.js` | `ParticlePool` | Re-export |
| `./fields.js` | `DEFAULT_GRAVITY_Y, DEFAULT_RADIAL_MIN_DISTANCE, DEFAULT_TURBULENCE_AMPLITUDE, DEFAULT_TURBULENCE_FREQUENCY, DEFAULT_VORTEX_MIN_DISTANCE, TURBULENCE_DIFFERENCE_CELLS, dragField, radialField, turbulenceField, uniformGravityField, volumeField, vortexField, windField` | Re-export |
| `./particle-renderable.js` | `PARTICLE_INSTANCE_FLOATS, PARTICLE_ROTATION_OFFSET, PARTICLE_SOFTNESS_OFFSET, PARTICLE_TRAIL_VERTEX_FLOATS, PARTICLE_WIDE_INSTANCE_FLOATS, ParticleRenderable` | Re-export |
| `./particle-system.js` | `PRIORITY_PARTICLES, ParticleSystem` | Re-export |
| `./random.js` | `SeededRandom` | Re-export |
| `./trail.js` | `DEFAULT_TRAIL_LENGTH, DEFAULT_TRAIL_MIN_DISTANCE, DEFAULT_TRAIL_TAIL_WIDTH_FACTOR, DEFAULT_TRAIL_WIDTH, ParticleTrailStore, TRAIL_VERTEX_FLOATS, buildTrailRibbonMesh, resolveTrailOptions` | Re-export |
| `./types.js` | `evaluateLifetimeRampColor, evaluateLifetimeRampNumber` | Re-export |
| `./emitter.js` | `ParticleEmitterOptions` | Re-export (type-only) |
| `./fields.js` | `BoxFieldVolume, FieldVolume, RadialFieldOptions, SphereFieldVolume, TurbulenceFieldOptions, VortexFieldOptions` | Re-export (type-only) |
| `./particle-renderable.js` | `ParticleRenderableOptions` | Re-export (type-only) |
| `./particle-system.js` | `ParticleFixedUpdateContext, ParticleStepTime, ParticleSystemOptions, SteppableEmitter` | Re-export (type-only) |
| `./trail.js` | `ParticleTrailOptions` | Re-export (type-only) |
| `./types.js` | `ParticleBurst, ParticleCollisionMode, ParticleColor, ParticleForceField, ParticleGpuIntegrateExtras, ParticleGpuRadialField, ParticleGpuSimulation, ParticleLifetimeRamp, ParticleLifetimeStop, ParticleRange, ParticleSimulationMode, ParticleTexture` | Re-export (type-only) |
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `DEFAULT_PARTICLE_LIFETIME_SECONDS`, `DEFAULT_PARTICLE_RESTITUTION`, `DEFAULT_PARTICLE_SEED`, `DEFAULT_PARTICLE_SIZE`, `PARTICLE_DRAWS_PER_SPAWN`, `ParticleEmitter`, `ParticlePool`, `DEFAULT_GRAVITY_Y`, `DEFAULT_RADIAL_MIN_DISTANCE`, `DEFAULT_TURBULENCE_AMPLITUDE`, `DEFAULT_TURBULENCE_FREQUENCY`, `DEFAULT_VORTEX_MIN_DISTANCE`, `TURBULENCE_DIFFERENCE_CELLS`, `dragField`, `radialField`, `turbulenceField`, `uniformGravityField`, `volumeField`, `vortexField`, `windField`, `PARTICLE_INSTANCE_FLOATS`, `PARTICLE_ROTATION_OFFSET`, `PARTICLE_SOFTNESS_OFFSET`, `PARTICLE_TRAIL_VERTEX_FLOATS`, `PARTICLE_WIDE_INSTANCE_FLOATS`, `ParticleRenderable`, `PRIORITY_PARTICLES`, `ParticleSystem`, `SeededRandom`, `DEFAULT_TRAIL_LENGTH`, `DEFAULT_TRAIL_MIN_DISTANCE`, `DEFAULT_TRAIL_TAIL_WIDTH_FACTOR`, `DEFAULT_TRAIL_WIDTH`, `ParticleTrailStore`, `TRAIL_VERTEX_FLOATS`, `buildTrailRibbonMesh`, `resolveTrailOptions`, `evaluateLifetimeRampColor`, `evaluateLifetimeRampNumber`, `ParticleEmitterOptions`, `BoxFieldVolume`, `FieldVolume`, `RadialFieldOptions`, `SphereFieldVolume`, `TurbulenceFieldOptions`, `VortexFieldOptions`, `ParticleRenderableOptions`, `ParticleFixedUpdateContext`, `ParticleStepTime`, `ParticleSystemOptions`, `SteppableEmitter`, `ParticleTrailOptions`, `ParticleBurst`, `ParticleCollisionMode`, `ParticleColor`, `ParticleForceField`, `ParticleGpuIntegrateExtras`, `ParticleGpuRadialField`, `ParticleGpuSimulation`, `ParticleLifetimeRamp`, `ParticleLifetimeStop`, `ParticleRange`, `ParticleSimulationMode`, `ParticleTexture`

---

<<<<<<< HEAD
### `packages/diagnostics/src/leak-registry.ts` - Re-export of `@fourjs/core`'s §83 FinalizationRegistry leak bookkeeping.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `auditFinalizedLeaks, disposeTracked, reportFinalized, resetLeakRegistry, trackDisposable, trackedDisposableId` |

**Exports:**
- Re-exports: `auditFinalizedLeaks`, `disposeTracked`, `reportFinalized`, `resetLeakRegistry`, `trackDisposable`, `trackedDisposableId`

---

### `packages/diagnostics/src/recorder.ts` - Session recording (§33–34, plan P10-1) — the producing half of the replay

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./replay-format.js` | `LATEST_REPLAY_FORMAT_VERSION, JsonValue, ReplayFrameRecord, ReplayInputRecord, ReplayRecording, ReplaySnapshotRecord, cloneJsonValue, encodeBase64, validateReplayRecording` | Import |

**Exports:**
- Classes: `ReplayRecorder`
- Interfaces: `ReplaySnapshot`, `ReplayTarget`, `ReplayRecorderOptions`

---

### `packages/diagnostics/src/replay-format.ts` - The §34 replay document — its types, its JSON encoding, and its validation

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError, cloneJsonValue, parseUntrustedJson, JsonValue, UntrustedJsonLimits` |
| `@fourjs/core` | `cloneJsonValue` |
| `@fourjs/core` | `JsonValue` |
| `@fourjs/core` | `UntrustedJsonLimits` |

**Exports:**
- Interfaces: `ReplayInputRecord`, `ReplayFrameRecord`, `ReplaySnapshotRecord`, `ReplayAdapterIdentity`, `ReplayRecording`
- Functions: `encodeBase64`, `decodeBase64`, `validateReplayRecording`, `encodeReplayRecording`, `decodeReplayRecording`, `assertReplayCompatible`, `isReplayCompatible`
- Constants: `LATEST_REPLAY_FORMAT_VERSION`, `MINIMUM_REPLAY_FORMAT_VERSION`, `REPLAY_FORMAT_VERSION`, `SUPPORTED_REPLAY_FORMAT_VERSIONS`
- Re-exports: `cloneJsonValue`, `JsonValue`, `UntrustedJsonLimits`

---

### `packages/diagnostics/src/replay-player.ts` - Replay playback and inspection (§33–34, §113; plan P10-3) — the consuming

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./recorder.js` | `ReplaySnapshot, ReplayTarget` | Import (type-only) |
| `./replay-format.js` | `ReplayRecording, assertReplayCompatible, decodeBase64, validateReplayRecording` | Import |

**Exports:**
- Classes: `ReplayPlayer`
- Interfaces: `ReplayStepEvent`, `ReplayPlayerOptions`
- Types: `ReplayStepListener`
- Constants: `DEFAULT_REPLAY_MAXIMUM_SUB_STEPS`

---

### `packages/diagnostics/src/resource-audit.ts` - §83's first development warning — **leaked textures and buffers** (A-4/A-5,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, devWarnOnce` |

**Exports:**
- Interfaces: `LiveResourceCounts`, `ResourceLeakReport`, `AuditResourceLeaksOptions`
- Functions: `auditResourceLeaks`
- Constants: `NO_RESOURCE_LEAKS`

---

### `packages/diagnostics/src/rollback.ts` - `RollbackBuffer` (§33 *"rollback"*, §34; PH-20, 2026-08-21) — a bounded ring

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./recorder.js` | `ReplaySnapshot` | Import (type-only) |

**Exports:**
- Classes: `RollbackBuffer`
- Interfaces: `RollbackTarget`, `RollbackBufferOptions`

---

### `packages/diagnostics/src/stats.ts` - §84 runtime statistics — the record behind `app.stats` (A-1, 2026-08-07).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./debug-draw.js` | `DebugBodyAccess, SolverStatistics` | Import (type-only) |

**Exports:**
- Interfaces: `FrameStats`, `RenderStatisticsLike`, `ClockSource`
- Functions: `createFrameStats`, `resetFrameStats`, `copyFrameStats`, `recordRenderStatistics`, `recordResourceMemory`, `solverStatistics`, `recordSolverStatistics`, `createMonotonicClock`
- Constants: `monotonicNowSeconds`

---

### `packages/diagnostics/src/validation.ts` - §85's validation catalogue (A-4 remainder step 2, 2026-09-06).
=======
### `packages/particles/src/trail.ts` - Per-particle position history and ribbon mesh generation (§36 trails, plan P9).

**Exports:**
- Classes: `ParticleTrailStore`
- Interfaces: `ParticleTrailOptions`
- Functions: `buildTrailRibbonMesh`, `resolveTrailOptions`
- Constants: `TRAIL_VERTEX_FLOATS`, `DEFAULT_TRAIL_LENGTH`, `DEFAULT_TRAIL_WIDTH`, `DEFAULT_TRAIL_MIN_DISTANCE`, `DEFAULT_TRAIL_TAIL_WIDTH_FACTOR`

---

### `packages/particles/src/particle-system.ts` - `ParticleSystem` (§39, §36, plan WP-9.4) — the fixed-step driver that steps
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Exports:**
- Classes: `ParticleSystem`
- Interfaces: `ParticleStepTime`, `ParticleFixedUpdateContext`, `SteppableEmitter`, `ParticleSystemOptions`
- Constants: `PRIORITY_PARTICLES`

---

<<<<<<< HEAD
<a id="packages-fourjs-dependencies"></a>

## Packages/fourjs Dependencies

### `packages/fourjs/src/animation.ts` - animation module
=======
### `packages/particles/src/fields.ts` - The §27 built-in force fields, MVP tier (plan P9-2, WP-9.2).
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/animation` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/animation`

---

### `packages/fourjs/src/application.ts` - The `Application` composition root (§45, plan D4).
=======
| `@fourjs/core` | `DEFAULT_GRAVITY_Y` |
| `@fourjs/math` | `Vector3` |
| `@fourjs/core` | `DEFAULT_GRAVITY_Y` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./random.js` | `SeededRandom` | Import |
| `./types.js` | `ParticleForceField` | Import (type-only) |

**Exports:**
- Interfaces: `RadialFieldOptions`, `VortexFieldOptions`, `TurbulenceFieldOptions`, `SphereFieldVolume`, `BoxFieldVolume`
- Types: `FieldVolume`
- Functions: `uniformGravityField`, `dragField`, `windField`, `radialField`, `vortexField`, `turbulenceField`, `volumeField`
- Constants: `DEFAULT_RADIAL_MIN_DISTANCE`, `DEFAULT_VORTEX_MIN_DISTANCE`, `DEFAULT_TURBULENCE_FREQUENCY`, `DEFAULT_TURBULENCE_AMPLITUDE`, `TURBULENCE_DIFFERENCE_CELLS`
- Re-exports: `DEFAULT_GRAVITY_Y`

---

### `packages/particles/src/random.ts` - `SeededRandom` for particles — a re-export of `@fourjs/core`.
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `DEV, EventEmitter, FourError, bindCapability, devWarnOnce, installPlugins, FourPlugin, PluginCapabilityBinding, PluginContext` |
| `@fourjs/diagnostics` | `auditFrameAllocations, createFrameStats, monotonicNowSeconds, recordRenderStatistics, recordResourceMemory, recordSolverStatistics, resetFrameStats, solverStatistics, FrameStats, SolverStatistics` |
| `@fourjs/geometry` | `geometryMemoryBytes` |
| `@fourjs/motion` | `DEFAULT_FIXED_DELTA_TIME, DEFAULT_MAXIMUM_SUB_STEPS, PRIORITY_PHYSICS_SOLVE, Scheduler, SystemRegistry, Detach, ReadonlyTimeState, SimulationSystem` |
| `@fourjs/math` | `constructionCount, DepthRange` |
| `@fourjs/assets` | `AssetManager` |
| `@fourjs/physics` | `PhysicsWorld` |
| `@fourjs/scene` | `PerspectiveCamera, PoseBuffer, Scene, createSnapshotSystem, resolveWorldTransforms, Camera, SurfaceSizedCamera, Viewport, WorldTransformStats` |
| `@fourjs/render` | `RenderStatistics, Renderer, RendererCapabilityDeclaration, RendererCapabilityShortfall, RendererFallbackReport, RendererRegistry, RendererSelection` |
| `@fourjs/render` | `resolveRenderer, textureMemoryBytes` |
=======
| `@fourjs/core` | `SeededRandom` |

**Exports:**
- Re-exports: `SeededRandom`

---

### `packages/particles/src/pool.ts` - The particle pool (§36, plan P9-1) — a fixed-capacity, structure-of-arrays

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3, Vector4` |

**Exports:**
- Classes: `ParticlePool`

---

### `packages/particles/src/types.ts` - Shared particle types (§27, §36) — the vocabulary WP-9.1's pool and emitter

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3` |

**Exports:**
- Interfaces: `ParticleForceField`, `ParticleGpuRadialField`, `ParticleGpuIntegrateExtras`, `ParticleGpuSimulation`, `ParticleRange`, `ParticleLifetimeStop`, `ParticleLifetimeRamp`, `ParticleColor`, `ParticleBurst`
- Types: `ParticleSimulationMode`, `ParticleCollisionMode`, `ParticleTexture`
- Functions: `evaluateLifetimeRampNumber`, `evaluateLifetimeRampColor`

---

<a id="packages-materials-dependencies"></a>

## Packages/materials Dependencies

### `packages/materials/src/capabilities.ts` - This package's §81 capability token (RFC 0002).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `defineCapability` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./shader-operators.js` | `ShaderOperatorRegistry` | Import (type-only) |

**Exports:**
- Constants: `SHADER_OPERATORS`

---

### `packages/materials/src/index.ts` - §81's materials / shader-node token (RFC 0002): declared here;

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./capabilities.js` | `SHADER_OPERATORS` | Re-export |
| `./shader-operators.js` | `ShaderOperatorRegistry` | Re-export |
| `./lit-material.js` | `LitMaterial` | Re-export |
| `./material.js` | `Material` | Re-export |
| `./node-material.js` | `NodeMaterial` | Re-export |
| `./node-material-builder.js` | `NodeMaterialBuilder, ShaderExpression, ShaderGraphBuilder, ShaderGraphOutput` | Re-export |
| `./shader-graph.js` | `MAX_SHADER_GRAPH_NODES, MAX_SHADER_GRAPH_TEXTURES, SHADER_ATTRIBUTE_TYPES, SHADER_VALUE_COMPONENTS, analyzeShaderGraph, forEachShaderNodeReference, freezeShaderGraph` | Re-export |
| `./sprite-material.js` | `SpriteMaterial` | Re-export |
| `./stencil-state.js` | `MAX_STENCIL_VALUE, StencilState` | Re-export |
| `./standard-material.js` | `StandardMaterial` | Re-export |
| `./unlit-material.js` | `UnlitMaterial` | Re-export |
| `./resource-memory.js` | `liveMaterialCount` | Re-export |
| `./shader-operators.js` | `ShaderOperatorFactory` | Re-export (type-only) |
| `./lit-material.js` | `LitMaterialOptions` | Re-export (type-only) |
| `./material.js` | `BlendMode, MaterialOptions` | Re-export (type-only) |
| `./node-material.js` | `NodeMaterialOptions` | Re-export (type-only) |
| `./node-material-builder.js` | `ShaderOperand` | Re-export (type-only) |
| `./shader-graph.js` | `ShaderAttributeName, ShaderBinaryOp, ShaderDomain, ShaderGraph, ShaderGraphAnalysis, ShaderNode, ShaderNodeId, ShaderReflection, ShaderTextureReflection, ShaderUnaryOp, ShaderUniformReflection, ShaderValueType` | Re-export (type-only) |
| `./sprite-material.js` | `SpriteMaterialOptions, SpriteTexture` | Re-export (type-only) |
| `./stencil-state.js` | `StencilFunc, StencilOp, StencilStateOptions` | Re-export (type-only) |
| `./standard-material.js` | `ColorRGB, StandardMaterialOptions` | Re-export (type-only) |
| `./texture.js` | `MaterialTexture, MaterialTextureFilter, MaterialTextureMinFilter, MaterialTextureWrap` | Re-export (type-only) |
| `./unlit-material.js` | `ColorRGBA, UnlitMaterialOptions` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `SHADER_OPERATORS`, `ShaderOperatorRegistry`, `LitMaterial`, `Material`, `NodeMaterial`, `NodeMaterialBuilder`, `ShaderExpression`, `ShaderGraphBuilder`, `ShaderGraphOutput`, `MAX_SHADER_GRAPH_NODES`, `MAX_SHADER_GRAPH_TEXTURES`, `SHADER_ATTRIBUTE_TYPES`, `SHADER_VALUE_COMPONENTS`, `analyzeShaderGraph`, `forEachShaderNodeReference`, `freezeShaderGraph`, `SpriteMaterial`, `MAX_STENCIL_VALUE`, `StencilState`, `StandardMaterial`, `UnlitMaterial`, `liveMaterialCount`, `ShaderOperatorFactory`, `LitMaterialOptions`, `BlendMode`, `MaterialOptions`, `NodeMaterialOptions`, `ShaderOperand`, `ShaderAttributeName`, `ShaderBinaryOp`, `ShaderDomain`, `ShaderGraph`, `ShaderGraphAnalysis`, `ShaderNode`, `ShaderNodeId`, `ShaderReflection`, `ShaderTextureReflection`, `ShaderUnaryOp`, `ShaderUniformReflection`, `ShaderValueType`, `SpriteMaterialOptions`, `SpriteTexture`, `StencilFunc`, `StencilOp`, `StencilStateOptions`, `ColorRGB`, `StandardMaterialOptions`, `MaterialTexture`, `MaterialTextureFilter`, `MaterialTextureMinFilter`, `MaterialTextureWrap`, `ColorRGBA`, `UnlitMaterialOptions`

---

### `packages/materials/src/texture.ts` - The read surface of a texture as a **material** and a rendering backend see

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `ColorSpace` |

**Exports:**
- Interfaces: `MaterialTexture`
- Types: `MaterialTextureFilter`, `MaterialTextureMinFilter`, `MaterialTextureWrap`

---

### `packages/materials/src/stencil-state.ts` - `StencilState` (§57, §67) — the per-material stencil test, write mask, and

**Exports:**
- Classes: `StencilState`
- Interfaces: `StencilStateOptions`
- Types: `StencilFunc`, `StencilOp`
- Constants: `MAX_STENCIL_VALUE`

---

### `packages/materials/src/sprite-material.ts` - `SpriteMaterial` (§55, §57) — one texture, one tint.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./material.js` | `Material, MaterialOptions` | Import |
| `./texture.js` | `MaterialTexture` | Import (type-only) |
| `./unlit-material.js` | `ColorRGBA` | Import (type-only) |

**Exports:**
- Classes: `SpriteMaterial`
- Interfaces: `SpriteMaterialOptions`
- Types: `SpriteTexture`

---

### `packages/materials/src/standard-material.ts` - `StandardMaterial` (§59) — the metallic-roughness workflow, at the tier this

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `ColorRGB, ColorRGBA` |
| `@fourjs/math` | `ColorRGB` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./material.js` | `Material, MaterialOptions` | Import |
| `./texture.js` | `MaterialTexture` | Import (type-only) |

**Exports:**
- Classes: `StandardMaterial`
- Interfaces: `StandardMaterialOptions`
- Re-exports: `ColorRGB`

---

### `packages/materials/src/shader-operators.ts` - The §81 materials / shader-node registry — a named map of operator

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./shader-graph.js` | `ShaderNode, ShaderNodeId` | Import (type-only) |

**Exports:**
- Classes: `ShaderOperatorRegistry`
- Types: `ShaderOperatorFactory`

---

### `packages/materials/src/unlit-material.ts` - `UnlitMaterial` (§57) — a flat RGBA color, optionally multiplied by a texture

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `ColorRGBA` |
| `@fourjs/math` | `ColorRGBA` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./material.js` | `Material, MaterialOptions` | Import |
| `./texture.js` | `MaterialTexture` | Import (type-only) |

**Exports:**
- Classes: `UnlitMaterial`
- Interfaces: `UnlitMaterialOptions`
- Re-exports: `ColorRGBA`

---

### `packages/materials/src/node-material-builder.ts` - The fluent authoring surface over `shader-graph.ts`'s IR (§60; RFC 0001).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./shader-graph.js` | `analyzeShaderGraph, ShaderAttributeName, ShaderBinaryOp, ShaderDomain, ShaderGraph, ShaderNode, ShaderNodeId, ShaderUnaryOp, ShaderValueType` | Import |
| `./node-material.js` | `NodeMaterial, NodeMaterialOptions` | Import |
| `./texture.js` | `MaterialTexture` | Import (type-only) |

**Exports:**
- Classes: `ShaderExpression`, `ShaderGraphOutput`, `ShaderGraphBuilder`, `NodeMaterialBuilder`
- Types: `ShaderOperand`

---

### `packages/materials/src/node-material.ts` - `NodeMaterial` (§57, §60) — the material family member that carries a

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./material.js` | `Material, MaterialOptions` | Import |
| `./shader-graph.js` | `SHADER_VALUE_COMPONENTS, analyzeShaderGraph, freezeShaderGraph, ShaderGraph, ShaderReflection, ShaderValueType` | Import |
| `./texture.js` | `MaterialTexture` | Import (type-only) |

**Exports:**
- Classes: `NodeMaterial`
- Interfaces: `NodeMaterialOptions`

---

### `packages/materials/src/shader-graph.ts` - The shader graph (§60) — a backend-independent, JSON-serializable shader IR

**Exports:**
- Interfaces: `ShaderGraph`, `ShaderUniformReflection`, `ShaderTextureReflection`, `ShaderReflection`, `ShaderGraphAnalysis`
- Types: `ShaderNodeId`, `ShaderValueType`, `ShaderDomain`, `ShaderAttributeName`, `ShaderUnaryOp`, `ShaderBinaryOp`, `ShaderNode`
- Functions: `forEachShaderNodeReference`, `analyzeShaderGraph`, `freezeShaderGraph`
- Constants: `MAX_SHADER_GRAPH_NODES`, `MAX_SHADER_GRAPH_TEXTURES`, `SHADER_VALUE_COMPONENTS`, `SHADER_ATTRIBUTE_TYPES`

---

### `packages/materials/src/material.ts` - `Material` (§57) — the abstract base every material family member extends,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Disposable` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./resource-memory.js` | `noteMaterial, releaseMaterialDisposable, trackMaterialDisposable` | Import |
| `./stencil-state.js` | `StencilState` | Import (type-only) |

**Exports:**
- Interfaces: `MaterialOptions`
- Types: `BlendMode`

---

### `packages/materials/src/resource-memory.ts` - §83 resource accounting for materials — how many are live (A-5 follow-up).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, disposeTracked, trackDisposable` |

**Exports:**
- Functions: `noteMaterial`, `liveMaterialCount`, `trackMaterialDisposable`, `releaseMaterialDisposable`

---

### `packages/materials/src/lit-material.ts` - `LitMaterial` (§57, §68, §120) — one RGBA color that responds to lights.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./material.js` | `Material, MaterialOptions` | Import |
| `./texture.js` | `MaterialTexture` | Import (type-only) |
| `./unlit-material.js` | `ColorRGBA` | Import (type-only) |

**Exports:**
- Classes: `LitMaterial`
- Interfaces: `LitMaterialOptions`

---

<a id="packages-ui-dependencies"></a>

## Packages/ui Dependencies

### `packages/ui/src/label.ts` - `Label` (§73) — a widget whose intrinsic size is its text (§74, §56).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector2` |
| `@fourjs/text` | `layoutText, GlyphAtlas, TextLayout` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./widget.js` | `UIWidget, UIWidgetOptions` | Import |

**Exports:**
- Classes: `Label`
- Interfaces: `LabelOptions`

---

### `packages/ui/src/canvas-view.ts` - `CanvasViewWidget` (§73's "canvas view"; RFC 0004, accepted 2026-08-21) — a

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./numbers.js` | `requireFinite` | Import |
| `./widget.js` | `UIWidget, UIWidgetOptions` | Import |

**Exports:**
- Classes: `CanvasViewWidget`
- Interfaces: `CanvasViewWidgetOptions`

---

### `packages/ui/src/slider.ts` - `Slider` (§73) — a value dragged along a track (§72) or stepped with the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/input` | `ScenePointerEvent, SceneKeyEvent` |
| `@fourjs/math` | `Matrix4, Vector3` |
| `@fourjs/scene` | `resolveWorldTransform` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./numbers.js` | `fractionOf, requireFinite, resolveValue` | Import |
| `./panel.js` | `Panel, PanelOptions` | Import |

**Exports:**
- Classes: `Slider`
- Interfaces: `SliderOptions`
- Types: `SliderOrientation`

---

### `packages/ui/src/capabilities.ts` - This package's §81 capability token (RFC 0002).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `defineCapability` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./control-registry.js` | `UIControlRegistry` | Import (type-only) |

**Exports:**
- Constants: `UI_CONTROLS`

---

### `packages/ui/src/radio.ts` - `RadioButton` (§73's "radio control") and its group mechanism (2026-08-07,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/input` | `SceneKeyEvent` |
| `@fourjs/scene` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./checkable.js` | `CheckableWidget, CheckableWidgetOptions` | Import |

**Exports:**
- Classes: `RadioButton`
- Interfaces: `RadioButtonOptions`
- Functions: `collectRadioGroup`, `checkedRadio`

---

### `packages/ui/src/index.ts` - `@fourjs/ui` — retained-mode UI at §113a's MVP tier (§73–§75).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./capabilities.js` | `UI_CONTROLS` | Re-export |
| `./control-registry.js` | `UIControlRegistry` | Re-export |
| `./accessibility.js` | `accessibilityElementId, installAccessibilityMirror, prefersReducedMotion` | Re-export |
| `./button.js` | `Button` | Re-export |
| `./canvas-view.js` | `CanvasViewWidget` | Re-export |
| `./checkable.js` | `CheckableWidget, Checkbox, Toggle` | Re-export |
| `./image.js` | `ImageWidget` | Re-export |
| `./keyboard.js` | `collectFocusOrder, installKeyboardTraversal, keyboardFocusTarget` | Re-export |
| `./label.js` | `Label` | Re-export |
| `./panel.js` | `Panel` | Re-export |
| `./progress.js` | `ProgressIndicator` | Re-export |
| `./radio.js` | `RadioButton, checkedRadio, collectRadioGroup` | Re-export |
| `./slider.js` | `Slider` | Re-export |
| `./widget.js` | `Insets, UIWidget, UI_LAYOUT_AUTHORITY, UI_STAGED, applyInsets, collectPickables, focusedWidget, isUIWidget, registerAccessibilitySync` | Re-export |
| `./control-registry.js` | `UIControlConstructor` | Re-export (type-only) |
| `./accessibility.js` | `AccessibilityMirror, AccessibilityMirrorOptions, AccessibilityMirrorRoot, DocumentLike, ElementLike, ElementStyleLike` | Re-export (type-only) |
| `./button.js` | `ButtonOptions` | Re-export (type-only) |
| `./canvas-view.js` | `CanvasViewWidgetOptions` | Re-export (type-only) |
| `./checkable.js` | `CheckableWidgetOptions, CheckboxOptions, ToggleOptions` | Re-export (type-only) |
| `./image.js` | `ImageWidgetOptions` | Re-export (type-only) |
| `./keyboard.js` | `KeyboardTraversalOptions` | Re-export (type-only) |
| `./label.js` | `LabelOptions` | Re-export (type-only) |
| `./panel.js` | `LayoutAlign, LayoutDirection, LayoutJustify, LayoutType, PanelLayout, PanelOptions` | Re-export (type-only) |
| `./progress.js` | `ProgressIndicatorOptions` | Re-export (type-only) |
| `./radio.js` | `RadioButtonOptions` | Re-export (type-only) |
| `./slider.js` | `SliderOptions, SliderOrientation` | Re-export (type-only) |
| `./widget.js` | `AccessibilitySync, InsetsInit, UIFocusEvent, UIWidgetOptions, WidgetAccessibility, WidgetActivateEvent, WidgetActivationSource, WidgetSkin, WidgetStateChangeEvent, WidgetStateSnapshot, WidgetValueChangeEvent` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `UI_CONTROLS`, `UIControlRegistry`, `accessibilityElementId`, `installAccessibilityMirror`, `prefersReducedMotion`, `Button`, `CanvasViewWidget`, `CheckableWidget`, `Checkbox`, `Toggle`, `ImageWidget`, `collectFocusOrder`, `installKeyboardTraversal`, `keyboardFocusTarget`, `Label`, `Panel`, `ProgressIndicator`, `RadioButton`, `checkedRadio`, `collectRadioGroup`, `Slider`, `Insets`, `UIWidget`, `UI_LAYOUT_AUTHORITY`, `UI_STAGED`, `applyInsets`, `collectPickables`, `focusedWidget`, `isUIWidget`, `registerAccessibilitySync`, `UIControlConstructor`, `AccessibilityMirror`, `AccessibilityMirrorOptions`, `AccessibilityMirrorRoot`, `DocumentLike`, `ElementLike`, `ElementStyleLike`, `ButtonOptions`, `CanvasViewWidgetOptions`, `CheckableWidgetOptions`, `CheckboxOptions`, `ToggleOptions`, `ImageWidgetOptions`, `KeyboardTraversalOptions`, `LabelOptions`, `LayoutAlign`, `LayoutDirection`, `LayoutJustify`, `LayoutType`, `PanelLayout`, `PanelOptions`, `ProgressIndicatorOptions`, `RadioButtonOptions`, `SliderOptions`, `SliderOrientation`, `AccessibilitySync`, `InsetsInit`, `UIFocusEvent`, `UIWidgetOptions`, `WidgetAccessibility`, `WidgetActivateEvent`, `WidgetActivationSource`, `WidgetSkin`, `WidgetStateChangeEvent`, `WidgetStateSnapshot`, `WidgetValueChangeEvent`

---

### `packages/ui/src/accessibility.ts` - §75's hidden DOM accessibility mirror (2026-09-06, A-13 remainder).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Disposable, Unsubscribe` |
| `@fourjs/scene` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./button.js` | `Button` | Import |
| `./checkable.js` | `Checkbox, Toggle` | Import |
| `./progress.js` | `ProgressIndicator` | Import |
| `./radio.js` | `RadioButton` | Import |
| `./slider.js` | `Slider` | Import |
| `./widget.js` | `registerAccessibilitySync, UIWidget, WidgetAccessibility` | Import |

**Exports:**
- Interfaces: `DocumentLike`, `ElementStyleLike`, `ElementLike`, `AccessibilityMirrorOptions`, `AccessibilityMirror`
- Types: `AccessibilityMirrorRoot`
- Functions: `prefersReducedMotion`, `installAccessibilityMirror`, `accessibilityElementId`

---

### `packages/ui/src/widget.ts` - `UIWidget` (§73–§75) — the retained-mode UI layer's base class: a scene node

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Disposable, Unsubscribe` |
| `@fourjs/input` | `Pickable, ScenePointerEvent` |
| `@fourjs/math` | `Vector2, Vector3` |
| `@fourjs/scene` | `Node, warnAuthorityConflict, NodeOptions` |

**Exports:**
- Classes: `Insets`
- Interfaces: `WidgetStateSnapshot`, `WidgetStateChangeEvent`, `WidgetActivateEvent`, `WidgetValueChangeEvent`, `UIFocusEvent`, `WidgetAccessibility`, `WidgetSkin`, `UIWidgetOptions`
- Types: `InsetsInit`, `WidgetActivationSource`, `AccessibilitySync`
- Functions: `applyInsets`, `registerAccessibilitySync`, `focusedWidget`, `isUIWidget`, `collectPickables`
- Constants: `UI_LAYOUT_AUTHORITY`, `UI_STAGED`

---

### `packages/ui/src/image.ts` - `ImageWidget` (§73's "image") — a box, a source key, and an intrinsic size

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector2` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./numbers.js` | `requireNonNegative` | Import |
| `./widget.js` | `UIWidget, UIWidgetOptions` | Import |

**Exports:**
- Classes: `ImageWidget`
- Interfaces: `ImageWidgetOptions`

---

### `packages/ui/src/control-registry.ts` - The §81 UI-control registry — a named map of widget constructors a host

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./widget.js` | `UIWidget` | Import (type-only) |

**Exports:**
- Classes: `UIControlRegistry`
- Types: `UIControlConstructor`

---

### `packages/ui/src/button.ts` - `Button` (§73) — the one control in this MVP that *does* something: a §72

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/input` | `ScenePointerEvent, SceneKeyEvent` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./panel.js` | `Panel, PanelOptions` | Import |
| `./widget.js` | `WidgetActivationSource` | Import (type-only) |

**Exports:**
- Classes: `Button`
- Types: `ButtonOptions`

---

### `packages/ui/src/checkable.ts` - `Toggle` and `Checkbox` (§73), over the checkable base they share

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./button.js` | `Button, ButtonOptions` | Import |

**Exports:**
- Classes: `Toggle`, `Checkbox`
- Interfaces: `CheckableWidgetOptions`
- Types: `ToggleOptions`, `CheckboxOptions`

---

### `packages/ui/src/panel.ts` - `Panel` (§73) and the layout engine (§74) — the container widget, and the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector2` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./widget.js` | `UIWidget, applyInsets, InsetsInit, UIWidgetOptions` | Import |

**Exports:**
- Classes: `Panel`
- Interfaces: `PanelLayout`, `PanelOptions`
- Types: `LayoutType`, `LayoutDirection`, `LayoutJustify`, `LayoutAlign`

---

### `packages/ui/src/numbers.ts` - Numeric guards and range arithmetic shared by the §73 controls that carry a

**Exports:**
- Functions: `requireFinite`, `requireNonNegative`, `resolveValue`, `fractionOf`

---

### `packages/ui/src/keyboard.ts` - §75's keyboard navigation: Tab traversal over a widget tree (2026-08-07,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Unsubscribe` |
| `@fourjs/input` | `SceneKeyEvent` |
| `@fourjs/scene` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./widget.js` | `UIWidget, focusedWidget` | Import |

**Exports:**
- Interfaces: `KeyboardTraversalOptions`
- Functions: `collectFocusOrder`, `keyboardFocusTarget`, `installKeyboardTraversal`

---

### `packages/ui/src/progress.ts` - `ProgressIndicator` (§73) — a value shown, never edited (2026-08-07, A-12).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./numbers.js` | `fractionOf, requireFinite` | Import |
| `./panel.js` | `Panel, PanelOptions` | Import |

**Exports:**
- Classes: `ProgressIndicator`
- Interfaces: `ProgressIndicatorOptions`

---

<a id="packages-text-dependencies"></a>

## Packages/text Dependencies

### `packages/text/src/index.ts` - `@fourjs/text` — bitmap text at §56's MVP tier.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./bitmap-font.js` | `BUILTIN_FONT, createBitmapFont, glyphFor, glyphPixel, glyphToAscii` | Re-export |
| `./glyph-atlas.js` | `buildGlyphAtlas` | Re-export |
| `./text-layout.js` | `layoutText` | Re-export |
| `./bitmap-font.js` | `BitmapFont, BitmapFontOptions, BitmapGlyph` | Re-export (type-only) |
| `./glyph-atlas.js` | `GlyphAtlas, GlyphAtlasEntry, GlyphAtlasOptions` | Re-export (type-only) |
| `./text-layout.js` | `TextAlign, TextLayout, TextLayoutOptions, TextQuad` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `BUILTIN_FONT`, `createBitmapFont`, `glyphFor`, `glyphPixel`, `glyphToAscii`, `buildGlyphAtlas`, `layoutText`, `BitmapFont`, `BitmapFontOptions`, `BitmapGlyph`, `GlyphAtlas`, `GlyphAtlasEntry`, `GlyphAtlasOptions`, `TextAlign`, `TextLayout`, `TextLayoutOptions`, `TextQuad`

---

### `packages/text/src/glyph-atlas.ts` - `buildGlyphAtlas` (§56 MVP tier) — every glyph of a {@link BitmapFont} packed

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./bitmap-font.js` | `BitmapFont, BitmapGlyph` | Import (type-only) |
| `./bitmap-font.js` | `BUILTIN_FONT, glyphPixel` | Import |

**Exports:**
- Interfaces: `GlyphAtlasEntry`, `GlyphAtlas`, `GlyphAtlasOptions`
- Functions: `buildGlyphAtlas`

---

### `packages/text/src/text-layout.ts` - `layoutText` (§56 MVP tier) — a string plus a {@link GlyphAtlas} becomes a

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./glyph-atlas.js` | `GlyphAtlas, GlyphAtlasEntry` | Import (type-only) |

**Exports:**
- Interfaces: `TextQuad`, `TextLayoutOptions`, `TextLayout`
- Types: `TextAlign`
- Functions: `layoutText`

---

### `packages/text/src/bitmap-font.ts` - A built-in, dependency-free monospace bitmap font (§56 MVP tier).

**Exports:**
- Interfaces: `BitmapGlyph`, `BitmapFont`, `BitmapFontOptions`
- Functions: `createBitmapFont`, `glyphFor`, `glyphPixel`, `glyphToAscii`
- Constants: `BUILTIN_FONT`

---

<a id="packages-math-dependencies"></a>

## Packages/math Dependencies

### `packages/math/src/quaternion.ts` - Above this dot product the two ends of a {@link Quaternion.slerp} are treated

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./alloc-counter.js` | `noteConstruction` | Import |
| `./vector3.js` | `Vector3` | Import (type-only) |

**Exports:**
- Classes: `Quaternion`
- Functions: `setQuaternionFromBasis`

---

### `packages/math/src/index.ts` - Package entry point for @fourjs/math (re-exports 22 symbols)

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./alloc-counter.js` | `constructionCount, resetConstructionCount` | Re-export |
| `./color.js` | `linearToSrgb, linearToSrgbRGB, linearToSrgbRGBA, parseColor, parseColorRGB, srgbToLinear, srgbToLinearRGB, srgbToLinearRGBA` | Re-export |
| `./frustum.js` | `Frustum` | Re-export |
| `./matrix3.js` | `Matrix3` | Re-export |
| `./matrix4.js` | `Matrix4` | Re-export |
| `./quaternion.js` | `Quaternion` | Re-export |
| `./rectangle2.js` | `Rectangle2` | Re-export |
| `./vector2.js` | `Vector2` | Re-export |
| `./vector3.js` | `Vector3` | Re-export |
| `./vector4.js` | `Vector4` | Re-export |
| `./color.js` | `ColorRGB, ColorRGBA, ColorSpace` | Re-export (type-only) |
| `./matrix4.js` | `DepthRange` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `constructionCount`, `resetConstructionCount`, `linearToSrgb`, `linearToSrgbRGB`, `linearToSrgbRGBA`, `parseColor`, `parseColorRGB`, `srgbToLinear`, `srgbToLinearRGB`, `srgbToLinearRGBA`, `Frustum`, `Matrix3`, `Matrix4`, `Quaternion`, `Rectangle2`, `Vector2`, `Vector3`, `Vector4`, `ColorRGB`, `ColorRGBA`, `ColorSpace`, `DepthRange`

---

### `packages/math/src/matrix3.ts` - Mutable 3×3 matrix stored **column-major** in a `Float64Array(9)` (§7b).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./alloc-counter.js` | `noteConstruction` | Import |
| `./matrix4.js` | `Matrix4` | Import (type-only) |

**Exports:**
- Classes: `Matrix3`

---

### `packages/math/src/rectangle2.ts` - Default tolerance for {@link Rectangle2.equalsApprox}. See `vector2.ts` for

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./alloc-counter.js` | `noteConstruction` | Import |

**Exports:**
- Classes: `Rectangle2`

---

### `packages/math/src/color.ts` - Colour value types, the sRGB transfer functions, and CSS colour-string

**Exports:**
- Types: `ColorRGB`, `ColorRGBA`, `ColorSpace`
- Functions: `srgbToLinear`, `linearToSrgb`, `srgbToLinearRGB`, `linearToSrgbRGB`, `srgbToLinearRGBA`, `linearToSrgbRGBA`, `parseColor`, `parseColorRGB`

---

### `packages/math/src/alloc-counter.ts` - Allocation instrumentation for the math types (§7b, §83).

**Exports:**
- Functions: `noteConstruction`, `constructionCount`, `resetConstructionCount`

---

### `packages/math/src/vector2.ts` - Default tolerance for {@link Vector2.equalsApprox}. Chosen to sit a little

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./alloc-counter.js` | `noteConstruction` | Import |

**Exports:**
- Classes: `Vector2`

---

### `packages/math/src/vector3.ts` - Default tolerance for {@link Vector3.equalsApprox}. See `vector2.ts` for the

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./alloc-counter.js` | `noteConstruction` | Import |

**Exports:**
- Classes: `Vector3`

---

### `packages/math/src/matrix4.ts` - Clip-space depth convention of a projection matrix (plan D8).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./alloc-counter.js` | `noteConstruction` | Import |
| `./quaternion.js` | `setQuaternionFromBasis, Quaternion` | Import |
| `./vector3.js` | `Vector3` | Import (type-only) |

**Exports:**
- Classes: `Matrix4`
- Types: `DepthRange`

---

### `packages/math/src/frustum.ts` - The six clip planes of a view-projection matrix (§87) — the primitive a

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./matrix4.js` | `DepthRange, Matrix4` | Import (type-only) |
| `./vector3.js` | `Vector3` | Import (type-only) |

**Exports:**
- Classes: `Frustum`

---

### `packages/math/src/vector4.ts` - Default tolerance for {@link Vector4.equalsApprox}. See `vector2.ts` for the

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./alloc-counter.js` | `noteConstruction` | Import |

**Exports:**
- Classes: `Vector4`

---

<a id="packages-render-svg-dependencies"></a>

## Packages/render svg Dependencies

### `packages/render-svg/src/index.ts` - Entry point exporting 1 symbols

**Exports:**
- Constants: `PACKAGE_NAME`

---

<a id="packages-physics-box2d-dependencies"></a>

## Packages/physics box2d Dependencies

### `packages/physics-box2d/src/index.ts` - Entry point exporting 1 symbols

**Exports:**
- Constants: `PACKAGE_NAME`

---

<a id="packages-scene-dependencies"></a>

## Packages/scene Dependencies

### `packages/scene/src/transform.ts` - Local/world transform of a scene node (§7).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Matrix4, Quaternion, Vector3` |

**Exports:**
- Classes: `Transform`

---

### `packages/scene/src/layers.ts` - Symbolic layers and their compiled masks (§46).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Exports:**
- Interfaces: `LayeredNode`
- Types: `LayerMask`
- Functions: `defineLayer`, `layerIndex`, `layerName`, `layerNames`, `layerMask`, `layerMaskNames`, `layersMatch`, `isLayerMask`, `assertLayerMask`, `applyLayers`, `resetLayers`
- Constants: `LAYER_COUNT`, `DEFAULT_LAYER_NAME`, `DEFAULT_LAYER`, `DEFAULT_LAYER_MASK`, `ALL_LAYERS`, `NO_LAYERS`

---

### `packages/scene/src/node-space.ts` - §8's node-level space declaration — {@link NodeSpace} (PH-12 remainder).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEFAULT_SPACE_MODE, SPACE_MODES, Component, ComponentHost, JsonValue, SpaceMode` |
| `@fourjs/math` | `Vector3` |

**Exports:**
- Classes: `NodeSpace`
- Interfaces: `NodeSpaceSerializerShape`, `NodeSpaceOptions`
- Constants: `NODE_SPACE_SERIALIZER`

---

### `packages/scene/src/index.ts` - Package entry point for @fourjs/scene (re-exports 86 symbols)

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./authority.js` | `DEFAULT_TRANSFORM_AUTHORITY, TRANSFORM_AUTHORITIES, warnAuthorityConflict` | Re-export |
| `./camera.js` | `Camera, OrthographicCamera, PerspectiveCamera` | Re-export |
| `./screen-camera.js` | `DEFAULT_SCREEN_FAR, DEFAULT_SCREEN_NEAR, DEFAULT_SCREEN_ORIGIN, DEFAULT_SCREEN_UNITS, SCREEN_ORIGINS, SCREEN_UNITS, ScreenCamera` | Re-export |
| `./trackball.js` | `DEFAULT_TRACKBALL_RADIUS, TrackballRig` | Re-export |
| `./group.js` | `Group` | Re-export |
| `./node-space.js` | `NODE_SPACE_SERIALIZER, NodeSpace` | Re-export |
| `./layers.js` | `ALL_LAYERS, DEFAULT_LAYER, DEFAULT_LAYER_MASK, DEFAULT_LAYER_NAME, LAYER_COUNT, NO_LAYERS, applyLayers, assertLayerMask, defineLayer, isLayerMask, layerIndex, layerMask, layerMaskNames, layerName, layerNames, layersMatch, resetLayers` | Re-export |
| `./light.js` | `DirectionalLight, DirectionalLightShadow, HemisphereLight, PointLight, PunctualLight, SpotLight` | Re-export |
| `./interpolation.js` | `POSE_SNAPSHOT_PRIORITY, PoseBuffer, createSnapshotSystem` | Re-export |
| `./node.js` | `Node, restoreNodeId` | Re-export |
| `./pose-target.js` | `PoseTarget` | Re-export |
| `./skeleton.js` | `Bone, MORPH_WEIGHTS_SERIALIZER, MorphWeights, Skeleton` | Re-export |
| `./scene.js` | `Scene` | Re-export |
| `./transform.js` | `Transform` | Re-export |
| `./viewport.js` | `createFullscreenViewport` | Re-export |
| `./world-transforms.js` | `resolveWorldTransform, resolveWorldTransforms` | Re-export |
| `./authority.js` | `AuthorityNode, TransformAuthority` | Re-export (type-only) |
| `./camera.js` | `OrthographicCameraOptions, PerspectiveCameraOptions` | Re-export (type-only) |
| `./screen-camera.js` | `ScreenCameraOptions, ScreenOrigin, ScreenUnits, SurfaceSizedCamera` | Re-export (type-only) |
| `./trackball.js` | `TrackballRigOptions` | Re-export (type-only) |
| `./node-space.js` | `NodeSpaceOptions, NodeSpaceSerializerShape` | Re-export (type-only) |
| `./layers.js` | `LayerMask, LayeredNode` | Re-export (type-only) |
| `./light.js` | `ColorRGB, DirectionalLightOptions, HemisphereLightOptions, LightColorInput, DirectionalLightShadowOptions, PunctualLightOptions, SpotLightOptions` | Re-export (type-only) |
| `./interpolation.js` | `PoseSnapshotSystem, SnapshotSystemOptions` | Re-export (type-only) |
| `./node.js` | `HitTestMode, NodeEventMap, NodeHierarchyEvent, NodeOptions, NodeType` | Re-export (type-only) |
| `./skeleton.js` | `MorphWeightsSerializerShape` | Re-export (type-only) |
| `./viewport.js` | `Viewport` | Re-export (type-only) |
| `./world-transforms.js` | `WorldTransformStats` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `DEFAULT_TRANSFORM_AUTHORITY`, `TRANSFORM_AUTHORITIES`, `warnAuthorityConflict`, `Camera`, `OrthographicCamera`, `PerspectiveCamera`, `DEFAULT_SCREEN_FAR`, `DEFAULT_SCREEN_NEAR`, `DEFAULT_SCREEN_ORIGIN`, `DEFAULT_SCREEN_UNITS`, `SCREEN_ORIGINS`, `SCREEN_UNITS`, `ScreenCamera`, `DEFAULT_TRACKBALL_RADIUS`, `TrackballRig`, `Group`, `NODE_SPACE_SERIALIZER`, `NodeSpace`, `ALL_LAYERS`, `DEFAULT_LAYER`, `DEFAULT_LAYER_MASK`, `DEFAULT_LAYER_NAME`, `LAYER_COUNT`, `NO_LAYERS`, `applyLayers`, `assertLayerMask`, `defineLayer`, `isLayerMask`, `layerIndex`, `layerMask`, `layerMaskNames`, `layerName`, `layerNames`, `layersMatch`, `resetLayers`, `DirectionalLight`, `DirectionalLightShadow`, `HemisphereLight`, `PointLight`, `PunctualLight`, `SpotLight`, `POSE_SNAPSHOT_PRIORITY`, `PoseBuffer`, `createSnapshotSystem`, `Node`, `restoreNodeId`, `PoseTarget`, `Bone`, `MORPH_WEIGHTS_SERIALIZER`, `MorphWeights`, `Skeleton`, `Scene`, `Transform`, `createFullscreenViewport`, `resolveWorldTransform`, `resolveWorldTransforms`, `AuthorityNode`, `TransformAuthority`, `OrthographicCameraOptions`, `PerspectiveCameraOptions`, `ScreenCameraOptions`, `ScreenOrigin`, `ScreenUnits`, `SurfaceSizedCamera`, `TrackballRigOptions`, `NodeSpaceOptions`, `NodeSpaceSerializerShape`, `LayerMask`, `LayeredNode`, `ColorRGB`, `DirectionalLightOptions`, `HemisphereLightOptions`, `LightColorInput`, `DirectionalLightShadowOptions`, `PunctualLightOptions`, `SpotLightOptions`, `PoseSnapshotSystem`, `SnapshotSystemOptions`, `HitTestMode`, `NodeEventMap`, `NodeHierarchyEvent`, `NodeOptions`, `NodeType`, `MorphWeightsSerializerShape`, `Viewport`, `WorldTransformStats`

---

### `packages/scene/src/skeleton.ts` - Bones, skeletons, and morph weights (§54, §14, §17; RFC 0003 — gaps PH-10 +

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError, Component, ComponentHost, JsonValue` |
| `@fourjs/math` | `Matrix4` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./node.js` | `Node` | Import |
| `./world-transforms.js` | `resolveWorldTransform` | Import |

**Exports:**
- Classes: `Bone`, `Skeleton`, `MorphWeights`
- Interfaces: `MorphWeightsSerializerShape`
- Constants: `MORPH_WEIGHTS_SERIALIZER`

---

### `packages/scene/src/group.ts` - `Group` (§6, §104) — a concrete {@link Node} with no behavior of its own.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./node.js` | `Node` | Import |

**Exports:**
- Classes: `Group`

---

### `packages/scene/src/screen-camera.ts` - §47's `ScreenCamera` — the pixel-rectangle camera (R-37, 2026-08-21).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `DepthRange` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./camera.js` | `Camera` | Import |

**Exports:**
- Classes: `ScreenCamera`
- Interfaces: `SurfaceSizedCamera`, `ScreenCameraOptions`
- Types: `ScreenOrigin`, `ScreenUnits`
- Constants: `SCREEN_ORIGINS`, `SCREEN_UNITS`, `DEFAULT_SCREEN_ORIGIN`, `DEFAULT_SCREEN_UNITS`, `DEFAULT_SCREEN_NEAR`, `DEFAULT_SCREEN_FAR`

---

### `packages/scene/src/light.ts` - Lights (§68) — the multi-light tier: directional, point, and spot nodes.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Matrix4, parseColorRGB, srgbToLinearRGB, ColorRGB, Vector3` |
| `@fourjs/math` | `ColorRGB` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./node.js` | `Node` | Import |
| `./world-transforms.js` | `resolveWorldTransform` | Import |

**Exports:**
- Classes: `DirectionalLightShadow`, `DirectionalLight`, `HemisphereLight`, `PointLight`, `SpotLight`
- Interfaces: `DirectionalLightShadowOptions`, `DirectionalLightOptions`, `HemisphereLightOptions`, `PunctualLightOptions`, `SpotLightOptions`
- Types: `LightColorInput`
- Re-exports: `ColorRGB`

---

### `packages/scene/src/trackball.ts` - §44/§47's **trackball** rig (R-37, 2026-08-21) — the last of the seven camera

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Quaternion, Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./authority.js` | `warnAuthorityConflict` | Import |
| `./node.js` | `Node` | Import (type-only) |
| `./screen-camera.js` | `DEFAULT_SCREEN_ORIGIN, ScreenOrigin` | Import |

**Exports:**
- Classes: `TrackballRig`
- Interfaces: `TrackballRigOptions`
- Constants: `DEFAULT_TRACKBALL_RADIUS`

---

### `packages/scene/src/world-transforms.ts` - World-transform resolution (§7) — the single writer of every

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Matrix4` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./node.js` | `Node` | Import (type-only) |
| `./transform.js` | `Transform` | Import (type-only) |

**Exports:**
- Interfaces: `WorldTransformStats`
- Functions: `resolveWorldTransforms`, `resolveWorldTransform`

---

### `packages/scene/src/pose-target.ts` - The `PoseTarget` component (§6a, §19, §42) — the pose animation *asks* for,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Component, ComponentHost` |
| `@fourjs/math` | `Quaternion, Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./transform.js` | `Transform` | Import (type-only) |

**Exports:**
- Classes: `PoseTarget`

---

### `packages/scene/src/scene.ts` - `Scene` (§6, §46, §104) — the root node, plus the indexed lookups of §46.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Component, ComponentType` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./light.js` | `ColorRGB` | Import (type-only) |
| `./node.js` | `Node, NodeType` | Import |

**Exports:**
- Classes: `Scene`

---

### `packages/scene/src/camera.ts` - Cameras (§47).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Matrix4, DepthRange` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./layers.js` | `ALL_LAYERS, LayerMask` | Import |
| `./node.js` | `Node` | Import |
| `./world-transforms.js` | `resolveWorldTransform` | Import |

**Exports:**
- Classes: `PerspectiveCamera`, `OrthographicCamera`
- Interfaces: `PerspectiveCameraOptions`, `OrthographicCameraOptions`

---

### `packages/scene/src/authority.ts` - Transform authority (§42).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV_WARNING_PREFIX` |

**Exports:**
- Interfaces: `AuthorityNode`
- Types: `TransformAuthority`
- Functions: `warnAuthorityConflict`
- Constants: `TRANSFORM_AUTHORITIES`, `DEFAULT_TRANSFORM_AUTHORITY`

---

### `packages/scene/src/interpolation.ts` - Previous/current pose storage and render interpolation (§43).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Quaternion, Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./node.js` | `Node` | Import (type-only) |

**Exports:**
- Classes: `PoseBuffer`
- Interfaces: `SnapshotSystemOptions`, `PoseSnapshotSystem`
- Functions: `createSnapshotSystem`
- Constants: `POSE_SNAPSHOT_PRIORITY`

---

### `packages/scene/src/viewport.ts` - Viewports (§48).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./camera.js` | `Camera` | Import (type-only) |
| `./layers.js` | `LayerMask` | Import (type-only) |

**Exports:**
- Interfaces: `Viewport`
- Functions: `createFullscreenViewport`

---

### `packages/scene/src/node.ts` - The unified node model (§6), its component delegation (§6a), and its event

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `ComponentRegistry, DEV_WARNING_PREFIX, EventEmitter, FourError, Component, ComponentHost, ComponentType` |
| `@fourjs/math` | `Quaternion, Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./authority.js` | `DEFAULT_TRANSFORM_AUTHORITY, TransformAuthority` | Import |
| `./layers.js` | `DEFAULT_LAYER_MASK, LayerMask` | Import |
| `./transform.js` | `Transform` | Import |
| `./world-transforms.js` | `resolveWorldTransform` | Import |

**Exports:**
- Interfaces: `NodeHierarchyEvent`, `NodeEventMap`, `NodeOptions`
- Types: `NodeType`, `HitTestMode`
- Functions: `restoreNodeId`

---

<a id="packages-assets-dependencies"></a>

## Packages/assets Dependencies

### `packages/assets/src/gltf.ts` - The §78 glTF 2.0 loader — the **parse tier** (A-19's last half, 2026-08-29).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError, cloneJsonValue, devWarnOnce, isFourError, parseUntrustedJson, Disposable, JsonValue` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./asset-manager.js` | `DEFAULT_MAXIMUM_BYTES, resolveGlobalFetch, AssetLoadContext, AssetLoader, FetchLike, FetchResponse` | Import |
| `./content-hash.js` | `resolveGlobalTextDecoder, TextDecodeLike` | Import |
| `./texture.js` | `createTextureDecoder, TexelDecodeLike, TexelProbeLike, TextureAsset, TextureFilterMode, TextureWrapMode` | Import |

**Exports:**
- Classes: `GltfAsset`
- Interfaces: `GltfPrimitiveRecord`, `GltfMeshRecord`, `GltfMaterialRecord`, `GltfNodeRecord`, `GltfSceneRecord`, `GltfSkinRecord`, `GltfChannelRecord`, `GltfAnimationRecord`, `GltfLoaderOptions`
- Types: `GltfPrimitiveMode`, `GltfChannelPath`
- Functions: `createGltfLoader`

---

### `packages/assets/src/capabilities.ts` - This package's §81 capability token (RFC 0002).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `defineCapability` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./loader-registry.js` | `AssetLoaderRegistry` | Import (type-only) |

**Exports:**
- Constants: `ASSET_LOADERS`

---

### `packages/assets/src/index.ts` - `@fourjs/assets` — the asset system (§76–78).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./capabilities.js` | `ASSET_LOADERS` | Re-export |
| `./loader-registry.js` | `AssetLoaderRegistry` | Re-export |
| `./asset-manager.js` | `AssetManager, DEFAULT_MAXIMUM_BYTES, DEFAULT_TIMEOUT_SECONDS` | Re-export |
| `./content-hash.js` | `CONTENT_HASH_ALGORITHM` | Re-export |
| `./manifest.js` | `loadFromManifest, manifestLoader, manifestUrl, parseAssetManifest` | Re-export |
| `./texture.js` | `DEFAULT_MAXIMUM_DECODED_BYTES, DEFAULT_MAXIMUM_EXPANSION_RATIO, TextureAsset, createTextureDecoder, createTextureLoader` | Re-export |
| `./gltf.js` | `GltfAsset, createGltfLoader` | Re-export |
| `./loaders.js` | `ImageAsset, binaryLoader, createImageLoader, jsonLoader, textLoader` | Re-export |
| `./loader-registry.js` | `RegisteredAssetLoader` | Re-export (type-only) |
| `./asset-manager.js` | `AbortHandle, AbortSignalLike, AssetGraph, AssetGraphLoadOptions, AssetLoadOptions, AssetLoadContext, AssetLoader, AssetManagerOptions, AssetProgressEvent, AssetWatchLike, AssetWithDependencies, ByteReaderLike, FetchInit, FetchLike, FetchResponse, ReadableBodyLike, ResponseHeadersLike, TimerLike, WorkerLike` | Re-export (type-only) |
| `./content-hash.js` | `DigestLike, TextDecodeLike` | Re-export (type-only) |
| `./manifest.js` | `AssetManifest, AssetManifestEntry, ManifestLoadOptions, ManifestParseOptions` | Re-export (type-only) |
| `./texture.js` | `DecodedTexels, TexelDecodeLike, TexelProbeLike, TextureColorSpace, TextureFilterMode, TextureLoaderOptions, TextureWrapMode` | Re-export (type-only) |
| `./gltf.js` | `GltfAnimationRecord, GltfChannelPath, GltfChannelRecord, GltfLoaderOptions, GltfMaterialRecord, GltfMeshRecord, GltfNodeRecord, GltfPrimitiveMode, GltfPrimitiveRecord, GltfSceneRecord, GltfSkinRecord` | Re-export (type-only) |
| `./loaders.js` | `ImageBitmapLike, ImageDecodeLike` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `ASSET_LOADERS`, `AssetLoaderRegistry`, `AssetManager`, `DEFAULT_MAXIMUM_BYTES`, `DEFAULT_TIMEOUT_SECONDS`, `CONTENT_HASH_ALGORITHM`, `loadFromManifest`, `manifestLoader`, `manifestUrl`, `parseAssetManifest`, `DEFAULT_MAXIMUM_DECODED_BYTES`, `DEFAULT_MAXIMUM_EXPANSION_RATIO`, `TextureAsset`, `createTextureDecoder`, `createTextureLoader`, `GltfAsset`, `createGltfLoader`, `ImageAsset`, `binaryLoader`, `createImageLoader`, `jsonLoader`, `textLoader`, `RegisteredAssetLoader`, `AbortHandle`, `AbortSignalLike`, `AssetGraph`, `AssetGraphLoadOptions`, `AssetLoadOptions`, `AssetLoadContext`, `AssetLoader`, `AssetManagerOptions`, `AssetProgressEvent`, `AssetWatchLike`, `AssetWithDependencies`, `ByteReaderLike`, `FetchInit`, `FetchLike`, `FetchResponse`, `ReadableBodyLike`, `ResponseHeadersLike`, `TimerLike`, `WorkerLike`, `DigestLike`, `TextDecodeLike`, `AssetManifest`, `AssetManifestEntry`, `ManifestLoadOptions`, `ManifestParseOptions`, `DecodedTexels`, `TexelDecodeLike`, `TexelProbeLike`, `TextureColorSpace`, `TextureFilterMode`, `TextureLoaderOptions`, `TextureWrapMode`, `GltfAnimationRecord`, `GltfChannelPath`, `GltfChannelRecord`, `GltfLoaderOptions`, `GltfMaterialRecord`, `GltfMeshRecord`, `GltfNodeRecord`, `GltfPrimitiveMode`, `GltfPrimitiveRecord`, `GltfSceneRecord`, `GltfSkinRecord`, `ImageBitmapLike`, `ImageDecodeLike`

---

### `packages/assets/src/texture.ts` - The texture loader tier (§77's asset half, A-19 — 2026-08-21).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError, Disposable` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./asset-manager.js` | `AssetLoader, FetchResponse` | Import (type-only) |

**Exports:**
- Classes: `TextureAsset`
- Interfaces: `DecodedTexels`, `TextureLoaderOptions`
- Types: `TextureColorSpace`, `TextureFilterMode`, `TextureWrapMode`, `TexelDecodeLike`, `TexelProbeLike`
- Functions: `createTextureDecoder`, `createTextureLoader`
- Constants: `DEFAULT_MAXIMUM_DECODED_BYTES`, `DEFAULT_MAXIMUM_EXPANSION_RATIO`

---

### `packages/assets/src/asset-manager.ts` - The asset manager (§76) — one cache, one refcount, one fetch per asset.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, FourError, devWarnOnce, disposeAll, isFourError, Disposable` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./content-hash.js` | `resolveGlobalDigest, resolveGlobalTextDecoder, DigestLike, TextDecodeLike` | Import |

**Exports:**
- Classes: `AssetManager`
- Interfaces: `FetchResponse`, `ReadableBodyLike`, `ByteReaderLike`, `AssetProgressEvent`, `WorkerLike`, `AssetWithDependencies`, `AssetGraph`, `AssetGraphLoadOptions`, `ResponseHeadersLike`, `TimerLike`, `AssetLoadContext`, `FetchInit`, `AbortHandle`, `AbortSignalLike`, `AssetLoadOptions`, `AssetLoader`, `AssetManagerOptions`
- Types: `AssetWatchLike`, `FetchLike`
- Functions: `resolveGlobalFetch`
- Constants: `DEFAULT_MAXIMUM_BYTES`, `DEFAULT_TIMEOUT_SECONDS`

---

### `packages/assets/src/loader-registry.ts` - The §81 asset-format registry — a named map of {@link AssetLoader}s a

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./asset-manager.js` | `AssetLoader` | Import (type-only) |

**Exports:**
- Classes: `AssetLoaderRegistry`
- Types: `RegisteredAssetLoader`

---

### `packages/assets/src/manifest.ts` - The §79 asset manifest — logical key → URL + content hash.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./asset-manager.js` | `AssetLoader, AssetLoadOptions` | Import (type-only) |
| `./asset-manager.js` | `AssetManager` | Import |

**Exports:**
- Interfaces: `AssetManifestEntry`, `ManifestLoadOptions`, `ManifestParseOptions`
- Types: `AssetManifest`
- Functions: `parseAssetManifest`, `loadFromManifest`, `manifestUrl`
- Constants: `manifestLoader`

---

### `packages/assets/src/content-hash.ts` - Content hashing (§76's last-but-one capability, §79's manifest half).

**Exports:**
- Types: `DigestLike`, `TextDecodeLike`
- Functions: `resolveGlobalDigest`, `resolveGlobalTextDecoder`
- Constants: `CONTENT_HASH_ALGORITHM`

---

### `packages/assets/src/loaders.ts` - The built-in loaders (§76) — text, JSON, binary, image.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./asset-manager.js` | `AssetLoader, FetchResponse` | Import (type-only) |

**Exports:**
- Classes: `ImageAsset`
- Interfaces: `ImageBitmapLike`
- Types: `ImageDecodeLike`
- Functions: `createImageLoader`
- Constants: `textLoader`, `jsonLoader`, `binaryLoader`

---

<a id="packages-physics-soft-dependencies"></a>

## Packages/physics soft Dependencies

### `packages/physics-soft/src/index.ts` - Entry point exporting 1 symbols

**Exports:**
- Constants: `PACKAGE_NAME`

---

<a id="packages-physics-rapier-dependencies"></a>

## Packages/physics rapier Dependencies

### `packages/physics-rapier/src/ccd.ts` - The §31 CCD-mode resolution both Rapier adapters share.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/physics` | `DEFAULT_ENABLED_CCD_MODE` |
| `@fourjs/physics` | `CCDMode, RigidBodyDescriptor` |

**Exports:**
- Functions: `resolveCcdMode`

---

### `packages/physics-rapier/src/index.ts` - `@fourjs/physics-rapier` — the Rapier solver adapters (§37, §102, §108).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./conversions2d.js` | `createRapierColliderDesc, createRapierShape, createRapierVector2, fromRapierAngle, fromRapierVector2, packInteractionGroups, quaternionToAngleZ, revoluteAxisSignZ, toRapierAngle, toRapierAngularScalar, toRapierBodyType, toRapierJointAxis2d, toRapierVector2` | Re-export |
| `./conversions3d.js` | `createRapierColliderDesc3d, createRapierRotation3, createRapierShape3d, createRapierVector3, fromRapierRotation3, fromRapierVector3, packInteractionGroups3d, rotateVectorByRotation3, toPrincipalInertia3d, toRapierAngularVector3, toRapierBodyType3d, toRapierRotation3, toRapierVector3` | Re-export |
| `./init.js` | `initializeRapier2d, rapier2dModule, rapier2dVersion` | Re-export |
| `./init.js` | `initializeRapier3d, rapier3dModule, rapier3dVersion` | Re-export |
| `./register.js` | `createRapierAdapter, isRapierSupported, registerRapierSolver` | Re-export |
| `./rapier2d-adapter.js` | `Rapier2dAdapter` | Re-export |
| `./rapier3d-adapter.js` | `Rapier3dAdapter` | Re-export |
| `./conversions2d.js` | `RapierVector2` | Re-export (type-only) |
| `./conversions3d.js` | `RapierRotation3, RapierVector3` | Re-export (type-only) |
| `./init.js` | `Rapier2dModule, Rapier3dModule` | Re-export (type-only) |
| `./rapier2d-adapter.js` | `RapierBodyAccess` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `createRapierColliderDesc`, `createRapierShape`, `createRapierVector2`, `fromRapierAngle`, `fromRapierVector2`, `packInteractionGroups`, `quaternionToAngleZ`, `revoluteAxisSignZ`, `toRapierAngle`, `toRapierAngularScalar`, `toRapierBodyType`, `toRapierJointAxis2d`, `toRapierVector2`, `createRapierColliderDesc3d`, `createRapierRotation3`, `createRapierShape3d`, `createRapierVector3`, `fromRapierRotation3`, `fromRapierVector3`, `packInteractionGroups3d`, `rotateVectorByRotation3`, `toPrincipalInertia3d`, `toRapierAngularVector3`, `toRapierBodyType3d`, `toRapierRotation3`, `toRapierVector3`, `initializeRapier2d`, `rapier2dModule`, `rapier2dVersion`, `initializeRapier3d`, `rapier3dModule`, `rapier3dVersion`, `createRapierAdapter`, `isRapierSupported`, `registerRapierSolver`, `Rapier2dAdapter`, `Rapier3dAdapter`, `RapierVector2`, `RapierRotation3`, `RapierVector3`, `Rapier2dModule`, `Rapier3dModule`, `RapierBodyAccess`

---

### `packages/physics-rapier/src/conversions2d.ts` - The §21/P5-3 mapping between the engine's 3D-typed physics API and Rapier's

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Quaternion, Vector3` |
| `@fourjs/physics` | `ALL_COLLISION_GROUPS, resolveAngularVelocity, resolveRotation` |
| `@fourjs/physics` | `AngularVelocityInput, BodyType, CollisionShape, RotationInput, Vector3Input` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./init.js` | `RAPIER_2D` | Import |
| `./init.js` | `RapierColliderDesc, RapierShape, RapierVector` | Import (type-only) |

**Exports:**
- Types: `RapierVector2`
- Functions: `createRapierVector2`, `toRapierVector2`, `fromRapierVector2`, `toRapierAngle`, `quaternionToAngleZ`, `fromRapierAngle`, `toRapierAngularScalar`, `toRapierBodyType`, `revoluteAxisSignZ`, `toRapierJointAxis2d`, `packInteractionGroups`, `createRapierShape`, `createRapierColliderDesc`, `requireHullDesc`

---

### `packages/physics-rapier/src/rapier2d-adapter.ts` - The Rapier 2D solver adapter (§37, §102, plan WP-5.4).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Quaternion, Vector3` |
| `@fourjs/math` | `Matrix3` |
| `@fourjs/physics` | `ALL_COLLISION_GROUPS, DEFAULT_FRICTION, DEFAULT_RESTITUTION, DETERMINISM_LEVELS, passesQueryFilter, resolveDensity, resolveGravity, resolveQueryOptions, resolveSleepingConfig, sortHitsByDistance, validateColliderDescriptor, validateJointDescriptor, validatePhysicsWorldOptions, validateQueryShape, validateRigidBodyDescriptor, rejectStalePhysicsHandle` |
| `@fourjs/physics` | `AngularVelocityInput, BodyType, CCDMode, ColliderDescriptor, ContactPoint, JointDescriptor, ShippedJointType, SolverBodyTuningAccess, SolverJointAccess, SolverJointMotor, OverlapHit, OverlapQuery, PhysicsBodyHandle, PhysicsCapabilities, PhysicsColliderHandle, PhysicsDimension, PhysicsEvent, PhysicsEventInterest, PhysicsJointHandle, PhysicsSolverAdapter, PhysicsWorldOptions, PointHit, PointQuery, QueryCandidate, RaycastHit, RaycastQuery, ResolvedQueryOptions, RigidBodyDescriptor, RotationInput, ShapeCastHit, ShapeCastQuery, SleepingConfig, Vector3Input` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./ccd.js` | `resolveCcdMode` | Import |
| `./conversions2d.js` | `createRapierColliderDesc, createRapierShape, createRapierVector2, fromRapierAngle, fromRapierVector2, packInteractionGroups, revoluteAxisSignZ, toRapierAngle, toRapierAngularScalar, toRapierBodyType, toRapierJointAxis2d, toRapierVector2` | Import |
| `./conversions2d.js` | `RapierVector2` | Import (type-only) |
| `./init.js` | `initializeRapier2d` | Import |
| `./init.js` | `Rapier2dModule, RapierCollider, RapierColliderDesc, RapierEventQueue, RapierImpulseJoint, RapierJointData, RapierRigidBody, RapierRigidBodyDesc, RapierUnitImpulseJoint, RapierWorld` | Import (type-only) |

**Exports:**
- Classes: `Rapier2dAdapter`
- Interfaces: `RapierBodyAccess`

---

### `packages/physics-rapier/src/rapier3d-adapter.ts` - The Rapier 3D solver adapter (§37, §102, plan WP-5.5).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Quaternion, Vector3` |
| `@fourjs/math` | `Matrix3` |
| `@fourjs/physics` | `ALL_COLLISION_GROUPS, DEFAULT_FRICTION, DEFAULT_RESTITUTION, DETERMINISM_LEVELS, passesQueryFilter, resolveDensity, resolveGravity, resolveQueryOptions, resolveSleepingConfig, sortHitsByDistance, validateColliderDescriptor, validateJointDescriptor, validatePhysicsWorldOptions, validateQueryShape, validateRigidBodyDescriptor, rejectStalePhysicsHandle` |
| `@fourjs/physics` | `AngularVelocityInput, BodyType, CCDMode, ColliderDescriptor, ContactPoint, JointDescriptor, OverlapHit, OverlapQuery, PhysicsBodyHandle, PhysicsCapabilities, PhysicsColliderHandle, PhysicsDimension, PhysicsEvent, PhysicsEventInterest, PhysicsJointHandle, PhysicsSolverAdapter, PhysicsWorldOptions, PointHit, PointQuery, QueryCandidate, RaycastHit, RaycastQuery, ResolvedQueryOptions, RigidBodyDescriptor, RotationInput, ShapeCastHit, ShapeCastQuery, ShippedJointType, SleepingConfig, SolverBodyTuningAccess, SolverJointAccess, SolverJointMotor, Vector3Input` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./ccd.js` | `resolveCcdMode` | Import |
| `./conversions3d.js` | `createRapierColliderDesc3d, createRapierRotation3, createRapierShape3d, createRapierVector3, fromRapierRotation3, fromRapierVector3, packInteractionGroups3d, rotateVectorByRotation3, toPrincipalInertia3d, toRapierAngularVector3, toRapierBodyType3d, toRapierRotation3, toRapierVector3` | Import |
| `./init.js` | `initializeRapier3d` | Import |
| `./init.js` | `Rapier3dModule, RapierCollider3d, RapierColliderDesc3d, RapierEventQueue3d, RapierRigidBody3d, RapierRigidBodyDesc3d, RapierRotation3, RapierVector3, RapierWorld3d` | Import (type-only) |
| `./rapier2d-adapter.js` | `RapierBodyAccess` | Import (type-only) |

**Exports:**
- Classes: `Rapier3dAdapter`

---

### `packages/physics-rapier/src/register.ts` - This package's opt-in to §37's solver registry (PH-19).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/physics` | `registerSolver, PhysicsWorldAdapter, PhysicsWorldOptions, SolverRegistry` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./rapier2d-adapter.js` | `Rapier2dAdapter` | Import |
| `./rapier3d-adapter.js` | `Rapier3dAdapter` | Import |

**Exports:**
- Functions: `isRapierSupported`, `createRapierAdapter`, `registerRapierSolver`

---

### `packages/physics-rapier/src/conversions3d.ts` - The §21/P5-3 mapping between the engine's 3D-typed physics API and Rapier's

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Matrix3, Quaternion, Vector3` |
| `@fourjs/physics` | `ALL_COLLISION_GROUPS, resolveAngularVelocity, resolveRotation` |
| `@fourjs/physics` | `AngularVelocityInput, BodyType, CollisionShape, RotationInput, Vector3Input` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./init.js` | `RAPIER_3D` | Import |
| `./init.js` | `RapierColliderDesc3d, RapierRotation3, RapierShape3d, RapierVector3` | Import (type-only) |
| `./init.js` | `RapierRotation3, RapierVector3` | Re-export (type-only) |

**Exports:**
- Functions: `createRapierVector3`, `createRapierRotation3`, `toRapierVector3`, `fromRapierVector3`, `toRapierRotation3`, `fromRapierRotation3`, `toRapierAngularVector3`, `toRapierBodyType3d`, `toPrincipalInertia3d`, `packInteractionGroups3d`, `createRapierShape3d`, `createRapierColliderDesc3d`, `requireHullDesc3d`, `rotateVectorByRotation3`
- Re-exports: `RapierRotation3`, `RapierVector3`

---

### `packages/physics-rapier/src/init.ts` - Shared loading of the Rapier WebAssembly modules, and the typed view of them

**External Dependencies:**
| Package | Import |
|---------|--------|
| `@dimforge/rapier2d-compat` | `RAPIER2D` |
| `@dimforge/rapier3d-compat` | `RAPIER3D` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `@dimforge/rapier2d-compat` | `Vector` | Re-export (type-only) |
| `@dimforge/rapier2d-compat` | `Shape` | Re-export (type-only) |
| `@dimforge/rapier2d-compat` | `RigidBody` | Re-export (type-only) |
| `@dimforge/rapier2d-compat` | `RigidBodyDesc` | Re-export (type-only) |
| `@dimforge/rapier2d-compat` | `Collider` | Re-export (type-only) |
| `@dimforge/rapier2d-compat` | `ColliderDesc` | Re-export (type-only) |
| `@dimforge/rapier2d-compat` | `JointData` | Re-export (type-only) |
| `@dimforge/rapier2d-compat` | `ImpulseJoint` | Re-export (type-only) |
| `@dimforge/rapier2d-compat` | `UnitImpulseJoint` | Re-export (type-only) |
| `@dimforge/rapier2d-compat` | `EventQueue` | Re-export (type-only) |
| `@dimforge/rapier2d-compat` | `World` | Re-export (type-only) |
| `@dimforge/rapier3d-compat` | `Vector` | Re-export (type-only) |
| `@dimforge/rapier3d-compat` | `Rotation` | Re-export (type-only) |
| `@dimforge/rapier3d-compat` | `Shape` | Re-export (type-only) |
| `@dimforge/rapier3d-compat` | `RigidBody` | Re-export (type-only) |
| `@dimforge/rapier3d-compat` | `RigidBodyDesc` | Re-export (type-only) |
| `@dimforge/rapier3d-compat` | `Collider` | Re-export (type-only) |
| `@dimforge/rapier3d-compat` | `ColliderDesc` | Re-export (type-only) |
| `@dimforge/rapier3d-compat` | `EventQueue` | Re-export (type-only) |
| `@dimforge/rapier3d-compat` | `World` | Re-export (type-only) |

**Exports:**
- Types: `Rapier2dModule`, `Rapier3dModule`
- Functions: `initializeRapier2d`, `rapier2dModule`, `rapier2dVersion`, `initializeRapier3d`, `rapier3dModule`, `rapier3dVersion`
- Constants: `RAPIER_2D`, `RAPIER_3D`
- Re-exports: `Vector`, `Shape`, `RigidBody`, `RigidBodyDesc`, `Collider`, `ColliderDesc`, `JointData`, `ImpulseJoint`, `UnitImpulseJoint`, `EventQueue`, `World`, `Rotation`

---

<a id="packages-render-webgl-dependencies"></a>

## Packages/render webgl Dependencies

### `packages/render-webgl/src/gl-render-target.ts` - GPU-side render targets for the WebGL 2 backend: one framebuffer object per

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `RenderTarget` |
| `@fourjs/render` | `warnDisposedInUse` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `GL, GlFramebuffer, GlRenderbuffer, GlTexture, WebglContext` | Import |

**Exports:**
- Classes: `RenderTargetCache`
- Interfaces: `RenderTargetRecord`
- Types: `CacheableRenderTarget`

---

### `packages/render-webgl/src/gl-picking.ts` - The WebGL 2 picking service (§71, §62; RFC 0005, 2026-08-28) — the id-buffer

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, FourError, devWarnOnce` |
| `@fourjs/math` | `Frustum, Matrix4` |
| `@fourjs/render` | `RenderTarget, assertEncodableCandidateCount, buildRenderList, buildViewRenderList, collectPickCandidates, decodePickId, encodePickId, PickRequest, PickResult, PickingService, RenderItem, RenderItemClip, RenderItemStencil` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-geometry.js` | `GeometryCache` | Import (type-only) |
| `./gl-particles.js` | `PARTICLE_VERTEX_SHADER_SOURCE, ParticleBatchCache, ParticleGlContext` | Import |
| `./gl-picking-registry.js` | `setPickingServiceFactory, PickingRendererHost` | Import |
| `./gl-program.js` | `GL, createLinkedProgram, matrixScratch, requireUniform, GlProgramHandle, GlUniformLocation, WebglContext` | Import |
| `./gl-render-target.js` | `RenderTargetRecord` | Import (type-only) |
| `./gl-skinning-glsl.js` | `SKINNING_GLSL` | Import |

**Exports:**
- Classes: `IdPassProgram`, `ParticleIdProgram`, `SkinnedIdProgram`, `WebglPickingService`
- Functions: `registerPickingPipeline`
- Constants: `PICKING_GL`

---

### `packages/render-webgl/src/gl-effect.ts` - The full-screen effect pipeline for the WebGL 2 backend — §70's blit, colour

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Disposable` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `createLinkedProgram, requireUniform, GlProgramHandle, GlUniformLocation, WebglContext` | Import |
| `./gl-effect-registry.js` | `EFFECT_TEXTURE_UNIT, EFFECT_VERTEX_COUNT, setEffectPipelineFactory` | Import |

**Exports:**
- Classes: `EffectProgram`
- Functions: `registerEffectPipeline`

---

### `packages/render-webgl/src/gl-shadow-registry.ts` - The shadow pipeline's registration slot (§69, §62; 2026-09-11) — the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Matrix4` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `WebglContext` | Import (type-only) |

**Exports:**
- Interfaces: `ShadowCasterPipeline`, `ShadowPipelineFactory`
- Functions: `setShadowPipelineFactory`, `resolveShadowPipelineFactory`, `clearRegisteredShadowPipeline`

---

### `packages/render-webgl/src/index.ts` - `@fourjs/render-webgl` — the WebGL 2 backend (§62 backend 2, §120's MVP tier).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-batch.js` | `GlBatching, createGlBatching` | Re-export |
| `./gl-effect-registry.js` | `EFFECT_TEXTURE_UNIT, EFFECT_VERTEX_COUNT, clearRegisteredEffectPipeline, resolveEffectPipelineFactory` | Re-export |
| `./gl-effect.js` | `EffectProgram, registerEffectPipeline` | Re-export |
| `./gl-geometry.js` | `GeometryCache` | Re-export |
| `./gl-particles-registry.js` | `clearRegisteredParticlePipeline, particleItemFloats, resolveParticlePipelineFactory` | Re-export |
| `./gl-particles.js` | `PARTICLE_ATTRIBUTE_LOCATIONS, PARTICLE_DEPTH_TEXTURE_UNIT, PARTICLE_GL, PARTICLE_VERTEX_SHADER_SOURCE, ParticleAppearanceProgram, ParticleBatchCache, ParticleProgram, ParticleTrailBatchCache, ParticleTrailProgram, registerParticlePipeline` | Re-export |
| `./gl-program.js` | `COLOR_ATTRIBUTE_LOCATION, GL, LitProgram, MAP_TEXTURE_UNIT, METAL_ROUGHNESS_TEXTURE_UNIT, EMISSIVE_TEXTURE_UNIT, NORMAL_ATTRIBUTE_LOCATION, POSITION_ATTRIBUTE_LOCATION, HEMISPHERE_LIGHT_GLSL, HemisphereLightUniforms, PUNCTUAL_LIGHT_GLSL, PunctualLightUniforms, SHADOW_GLSL, SHADOW_TEXTURE_UNIT, ShadowUniforms, SpriteProgram, UV_ATTRIBUTE_LOCATION, UnlitProgram` | Re-export |
| `./gl-picking-registry.js` | `clearRegisteredPickingPipeline, resolvePickingServiceFactory` | Re-export |
| `./gl-picking.js` | `IdPassProgram, PICKING_GL, ParticleIdProgram, SkinnedIdProgram, WebglPickingService, registerPickingPipeline` | Re-export |
| `./gl-render-target.js` | `RenderTargetCache` | Re-export |
| `./gl-program.js` | `JOINTS_ATTRIBUTE_LOCATION, WEIGHTS_ATTRIBUTE_LOCATION` | Re-export |
| `./gl-skinning-registry.js` | `clearRegisteredSkinningPipeline, resolveSkinningPipelineFactory` | Re-export |
| `./gl-skinning.js` | `SKINNING_GLSL, SkinnedLitProgram, SkinnedShadowProgram, SkinnedUnlitProgram, registerSkinningPipeline` | Re-export |
| `./node-pipeline-registry.js` | `NODE_SURFACE_TEXTURE_UNIT_BASE, clearRegisteredNodeMaterialPipeline, resolveNodeMaterialPipelineFactory` | Re-export |
| `./gl-node-program.js` | `GlNodeProgram, GlNodeProgramCache, emitShaderGraphGlsl, registerNodeMaterialPipeline` | Re-export |
| `./gl-shadow-registry.js` | `clearRegisteredShadowPipeline, resolveShadowPipelineFactory` | Re-export |
| `./gl-shadow.js` | `ShadowProgram, registerShadowPipeline` | Re-export |
| `./gl-standard-registry.js` | `clearRegisteredStandardPipeline, resolveStandardPipelineFactory` | Re-export |
| `./gl-standard.js` | `StandardProgram, registerStandardPipeline` | Re-export |
| `./gl-texture.js` | `TextureCache` | Re-export |
| `./register.js` | `isWebgl2Supported, registerWebglRenderer` | Re-export |
| `./webgl-renderer.js` | `WebglRenderer` | Re-export |
| `./gl-batch.js` | `BatchGlContext, RenderBatching` | Re-export (type-only) |
| `./gl-effect-registry.js` | `EffectPipeline, EffectPipelineFactory` | Re-export (type-only) |
| `./gl-geometry.js` | `CacheableGeometry, GeometryRecord` | Re-export (type-only) |
| `./gl-particles-registry.js` | `ParticleAppearancePipeline, ParticleBillboardPipeline, ParticlePipelineFactory, ParticlePrograms` | Re-export (type-only) |
| `./gl-particles.js` | `ParticleBatchRecord, ParticleGlContext, ParticleTrailBatchRecord` | Re-export (type-only) |
| `./gl-program.js` | `GlBuffer, GlProgramHandle, GlShader, GlQuery, GlSync, GlTexture, GlUniformLocation, GlVertexArray, WebglContext` | Re-export (type-only) |
| `./gl-program.js` | `GlFramebuffer, GlRenderbuffer` | Re-export (type-only) |
| `./gl-picking-registry.js` | `PickingRendererHost, PickingServiceFactory` | Re-export (type-only) |
| `./gl-render-target.js` | `CacheableRenderTarget, RenderTargetRecord` | Re-export (type-only) |
| `./gl-skinning-registry.js` | `SkinnedLitPipeline, SkinnedPrograms, SkinnedShadowPipeline, SkinnedUnlitPipeline, SkinningPipelineFactory` | Re-export (type-only) |
| `./node-pipeline-registry.js` | `NodeItemMaterial, NodeMaterialPipelineFactory, NodeMaterialProgram, NodeMaterialPrograms` | Re-export (type-only) |
| `./gl-node-program.js` | `EmittedNodeShader` | Re-export (type-only) |
| `./gl-shadow-registry.js` | `ShadowCasterPipeline, ShadowPipelineFactory` | Re-export (type-only) |
| `./gl-standard-registry.js` | `StandardPipeline, StandardPipelineFactory` | Re-export (type-only) |
| `./gl-texture.js` | `CacheableTexture, TextureRecord` | Re-export (type-only) |
| `./webgl-renderer.js` | `WebglCanvas, WebglContextAttributes, WebglContextEventLike` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `GlBatching`, `createGlBatching`, `EFFECT_TEXTURE_UNIT`, `EFFECT_VERTEX_COUNT`, `clearRegisteredEffectPipeline`, `resolveEffectPipelineFactory`, `EffectProgram`, `registerEffectPipeline`, `GeometryCache`, `clearRegisteredParticlePipeline`, `particleItemFloats`, `resolveParticlePipelineFactory`, `PARTICLE_ATTRIBUTE_LOCATIONS`, `PARTICLE_DEPTH_TEXTURE_UNIT`, `PARTICLE_GL`, `PARTICLE_VERTEX_SHADER_SOURCE`, `ParticleAppearanceProgram`, `ParticleBatchCache`, `ParticleProgram`, `ParticleTrailBatchCache`, `ParticleTrailProgram`, `registerParticlePipeline`, `COLOR_ATTRIBUTE_LOCATION`, `GL`, `LitProgram`, `MAP_TEXTURE_UNIT`, `METAL_ROUGHNESS_TEXTURE_UNIT`, `EMISSIVE_TEXTURE_UNIT`, `NORMAL_ATTRIBUTE_LOCATION`, `POSITION_ATTRIBUTE_LOCATION`, `HEMISPHERE_LIGHT_GLSL`, `HemisphereLightUniforms`, `PUNCTUAL_LIGHT_GLSL`, `PunctualLightUniforms`, `SHADOW_GLSL`, `SHADOW_TEXTURE_UNIT`, `ShadowUniforms`, `SpriteProgram`, `UV_ATTRIBUTE_LOCATION`, `UnlitProgram`, `clearRegisteredPickingPipeline`, `resolvePickingServiceFactory`, `IdPassProgram`, `PICKING_GL`, `ParticleIdProgram`, `SkinnedIdProgram`, `WebglPickingService`, `registerPickingPipeline`, `RenderTargetCache`, `JOINTS_ATTRIBUTE_LOCATION`, `WEIGHTS_ATTRIBUTE_LOCATION`, `clearRegisteredSkinningPipeline`, `resolveSkinningPipelineFactory`, `SKINNING_GLSL`, `SkinnedLitProgram`, `SkinnedShadowProgram`, `SkinnedUnlitProgram`, `registerSkinningPipeline`, `NODE_SURFACE_TEXTURE_UNIT_BASE`, `clearRegisteredNodeMaterialPipeline`, `resolveNodeMaterialPipelineFactory`, `GlNodeProgram`, `GlNodeProgramCache`, `emitShaderGraphGlsl`, `registerNodeMaterialPipeline`, `clearRegisteredShadowPipeline`, `resolveShadowPipelineFactory`, `ShadowProgram`, `registerShadowPipeline`, `clearRegisteredStandardPipeline`, `resolveStandardPipelineFactory`, `StandardProgram`, `registerStandardPipeline`, `TextureCache`, `isWebgl2Supported`, `registerWebglRenderer`, `WebglRenderer`, `BatchGlContext`, `RenderBatching`, `EffectPipeline`, `EffectPipelineFactory`, `CacheableGeometry`, `GeometryRecord`, `ParticleAppearancePipeline`, `ParticleBillboardPipeline`, `ParticlePipelineFactory`, `ParticlePrograms`, `ParticleBatchRecord`, `ParticleGlContext`, `ParticleTrailBatchRecord`, `GlBuffer`, `GlProgramHandle`, `GlShader`, `GlQuery`, `GlSync`, `GlTexture`, `GlUniformLocation`, `GlVertexArray`, `WebglContext`, `GlFramebuffer`, `GlRenderbuffer`, `PickingRendererHost`, `PickingServiceFactory`, `CacheableRenderTarget`, `RenderTargetRecord`, `SkinnedLitPipeline`, `SkinnedPrograms`, `SkinnedShadowPipeline`, `SkinnedUnlitPipeline`, `SkinningPipelineFactory`, `NodeItemMaterial`, `NodeMaterialPipelineFactory`, `NodeMaterialProgram`, `NodeMaterialPrograms`, `EmittedNodeShader`, `ShadowCasterPipeline`, `ShadowPipelineFactory`, `StandardPipeline`, `StandardPipelineFactory`, `CacheableTexture`, `TextureRecord`, `WebglCanvas`, `WebglContextAttributes`, `WebglContextEventLike`

---

### `packages/render-webgl/src/gl-standard-registry.ts` - The standard pipeline's registration slot (§59, §62; 2026-09-11) — the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Matrix4` |
| `@fourjs/render` | `SceneLights` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `WebglContext` | Import (type-only) |

**Exports:**
- Interfaces: `StandardPipeline`, `StandardPipelineFactory`
- Functions: `setStandardPipelineFactory`, `resolveStandardPipelineFactory`, `clearRegisteredStandardPipeline`

---

### `packages/render-webgl/src/gl-skinning-glsl.ts` - The vertex-stage skinning chunk both the colour/caster programs

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `MAX_SKINNING_JOINTS` |

**Exports:**
- Constants: `SKINNING_GLSL`

---

### `packages/render-webgl/src/gl-particles.ts` - The batched particle pipeline for the WebGL 2 backend (§36, §64 stage 6,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Disposable` |
| `@fourjs/math` | `Matrix4` |
| `@fourjs/render` | `PARTICLE_COLOR_OFFSET, PARTICLE_POSITION_OFFSET, PARTICLE_ROTATION_OFFSET, PARTICLE_SIZE_OFFSET, PARTICLE_SOFTNESS_OFFSET, PARTICLE_WIDE_INSTANCE_FLOATS, TRAIL_COLOR_OFFSET, TRAIL_POSITION_OFFSET, TRAIL_VERTEX_FLOATS, ParticleRenderItem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `GL, POSITION_ATTRIBUTE_LOCATION, MAP_TEXTURE_UNIT, createLinkedProgram, matrixScratch, requireUniform, GlBuffer, GlProgramHandle, GlUniformLocation, GlVertexArray, WebglContext` | Import |
| `./gl-particles-registry.js` | `particleItemFloats, setParticlePipelineFactory, ParticlePrograms` | Import |

**Exports:**
- Classes: `ParticleProgram`, `ParticleAppearanceProgram`, `ParticleBatchCache`, `ParticleTrailProgram`, `ParticleTrailBatchCache`
- Interfaces: `ParticleGlContext`, `ParticleBatchRecord`, `ParticleTrailBatchRecord`
- Functions: `registerParticlePipeline`
- Constants: `PARTICLE_GL`, `PARTICLE_ATTRIBUTE_LOCATIONS`, `PARTICLE_VERTEX_SHADER_SOURCE`, `PARTICLE_DEPTH_TEXTURE_UNIT`

---

### `packages/render-webgl/src/gl-picking-registry.ts` - The picking pipeline's registration slot (§71, §62; RFC 0005, 2026-08-28) —

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `PickingService` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-geometry.js` | `GeometryCache` | Import (type-only) |
| `./gl-particles.js` | `ParticleBatchCache` | Import (type-only) |
| `./gl-program.js` | `WebglContext` | Import (type-only) |
| `./gl-render-target.js` | `RenderTargetCache` | Import (type-only) |

**Exports:**
- Interfaces: `PickingRendererHost`, `PickingServiceFactory`
- Functions: `setPickingServiceFactory`, `resolvePickingServiceFactory`, `clearRegisteredPickingPipeline`

---

### `packages/render-webgl/src/gl-geometry.ts` - GPU-side geometry for the WebGL 2 backend: one vertex array per

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `RenderItem` |
| `@fourjs/render` | `warnDisposedInUse` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `COLOR_ATTRIBUTE_LOCATION, GL, JOINTS_ATTRIBUTE_LOCATION, NORMAL_ATTRIBUTE_LOCATION, POSITION_ATTRIBUTE_LOCATION, UV_ATTRIBUTE_LOCATION, WEIGHTS_ATTRIBUTE_LOCATION, WebglContext` | Import |
| `./gl-program.js` | `GlBuffer, GlVertexArray` | Import (type-only) |

**Exports:**
- Classes: `GeometryCache`
- Interfaces: `GeometryRecord`
- Types: `CacheableGeometry`

---

### `packages/render-webgl/src/node-pipeline-registry.ts` - The node-material pipeline's registration slot (§60, §62; RFC 0001, gap

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Matrix4` |
| `@fourjs/render` | `NodeRenderItem, ShaderGraph` |
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `WebglContext` | Import (type-only) |

**Exports:**
- Interfaces: `NodeMaterialProgram`, `NodeMaterialPrograms`, `NodeMaterialPipelineFactory`
- Types: `NodeItemMaterial`
- Functions: `setNodeMaterialPipelineFactory`, `resolveNodeMaterialPipelineFactory`, `clearRegisteredNodeMaterialPipeline`
- Constants: `NODE_SURFACE_TEXTURE_UNIT_BASE`

---

<<<<<<< HEAD
### `packages/fourjs/src/assets.ts` - assets module
=======
### `packages/render-webgl/src/gl-standard.ts` - The metallic-roughness pipeline (§59, §68) — this backend's sixth program,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Disposable` |
| `@fourjs/math` | `Matrix4, Vector3` |
| `@fourjs/render` | `SceneLights` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `EMISSIVE_TEXTURE_UNIT, MAP_TEXTURE_UNIT, METAL_ROUGHNESS_TEXTURE_UNIT, HEMISPHERE_LIGHT_GLSL, HemisphereLightUniforms, PUNCTUAL_LIGHT_GLSL, PunctualLightUniforms, SHADOW_GLSL, ShadowUniforms, createLinkedProgram, matrixScratch, requireUniform, uploadNormalMatrix, GlProgramHandle, GlUniformLocation, WebglContext` | Import |
| `./gl-standard-registry.js` | `setStandardPipelineFactory` | Import |

**Exports:**
- Classes: `StandardProgram`
- Functions: `registerStandardPipeline`

---

### `packages/render-webgl/src/register.ts` - This backend's opt-in to §62's renderer registry (R-2, A-8).
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/assets` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/assets`

---

### `packages/fourjs/src/capabilities.ts` - The umbrella's own §81 capability token (RFC 0002).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `defineCapability` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./editor-tools.js` | `EditorToolRegistry` | Import (type-only) |

**Exports:**
- Constants: `EDITOR_TOOLS`

---

### `packages/fourjs/src/compute-pass.ts` - §82's `Four.ComputePass` — the named-map sugar over `@fourjs/render`'s

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `ComputeBinding, ComputeBuffer, ComputePassDescriptor` |

**Exports:**
- Classes: `ComputePass`
- Interfaces: `ComputePassOptions`
- Types: `ComputePassBindingEntry`, `ComputePassBindings`

---

### `packages/fourjs/src/core.ts` - core module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/core`

---

### `packages/fourjs/src/diagnostics.ts` - diagnostics module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/diagnostics` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/diagnostics`

---

### `packages/fourjs/src/editor-tools.ts` - The §81 editor-tool registry — a named map of tool factories the **host**

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Exports:**
- Classes: `EditorToolRegistry`
- Types: `EditorToolFactory`

---

### `packages/fourjs/src/geometry.ts` - geometry module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/geometry` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/geometry`

---

### `packages/fourjs/src/gltf.ts` - §78 glTF assembly — `instantiateGltf` (A-19's closing packet, 2026-08-29).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/assets` | `GltfAsset` |
| `@fourjs/animation` | `AnimationClip, AnimationTrack, quaternionAdapter, vector3Adapter, AnimationTrackLike` |
| `@fourjs/core` | `FourError` |
| `@fourjs/geometry` | `BufferGeometry` |
| `@fourjs/materials` | `StandardMaterial` |
| `@fourjs/math` | `Matrix4, Quaternion, Vector3` |
| `@fourjs/render` | `Mesh, Texture` |
| `@fourjs/scene` | `Bone, Group, Skeleton, Node` |

**Exports:**
- Interfaces: `GltfInstance`
- Functions: `instantiateGltf`

---

### `packages/fourjs/src/index.ts` - The umbrella package (§98): one namespace per workspace package, plus the
=======
| `@fourjs/render` | `registerRenderer, RendererOptions, RendererRegistry` |
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
<<<<<<< HEAD
| `./application.js` | `Application` | Re-export |
| `./live-resource-counts.js` | `readLiveResourceCounts` | Re-export |
| `./plugins.js` | `ASSET_LOADERS, COMPONENT_SERIALIZERS, COMPUTE_WORKLOADS, EDITOR_TOOLS, RENDERER_REGISTRY, RENDER_GRAPH, SCENE_MIGRATIONS, SHADER_OPERATORS, SIMULATION_SYSTEMS, PATH_PLANNERS, SOLVER_REGISTRY, UI_CONTROLS` | Re-export |
| `./plugins.js` | `EditorToolRegistry` | Re-export |
| `./scene-serializers.js` | `BUTTON_NODE_TYPE, CHECKBOX_NODE_TYPE, CIRCLE_NODE_TYPE, DIRECTIONAL_LIGHT_NODE_TYPE, HEMISPHERE_LIGHT_NODE_TYPE, ELLIPSE_NODE_TYPE, IMAGE_NODE_TYPE, LABEL_NODE_TYPE, ORTHOGRAPHIC_CAMERA_NODE_TYPE, PANEL_NODE_TYPE, PATH_SHAPE_NODE_TYPE, PERSPECTIVE_CAMERA_NODE_TYPE, POINT_LIGHT_NODE_TYPE, POLYGON_NODE_TYPE, PROGRESS_NODE_TYPE, RADIO_BUTTON_NODE_TYPE, RECTANGLE_NODE_TYPE, REGULAR_POLYGON_NODE_TYPE, RENDERABLE_NODE_TYPE, RING_NODE_TYPE, SECTOR_NODE_TYPE, SLIDER_NODE_TYPE, SPOT_LIGHT_NODE_TYPE, SPRITE_NODE_TYPE, STAR_NODE_TYPE, TEXT_NODE_TYPE, TOGGLE_NODE_TYPE, composeSceneNodeTypes, registerPhysicsSerializers, registerRenderSerializers, registerSceneNodeTypes, registerShapeSerializers, registerTextSerializers, registerUISerializers, resourceCatalog, restoreNodeId` | Re-export |
| `./text-node.js` | `Text` | Re-export |
| `./compute-pass.js` | `ComputePass` | Re-export |
| `./gltf.js` | `instantiateGltf` | Re-export |
| `./pick-provider.js` | `createPickProvider` | Re-export |
| `./manifest-catalog.js` | `preloadManifestIntoCatalog` | Re-export |
| `./application.js` | `ApplicationEventMap, ApplicationOptions, PhysicsWorldContext, PhysicsWorldFactory, SurfaceObserver, SurfaceResize` | Re-export (type-only) |
| `./plugins.js` | `EditorToolFactory` | Re-export (type-only) |
| `./scene-serializers.js` | `SceneNodeTypeOptions, SceneNodeTypeSupport, SceneResourceCatalog, SceneSerializationSupport, UnknownResourcePolicy` | Re-export (type-only) |
| `./text-node.js` | `TextOptions` | Re-export (type-only) |
| `./compute-pass.js` | `ComputePassBindingEntry, ComputePassBindings, ComputePassOptions` | Re-export (type-only) |
| `./gltf.js` | `GltfInstance` | Re-export (type-only) |
| `./manifest-catalog.js` | `PreloadManifestIntoCatalogOptions` | Re-export (type-only) |

**Exports:**
- Re-exports: `Application`, `readLiveResourceCounts`, `ASSET_LOADERS`, `COMPONENT_SERIALIZERS`, `COMPUTE_WORKLOADS`, `EDITOR_TOOLS`, `RENDERER_REGISTRY`, `RENDER_GRAPH`, `SCENE_MIGRATIONS`, `SHADER_OPERATORS`, `SIMULATION_SYSTEMS`, `PATH_PLANNERS`, `SOLVER_REGISTRY`, `UI_CONTROLS`, `EditorToolRegistry`, `BUTTON_NODE_TYPE`, `CHECKBOX_NODE_TYPE`, `CIRCLE_NODE_TYPE`, `DIRECTIONAL_LIGHT_NODE_TYPE`, `HEMISPHERE_LIGHT_NODE_TYPE`, `ELLIPSE_NODE_TYPE`, `IMAGE_NODE_TYPE`, `LABEL_NODE_TYPE`, `ORTHOGRAPHIC_CAMERA_NODE_TYPE`, `PANEL_NODE_TYPE`, `PATH_SHAPE_NODE_TYPE`, `PERSPECTIVE_CAMERA_NODE_TYPE`, `POINT_LIGHT_NODE_TYPE`, `POLYGON_NODE_TYPE`, `PROGRESS_NODE_TYPE`, `RADIO_BUTTON_NODE_TYPE`, `RECTANGLE_NODE_TYPE`, `REGULAR_POLYGON_NODE_TYPE`, `RENDERABLE_NODE_TYPE`, `RING_NODE_TYPE`, `SECTOR_NODE_TYPE`, `SLIDER_NODE_TYPE`, `SPOT_LIGHT_NODE_TYPE`, `SPRITE_NODE_TYPE`, `STAR_NODE_TYPE`, `TEXT_NODE_TYPE`, `TOGGLE_NODE_TYPE`, `composeSceneNodeTypes`, `registerPhysicsSerializers`, `registerRenderSerializers`, `registerSceneNodeTypes`, `registerShapeSerializers`, `registerTextSerializers`, `registerUISerializers`, `resourceCatalog`, `restoreNodeId`, `Text`, `ComputePass`, `instantiateGltf`, `createPickProvider`, `preloadManifestIntoCatalog`, `ApplicationEventMap`, `ApplicationOptions`, `PhysicsWorldContext`, `PhysicsWorldFactory`, `SurfaceObserver`, `SurfaceResize`, `EditorToolFactory`, `SceneNodeTypeOptions`, `SceneNodeTypeSupport`, `SceneResourceCatalog`, `SceneSerializationSupport`, `UnknownResourcePolicy`, `TextOptions`, `ComputePassBindingEntry`, `ComputePassBindings`, `ComputePassOptions`, `GltfInstance`, `PreloadManifestIntoCatalogOptions`

---

### `packages/fourjs/src/input.ts` - input module
=======
| `./webgl-renderer.js` | `WebglRenderer` | Import |

**Exports:**
- Functions: `isWebgl2Supported`, `registerWebglRenderer`

---

### `packages/render-webgl/src/gl-particles-registry.ts` - The particle pipeline's registration slot (§36, §62; 2026-09-11) — the
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/input` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/input`

---

### `packages/fourjs/src/live-resource-counts.ts` - Aggregates §83 live-resource counts for `auditResourceLeaks`.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/diagnostics` | `LiveResourceCounts` |
| `@fourjs/geometry` | `geometryMemoryBytes, liveGeometryCount` |
| `@fourjs/materials` | `liveMaterialCount` |
| `@fourjs/physics` | `liveSolverBodyCount, liveSolverColliderCount, liveSolverHandleCount, liveSolverJointCount` |
| `@fourjs/render` | `liveRenderTargetCount, liveTextureCount, textureMemoryBytes` |

**Exports:**
- Functions: `readLiveResourceCounts`

---

### `packages/fourjs/src/manifest-catalog.ts` - Preload a §79 manifest into a synchronous {@link SceneResourceCatalog}

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/assets` | `loadFromManifest, AssetLoader, AssetManager, AssetManifest, ManifestLoadOptions` |
=======
| `@fourjs/render` | `PARTICLE_INSTANCE_FLOATS, ParticleRenderItem` |
| `@fourjs/math` | `Matrix4` |
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-particles.js` | `ParticleBatchCache, ParticleGlContext, ParticleTrailBatchCache` | Import (type-only) |

**Exports:**
- Interfaces: `ParticleBillboardPipeline`, `ParticleAppearancePipeline`, `ParticlePrograms`, `ParticlePipelineFactory`
- Functions: `particleItemFloats`, `setParticlePipelineFactory`, `resolveParticlePipelineFactory`, `clearRegisteredParticlePipeline`

---

<<<<<<< HEAD
### `packages/fourjs/src/materials.ts` - materials module
=======
### `packages/render-webgl/src/gl-node-program.ts` - The node-material pipeline (§60, §62; RFC 0001 — gap R-14): a GLSL ES 3.00
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/materials` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/materials`

---

### `packages/fourjs/src/math.ts` - math module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/math`

---

### `packages/fourjs/src/motion.ts` - motion module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/motion` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/motion`

---

### `packages/fourjs/src/particles.ts` - particles module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/particles` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/particles`

---

### `packages/fourjs/src/physics-box2d.ts` - physics-box2d module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/physics-box2d` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/physics-box2d`

---

### `packages/fourjs/src/physics-rapier.ts` - physics-rapier module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/physics-rapier` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/physics-rapier`

---

### `packages/fourjs/src/physics-soft.ts` - physics-soft module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/physics-soft` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/physics-soft`

---

### `packages/fourjs/src/physics.ts` - physics module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/physics` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/physics`

---

### `packages/fourjs/src/pick-provider.ts` - The four-line adapter RFC 0005 §2 promised (§71, §45; 2026-08-28): a

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/input` | `PickProvider` |
| `@fourjs/render` | `PickingService` |
| `@fourjs/scene` | `Viewport` |

**Exports:**
- Functions: `createPickProvider`

---

### `packages/fourjs/src/plugins.ts` - The §81 capability tokens (RFC 0002, accepted 2026-08-21; gap `A-3`) —

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/assets` | `ASSET_LOADERS` |
| `@fourjs/materials` | `SHADER_OPERATORS` |
| `@fourjs/motion` | `PATH_PLANNERS, SIMULATION_SYSTEMS` |
| `@fourjs/physics` | `SOLVER_REGISTRY` |
| `@fourjs/render` | `COMPUTE_WORKLOADS, RENDERER_REGISTRY, RENDER_GRAPH` |
| `@fourjs/serialization` | `COMPONENT_SERIALIZERS, SCENE_MIGRATIONS` |
| `@fourjs/ui` | `UI_CONTROLS` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./capabilities.js` | `EDITOR_TOOLS` | Re-export |
| `./editor-tools.js` | `EditorToolRegistry` | Re-export |
| `./editor-tools.js` | `EditorToolFactory` | Re-export (type-only) |

**Exports:**
- Re-exports: `ASSET_LOADERS`, `SHADER_OPERATORS`, `PATH_PLANNERS`, `SIMULATION_SYSTEMS`, `SOLVER_REGISTRY`, `COMPUTE_WORKLOADS`, `RENDERER_REGISTRY`, `RENDER_GRAPH`, `COMPONENT_SERIALIZERS`, `SCENE_MIGRATIONS`, `UI_CONTROLS`, `EDITOR_TOOLS`, `EditorToolRegistry`, `EditorToolFactory`

---

### `packages/fourjs/src/render-canvas.ts` - render-canvas module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render-canvas` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/render-canvas`

---

### `packages/fourjs/src/render-svg.ts` - render-svg module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render-svg` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/render-svg`

---

### `packages/fourjs/src/render-webgl.ts` - render-webgl module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render-webgl` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/render-webgl`
=======
| `@fourjs/core` | `DEV, devWarnOnce, Disposable` |
| `@fourjs/math` | `Matrix4` |
| `@fourjs/render` | `analyzeShaderGraph, ShaderAttributeName, ShaderDomain, ShaderGraph, ShaderGraphAnalysis, ShaderNode, ShaderUniformReflection, ShaderValueType` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `createLinkedProgram, matrixScratch, requireUniform, GlProgramHandle, GlUniformLocation, WebglContext` | Import |
| `./node-pipeline-registry.js` | `NODE_SURFACE_TEXTURE_UNIT_BASE, setNodeMaterialPipelineFactory, NodeItemMaterial, NodeMaterialProgram, NodeMaterialPrograms` | Import |

**Exports:**
- Classes: `GlNodeProgram`, `GlNodeProgramCache`
- Interfaces: `EmittedNodeShader`
- Functions: `emitShaderGraphGlsl`, `registerNodeMaterialPipeline`
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

---

### `packages/render-webgl/src/gl-program.ts` - The WebGL 2 surface this backend uses, and the pipelines it draws with

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError, Disposable` |
| `@fourjs/math` | `Matrix3, Matrix4, Vector3` |
| `@fourjs/render` | `MAX_PUNCTUAL_LIGHTS, SceneLights` |

**Exports:**
- Classes: `HemisphereLightUniforms`, `PunctualLightUniforms`, `ShadowUniforms`, `UnlitProgram`, `SpriteProgram`, `LitProgram`
- Interfaces: `WebglContext`
- Types: `GlShader`, `GlProgramHandle`, `GlBuffer`, `GlVertexArray`, `GlUniformLocation`, `GlTexture`, `GlFramebuffer`, `GlRenderbuffer`, `GlSync`, `GlQuery`
- Functions: `uploadNormalMatrix`, `createLinkedProgram`, `requireUniform`
- Constants: `GL`, `POSITION_ATTRIBUTE_LOCATION`, `NORMAL_ATTRIBUTE_LOCATION`, `UV_ATTRIBUTE_LOCATION`, `COLOR_ATTRIBUTE_LOCATION`, `JOINTS_ATTRIBUTE_LOCATION`, `WEIGHTS_ATTRIBUTE_LOCATION`, `MAP_TEXTURE_UNIT`, `SHADOW_TEXTURE_UNIT`, `METAL_ROUGHNESS_TEXTURE_UNIT`, `EMISSIVE_TEXTURE_UNIT`, `FRAGMENT_SHADER_SOURCE`, `PUNCTUAL_LIGHT_GLSL`, `HEMISPHERE_LIGHT_GLSL`, `SHADOW_GLSL`, `LIT_FRAGMENT_SHADER_SOURCE`, `matrixScratch`

---

### `packages/render-webgl/src/webgl-renderer.ts` - The WebGL 2 backend (§61, §62, §120) — the MVP's only renderer.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, devWarnOnce, EventEmitter, FourError` |
| `@fourjs/math` | `Frustum, Matrix4, Rectangle2` |
| `@fourjs/render` | `MAX_SKINNING_JOINTS, RenderTarget, buildInterpolatedRenderList, buildRenderList, buildViewRenderList, collectSceneLights, createSceneLights, isLitItem, isNodeItem, isParticlesItem, isRenderTargetTexture, isSkinnedLitItem, isSkinnedUnlitItem, isSpriteItem, isStandardItem, intersectScissor, validateReadbackRegion, COLOR_GRADE_DEFAULTS, EffectRenderPass, GraphEffect, PickingService, RenderItem, RenderItemKind, RenderStatistics, Renderer, RendererCapabilities, ScissorRect, RendererEventMap, RendererOptions, ScreenEffectRenderer` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-batch.js` | `RenderBatching` | Import (type-only) |
| `./gl-effect-registry.js` | `EFFECT_TEXTURE_UNIT, EFFECT_VERTEX_COUNT, resolveEffectPipelineFactory, EffectPipeline` | Import |
| `./gl-geometry.js` | `GeometryCache` | Import |
| `./gl-gpu-timer.js` | `GlGpuTimer, hasDisjointTimerQuery` | Import |
| `./gl-particles-registry.js` | `particleItemFloats, resolveParticlePipelineFactory, ParticleAppearancePipeline, ParticleBillboardPipeline, ParticlePrograms` | Import |
| `./gl-particles.js` | `ParticleGlContext` | Import (type-only) |
| `./gl-program.js` | `GL, LitProgram, EMISSIVE_TEXTURE_UNIT, MAP_TEXTURE_UNIT, METAL_ROUGHNESS_TEXTURE_UNIT, SHADOW_TEXTURE_UNIT, SpriteProgram, UnlitProgram, GlTexture` | Import |
| `./gl-picking-registry.js` | `resolvePickingServiceFactory, PickingRendererHost` | Import |
| `./gl-render-target.js` | `RenderTargetCache, RenderTargetRecord` | Import |
| `./gl-skinning-registry.js` | `resolveSkinningPipelineFactory, SkinnedPrograms, SkinnedShadowPipeline` | Import |
| `./node-pipeline-registry.js` | `NODE_SURFACE_TEXTURE_UNIT_BASE, resolveNodeMaterialPipelineFactory, NodeMaterialProgram, NodeMaterialPrograms` | Import |
| `./gl-shadow-registry.js` | `resolveShadowPipelineFactory, ShadowCasterPipeline` | Import |
| `./gl-standard-registry.js` | `resolveStandardPipelineFactory, StandardPipeline` | Import |
| `./gl-texture.js` | `TextureCache, CacheableTexture` | Import |

**Exports:**
- Classes: `WebglRenderer`
- Interfaces: `WebglContextEventLike`, `WebglCanvas`, `WebglContextAttributes`

---

### `packages/render-webgl/src/gl-skinning-registry.ts` - The skinning pipeline's registration slot (§54, §62; RFC 0003, 2026-08-28)

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Matrix4` |
| `@fourjs/render` | `SceneLights` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `WebglContext` | Import (type-only) |

**Exports:**
- Interfaces: `SkinnedUnlitPipeline`, `SkinnedLitPipeline`, `SkinnedShadowPipeline`, `SkinnedPrograms`, `SkinningPipelineFactory`
- Functions: `setSkinningPipelineFactory`, `resolveSkinningPipelineFactory`, `clearRegisteredSkinningPipeline`

---

### `packages/render-webgl/src/gl-skinning.ts` - The skinned pipelines (§54, §62; RFC 0003 — gaps PH-10 + R-22, 2026-08-28):

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Disposable` |
| `@fourjs/math` | `Matrix4` |
| `@fourjs/render` | `SceneLights` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-skinning-glsl.js` | `SKINNING_GLSL` | Import |
| `./gl-program.js` | `FRAGMENT_SHADER_SOURCE, LIT_FRAGMENT_SHADER_SOURCE, MAP_TEXTURE_UNIT, HemisphereLightUniforms, PunctualLightUniforms, ShadowUniforms, createLinkedProgram, matrixScratch, requireUniform, GlProgramHandle, GlUniformLocation, WebglContext` | Import |
| `./gl-skinning-registry.js` | `setSkinningPipelineFactory, SkinnedLitPipeline, SkinnedPrograms, SkinnedShadowPipeline, SkinnedUnlitPipeline` | Import |

**Exports:**
- Classes: `SkinnedUnlitProgram`, `SkinnedLitProgram`, `SkinnedShadowProgram`
- Functions: `registerSkinningPipeline`

---

### `packages/render-webgl/src/gl-batch.ts` - §65 batching for the WebGL 2 backend — the GPU half of `@fourjs/render`'s

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Matrix4` |
| `@fourjs/render` | `RenderBatcher, RenderBatch, RenderBatchOptions, RenderItem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `COLOR_ATTRIBUTE_LOCATION, GL, POSITION_ATTRIBUTE_LOCATION, UV_ATTRIBUTE_LOCATION, GlBuffer, GlVertexArray, UnlitProgram, WebglContext` | Import |

**Exports:**
- Classes: `GlBatching`
- Interfaces: `BatchGlContext`, `RenderBatching`
- Functions: `createGlBatching`

---

### `packages/render-webgl/src/gl-texture.ts` - GPU-side textures for the WebGL 2 backend: one `WebGLTexture` per

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `SpriteRenderItem` |
| `@fourjs/render` | `warnDisposedInUse` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `GL, GlTexture, WebglContext` | Import |

**Exports:**
- Classes: `TextureCache`
- Interfaces: `TextureRecord`
- Types: `CacheableTexture`

---

### `packages/render-webgl/src/gl-effect-registry.ts` - The effect pipeline's registration slot (§70, §62; 2026-09-11) — the

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `WebglContext` | Import (type-only) |

**Exports:**
- Interfaces: `EffectPipeline`, `EffectPipelineFactory`
- Functions: `setEffectPipelineFactory`, `resolveEffectPipelineFactory`, `clearRegisteredEffectPipeline`
- Constants: `EFFECT_TEXTURE_UNIT`, `EFFECT_VERTEX_COUNT`

---

### `packages/render-webgl/src/gl-shadow.ts` - The depth-only caster pipeline (§69) — this backend's seventh program (R-18,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Disposable` |
| `@fourjs/math` | `Matrix4` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `createLinkedProgram, matrixScratch, requireUniform, GlProgramHandle, GlUniformLocation, WebglContext` | Import |
| `./gl-shadow-registry.js` | `setShadowPipelineFactory` | Import |

**Exports:**
- Classes: `ShadowProgram`
- Functions: `registerShadowPipeline`

---

### `packages/render-webgl/src/gl-gpu-timer.ts` - WebGL 2 GPU-frame timer — `EXT_disjoint_timer_query_webgl2` (A-1, §62, §84).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `GL, GlQuery` | Import |

**Exports:**
- Classes: `GlGpuTimer`
- Functions: `hasDisjointTimerQuery`

---

<<<<<<< HEAD
### `packages/fourjs/src/render.ts` - render module
=======
<a id="packages-physics-dependencies"></a>

## Packages/physics Dependencies

### `packages/physics/src/solver-registry.ts` - The §37 solver registry — how `solver: "auto"` becomes an adapter without

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./adapter.js` | `PhysicsSolverAdapter` | Import (type-only) |
| `./descriptors.js` | `PhysicsWorldOptions` | Import (type-only) |
| `./types.js` | `DeterminismLevel` | Import (type-only) |
| `./types.js` | `DEFAULT_DETERMINISM_LEVEL, DETERMINISM_LEVELS` | Import |
| `./world.js` | `PhysicsWorldAdapter` | Import (type-only) |

**Exports:**
- Classes: `SolverRegistry`
- Interfaces: `SolverRegistration`, `SolverRejectionReport`, `SolverResolveOptions`
- Types: `SolverName`, `SolverSelection`, `SolverRejectionReason`
- Functions: `registerSolver`, `registeredSolvers`, `clearRegisteredSolvers`, `resolveSolver`

---

### `packages/physics/src/capabilities.ts` - This package's §81 capability token (RFC 0002; declared here since

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `defineCapability` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./solver-registry.js` | `SolverRegistry` | Import (type-only) |

**Exports:**
- Constants: `SOLVER_REGISTRY`

---

### `packages/physics/src/index.ts` - `@fourjs/physics` — the stable, solver-independent physics API (§101, Part IV).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./capabilities.js` | `SOLVER_REGISTRY` | Re-export |
| `./adapter.js` | `NO_TUNING_CAPABILITIES, resolveTuningCapabilities` | Re-export |
| `./body-access.js` | `missingSolverBodyTuning, missingSolverJointAccess, supportsSolverBodyTuning, supportsSolverJointAccess` | Re-export |
| `./collider.js` | `Collider` | Re-export |
| `./descriptors.js` | `DEFAULT_GRAVITY_Y, JOINT_TYPES, SHIPPED_JOINT_TYPES, SHIPPED_JOINT_TYPES_2D, SHIPPED_JOINT_TYPES_3D, STAGED_JOINT_TYPES, jointTypeSupportsDimension, resolveAngularVelocity, resolveGravity, resolveRotation, resolveSleepingConfig, widenToVector3` | Re-export |
| `./force-field.js` | `ForceFieldSystem` | Re-export |
| `./joints.js` | `BallJoint, FixedJoint, HingeJoint, Joint, PrismaticJoint, RevoluteJoint, RopeJoint, SliderJoint, SphericalJoint, SpringJoint, worldAnchorToLocal, worldAxisToLocal` | Re-export |
| `./physics-event-system.js` | `PhysicsEventSystem` | Re-export |
| `./physics-system.js` | `PhysicsSystem` | Re-export |
| `./stale-handle.js` | `rejectStalePhysicsHandle, resetStaleHandleWarnings` | Re-export |
| `./material.js` | `DEFAULT_DENSITY, DEFAULT_FRICTION, DEFAULT_FRICTION_COMBINE_MODE, DEFAULT_RESTITUTION, DEFAULT_RESTITUTION_COMBINE_MODE, PhysicsMaterial, combineFriction, combineRestitution, combineValues, resolveDensity` | Re-export |
| `./queries.js` | `ALL_COLLISION_GROUPS, passesQueryFilter, resolveQueryOptions, sortHitsByDistance` | Re-export |
| `./serializers.js` | `COLLIDER_SERIALIZER, RIGID_BODY_SERIALIZER, SWEPT_CHARACTER_CONTROLLER_SERIALIZER, deserializeCollisionShape, serializeCollisionShape` | Re-export |
| `./rigid-body.js` | `RigidBody` | Re-export |
| `./solver-registry.js` | `SolverRegistry, clearRegisteredSolvers, registerSolver, registeredSolvers, resolveSolver` | Re-export |
| `./shapes.js` | `COLLISION_SHAPE_TYPES_2D, COLLISION_SHAPE_TYPES_3D, COMPOSITE_COLLISION_SHAPE_TYPES, shapeIsConvex, shapeMaximumExtent, shapeSupportsDimension, validateCollisionShape, validateQueryShape` | Re-export |
| `./types.js` | `BODY_TYPES, CCD_MODES, COMBINE_MODES, DEFAULT_CCD_MODE, DEFAULT_DETERMINISM_LEVEL, DEFAULT_ENABLED_CCD_MODE, DEFAULT_SLEEPING_CONFIG, DETERMINISM_LEVELS, PHYSICS_DIMENSIONS` | Re-export |
| `./validation.js` | `validateAngularJointMotor, validateColliderDescriptor, validateInertiaTensor, validateJointBreakThreshold, validateJointDescriptor, validateJointLimits, validateLinearJointMotor, validateMass, validatePhysicsWorldOptions, validateRigidBodyDescriptor, validateSphericalJointLimits` | Re-export |
| `./swept-character-controller.js` | `DEFAULT_GROUND_SNAP_DISTANCE, DEFAULT_MAX_SLIDES, DEFAULT_PUSH_IMPULSE_SCALE, DEFAULT_PUSH_MASS, DEFAULT_SKIN_WIDTH, DEFAULT_SLOPE_LIMIT, DEFAULT_STEP_HEIGHT, SweptCharacterController, SweptCharacterSystem` | Re-export |
| `./local-plane.js` | `DEFAULT_LOCAL_PLANE, isDefaultLocalPlane, planeToWorld, planeToWorldVec, resolveLocalPlane, worldToPlane, worldToPlaneVec` | Re-export |
| `./world-units.js` | `fromSiLength, fromSiMass, resolvePhysicsWorldUnits, toSiLength, toSiMass` | Re-export |
| `./world.js` | `POSE_TARGET_CAPTURE_PRIORITY, PhysicsWorld, createPoseTargetCaptureSystem` | Re-export |
| `./resource-memory.js` | `liveSolverBodyCount, liveSolverColliderCount, liveSolverHandleCount, liveSolverJointCount` | Re-export |
| `./adapter.js` | `PhysicsCapabilities, PhysicsQueryCapabilities, PhysicsEventInterest, PhysicsSolverAdapter, PhysicsTuningCapabilities` | Re-export (type-only) |
| `./body-access.js` | `SolverBodyAccess, SolverBodyTuningAccess, SolverJointAccess, SolverJointMotor` | Re-export (type-only) |
| `./collider.js` | `ColliderEventMap, ColliderOptions, ColliderTriggerEvent, RigidBodyCollisionEvent` | Re-export (type-only) |
| `./descriptors.js` | `AngularJointMotor, ColliderDescriptor, FixedJointDescriptor, JointDescriptor, JointDescriptorBase, JointLimits, JointType, LinearJointMotor, LocalPlane, PhysicsWorldOptions, PrismaticJointDescriptor, RevoluteJointDescriptor, RigidBodyDescriptor, RopeJointDescriptor, ShippedJointType, SphericalJointDescriptor, SphericalJointLimits, SpringJointDescriptor, StagedJointType` | Re-export (type-only) |
| `./events.js` | `CollisionEvent, CollisionPhase, ContactPoint, JointBreakEvent, JointPhase, PhysicsEvent, PhysicsEventType, SleepEvent, SleepPhase, TriggerEvent, TriggerPhase` | Re-export (type-only) |
| `./force-field.js` | `ForceField, ForceFieldAddOptions, ForceFieldEntry, ForceFieldSystemOptions, ForceFieldUnits` | Re-export (type-only) |
| `./joints.js` | `HingeJointOptions, JointBinding, JointBreakPayload, JointCommands, JointEventMap, JointOptions, RopeJointOptions, SliderJointOptions, SphericalJointOptions, SpringJointOptions` | Re-export (type-only) |
| `./material.js` | `PhysicsMaterialOptions` | Re-export (type-only) |
| `./physics-event-system.js` | `PhysicsEventSystemOptions` | Re-export (type-only) |
| `./physics-system.js` | `PhysicsSystemOptions` | Re-export (type-only) |
| `./stale-handle.js` | `StalePhysicsHandleKind` | Re-export (type-only) |
| `./queries.js` | `OverlapHit, OverlapQuery, PointHit, PointQuery, QueryCandidate, QueryFilter, QueryHit, QueryHitMode, QueryOptions, RaycastHit, RaycastQuery, ResolvedQueryOptions, ShapeCastHit, ShapeCastQuery` | Re-export (type-only) |
| `./serializers.js` | `ColliderDocument, PhysicsMaterialDocument, RigidBodyDocument` | Re-export (type-only) |
| `./rigid-body.js` | `BlendWeights, PointLoad, RigidBodyCommands, RigidBodyEventMap, RigidBodySleepEvent, SleepCommand, TorqueInput` | Re-export (type-only) |
| `./solver-registry.js` | `SolverName, SolverRegistration, SolverRejectionReason, SolverRejectionReport, SolverResolveOptions, SolverSelection` | Re-export (type-only) |
| `./shapes.js` | `BoxShape, CapsuleShape, ChainShape, CircleShape, CollisionShape, CollisionShape2D, CollisionShape3D, CollisionShapeType, ConeShape, ConvexHullShape, CylinderShape, HeightFieldShape, PolygonShape, PolylineShape, RectangleShape, SphereShape, TriangleMeshShape` | Re-export (type-only) |
| `./types.js` | `AngularVelocityInput, BodyType, CCDMode, CombineMode, DeterminismLevel, PhysicsBodyHandle, PhysicsColliderHandle, PhysicsDimension, PhysicsHandle, PhysicsJointHandle, RotationInput, SleepingConfig, Vector3Input` | Re-export (type-only) |
| `./swept-character-controller.js` | `SweptCharacterControllerOptions, SweptCharacterSystemOptions` | Re-export (type-only) |
| `./local-plane.js` | `ResolvedLocalPlane` | Re-export (type-only) |
| `./world-units.js` | `PhysicsWorldUnits` | Re-export (type-only) |
| `./world.js` | `ActiveBodyVisitor, BodyControlModeOptions, PhysicsSnapshot, PhysicsSnapshotConfiguration, PhysicsWorldAdapter, PhysicsWorldInit, PoseTargetCaptureSystemOptions, WorldOverlapHit, WorldPhysicsEvent, WorldPointHit, WorldQueryHit, WorldRaycastHit, WorldShapeCastHit` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `SOLVER_REGISTRY`, `NO_TUNING_CAPABILITIES`, `resolveTuningCapabilities`, `missingSolverBodyTuning`, `missingSolverJointAccess`, `supportsSolverBodyTuning`, `supportsSolverJointAccess`, `Collider`, `DEFAULT_GRAVITY_Y`, `JOINT_TYPES`, `SHIPPED_JOINT_TYPES`, `SHIPPED_JOINT_TYPES_2D`, `SHIPPED_JOINT_TYPES_3D`, `STAGED_JOINT_TYPES`, `jointTypeSupportsDimension`, `resolveAngularVelocity`, `resolveGravity`, `resolveRotation`, `resolveSleepingConfig`, `widenToVector3`, `ForceFieldSystem`, `BallJoint`, `FixedJoint`, `HingeJoint`, `Joint`, `PrismaticJoint`, `RevoluteJoint`, `RopeJoint`, `SliderJoint`, `SphericalJoint`, `SpringJoint`, `worldAnchorToLocal`, `worldAxisToLocal`, `PhysicsEventSystem`, `PhysicsSystem`, `rejectStalePhysicsHandle`, `resetStaleHandleWarnings`, `DEFAULT_DENSITY`, `DEFAULT_FRICTION`, `DEFAULT_FRICTION_COMBINE_MODE`, `DEFAULT_RESTITUTION`, `DEFAULT_RESTITUTION_COMBINE_MODE`, `PhysicsMaterial`, `combineFriction`, `combineRestitution`, `combineValues`, `resolveDensity`, `ALL_COLLISION_GROUPS`, `passesQueryFilter`, `resolveQueryOptions`, `sortHitsByDistance`, `COLLIDER_SERIALIZER`, `RIGID_BODY_SERIALIZER`, `SWEPT_CHARACTER_CONTROLLER_SERIALIZER`, `deserializeCollisionShape`, `serializeCollisionShape`, `RigidBody`, `SolverRegistry`, `clearRegisteredSolvers`, `registerSolver`, `registeredSolvers`, `resolveSolver`, `COLLISION_SHAPE_TYPES_2D`, `COLLISION_SHAPE_TYPES_3D`, `COMPOSITE_COLLISION_SHAPE_TYPES`, `shapeIsConvex`, `shapeMaximumExtent`, `shapeSupportsDimension`, `validateCollisionShape`, `validateQueryShape`, `BODY_TYPES`, `CCD_MODES`, `COMBINE_MODES`, `DEFAULT_CCD_MODE`, `DEFAULT_DETERMINISM_LEVEL`, `DEFAULT_ENABLED_CCD_MODE`, `DEFAULT_SLEEPING_CONFIG`, `DETERMINISM_LEVELS`, `PHYSICS_DIMENSIONS`, `validateAngularJointMotor`, `validateColliderDescriptor`, `validateInertiaTensor`, `validateJointBreakThreshold`, `validateJointDescriptor`, `validateJointLimits`, `validateLinearJointMotor`, `validateMass`, `validatePhysicsWorldOptions`, `validateRigidBodyDescriptor`, `validateSphericalJointLimits`, `DEFAULT_GROUND_SNAP_DISTANCE`, `DEFAULT_MAX_SLIDES`, `DEFAULT_PUSH_IMPULSE_SCALE`, `DEFAULT_PUSH_MASS`, `DEFAULT_SKIN_WIDTH`, `DEFAULT_SLOPE_LIMIT`, `DEFAULT_STEP_HEIGHT`, `SweptCharacterController`, `SweptCharacterSystem`, `DEFAULT_LOCAL_PLANE`, `isDefaultLocalPlane`, `planeToWorld`, `planeToWorldVec`, `resolveLocalPlane`, `worldToPlane`, `worldToPlaneVec`, `fromSiLength`, `fromSiMass`, `resolvePhysicsWorldUnits`, `toSiLength`, `toSiMass`, `POSE_TARGET_CAPTURE_PRIORITY`, `PhysicsWorld`, `createPoseTargetCaptureSystem`, `liveSolverBodyCount`, `liveSolverColliderCount`, `liveSolverHandleCount`, `liveSolverJointCount`, `PhysicsCapabilities`, `PhysicsQueryCapabilities`, `PhysicsEventInterest`, `PhysicsSolverAdapter`, `PhysicsTuningCapabilities`, `SolverBodyAccess`, `SolverBodyTuningAccess`, `SolverJointAccess`, `SolverJointMotor`, `ColliderEventMap`, `ColliderOptions`, `ColliderTriggerEvent`, `RigidBodyCollisionEvent`, `AngularJointMotor`, `ColliderDescriptor`, `FixedJointDescriptor`, `JointDescriptor`, `JointDescriptorBase`, `JointLimits`, `JointType`, `LinearJointMotor`, `LocalPlane`, `PhysicsWorldOptions`, `PrismaticJointDescriptor`, `RevoluteJointDescriptor`, `RigidBodyDescriptor`, `RopeJointDescriptor`, `ShippedJointType`, `SphericalJointDescriptor`, `SphericalJointLimits`, `SpringJointDescriptor`, `StagedJointType`, `CollisionEvent`, `CollisionPhase`, `ContactPoint`, `JointBreakEvent`, `JointPhase`, `PhysicsEvent`, `PhysicsEventType`, `SleepEvent`, `SleepPhase`, `TriggerEvent`, `TriggerPhase`, `ForceField`, `ForceFieldAddOptions`, `ForceFieldEntry`, `ForceFieldSystemOptions`, `ForceFieldUnits`, `HingeJointOptions`, `JointBinding`, `JointBreakPayload`, `JointCommands`, `JointEventMap`, `JointOptions`, `RopeJointOptions`, `SliderJointOptions`, `SphericalJointOptions`, `SpringJointOptions`, `PhysicsMaterialOptions`, `PhysicsEventSystemOptions`, `PhysicsSystemOptions`, `StalePhysicsHandleKind`, `OverlapHit`, `OverlapQuery`, `PointHit`, `PointQuery`, `QueryCandidate`, `QueryFilter`, `QueryHit`, `QueryHitMode`, `QueryOptions`, `RaycastHit`, `RaycastQuery`, `ResolvedQueryOptions`, `ShapeCastHit`, `ShapeCastQuery`, `ColliderDocument`, `PhysicsMaterialDocument`, `RigidBodyDocument`, `BlendWeights`, `PointLoad`, `RigidBodyCommands`, `RigidBodyEventMap`, `RigidBodySleepEvent`, `SleepCommand`, `TorqueInput`, `SolverName`, `SolverRegistration`, `SolverRejectionReason`, `SolverRejectionReport`, `SolverResolveOptions`, `SolverSelection`, `BoxShape`, `CapsuleShape`, `ChainShape`, `CircleShape`, `CollisionShape`, `CollisionShape2D`, `CollisionShape3D`, `CollisionShapeType`, `ConeShape`, `ConvexHullShape`, `CylinderShape`, `HeightFieldShape`, `PolygonShape`, `PolylineShape`, `RectangleShape`, `SphereShape`, `TriangleMeshShape`, `AngularVelocityInput`, `BodyType`, `CCDMode`, `CombineMode`, `DeterminismLevel`, `PhysicsBodyHandle`, `PhysicsColliderHandle`, `PhysicsDimension`, `PhysicsHandle`, `PhysicsJointHandle`, `RotationInput`, `SleepingConfig`, `Vector3Input`, `SweptCharacterControllerOptions`, `SweptCharacterSystemOptions`, `ResolvedLocalPlane`, `PhysicsWorldUnits`, `ActiveBodyVisitor`, `BodyControlModeOptions`, `PhysicsSnapshot`, `PhysicsSnapshotConfiguration`, `PhysicsWorldAdapter`, `PhysicsWorldInit`, `PoseTargetCaptureSystemOptions`, `WorldOverlapHit`, `WorldPhysicsEvent`, `WorldPointHit`, `WorldQueryHit`, `WorldRaycastHit`, `WorldShapeCastHit`

---

### `packages/physics/src/world.ts` - `PhysicsWorld` (§20, §30, §32, §33, §34, §37, §39, §42, §43) — the object an
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/render`

---

### `packages/fourjs/src/scene-serializers.ts` - §79 node types and component serializers for the classes the engine itself

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError, JsonValue` |
| `@fourjs/geometry` | `Path, BufferGeometry, Point2D` |
| `@fourjs/materials` | `Material, MaterialTexture, SpriteMaterial, UnlitMaterial` |
| `@fourjs/motion` | `CAMERA_SHAKE_SERIALIZER, CHARACTER_CONTROLLER_SERIALIZER, CameraShake, CharacterController, FIRST_PERSON_LOOK_SERIALIZER, FOLLOW_RIG_SERIALIZER, FirstPersonLook, FollowRig, KINEMATIC_CONTROLLER_SERIALIZER, KinematicController, LOOK_AT_CONSTRAINT_SERIALIZER, LookAtConstraint, MOTION_COMPONENT_SERIALIZER, MotionComponent, ORBIT_RIG_SERIALIZER, OrbitRig` |
| `@fourjs/physics` | `COLLIDER_SERIALIZER, Collider, RIGID_BODY_SERIALIZER, RigidBody, SWEPT_CHARACTER_CONTROLLER_SERIALIZER, SweptCharacterController` |
| `@fourjs/render` | `Arc, Circle, Ellipse, Line, Mesh, PathShape, Polygon, Polyline, Rectangle, RegularPolygon, Renderable, Ring, Sector, Shape2D, Sprite, Star, resolveShapePaintSupport, restoreMeshSkeleton` |
| `@fourjs/render` | `GradientStop, Paint, ResolvedPaint, ResolvedShapeFill, ResolvedStrokeStyle, ScissorRect` |
| `@fourjs/scene` | `Bone, DirectionalLight, HemisphereLight, MORPH_WEIGHTS_SERIALIZER, MorphWeights, NODE_SPACE_SERIALIZER, NodeSpace, OrthographicCamera, PerspectiveCamera, PointLight, SCREEN_ORIGINS, SCREEN_UNITS, ScreenCamera, SpotLight, restoreNodeId, HitTestMode, Node` |
| `@fourjs/serialization` | `ComponentSerializerRegistry, createDefaultComponentSerializers, InstantiateSceneOptions, SceneNodeDocument, SerializeSceneOptions` |
| `@fourjs/text` | `GlyphAtlas, TextAlign` |
| `@fourjs/ui` | `Button, CanvasViewWidget, Checkbox, ImageWidget, Label, Panel, ProgressIndicator, RadioButton, Slider, Toggle, UIWidget, CheckableWidget, UIWidgetOptions, WidgetAccessibility` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./text-node.js` | `Text` | Import |

**Exports:**
- Interfaces: `SceneResourceCatalog`, `SceneNodeTypeOptions`, `SceneNodeTypeSupport`, `SceneSerializationSupport`
- Types: `UnknownResourcePolicy`
- Functions: `resourceCatalog`, `registerUISerializers`, `registerRenderSerializers`, `registerShapeSerializers`, `registerTextSerializers`, `composeSceneNodeTypes`, `registerPhysicsSerializers`, `registerSceneNodeTypes`
- Constants: `PANEL_NODE_TYPE`, `LABEL_NODE_TYPE`, `BUTTON_NODE_TYPE`, `TOGGLE_NODE_TYPE`, `CHECKBOX_NODE_TYPE`, `RADIO_BUTTON_NODE_TYPE`, `SLIDER_NODE_TYPE`, `PROGRESS_NODE_TYPE`, `IMAGE_NODE_TYPE`, `CANVAS_VIEW_NODE_TYPE`, `RENDERABLE_NODE_TYPE`, `SPRITE_NODE_TYPE`, `MESH_NODE_TYPE`, `BONE_NODE_TYPE`, `TEXT_NODE_TYPE`, `PERSPECTIVE_CAMERA_NODE_TYPE`, `ORTHOGRAPHIC_CAMERA_NODE_TYPE`, `SCREEN_CAMERA_NODE_TYPE`, `DIRECTIONAL_LIGHT_NODE_TYPE`, `POINT_LIGHT_NODE_TYPE`, `SPOT_LIGHT_NODE_TYPE`, `HEMISPHERE_LIGHT_NODE_TYPE`, `CIRCLE_NODE_TYPE`, `ELLIPSE_NODE_TYPE`, `RECTANGLE_NODE_TYPE`, `REGULAR_POLYGON_NODE_TYPE`, `POLYGON_NODE_TYPE`, `STAR_NODE_TYPE`, `SECTOR_NODE_TYPE`, `RING_NODE_TYPE`, `PATH_SHAPE_NODE_TYPE`, `LINE_NODE_TYPE`, `POLYLINE_NODE_TYPE`, `ARC_NODE_TYPE`

---

<<<<<<< HEAD
### `packages/fourjs/src/scene.ts` - scene module
=======
### `packages/physics/src/rigid-body.ts` - The `RigidBody` component (§6a, §23) and its §26 force/impulse command
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/scene` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/scene`

---

### `packages/fourjs/src/serialization.ts` - serialization module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/serialization` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/serialization`

---

### `packages/fourjs/src/text-node.ts` - `Text` (§49, §56) — a string, a font atlas and a material become **one** draw

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/text` | `TextLayoutOptions` |
| `@fourjs/geometry` | `BufferGeometry` |
| `@fourjs/materials` | `UnlitMaterial` |
| `@fourjs/render` | `Renderable, RenderableOptions` |
| `@fourjs/text` | `layoutText, GlyphAtlas, TextAlign, TextLayout` |
| `@fourjs/core` | `Disposable` |

**Exports:**
- Classes: `Text`
- Interfaces: `TextOptions`

---

### `packages/fourjs/src/text.ts` - text module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/text` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/text`

---

### `packages/fourjs/src/ui.ts` - ui module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/ui` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/ui`

---

<a id="packages-geometry-dependencies"></a>

## Packages/geometry Dependencies

### `packages/geometry/src/buffer-geometry.ts` - `BufferGeometry` (§53) — CPU-side vertex data, in the one shape the MVP

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3` |
=======
| `@fourjs/core` | `DEFAULT_SPACE_MODE, DEV_WARNING_PREFIX, EventEmitter, FourError, Component, ComponentHost, SpaceMode` |
| `@fourjs/math` | `Matrix3, Quaternion, Vector3` |
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
<<<<<<< HEAD
| `./geometry.js` | `Geometry, BoundingVolume, MutableBoundingVolume` | Import |
| `./resource-memory.js` | `noteGeometry, releaseGeometryDisposable, trackGeometryDisposable` | Import |

**Exports:**
- Classes: `BufferGeometry`
- Interfaces: `BufferGeometryOptions`
- Types: `GeometryDrawMode`, `GeometryIndexArray`, `GeometryBounds`

---

### `packages/geometry/src/cpu-skinning.ts` - Reusable CPU linear-blend skinning (§54, RFC 0003).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./buffer-geometry.js` | `BufferGeometry` | Import |

**Exports:**
- Classes: `CpuSkinning`

---

### `packages/geometry/src/geometry.ts` - §53's `Geometry` base and its `BoundingVolume` — the two declarations the
=======
| `./descriptors.js` | `RigidBodyDescriptor` | Import (type-only) |
| `./descriptors.js` | `resolveAngularVelocity, resolveRotation, widenToVector3` | Import |
| `./events.js` | `SleepEvent` | Import (type-only) |
| `./types.js` | `BodyType, CCDMode, PhysicsDimension, Vector3Input` | Import (type-only) |
| `./types.js` | `DEFAULT_CCD_MODE, DEFAULT_ENABLED_CCD_MODE` | Import |
| `./validation.js` | `validateMass, validateRigidBodyDescriptor` | Import |

**Exports:**
- Classes: `RigidBody`
- Interfaces: `BlendWeights`, `PointLoad`, `RigidBodyCommands`, `RigidBodyEventMap`
- Types: `TorqueInput`, `SleepCommand`, `RigidBodySleepEvent`
- Functions: `clearRigidBodyCommands`, `setRigidBodyRegistered`, `drainRigidBodySolverWrites`, `setRigidBodyType`, `setRigidBodyDerivedMass`, `setRigidBodySleeping`
- Constants: `RIGID_BODY_MASS_PROPERTIES_DIRTY`, `RIGID_BODY_DAMPING_DIRTY`, `RIGID_BODY_GRAVITY_SCALE_DIRTY`, `RIGID_BODY_CCD_DIRTY`

---

### `packages/physics/src/validation.ts` - Descriptor validation (§85), for the physics half of the checklist.
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `Disposable` |
| `@fourjs/math` | `Vector3` |

**Exports:**
- Interfaces: `BoundingVolume`, `MutableBoundingVolume`
- Functions: `nextGeometryIdentifier`

---

### `packages/geometry/src/index.ts` - --- R-21: §53 geometry base + bounding volume (begin) ---
=======
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Matrix3` |
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
<<<<<<< HEAD
| `./buffer-geometry.js` | `BufferGeometry` | Re-export |
| `./geometry.js` | `Geometry` | Re-export |
| `./primitives-3d.js` | `capsuleGeometry, coneGeometry, cylinderGeometry, extrudeGeometry, heightFieldGeometry, latheGeometry, sphereGeometry, torusGeometry, tubeGeometry` | Re-export |
| `./path.js` | `DEFAULT_FLATTEN_TOLERANCE, MAX_SUBDIVISION_DEPTH, Path, booleanOp` | Re-export |
| `./svg-document.js` | `DEFAULT_MAXIMUM_SVG_DOCUMENT_LENGTH, parseSvgDocument` | Re-export |
| `./svg-path.js` | `DEFAULT_MAXIMUM_PATH_DATA_LENGTH, formatSvgPathData, parseSvgPathData` | Re-export |
| `./primitives.js` | `boxGeometry, circleGeometry2D, planeGeometry, polygonGeometry2D` | Re-export |
| `./resource-memory.js` | `geometryMemoryBytes, liveGeometryCount` | Re-export |
| `./tessellation.js` | `DEFAULT_MITER_LIMIT, earClippingTessellator, expandStroke, triangulatePolygon` | Re-export |
| `./cpu-skinning.js` | `CpuSkinning` | Re-export |
| `./buffer-geometry.js` | `BufferGeometryOptions, GeometryBounds, GeometryDrawMode, GeometryIndexArray` | Re-export (type-only) |
| `./geometry.js` | `BoundingVolume` | Re-export (type-only) |
| `./primitives-3d.js` | `CapsuleGeometryOptions, ExtrudeGeometryOptions, HeightFieldGeometryOptions, LatheGeometryOptions, Point3D, SphereGeometryOptions, TaperedGeometryOptions, TorusGeometryOptions, TubeGeometryOptions` | Re-export (type-only) |
| `./path.js` | `BooleanOp, FillRule, PathArcCommand, PathClosestPoint, PathCloseCommand, PathCommand, PathCubicCommand, PathFillRings, PathLineCommand, PathMoveCommand, PathOptions, PathQuadraticCommand, PathSegmentCommand` | Re-export (type-only) |
| `./svg-document.js` | `SvgDocument, SvgDocumentParseOptions, SvgDocumentPath, SvgViewBox` | Re-export (type-only) |
| `./svg-path.js` | `SvgPathFormatOptions, SvgPathParseOptions` | Re-export (type-only) |
| `./primitives.js` | `BoxGeometryOptions, CircleGeometry2DOptions, PlaneGeometryOptions, PolygonGeometry2DOptions` | Re-export (type-only) |
| `./tessellation.js` | `Point2D, PolygonTessellator, Polyline2D, StrokeAlignment, StrokeGeometryOptions, StrokeLineCap, StrokeLineJoin, StrokeMesh` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `BufferGeometry`, `Geometry`, `capsuleGeometry`, `coneGeometry`, `cylinderGeometry`, `extrudeGeometry`, `heightFieldGeometry`, `latheGeometry`, `sphereGeometry`, `torusGeometry`, `tubeGeometry`, `DEFAULT_FLATTEN_TOLERANCE`, `MAX_SUBDIVISION_DEPTH`, `Path`, `booleanOp`, `DEFAULT_MAXIMUM_SVG_DOCUMENT_LENGTH`, `parseSvgDocument`, `DEFAULT_MAXIMUM_PATH_DATA_LENGTH`, `formatSvgPathData`, `parseSvgPathData`, `boxGeometry`, `circleGeometry2D`, `planeGeometry`, `polygonGeometry2D`, `geometryMemoryBytes`, `liveGeometryCount`, `DEFAULT_MITER_LIMIT`, `earClippingTessellator`, `expandStroke`, `triangulatePolygon`, `CpuSkinning`, `BufferGeometryOptions`, `GeometryBounds`, `GeometryDrawMode`, `GeometryIndexArray`, `BoundingVolume`, `CapsuleGeometryOptions`, `ExtrudeGeometryOptions`, `HeightFieldGeometryOptions`, `LatheGeometryOptions`, `Point3D`, `SphereGeometryOptions`, `TaperedGeometryOptions`, `TorusGeometryOptions`, `TubeGeometryOptions`, `BooleanOp`, `FillRule`, `PathArcCommand`, `PathClosestPoint`, `PathCloseCommand`, `PathCommand`, `PathCubicCommand`, `PathFillRings`, `PathLineCommand`, `PathMoveCommand`, `PathOptions`, `PathQuadraticCommand`, `PathSegmentCommand`, `SvgDocument`, `SvgDocumentParseOptions`, `SvgDocumentPath`, `SvgViewBox`, `SvgPathFormatOptions`, `SvgPathParseOptions`, `BoxGeometryOptions`, `CircleGeometry2DOptions`, `PlaneGeometryOptions`, `PolygonGeometry2DOptions`, `Point2D`, `PolygonTessellator`, `Polyline2D`, `StrokeAlignment`, `StrokeGeometryOptions`, `StrokeLineCap`, `StrokeLineJoin`, `StrokeMesh`

---

### `packages/geometry/src/path-boolean.ts` - §51 Boolean operations on flattened closed contours.
=======
| `./descriptors.js` | `AngularJointMotor, ColliderDescriptor, JointDescriptor, JointLimits, LinearJointMotor, PhysicsWorldOptions, RigidBodyDescriptor, ShippedJointType, SphericalJointLimits` | Import (type-only) |
| `./descriptors.js` | `JOINT_TYPES, SHIPPED_JOINT_TYPES, STAGED_JOINT_TYPES, jointTypeSupportsDimension, resolveGravity, resolveRotation` | Import |
| `./shapes.js` | `validateCollisionShape` | Import |
| `./types.js` | `BodyType, PhysicsDimension, Vector3Input` | Import (type-only) |
| `./types.js` | `BODY_TYPES, CCD_MODES, DEFAULT_ENABLED_CCD_MODE, DETERMINISM_LEVELS, PHYSICS_DIMENSIONS` | Import |

**Exports:**
- Functions: `validateMass`, `validateInertiaTensor`, `validateRigidBodyDescriptor`, `validateColliderDescriptor`, `validateJointLimits`, `validateSphericalJointLimits`, `validateAngularJointMotor`, `validateLinearJointMotor`, `validateJointBreakThreshold`, `validateJointDescriptor`, `validatePhysicsWorldOptions`

---

### `packages/physics/src/joints.ts` - The §28 joint classes — `FixedJoint`, `HingeJoint`, `SliderJoint`,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `EventEmitter, FourError` |
| `@fourjs/math` | `Quaternion, Vector3` |
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
<<<<<<< HEAD
| `./path.js` | `FillRule` | Import (type-only) |
| `./tessellation.js` | `Point2D` | Import (type-only) |

**Exports:**
- Types: `BooleanOp`
- Functions: `booleanPolygons`, `isConvex`, `sutherlandHodgman`, `ringsContain`

---

### `packages/geometry/src/path.ts` - The §51 path model — the vector-level source data every 2D shape, stroke,
=======
| `./body-access.js` | `SolverJointMotor` | Import (type-only) |
| `./descriptors.js` | `AngularJointMotor, FixedJointDescriptor, JointDescriptor, JointDescriptorBase, JointLimits, LinearJointMotor, PrismaticJointDescriptor, RevoluteJointDescriptor, RopeJointDescriptor, ShippedJointType, SphericalJointDescriptor, SphericalJointLimits, SpringJointDescriptor` | Import (type-only) |
| `./descriptors.js` | `widenToVector3` | Import |
| `./events.js` | `JointBreakEvent` | Import (type-only) |
| `./rigid-body.js` | `RigidBody` | Import (type-only) |
| `./types.js` | `PhysicsBodyHandle, PhysicsDimension, Vector3Input` | Import (type-only) |
| `./validation.js` | `validateAngularJointMotor, validateJointBreakThreshold, validateJointLimits, validateLinearJointMotor, validateSphericalJointLimits` | Import |

**Exports:**
- Classes: `FixedJoint`, `HingeJoint`, `SliderJoint`, `RopeJoint`, `SpringJoint`, `SphericalJoint`
- Interfaces: `JointEventMap`, `JointBinding`, `JointCommands`, `JointOptions`, `HingeJointOptions`, `SliderJointOptions`, `RopeJointOptions`, `SpringJointOptions`, `SphericalJointOptions`
- Types: `JointBreakPayload`, `RevoluteJoint`, `PrismaticJoint`, `BallJoint`
- Functions: `worldAnchorToLocal`, `worldAxisToLocal`, `bindJoint`, `unbindJoint`, `setJointBroken`, `clearJointCommands`, `readJointAnchors`, `readJointLimits`, `readJointMotor`
- Constants: `RevoluteJoint`, `PrismaticJoint`, `BallJoint`

---

### `packages/physics/src/descriptors.ts` - The descriptors an adapter is built from (§37) and the §21 widening helpers
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Matrix3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./path-boolean.js` | `booleanPolygons, BooleanOp` | Import |
| `./primitive-support.js` | `requirePositive` | Import |
| `./tessellation.js` | `Point2D, Polyline2D` | Import (type-only) |
| `./path-boolean.js` | `BooleanOp` | Re-export (type-only) |

**Exports:**
- Classes: `Path`
- Interfaces: `PathMoveCommand`, `PathLineCommand`, `PathQuadraticCommand`, `PathCubicCommand`, `PathArcCommand`, `PathCloseCommand`, `PathOptions`, `PathFillRings`, `PathClosestPoint`, `PathCursor`
- Types: `FillRule`, `PathSegmentCommand`, `PathCommand`
- Functions: `booleanOp`, `arcPoint`, `newCursor`, `advance`
- Constants: `DEFAULT_FLATTEN_TOLERANCE`, `MAX_SUBDIVISION_DEPTH`
- Re-exports: `BooleanOp`

---

### `packages/geometry/src/primitive-support.ts` - Shared building blocks of the §53 primitive builders — index allocation,

**Exports:**
- Types: `IndexArray`
- Functions: `createIndices`, `requirePositive`, `requireNonNegative`, `requireSegments`, `gridIndices`, `writeCap`

---

### `packages/geometry/src/primitives-3d.ts` - The nine 3D primitives §53 requires beyond the box and the plane — sphere,

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./buffer-geometry.js` | `BufferGeometry` | Import |
| `./primitive-support.js` | `createIndices, gridIndices, requireNonNegative, requirePositive, requireSegments, writeCap, IndexArray` | Import |
| `./tessellation.js` | `triangulatePolygon, Point2D` | Import |

**Exports:**
- Interfaces: `Point3D`, `SphereGeometryOptions`, `TaperedGeometryOptions`, `CapsuleGeometryOptions`, `TorusGeometryOptions`, `LatheGeometryOptions`, `ExtrudeGeometryOptions`, `TubeGeometryOptions`, `HeightFieldGeometryOptions`
- Functions: `sphereGeometry`, `cylinderGeometry`, `coneGeometry`, `capsuleGeometry`, `torusGeometry`, `latheGeometry`, `extrudeGeometry`, `tubeGeometry`, `heightFieldGeometry`

---

### `packages/geometry/src/primitives.ts` - Primitive geometry builders (§53) — the box, the plane, and the 2D circle.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./buffer-geometry.js` | `BufferGeometry` | Import |
| `./primitive-support.js` | `createIndices, requirePositive` | Import |
| `./tessellation.js` | `triangulatePolygon, Point2D` | Import |

**Exports:**
- Interfaces: `BoxGeometryOptions`, `PlaneGeometryOptions`, `CircleGeometry2DOptions`, `PolygonGeometry2DOptions`
- Functions: `boxGeometry`, `planeGeometry`, `circleGeometry2D`, `polygonGeometry2D`

---

### `packages/geometry/src/resource-memory.ts` - §83 resource accounting for geometries — how many are live, and how many

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, disposeTracked, trackDisposable` |

**Exports:**
- Functions: `noteGeometry`, `geometryMemoryBytes`, `liveGeometryCount`, `trackGeometryDisposable`, `releaseGeometryDisposable`

---

### `packages/geometry/src/svg-document.ts` - §50's SVG **document** tier: a small XML tokenizer that turns `<svg>`

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Matrix3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./path.js` | `Path, FillRule` | Import |
| `./svg-path.js` | `DEFAULT_MAXIMUM_PATH_DATA_LENGTH, parseSvgPathData, SvgPathParseOptions` | Import |

**Exports:**
- Interfaces: `SvgDocumentParseOptions`, `SvgViewBox`, `SvgDocumentPath`, `SvgDocument`
- Functions: `parseSvgDocument`, `parseTransform`
- Constants: `DEFAULT_MAXIMUM_SVG_DOCUMENT_LENGTH`

---

### `packages/geometry/src/svg-path.ts` - §50's *"SVG import/export compatibility"*, at the **path-data tier**: the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./path.js` | `Path, advance, arcPoint, newCursor, PathArcCommand, PathCursor` | Import |

**Exports:**
- Interfaces: `SvgPathFormatOptions`, `SvgPathParseOptions`
- Functions: `parseSvgPathData`, `formatSvgPathData`
- Constants: `DEFAULT_MAXIMUM_PATH_DATA_LENGTH`

---

### `packages/geometry/src/tessellation.ts` - Polygon tessellation (§52) — the isolated module that turns a closed 2D

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./buffer-geometry.js` | `GeometryIndexArray` | Import (type-only) |
| `./primitive-support.js` | `createIndices, requirePositive` | Import |

**Exports:**
- Interfaces: `Point2D`, `PolygonTessellator`, `Polyline2D`, `StrokeGeometryOptions`, `StrokeMesh`
- Types: `StrokeAlignment`, `StrokeLineCap`, `StrokeLineJoin`
- Functions: `triangulatePolygon`, `expandStroke`
- Constants: `earClippingTessellator`, `DEFAULT_MITER_LIMIT`

---

<a id="packages-input-dependencies"></a>

## Packages/input Dependencies

### `packages/input/src/drag.ts` - Dragging (§72, §120): press a node, move the pointer, get world-space deltas.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Unsubscribe` |
| `@fourjs/math` | `Vector3, DepthRange` |
| `@fourjs/scene` | `resolveWorldTransform, Camera, Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./pick.js` | `createPickRay` | Import |
| `./pointer-events.js` | `ScenePointerEvent` | Import (type-only) |
| `./pointer-input.js` | `PointerInput` | Import (type-only) |

**Exports:**
- Classes: `DragManager`
- Interfaces: `DragManagerOptions`
- Types: `DragListener`

---

### `packages/input/src/index.ts` - Polled key state -- "is W down?" -- which is what `@fourjs/input` most

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./drag.js` | `DragManager` | Re-export |
| `./key-events.js` | `SceneKeyEvent, dispatchKeyEvent` | Re-export |
| `./keyboard-input.js` | `KeyboardInput` | Re-export |
| `./keyboard-state.js` | `KeyboardState` | Re-export |
| `./pick.js` | `createPickRay, pick` | Re-export |
| `./pointer-events.js` | `CAPTURE_KEY_PREFIX, ScenePointerEvent, dispatchPointerEvent` | Re-export |
| `./pointer-input.js` | `DEFAULT_CLICK_MOVE_THRESHOLD, PointerInput` | Re-export |
| `./propagation.js` | `SceneInputEvent, buildPropagationPath, dispatchThreePhase` | Re-export |
| `./drag.js` | `DragListener, DragManagerOptions` | Re-export (type-only) |
| `./key-events.js` | `KeyDefaultSuppressor, KeyModifiers, SceneKeyEventInit, SceneKeyEventType` | Re-export (type-only) |
| `./keyboard-input.js` | `KeySurface, KeyboardInputOptions, SurfaceKeyEvent, SurfaceKeyListener` | Re-export (type-only) |
| `./pick.js` | `PickHit, Pickable, PickableAlphaMask, PickableTriangles, PickProvider` | Re-export (type-only) |
| `./pointer-events.js` | `PointerDeviceType, PropagatingPointerEventType, ScenePointerEventInit, ScenePointerEventType` | Re-export (type-only) |
| `./pointer-input.js` | `PointerInputOptions, PointerSurface, SurfacePointerEvent, SurfacePointerListener, SurfaceRect` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `DragManager`, `SceneKeyEvent`, `dispatchKeyEvent`, `KeyboardInput`, `KeyboardState`, `createPickRay`, `pick`, `CAPTURE_KEY_PREFIX`, `ScenePointerEvent`, `dispatchPointerEvent`, `DEFAULT_CLICK_MOVE_THRESHOLD`, `PointerInput`, `SceneInputEvent`, `buildPropagationPath`, `dispatchThreePhase`, `DragListener`, `DragManagerOptions`, `KeyDefaultSuppressor`, `KeyModifiers`, `SceneKeyEventInit`, `SceneKeyEventType`, `KeySurface`, `KeyboardInputOptions`, `SurfaceKeyEvent`, `SurfaceKeyListener`, `PickHit`, `Pickable`, `PickableAlphaMask`, `PickableTriangles`, `PickProvider`, `PointerDeviceType`, `PropagatingPointerEventType`, `ScenePointerEventInit`, `ScenePointerEventType`, `PointerInputOptions`, `PointerSurface`, `SurfacePointerEvent`, `SurfacePointerListener`, `SurfaceRect`

---

### `packages/input/src/key-events.ts` - Key events and their propagation through the scene graph (§72, §6b,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/scene` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./propagation.js` | `SceneInputEvent, dispatchThreePhase` | Import |

**Exports:**
- Classes: `SceneKeyEvent`
- Interfaces: `KeyModifiers`, `KeyDefaultSuppressor`, `SceneKeyEventInit`
- Types: `SceneKeyEventType`
- Functions: `dispatchKeyEvent`

---

### `packages/input/src/keyboard-input.ts` - The keyboard source (§72, 2026-08-07, A-10): platform key events in, scene

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/scene` | `Node` |
| `@fourjs/core` | `DEV, FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./key-events.js` | `SceneKeyEvent, dispatchKeyEvent, KeyDefaultSuppressor, SceneKeyEventType` | Import |
| `./propagation.js` | `buildPropagationPath` | Import |

**Exports:**
- Classes: `KeyboardInput`
- Interfaces: `SurfaceKeyEvent`, `KeySurface`, `KeyboardInputOptions`
- Types: `SurfaceKeyListener`

---

### `packages/input/src/keyboard-state.ts` - §72 — polled keyboard state: "is this key held right now?"

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./keyboard-input.js` | `KeySurface, SurfaceKeyListener` | Import (type-only) |

**Exports:**
- Classes: `KeyboardState`

---

### `packages/input/src/pick.ts` - Picking and hit testing (§71) — the bounds tier.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Matrix4, Vector3, DepthRange` |
| `@fourjs/scene` | `resolveWorldTransform, Camera, Node` |

**Exports:**
- Interfaces: `PickProvider`, `PickableAlphaMask`, `PickableTriangles`, `Pickable`, `PickHit`
- Functions: `createPickRay`, `pick`

---

### `packages/input/src/pointer-events.ts` - Pointer events and their propagation through the scene graph (§72, §6b).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3` |
| `@fourjs/scene` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./propagation.js` | `SceneInputEvent, dispatchThreePhase` | Import |
| `./propagation.js` | `buildPropagationPath` | Re-export |

**Exports:**
- Classes: `ScenePointerEvent`
- Interfaces: `ScenePointerEventInit`
- Types: `PropagatingPointerEventType`, `ScenePointerEventType`, `PointerDeviceType`
- Functions: `dispatchPointerEvent`
- Constants: `CAPTURE_KEY_PREFIX`
- Re-exports: `buildPropagationPath`

---

### `packages/input/src/pointer-input.ts` - The pointer source (§72): platform pointer events in, scene pointer events

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3, DepthRange` |
| `@fourjs/scene` | `Camera, Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./pick.js` | `pick, PickHit, Pickable, PickProvider` | Import |
| `./pointer-events.js` | `ScenePointerEvent, buildPropagationPath, dispatchPointerEvent, PointerDeviceType, PropagatingPointerEventType, ScenePointerEventType` | Import |

**Exports:**
- Classes: `PointerInput`
- Interfaces: `SurfacePointerEvent`, `SurfaceRect`, `PointerSurface`, `PointerInputOptions`
- Types: `SurfacePointerListener`
- Constants: `DEFAULT_CLICK_MOVE_THRESHOLD`

---

### `packages/input/src/propagation.ts` - The propagation machinery every scene input event shares (§72, §6b) — the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/scene` | `Node, NodeEventMap` |

**Exports:**
- Functions: `buildPropagationPath`, `dispatchThreePhase`

---

<a id="packages-materials-dependencies"></a>

## Packages/materials Dependencies

### `packages/materials/src/capabilities.ts` - This package's §81 capability token (RFC 0002).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `defineCapability` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./shader-operators.js` | `ShaderOperatorRegistry` | Import (type-only) |

**Exports:**
- Constants: `SHADER_OPERATORS`

---

### `packages/materials/src/index.ts` - §81's materials / shader-node token (RFC 0002): declared here;

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./capabilities.js` | `SHADER_OPERATORS` | Re-export |
| `./shader-operators.js` | `ShaderOperatorRegistry` | Re-export |
| `./lit-material.js` | `LitMaterial` | Re-export |
| `./material.js` | `Material` | Re-export |
| `./node-material.js` | `NodeMaterial` | Re-export |
| `./node-material-builder.js` | `NodeMaterialBuilder, ShaderExpression, ShaderGraphBuilder, ShaderGraphOutput` | Re-export |
| `./shader-graph.js` | `MAX_SHADER_GRAPH_NODES, MAX_SHADER_GRAPH_TEXTURES, SHADER_ATTRIBUTE_TYPES, SHADER_VALUE_COMPONENTS, analyzeShaderGraph, forEachShaderNodeReference, freezeShaderGraph` | Re-export |
| `./sprite-material.js` | `SpriteMaterial` | Re-export |
| `./stencil-state.js` | `MAX_STENCIL_VALUE, StencilState` | Re-export |
| `./standard-material.js` | `StandardMaterial` | Re-export |
| `./unlit-material.js` | `UnlitMaterial` | Re-export |
| `./resource-memory.js` | `liveMaterialCount` | Re-export |
| `./shader-function.js` | `ShaderFunction` | Re-export |
| `./shader-variants.js` | `ShaderVariantSet` | Re-export |
| `./shader-source-map.js` | `createShaderSourceMap` | Re-export |
| `./shader-operators.js` | `ShaderOperatorFactory` | Re-export (type-only) |
| `./lit-material.js` | `LitMaterialOptions` | Re-export (type-only) |
| `./material.js` | `BlendMode, MaterialOptions` | Re-export (type-only) |
| `./node-material.js` | `NodeMaterialOptions` | Re-export (type-only) |
| `./node-material-builder.js` | `ShaderOperand` | Re-export (type-only) |
| `./shader-graph.js` | `ShaderAttributeName, ShaderBinaryOp, ShaderDomain, ShaderGraph, ShaderGraphAnalysis, ShaderNode, ShaderNodeId, ShaderReflection, ShaderTextureReflection, ShaderUnaryOp, ShaderUniformReflection, ShaderValueType` | Re-export (type-only) |
| `./sprite-material.js` | `SpriteMaterialOptions, SpriteTexture` | Re-export (type-only) |
| `./stencil-state.js` | `StencilFunc, StencilOp, StencilStateOptions` | Re-export (type-only) |
| `./standard-material.js` | `ColorRGB, StandardMaterialOptions` | Re-export (type-only) |
| `./texture.js` | `MaterialTexture, MaterialTextureFilter, MaterialTextureMinFilter, MaterialTextureWrap` | Re-export (type-only) |
| `./unlit-material.js` | `ColorRGBA, UnlitMaterialOptions` | Re-export (type-only) |
| `./shader-function.js` | `ShaderFunctionDefinition` | Re-export (type-only) |
| `./shader-source-map.js` | `ShaderSourceLocation, ShaderSourceMap` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `SHADER_OPERATORS`, `ShaderOperatorRegistry`, `LitMaterial`, `Material`, `NodeMaterial`, `NodeMaterialBuilder`, `ShaderExpression`, `ShaderGraphBuilder`, `ShaderGraphOutput`, `MAX_SHADER_GRAPH_NODES`, `MAX_SHADER_GRAPH_TEXTURES`, `SHADER_ATTRIBUTE_TYPES`, `SHADER_VALUE_COMPONENTS`, `analyzeShaderGraph`, `forEachShaderNodeReference`, `freezeShaderGraph`, `SpriteMaterial`, `MAX_STENCIL_VALUE`, `StencilState`, `StandardMaterial`, `UnlitMaterial`, `liveMaterialCount`, `ShaderFunction`, `ShaderVariantSet`, `createShaderSourceMap`, `ShaderOperatorFactory`, `LitMaterialOptions`, `BlendMode`, `MaterialOptions`, `NodeMaterialOptions`, `ShaderOperand`, `ShaderAttributeName`, `ShaderBinaryOp`, `ShaderDomain`, `ShaderGraph`, `ShaderGraphAnalysis`, `ShaderNode`, `ShaderNodeId`, `ShaderReflection`, `ShaderTextureReflection`, `ShaderUnaryOp`, `ShaderUniformReflection`, `ShaderValueType`, `SpriteMaterialOptions`, `SpriteTexture`, `StencilFunc`, `StencilOp`, `StencilStateOptions`, `ColorRGB`, `StandardMaterialOptions`, `MaterialTexture`, `MaterialTextureFilter`, `MaterialTextureMinFilter`, `MaterialTextureWrap`, `ColorRGBA`, `UnlitMaterialOptions`, `ShaderFunctionDefinition`, `ShaderSourceLocation`, `ShaderSourceMap`

---

### `packages/materials/src/lit-material.ts` - `LitMaterial` (§57, §68, §120) — one RGBA color that responds to lights.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./material.js` | `Material, MaterialOptions` | Import |
| `./texture.js` | `MaterialTexture` | Import (type-only) |
| `./unlit-material.js` | `ColorRGBA` | Import (type-only) |

**Exports:**
- Classes: `LitMaterial`
- Interfaces: `LitMaterialOptions`

---

### `packages/materials/src/material.ts` - `Material` (§57) — the abstract base every material family member extends,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Disposable` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./resource-memory.js` | `noteMaterial, releaseMaterialDisposable, trackMaterialDisposable` | Import |
| `./stencil-state.js` | `StencilState` | Import (type-only) |

**Exports:**
- Interfaces: `MaterialOptions`
- Types: `BlendMode`

---

### `packages/materials/src/node-material-builder.ts` - The fluent authoring surface over `shader-graph.ts`'s IR (§60; RFC 0001).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./shader-graph.js` | `analyzeShaderGraph, analyzeShaderNodeType, ShaderAttributeName, ShaderBinaryOp, ShaderDomain, ShaderGraph, ShaderNode, ShaderNodeId, ShaderUnaryOp, ShaderValueType` | Import |
| `./node-material.js` | `NodeMaterial, NodeMaterialOptions` | Import |
| `./texture.js` | `MaterialTexture` | Import (type-only) |

**Exports:**
- Classes: `ShaderExpression`, `ShaderGraphOutput`, `ShaderGraphBuilder`, `NodeMaterialBuilder`
- Types: `ShaderOperand`

---

### `packages/materials/src/node-material.ts` - `NodeMaterial` (§57, §60) — the material family member that carries a

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./material.js` | `Material, MaterialOptions` | Import |
| `./shader-graph.js` | `SHADER_VALUE_COMPONENTS, analyzeShaderGraph, freezeShaderGraph, ShaderGraph, ShaderReflection, ShaderValueType` | Import |
| `./texture.js` | `MaterialTexture` | Import (type-only) |

**Exports:**
- Classes: `NodeMaterial`
- Interfaces: `NodeMaterialOptions`

---

### `packages/materials/src/resource-memory.ts` - §83 resource accounting for materials — how many are live (A-5 follow-up).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, disposeTracked, trackDisposable` |

**Exports:**
- Functions: `noteMaterial`, `liveMaterialCount`, `trackMaterialDisposable`, `releaseMaterialDisposable`

---

### `packages/materials/src/shader-function.ts` - A reusable, data-declared operator lowered to the existing closed IR. No

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./shader-graph.js` | `analyzeShaderGraph, freezeShaderGraph, forEachShaderNodeReference, ShaderGraph, ShaderNodeId, ShaderValueType` | Import |
| `./node-material-builder.js` | `ShaderExpression, ShaderGraphBuilder, ShaderOperand` | Import (type-only) |

**Exports:**
- Classes: `ShaderFunction`
- Interfaces: `ShaderFunctionDefinition`

---

### `packages/materials/src/shader-graph.ts` - The shader graph (§60) — a backend-independent, JSON-serializable shader IR

**Exports:**
- Interfaces: `ShaderGraph`, `ShaderUniformReflection`, `ShaderTextureReflection`, `ShaderReflection`, `ShaderGraphAnalysis`
- Types: `ShaderNodeId`, `ShaderValueType`, `ShaderDomain`, `ShaderAttributeName`, `ShaderUnaryOp`, `ShaderBinaryOp`, `ShaderNode`
- Functions: `forEachShaderNodeReference`, `analyzeShaderGraph`, `analyzeShaderNodeType`, `freezeShaderGraph`
- Constants: `MAX_SHADER_GRAPH_NODES`, `MAX_SHADER_GRAPH_TEXTURES`, `SHADER_VALUE_COMPONENTS`, `SHADER_ATTRIBUTE_TYPES`

---

### `packages/materials/src/shader-operators.ts` - The §81 materials / shader-node registry — a named map of operator

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./shader-function.js` | `ShaderFunction, ShaderFunctionDefinition` | Import |
| `./shader-graph.js` | `ShaderNode, ShaderNodeId` | Import (type-only) |

**Exports:**
- Classes: `ShaderOperatorRegistry`
- Types: `ShaderOperatorFactory`

---

### `packages/materials/src/shader-source-map.ts` - Maps the compiler's deterministic local declarations without changing shader

**Exports:**
- Interfaces: `ShaderSourceLocation`
- Types: `ShaderSourceMap`
- Functions: `createShaderSourceMap`

---

### `packages/materials/src/shader-variants.ts` - A finite, declarative family of compile-time graph alternatives. Each key

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./shader-graph.js` | `analyzeShaderGraph, freezeShaderGraph, ShaderGraph` | Import |

**Exports:**
- Classes: `ShaderVariantSet`

---

### `packages/materials/src/sprite-material.ts` - `SpriteMaterial` (§55, §57) — one texture, one tint.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./material.js` | `Material, MaterialOptions` | Import |
| `./texture.js` | `MaterialTexture` | Import (type-only) |
| `./unlit-material.js` | `ColorRGBA` | Import (type-only) |

**Exports:**
- Classes: `SpriteMaterial`
- Interfaces: `SpriteMaterialOptions`
- Types: `SpriteTexture`

---

### `packages/materials/src/standard-material.ts` - `StandardMaterial` (§59) — the metallic-roughness workflow, at the tier this

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `ColorRGB, ColorRGBA` |
| `@fourjs/math` | `ColorRGB` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./material.js` | `Material, MaterialOptions` | Import |
| `./texture.js` | `MaterialTexture` | Import (type-only) |

**Exports:**
- Classes: `StandardMaterial`
- Interfaces: `StandardMaterialOptions`
- Re-exports: `ColorRGB`

---

### `packages/materials/src/stencil-state.ts` - `StencilState` (§57, §67) — the per-material stencil test, write mask, and

**Exports:**
- Classes: `StencilState`
- Interfaces: `StencilStateOptions`
- Types: `StencilFunc`, `StencilOp`
- Constants: `MAX_STENCIL_VALUE`

---

### `packages/materials/src/texture.ts` - The read surface of a texture as a **material** and a rendering backend see

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `ColorSpace, Rectangle2` |

**Exports:**
- Interfaces: `MaterialTexture`
- Types: `MaterialTextureFilter`, `MaterialTextureMinFilter`, `MaterialTextureWrap`

---

### `packages/materials/src/unlit-material.ts` - `UnlitMaterial` (§57) — a flat RGBA color, optionally multiplied by a texture

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `ColorRGBA` |
| `@fourjs/math` | `ColorRGBA` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./material.js` | `Material, MaterialOptions` | Import |
| `./texture.js` | `MaterialTexture` | Import (type-only) |

**Exports:**
- Classes: `UnlitMaterial`
- Interfaces: `UnlitMaterialOptions`
- Re-exports: `ColorRGBA`

---

<a id="packages-math-dependencies"></a>

## Packages/math Dependencies

### `packages/math/src/alloc-counter.ts` - Allocation instrumentation for the math types (§7b, §83).

**Exports:**
- Functions: `noteConstruction`, `constructionCount`, `resetConstructionCount`

---

### `packages/math/src/color.ts` - Colour value types, the sRGB transfer functions, and CSS colour-string

**Exports:**
- Types: `ColorRGB`, `ColorRGBA`, `ColorSpace`
- Functions: `srgbToLinear`, `linearToSrgb`, `srgbToLinearRGB`, `linearToSrgbRGB`, `srgbToLinearRGBA`, `linearToSrgbRGBA`, `parseColor`, `parseColorRGB`

---

### `packages/math/src/frustum.ts` - The six clip planes of a view-projection matrix (§87) — the primitive a

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./matrix4.js` | `DepthRange, Matrix4` | Import (type-only) |
| `./vector3.js` | `Vector3` | Import (type-only) |

**Exports:**
- Classes: `Frustum`

---

### `packages/math/src/index.ts` - Package entry point for @fourjs/math (re-exports 22 symbols)

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./alloc-counter.js` | `constructionCount, resetConstructionCount` | Re-export |
| `./color.js` | `linearToSrgb, linearToSrgbRGB, linearToSrgbRGBA, parseColor, parseColorRGB, srgbToLinear, srgbToLinearRGB, srgbToLinearRGBA` | Re-export |
| `./frustum.js` | `Frustum` | Re-export |
| `./matrix3.js` | `Matrix3` | Re-export |
| `./matrix4.js` | `Matrix4` | Re-export |
| `./quaternion.js` | `Quaternion` | Re-export |
| `./rectangle2.js` | `Rectangle2` | Re-export |
| `./vector2.js` | `Vector2` | Re-export |
| `./vector3.js` | `Vector3` | Re-export |
| `./vector4.js` | `Vector4` | Re-export |
| `./color.js` | `ColorRGB, ColorRGBA, ColorSpace` | Re-export (type-only) |
| `./matrix4.js` | `DepthRange` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `constructionCount`, `resetConstructionCount`, `linearToSrgb`, `linearToSrgbRGB`, `linearToSrgbRGBA`, `parseColor`, `parseColorRGB`, `srgbToLinear`, `srgbToLinearRGB`, `srgbToLinearRGBA`, `Frustum`, `Matrix3`, `Matrix4`, `Quaternion`, `Rectangle2`, `Vector2`, `Vector3`, `Vector4`, `ColorRGB`, `ColorRGBA`, `ColorSpace`, `DepthRange`

---

### `packages/math/src/matrix3.ts` - Mutable 3×3 matrix stored **column-major** in a `Float64Array(9)` (§7b).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./alloc-counter.js` | `noteConstruction` | Import |
| `./matrix4.js` | `Matrix4` | Import (type-only) |

**Exports:**
- Classes: `Matrix3`

---

### `packages/math/src/matrix4.ts` - Clip-space depth convention of a projection matrix (plan D8).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./alloc-counter.js` | `noteConstruction` | Import |
| `./quaternion.js` | `setQuaternionFromBasis, Quaternion` | Import |
| `./vector3.js` | `Vector3` | Import (type-only) |

**Exports:**
- Classes: `Matrix4`
- Types: `DepthRange`

---

### `packages/math/src/quaternion.ts` - Above this dot product the two ends of a {@link Quaternion.slerp} are treated

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./alloc-counter.js` | `noteConstruction` | Import |
| `./vector3.js` | `Vector3` | Import (type-only) |

**Exports:**
- Classes: `Quaternion`
- Functions: `setQuaternionFromBasis`

---

### `packages/math/src/rectangle2.ts` - Default tolerance for {@link Rectangle2.equalsApprox}. See `vector2.ts` for

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./alloc-counter.js` | `noteConstruction` | Import |

**Exports:**
- Classes: `Rectangle2`

---

### `packages/math/src/vector2.ts` - Default tolerance for {@link Vector2.equalsApprox}. Chosen to sit a little

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./alloc-counter.js` | `noteConstruction` | Import |

**Exports:**
- Classes: `Vector2`

---

### `packages/math/src/vector3.ts` - Default tolerance for {@link Vector3.equalsApprox}. See `vector2.ts` for the

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./alloc-counter.js` | `noteConstruction` | Import |

**Exports:**
- Classes: `Vector3`

---

### `packages/math/src/vector4.ts` - Default tolerance for {@link Vector4.equalsApprox}. See `vector2.ts` for the

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./alloc-counter.js` | `noteConstruction` | Import |

**Exports:**
- Classes: `Vector4`

---

<a id="packages-motion-dependencies"></a>

## Packages/motion Dependencies

### `packages/motion/src/camera-rigs.ts` - §44 camera rigs: {@link OrbitRig} (orbit) and {@link FollowRig} (follow target

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Component, ComponentHost` |
| `@fourjs/math` | `Vector3` |
| `@fourjs/scene` | `resolveWorldTransform, Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./rig-target.js` | `placeAtWorldPosition, resolveTargetPosition, worldPositionOf, RigTarget` | Import |
| `./spring-damper.js` | `SpringDamper, SpringDamperVector3Result` | Import (type-only) |

**Exports:**
- Classes: `OrbitRig`, `FollowRig`
- Interfaces: `OrbitRigOptions`, `FollowRigOptions`
- Types: `FollowFrame`
- Constants: `DEFAULT_ORBIT_PITCH_LIMIT`, `DEFAULT_ORBIT_MIN_DISTANCE`

---

### `packages/motion/src/camera-shake.ts` - §44 camera shake: an additive pose offset driven by interpolated value

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Component, ComponentHost` |
| `@fourjs/math` | `Quaternion, Vector3` |
| `@fourjs/scene` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./random.js` | `SeededRandom` | Import |
| `./rig-target.js` | `placeAtWorldPosition, worldPositionOf` | Import |

**Exports:**
- Classes: `CameraShake`
- Interfaces: `CameraShakeOptions`

---

### `packages/motion/src/capabilities.ts` - This package's §81 capability token (RFC 0002; declared here since

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `defineCapability` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./systems.js` | `SystemRegistry` | Import (type-only) |
| `./path-planning.js` | `PathPlannerRegistry` | Import (type-only) |

**Exports:**
- Constants: `SIMULATION_SYSTEMS`, `PATH_PLANNERS`

---

### `packages/motion/src/character-controller.ts` - §12's **character controllers** — {@link CharacterController}, the one yaw

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Component, ComponentHost` |
| `@fourjs/scene` | `Transform` |

**Exports:**
- Classes: `CharacterController`, `FirstPersonLook`
- Interfaces: `CharacterControllerOptions`, `FirstPersonLookOptions`
- Constants: `DEFAULT_CHARACTER_GRAVITY`, `DEFAULT_FIRST_PERSON_PITCH_LIMIT`

---

### `packages/motion/src/clock.ts` - Clock and time domains (§9).

**Exports:**
- Interfaces: `TimeState`, `TimeStateOptions`
- Types: `ReadonlyTimeState`, `Clock`, `ReadonlyClock`
- Functions: `createTimeState`, `copyTimeState`, `assertFixedDeltaTime`, `assertTimeScale`
- Constants: `DEFAULT_FIXED_DELTA_TIME`, `DEFAULT_MAXIMUM_SUB_STEPS`

---

### `packages/motion/src/constraints.ts` - §12's look-at constraint and the §39 step-7 system that runs it, together

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Component, ComponentHost` |
| `@fourjs/math` | `Quaternion, Vector3` |
| `@fourjs/scene` | `resolveWorldTransform, warnAuthorityConflict, Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./camera-rigs.js` | `FollowRig, OrbitRig` | Import |
| `./camera-shake.js` | `CameraShake` | Import |
| `./rig-target.js` | `resolveTargetPosition, RigTarget` | Import |
| `./systems.js` | `PRIORITY_CONSTRAINTS, FixedUpdateContext, SimulationSystem` | Import |

**Exports:**
- Classes: `LookAtConstraint`, `ConstraintSystem`
- Interfaces: `LookAtConstraintOptions`, `ConstraintSystemOptions`

---

### `packages/motion/src/ik.ts` - Analytic two-bone inverse kinematics (§111 "inverse kinematics"; plan P8-1).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3` |
| `@fourjs/scene` | `resolveWorldTransform, Node` |

**Exports:**
- Interfaces: `TwoBoneIKSolution`, `JointLimit`, `IKSolveOptions`, `IKSolveResult`
- Types: `IKChain`
- Functions: `createTwoBoneIKSolution`, `solveTwoBoneIK`, `solveCCD`, `solveFABRIK`
- Constants: `DEFAULT_IK_TOLERANCE`, `DEFAULT_IK_MAX_ITERATIONS`

---

### `packages/motion/src/index.ts` - §81's motion-side capability token (RFC 0002), declared by the package that

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./capabilities.js` | `SIMULATION_SYSTEMS` | Re-export |
| `./camera-rigs.js` | `DEFAULT_ORBIT_PITCH_LIMIT, FollowRig, OrbitRig` | Re-export |
| `./camera-shake.js` | `CameraShake` | Re-export |
| `./character-controller.js` | `CharacterController, DEFAULT_CHARACTER_GRAVITY, DEFAULT_FIRST_PERSON_PITCH_LIMIT, FirstPersonLook` | Re-export |
| `./clock.js` | `DEFAULT_FIXED_DELTA_TIME, DEFAULT_MAXIMUM_SUB_STEPS, assertFixedDeltaTime, assertTimeScale, copyTimeState, createTimeState` | Re-export |
| `./constraints.js` | `ConstraintSystem, LookAtConstraint` | Re-export |
| `./ik.js` | `DEFAULT_IK_MAX_ITERATIONS, DEFAULT_IK_TOLERANCE, createTwoBoneIKSolution, solveCCD, solveFABRIK, solveTwoBoneIK` | Re-export |
| `./integrators.js` | `DEFAULT_INTEGRATOR, INTEGRATORS, explicitEuler, rk2, rk4, semiImplicitEuler, velocityVerlet` | Re-export |
| `./kinematic-controller.js` | `KINEMATIC_COMPLETION_TOLERANCE, KinematicController, KinematicSystem` | Re-export |
| `./motion-component.js` | `MotionComponent, MotionSystem` | Re-export |
| `./serializers.js` | `CHARACTER_CONTROLLER_SERIALIZER, FIRST_PERSON_LOOK_SERIALIZER, CAMERA_SHAKE_SERIALIZER, FOLLOW_RIG_SERIALIZER, KINEMATIC_CONTROLLER_SERIALIZER, LOOK_AT_CONSTRAINT_SERIALIZER, MOTION_COMPONENT_SERIALIZER, ORBIT_RIG_SERIALIZER` | Re-export |
| `./pid.js` | `DEFAULT_PID_OUTPUT_LIMITS, PIDController` | Re-export |
| `./prediction.js` | `ballisticApexHeight, ballisticTimeOfFlightToPlane, ballisticTimeToApex, interceptPoint, interceptTime, predictBallistic, predictLinear` | Re-export |
| `./random.js` | `SeededRandom` | Re-export |
| `./scheduler.js` | `Scheduler` | Re-export |
| `./spring-damper.js` | `SpringDamper` | Re-export |
| `./spatial-hash.js` | `SpatialHash` | Re-export |
| `./steering.js` | `SteeringAgent, WanderState, alignment, arrive, cohesion, evade, flee, pursue, seek, separation, truncate, wander, wanderSpherical` | Re-export |
| `./systems.js` | `PRIORITY_ANIMATION_TARGETS, PRIORITY_COMMANDS, PRIORITY_CONSTRAINTS, PRIORITY_EVENT_DISPATCH, PRIORITY_FORCES, PRIORITY_INPUT, PRIORITY_KINEMATICS, PRIORITY_PHYSICS_SOLVE, PRIORITY_RENDER_INTERPOLATION, PRIORITY_SENSOR_UPDATE, PRIORITY_SNAPSHOT, SystemRegistry` | Re-export |
| `./trajectories.js` | `BallisticTrajectory, CENTRAL_DIFFERENCE_STEP, CatmullRomTrajectory, CircularTrajectory, CubicBezierTrajectory, DEFAULT_BALLISTIC_ACCELERATION_Y, DampedSpringTrajectory, EllipticalTrajectory, LinearTrajectory, ParabolicTrajectory, ParametricTrajectory` | Re-export |
| `./path-planning.js` | `freezePlannedPath, validatePathQuery, plannedPathToTrajectory, PathPlannerRegistry` | Re-export |
| `./waypoint-graph-planner.js` | `WaypointGraphPlanner` | Re-export |
| `./steering.js` | `followWaypoints` | Re-export |
| `./capabilities.js` | `PATH_PLANNERS` | Re-export |
| `./camera-rigs.js` | `FollowFrame, FollowRigOptions, OrbitRigOptions` | Re-export (type-only) |
| `./camera-shake.js` | `CameraShakeOptions` | Re-export (type-only) |
| `./character-controller.js` | `CharacterControllerOptions, FirstPersonLookOptions` | Re-export (type-only) |
| `./clock.js` | `Clock, ReadonlyClock, ReadonlyTimeState, TimeState, TimeStateOptions` | Re-export (type-only) |
| `./constraints.js` | `ConstraintSystemOptions, LookAtConstraintOptions` | Re-export (type-only) |
| `./ik.js` | `IKChain, IKSolveOptions, IKSolveResult, JointLimit, TwoBoneIKSolution` | Re-export (type-only) |
| `./integrators.js` | `AccelerationFn, Integrator, IntegratorFn, IntegratorState` | Re-export (type-only) |
| `./kinematic-controller.js` | `KinematicSystemOptions, MoveOptions, PathFollowOptions, RotateOptions` | Re-export (type-only) |
| `./motion-component.js` | `MotionComponentOptions, MotionSystemOptions` | Re-export (type-only) |
| `./rig-target.js` | `RigTarget` | Re-export (type-only) |
| `./serializers.js` | `ComponentSerializerShape` | Re-export (type-only) |
| `./pid.js` | `PIDControllerOptions, PIDDerivativeSource` | Re-export (type-only) |
| `./prediction.js` | `InterceptTimeOptions` | Re-export (type-only) |
| `./scheduler.js` | `SchedulerCallback, SchedulerOptions` | Re-export (type-only) |
| `./spring-damper.js` | `SpringDamperCoefficientOptions, SpringDamperFrequencyOptions, SpringDamperOptions, SpringDamperResult, SpringDamperVector3Result` | Re-export (type-only) |
| `./spatial-hash.js` | `SpatialHashEntry, SpatialHashOptions` | Re-export (type-only) |
| `./steering.js` | `SteeringAgentOptions, SteeringContext, SteeringNeighbor, WanderStateOptions` | Re-export (type-only) |
| `./systems.js` | `Detach, FixedUpdateContext, SimulationContext, SimulationSystem, Unregister` | Re-export (type-only) |
| `./trajectories.js` | `BallisticTrajectoryOptions, CatmullRomTrajectoryOptions, CircularTrajectoryOptions, CubicBezierTrajectoryOptions, DampedSpringTrajectoryOptions, EllipticalTrajectoryOptions, LinearTrajectoryOptions, ParabolicTrajectoryOptions, ParametricTrajectoryOptions, Trajectory` | Re-export (type-only) |
| `./path-planning.js` | `PlannedPath, PathQuery, PathPlannerDeterminism, PathPlannerCapabilities, PathPlannerAdapter, PlannedPathToTrajectoryOptions` | Re-export (type-only) |
| `./waypoint-graph-planner.js` | `WaypointGraphOptions` | Re-export (type-only) |
| `./steering.js` | `WaypointCursor, FollowWaypointsOptions` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `SIMULATION_SYSTEMS`, `DEFAULT_ORBIT_PITCH_LIMIT`, `FollowRig`, `OrbitRig`, `CameraShake`, `CharacterController`, `DEFAULT_CHARACTER_GRAVITY`, `DEFAULT_FIRST_PERSON_PITCH_LIMIT`, `FirstPersonLook`, `DEFAULT_FIXED_DELTA_TIME`, `DEFAULT_MAXIMUM_SUB_STEPS`, `assertFixedDeltaTime`, `assertTimeScale`, `copyTimeState`, `createTimeState`, `ConstraintSystem`, `LookAtConstraint`, `DEFAULT_IK_MAX_ITERATIONS`, `DEFAULT_IK_TOLERANCE`, `createTwoBoneIKSolution`, `solveCCD`, `solveFABRIK`, `solveTwoBoneIK`, `DEFAULT_INTEGRATOR`, `INTEGRATORS`, `explicitEuler`, `rk2`, `rk4`, `semiImplicitEuler`, `velocityVerlet`, `KINEMATIC_COMPLETION_TOLERANCE`, `KinematicController`, `KinematicSystem`, `MotionComponent`, `MotionSystem`, `CHARACTER_CONTROLLER_SERIALIZER`, `FIRST_PERSON_LOOK_SERIALIZER`, `CAMERA_SHAKE_SERIALIZER`, `FOLLOW_RIG_SERIALIZER`, `KINEMATIC_CONTROLLER_SERIALIZER`, `LOOK_AT_CONSTRAINT_SERIALIZER`, `MOTION_COMPONENT_SERIALIZER`, `ORBIT_RIG_SERIALIZER`, `DEFAULT_PID_OUTPUT_LIMITS`, `PIDController`, `ballisticApexHeight`, `ballisticTimeOfFlightToPlane`, `ballisticTimeToApex`, `interceptPoint`, `interceptTime`, `predictBallistic`, `predictLinear`, `SeededRandom`, `Scheduler`, `SpringDamper`, `SpatialHash`, `SteeringAgent`, `WanderState`, `alignment`, `arrive`, `cohesion`, `evade`, `flee`, `pursue`, `seek`, `separation`, `truncate`, `wander`, `wanderSpherical`, `PRIORITY_ANIMATION_TARGETS`, `PRIORITY_COMMANDS`, `PRIORITY_CONSTRAINTS`, `PRIORITY_EVENT_DISPATCH`, `PRIORITY_FORCES`, `PRIORITY_INPUT`, `PRIORITY_KINEMATICS`, `PRIORITY_PHYSICS_SOLVE`, `PRIORITY_RENDER_INTERPOLATION`, `PRIORITY_SENSOR_UPDATE`, `PRIORITY_SNAPSHOT`, `SystemRegistry`, `BallisticTrajectory`, `CENTRAL_DIFFERENCE_STEP`, `CatmullRomTrajectory`, `CircularTrajectory`, `CubicBezierTrajectory`, `DEFAULT_BALLISTIC_ACCELERATION_Y`, `DampedSpringTrajectory`, `EllipticalTrajectory`, `LinearTrajectory`, `ParabolicTrajectory`, `ParametricTrajectory`, `freezePlannedPath`, `validatePathQuery`, `plannedPathToTrajectory`, `PathPlannerRegistry`, `WaypointGraphPlanner`, `followWaypoints`, `PATH_PLANNERS`, `FollowFrame`, `FollowRigOptions`, `OrbitRigOptions`, `CameraShakeOptions`, `CharacterControllerOptions`, `FirstPersonLookOptions`, `Clock`, `ReadonlyClock`, `ReadonlyTimeState`, `TimeState`, `TimeStateOptions`, `ConstraintSystemOptions`, `LookAtConstraintOptions`, `IKChain`, `IKSolveOptions`, `IKSolveResult`, `JointLimit`, `TwoBoneIKSolution`, `AccelerationFn`, `Integrator`, `IntegratorFn`, `IntegratorState`, `KinematicSystemOptions`, `MoveOptions`, `PathFollowOptions`, `RotateOptions`, `MotionComponentOptions`, `MotionSystemOptions`, `RigTarget`, `ComponentSerializerShape`, `PIDControllerOptions`, `PIDDerivativeSource`, `InterceptTimeOptions`, `SchedulerCallback`, `SchedulerOptions`, `SpringDamperCoefficientOptions`, `SpringDamperFrequencyOptions`, `SpringDamperOptions`, `SpringDamperResult`, `SpringDamperVector3Result`, `SpatialHashEntry`, `SpatialHashOptions`, `SteeringAgentOptions`, `SteeringContext`, `SteeringNeighbor`, `WanderStateOptions`, `Detach`, `FixedUpdateContext`, `SimulationContext`, `SimulationSystem`, `Unregister`, `BallisticTrajectoryOptions`, `CatmullRomTrajectoryOptions`, `CircularTrajectoryOptions`, `CubicBezierTrajectoryOptions`, `DampedSpringTrajectoryOptions`, `EllipticalTrajectoryOptions`, `LinearTrajectoryOptions`, `ParabolicTrajectoryOptions`, `ParametricTrajectoryOptions`, `Trajectory`, `PlannedPath`, `PathQuery`, `PathPlannerDeterminism`, `PathPlannerCapabilities`, `PathPlannerAdapter`, `PlannedPathToTrajectoryOptions`, `WaypointGraphOptions`, `WaypointCursor`, `FollowWaypointsOptions`

---

### `packages/motion/src/integrators.ts` - Numerical integrators (§38).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3` |

**Exports:**
- Types: `Integrator`, `IntegratorState`, `AccelerationFn`, `IntegratorFn`
- Constants: `explicitEuler`, `semiImplicitEuler`, `velocityVerlet`, `rk2`, `rk4`, `INTEGRATORS`, `DEFAULT_INTEGRATOR`

---

### `packages/motion/src/kinematic-controller.ts` - Kinematic motion (§12) — the {@link KinematicController} component and the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Component, ComponentHost` |
| `@fourjs/math` | `Quaternion, Vector3` |
| `@fourjs/scene` | `warnAuthorityConflict, Node, Transform` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./character-controller.js` | `CharacterController, FirstPersonLook` | Import |
| `./systems.js` | `PRIORITY_KINEMATICS, FixedUpdateContext, SimulationSystem` | Import |
| `./trajectories.js` | `Trajectory` | Import (type-only) |

**Exports:**
- Classes: `KinematicController`, `KinematicSystem`
- Interfaces: `MoveOptions`, `RotateOptions`, `PathFollowOptions`, `KinematicSystemOptions`
- Constants: `KINEMATIC_COMPLETION_TOLERANCE`

---

### `packages/motion/src/motion-component.ts` - `MotionComponent` (§11) and the system that advances it (§39 step 4).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Component, ComponentHost` |
| `@fourjs/math` | `Quaternion, Vector3` |
| `@fourjs/scene` | `warnAuthorityConflict, Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./systems.js` | `PRIORITY_KINEMATICS, FixedUpdateContext, SimulationSystem` | Import |

**Exports:**
- Classes: `MotionComponent`, `MotionSystem`
- Interfaces: `MotionComponentOptions`, `MotionSystemOptions`

---

### `packages/motion/src/path-planning.ts` - path-planning module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError, Disposable` |
| `@fourjs/math` | `Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./trajectories.js` | `CatmullRomTrajectory, ParametricTrajectory, Trajectory` | Import |

**Exports:**
- Classes: `PathPlannerRegistry`
- Interfaces: `PlannedPath`, `PathQuery`, `PathPlannerCapabilities`, `PathPlannerAdapter`, `PlannedPathToTrajectoryOptions`
- Types: `PathPlannerDeterminism`
- Functions: `validatePathQuery`, `freezePlannedPath`, `plannedPathToTrajectory`

---

### `packages/motion/src/pid.ts` - PID controller utility (§111).

**Exports:**
- Classes: `PIDController`
- Interfaces: `PIDControllerOptions`
- Types: `PIDDerivativeSource`
- Constants: `DEFAULT_PID_OUTPUT_LIMITS`

---

### `packages/motion/src/prediction.ts` - Trajectory prediction (§111 "trajectory prediction"; plan P8-1).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3` |

**Exports:**
- Interfaces: `InterceptTimeOptions`
- Functions: `predictBallistic`, `predictLinear`, `ballisticTimeToApex`, `ballisticApexHeight`, `ballisticTimeOfFlightToPlane`, `interceptTime`, `interceptPoint`

---

### `packages/motion/src/random.ts` - `SeededRandom`'s original home (WP-8.2), now a re-export of `@fourjs/core`.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `SeededRandom` |

**Exports:**
- Re-exports: `SeededRandom`

---

### `packages/motion/src/rig-target.ts` - What a rig aims at, and how a rig writes a world-space placement back onto a

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Matrix4, Vector3` |
| `@fourjs/scene` | `resolveWorldTransform, Node` |

**Exports:**
- Types: `RigTarget`
- Functions: `resolveTargetPosition`, `worldPositionOf`, `placeAtWorldPosition`

---

### `packages/motion/src/scheduler.ts` - Fixed-step scheduler (§10).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./clock.js` | `DEFAULT_FIXED_DELTA_TIME, DEFAULT_MAXIMUM_SUB_STEPS, assertFixedDeltaTime, assertTimeScale, createTimeState, ReadonlyTimeState, TimeState` | Import |

**Exports:**
- Classes: `Scheduler`
- Interfaces: `SchedulerOptions`
- Types: `SchedulerCallback`

---

### `packages/motion/src/serializers.ts` - The §79 serializers for this package's components (PH-17, 2026-08-06;

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `JsonValue` |
| `@fourjs/math` | `Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./camera-rigs.js` | `DEFAULT_ORBIT_MIN_DISTANCE, DEFAULT_ORBIT_PITCH_LIMIT, FollowRig, OrbitRig` | Import |
| `./camera-shake.js` | `CameraShake` | Import |
| `./character-controller.js` | `CharacterController, DEFAULT_CHARACTER_GRAVITY, DEFAULT_FIRST_PERSON_PITCH_LIMIT, FirstPersonLook` | Import |
| `./constraints.js` | `LookAtConstraint` | Import |
| `./kinematic-controller.js` | `KinematicController` | Import |
| `./motion-component.js` | `MotionComponent` | Import |
| `./rig-target.js` | `RigTarget` | Import (type-only) |
| `./spring-damper.js` | `SpringDamper` | Import |

**Exports:**
- Interfaces: `ComponentSerializerShape`
- Constants: `MOTION_COMPONENT_SERIALIZER`, `KINEMATIC_CONTROLLER_SERIALIZER`, `ORBIT_RIG_SERIALIZER`, `FOLLOW_RIG_SERIALIZER`, `LOOK_AT_CONSTRAINT_SERIALIZER`, `CHARACTER_CONTROLLER_SERIALIZER`, `FIRST_PERSON_LOOK_SERIALIZER`, `CAMERA_SHAKE_SERIALIZER`

---

### `packages/motion/src/spatial-hash.ts` - Uniform-grid spatial hash for radius neighbour queries (§12 flocking, §36

**Exports:**
- Classes: `SpatialHash`
- Interfaces: `SpatialHashOptions`, `SpatialHashEntry`

---

### `packages/motion/src/spring-damper.ts` - Spring-damper controller (§111), the game-smoothing primitive.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3` |

**Exports:**
- Classes: `SpringDamper`
- Interfaces: `SpringDamperCoefficientOptions`, `SpringDamperFrequencyOptions`, `SpringDamperResult`, `SpringDamperVector3Result`
- Types: `SpringDamperOptions`

---

### `packages/motion/src/steering.ts` - Steering behaviours and flocking (§12 "steering behaviours", §111), plan

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./path-planning.js` | `PlannedPath` | Import (type-only) |
| `./prediction.js` | `interceptTime` | Import |
| `./random.js` | `SeededRandom` | Import (type-only) |

**Exports:**
- Classes: `WanderState`, `SteeringAgent`
- Interfaces: `SteeringNeighbor`, `SteeringContext`, `WanderStateOptions`, `SteeringAgentOptions`, `WaypointCursor`, `FollowWaypointsOptions`
- Functions: `truncate`, `seek`, `flee`, `arrive`, `pursue`, `evade`, `wander`, `wanderSpherical`, `separation`, `cohesion`, `alignment`, `followWaypoints`

---

### `packages/motion/src/systems.ts` - Simulation systems and the priority registry (§39).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./clock.js` | `ReadonlyTimeState` | Import (type-only) |
| `./scheduler.js` | `Scheduler, SchedulerCallback` | Import (type-only) |

**Exports:**
- Classes: `SystemRegistry`
- Interfaces: `SimulationContext`, `FixedUpdateContext`, `SimulationSystem`
- Types: `Unregister`, `Detach`
- Constants: `PRIORITY_INPUT`, `PRIORITY_COMMANDS`, `PRIORITY_ANIMATION_TARGETS`, `PRIORITY_KINEMATICS`, `PRIORITY_FORCES`, `PRIORITY_PHYSICS_SOLVE`, `PRIORITY_CONSTRAINTS`, `PRIORITY_SENSOR_UPDATE`, `PRIORITY_EVENT_DISPATCH`, `PRIORITY_SNAPSHOT`, `PRIORITY_RENDER_INTERPOLATION`

---

### `packages/motion/src/trajectories.ts` - Trajectory system (§13).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3` |

**Exports:**
- Classes: `LinearTrajectory`, `ParabolicTrajectory`, `BallisticTrajectory`, `CircularTrajectory`, `EllipticalTrajectory`, `CubicBezierTrajectory`, `CatmullRomTrajectory`, `DampedSpringTrajectory`, `ParametricTrajectory`
- Interfaces: `Trajectory`, `LinearTrajectoryOptions`, `ParabolicTrajectoryOptions`, `BallisticTrajectoryOptions`, `CircularTrajectoryOptions`, `EllipticalTrajectoryOptions`, `CubicBezierTrajectoryOptions`, `CatmullRomTrajectoryOptions`, `DampedSpringTrajectoryOptions`, `ParametricTrajectoryOptions`
- Constants: `CENTRAL_DIFFERENCE_STEP`, `DEFAULT_BALLISTIC_ACCELERATION_Y`

---

### `packages/motion/src/waypoint-graph-planner.ts` - waypoint-graph-planner module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./path-planning.js` | `freezePlannedPath, validatePathQuery, PathPlannerAdapter, PathPlannerCapabilities, PathQuery, PlannedPath` | Import |

**Exports:**
- Classes: `WaypointGraphPlanner`
- Interfaces: `WaypointGraphOptions`

---

<a id="packages-particles-dependencies"></a>

## Packages/particles Dependencies

### `packages/particles/src/emitter.ts` - `ParticleEmitter` — the CPU particle simulation (§36, plan P9-1, WP-9.1).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Vector3, Vector4` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./pool.js` | `ParticlePool` | Import |
| `./random.js` | `SeededRandom` | Import |
| `./trail.js` | `ParticleTrailStore, resolveTrailOptions, ParticleTrailOptions` | Import |
| `./types.js` | `ParticleBurst, ParticleCollisionMode, ParticleColor, ParticleForceField, ParticleGpuIntegrateExtras, ParticleGpuRadialField, ParticleGpuSimulation, ParticleLifetimeRamp, ParticleLifetimeStop, ParticleRange, ParticleSimulationMode, ParticleTexture` | Import (type-only) |
| `./types.js` | `evaluateLifetimeRampColor, evaluateLifetimeRampNumber` | Import |

**Exports:**
- Classes: `ParticleEmitter`
- Interfaces: `ParticleEmitterOptions`
- Constants: `PARTICLE_DRAWS_PER_SPAWN`, `DEFAULT_PARTICLE_SEED`, `DEFAULT_PARTICLE_LIFETIME_SECONDS`, `DEFAULT_PARTICLE_SIZE`, `DEFAULT_PARTICLE_RESTITUTION`

---

### `packages/particles/src/fields.ts` - The §27 built-in force fields, MVP tier (plan P9-2, WP-9.2).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEFAULT_GRAVITY_Y` |
| `@fourjs/math` | `Vector3` |
| `@fourjs/core` | `DEFAULT_GRAVITY_Y` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./random.js` | `SeededRandom` | Import |
| `./types.js` | `ParticleForceField` | Import (type-only) |

**Exports:**
- Interfaces: `RadialFieldOptions`, `VortexFieldOptions`, `TurbulenceFieldOptions`, `SphereFieldVolume`, `BoxFieldVolume`
- Types: `FieldVolume`
- Functions: `uniformGravityField`, `dragField`, `windField`, `radialField`, `vortexField`, `turbulenceField`, `volumeField`
- Constants: `DEFAULT_RADIAL_MIN_DISTANCE`, `DEFAULT_VORTEX_MIN_DISTANCE`, `DEFAULT_TURBULENCE_FREQUENCY`, `DEFAULT_TURBULENCE_AMPLITUDE`, `TURBULENCE_DIFFERENCE_CELLS`
- Re-exports: `DEFAULT_GRAVITY_Y`

---

<<<<<<< HEAD
### `packages/particles/src/index.ts` - --- WP-9.2: §27 force fields (begin) ---
=======
### `packages/physics/src/swept-character-controller.ts` - §12's **solver-backed** character controller — {@link SweptCharacterController}

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV_WARNING_PREFIX, FourError` |
| `@fourjs/core` | `Component, ComponentHost` |
| `@fourjs/math` | `Vector3` |
| `@fourjs/motion` | `CharacterController, PRIORITY_KINEMATICS, FixedUpdateContext, SimulationSystem` |
| `@fourjs/scene` | `warnAuthorityConflict, Node` |
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
<<<<<<< HEAD
| `./emitter.js` | `DEFAULT_PARTICLE_LIFETIME_SECONDS, DEFAULT_PARTICLE_RESTITUTION, DEFAULT_PARTICLE_SEED, DEFAULT_PARTICLE_SIZE, PARTICLE_DRAWS_PER_SPAWN, ParticleEmitter` | Re-export |
| `./pool.js` | `ParticlePool` | Re-export |
| `./fields.js` | `DEFAULT_GRAVITY_Y, DEFAULT_RADIAL_MIN_DISTANCE, DEFAULT_TURBULENCE_AMPLITUDE, DEFAULT_TURBULENCE_FREQUENCY, DEFAULT_VORTEX_MIN_DISTANCE, TURBULENCE_DIFFERENCE_CELLS, dragField, radialField, turbulenceField, uniformGravityField, volumeField, vortexField, windField` | Re-export |
| `./particle-renderable.js` | `PARTICLE_INSTANCE_FLOATS, PARTICLE_ROTATION_OFFSET, PARTICLE_SOFTNESS_OFFSET, PARTICLE_TRAIL_VERTEX_FLOATS, PARTICLE_WIDE_INSTANCE_FLOATS, ParticleRenderable` | Re-export |
| `./particle-system.js` | `PRIORITY_PARTICLES, ParticleSystem` | Re-export |
| `./random.js` | `SeededRandom` | Re-export |
| `./trail.js` | `DEFAULT_TRAIL_LENGTH, DEFAULT_TRAIL_MIN_DISTANCE, DEFAULT_TRAIL_TAIL_WIDTH_FACTOR, DEFAULT_TRAIL_WIDTH, ParticleTrailStore, TRAIL_VERTEX_FLOATS, buildTrailRibbonMesh, resolveTrailOptions` | Re-export |
| `./types.js` | `evaluateLifetimeRampColor, evaluateLifetimeRampNumber` | Re-export |
| `./emitter.js` | `ParticleEmitterOptions` | Re-export (type-only) |
| `./fields.js` | `BoxFieldVolume, FieldVolume, RadialFieldOptions, SphereFieldVolume, TurbulenceFieldOptions, VortexFieldOptions` | Re-export (type-only) |
| `./particle-renderable.js` | `ParticleRenderableOptions` | Re-export (type-only) |
| `./particle-system.js` | `ParticleFixedUpdateContext, ParticleStepTime, ParticleSystemOptions, SteppableEmitter` | Re-export (type-only) |
| `./trail.js` | `ParticleTrailOptions` | Re-export (type-only) |
| `./types.js` | `ParticleBurst, ParticleCollisionMode, ParticleColor, ParticleForceField, ParticleGpuIntegrateExtras, ParticleGpuRadialField, ParticleGpuSimulation, ParticleLifetimeRamp, ParticleLifetimeStop, ParticleRange, ParticleSimulationMode, ParticleTexture` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `DEFAULT_PARTICLE_LIFETIME_SECONDS`, `DEFAULT_PARTICLE_RESTITUTION`, `DEFAULT_PARTICLE_SEED`, `DEFAULT_PARTICLE_SIZE`, `PARTICLE_DRAWS_PER_SPAWN`, `ParticleEmitter`, `ParticlePool`, `DEFAULT_GRAVITY_Y`, `DEFAULT_RADIAL_MIN_DISTANCE`, `DEFAULT_TURBULENCE_AMPLITUDE`, `DEFAULT_TURBULENCE_FREQUENCY`, `DEFAULT_VORTEX_MIN_DISTANCE`, `TURBULENCE_DIFFERENCE_CELLS`, `dragField`, `radialField`, `turbulenceField`, `uniformGravityField`, `volumeField`, `vortexField`, `windField`, `PARTICLE_INSTANCE_FLOATS`, `PARTICLE_ROTATION_OFFSET`, `PARTICLE_SOFTNESS_OFFSET`, `PARTICLE_TRAIL_VERTEX_FLOATS`, `PARTICLE_WIDE_INSTANCE_FLOATS`, `ParticleRenderable`, `PRIORITY_PARTICLES`, `ParticleSystem`, `SeededRandom`, `DEFAULT_TRAIL_LENGTH`, `DEFAULT_TRAIL_MIN_DISTANCE`, `DEFAULT_TRAIL_TAIL_WIDTH_FACTOR`, `DEFAULT_TRAIL_WIDTH`, `ParticleTrailStore`, `TRAIL_VERTEX_FLOATS`, `buildTrailRibbonMesh`, `resolveTrailOptions`, `evaluateLifetimeRampColor`, `evaluateLifetimeRampNumber`, `ParticleEmitterOptions`, `BoxFieldVolume`, `FieldVolume`, `RadialFieldOptions`, `SphereFieldVolume`, `TurbulenceFieldOptions`, `VortexFieldOptions`, `ParticleRenderableOptions`, `ParticleFixedUpdateContext`, `ParticleStepTime`, `ParticleSystemOptions`, `SteppableEmitter`, `ParticleTrailOptions`, `ParticleBurst`, `ParticleCollisionMode`, `ParticleColor`, `ParticleForceField`, `ParticleGpuIntegrateExtras`, `ParticleGpuRadialField`, `ParticleGpuSimulation`, `ParticleLifetimeRamp`, `ParticleLifetimeStop`, `ParticleRange`, `ParticleSimulationMode`, `ParticleTexture`

---

### `packages/particles/src/particle-renderable.ts` - `ParticleRenderable` (§36, §49, plan P9-3) — the scene node that puts a

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3, Vector4` |
| `@fourjs/scene` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./emitter.js` | `ParticleEmitter` | Import (type-only) |
| `./types.js` | `ParticleTexture` | Import (type-only) |
| `./trail.js` | `TRAIL_VERTEX_FLOATS, buildTrailRibbonMesh` | Import |

**Exports:**
- Classes: `ParticleRenderable`
- Interfaces: `ParticleRenderableOptions`
- Constants: `PARTICLE_INSTANCE_FLOATS`, `PARTICLE_WIDE_INSTANCE_FLOATS`, `PARTICLE_ROTATION_OFFSET`, `PARTICLE_SOFTNESS_OFFSET`, `PARTICLE_TRAIL_VERTEX_FLOATS`

---

### `packages/particles/src/particle-system.ts` - `ParticleSystem` (§39, §36, plan WP-9.4) — the fixed-step driver that steps

**Exports:**
- Classes: `ParticleSystem`
- Interfaces: `ParticleStepTime`, `ParticleFixedUpdateContext`, `SteppableEmitter`, `ParticleSystemOptions`
- Constants: `PRIORITY_PARTICLES`

---

### `packages/particles/src/pool.ts` - The particle pool (§36, plan P9-1) — a fixed-capacity, structure-of-arrays

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3, Vector4` |

**Exports:**
- Classes: `ParticlePool`

---

### `packages/particles/src/random.ts` - `SeededRandom` for particles — a re-export of `@fourjs/core`.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `SeededRandom` |

**Exports:**
- Re-exports: `SeededRandom`

---

### `packages/particles/src/trail.ts` - Per-particle position history and ribbon mesh generation (§36 trails, plan P9).

**Exports:**
- Classes: `ParticleTrailStore`
- Interfaces: `ParticleTrailOptions`
- Functions: `buildTrailRibbonMesh`, `resolveTrailOptions`
- Constants: `TRAIL_VERTEX_FLOATS`, `DEFAULT_TRAIL_LENGTH`, `DEFAULT_TRAIL_WIDTH`, `DEFAULT_TRAIL_MIN_DISTANCE`, `DEFAULT_TRAIL_TAIL_WIDTH_FACTOR`

---

### `packages/particles/src/types.ts` - Shared particle types (§27, §36) — the vocabulary WP-9.1's pool and emitter

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3` |

**Exports:**
- Interfaces: `ParticleForceField`, `ParticleGpuRadialField`, `ParticleGpuIntegrateExtras`, `ParticleGpuSimulation`, `ParticleRange`, `ParticleLifetimeStop`, `ParticleLifetimeRamp`, `ParticleColor`, `ParticleBurst`
- Types: `ParticleSimulationMode`, `ParticleCollisionMode`, `ParticleTexture`
- Functions: `evaluateLifetimeRampNumber`, `evaluateLifetimeRampColor`

---

<a id="packages-physics-dependencies"></a>

## Packages/physics Dependencies

### `packages/physics/src/adapter.ts` - The solver adapter contract (§37) — the seam every physics backend

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Disposable` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./descriptors.js` | `ColliderDescriptor, JointDescriptor, PhysicsWorldOptions, RigidBodyDescriptor` | Import (type-only) |
| `./events.js` | `PhysicsEvent` | Import (type-only) |
| `./queries.js` | `OverlapHit, OverlapQuery, PointHit, PointQuery, RaycastHit, RaycastQuery, ShapeCastHit, ShapeCastQuery` | Import (type-only) |
| `./types.js` | `CCDMode, DeterminismLevel, PhysicsBodyHandle, PhysicsColliderHandle, PhysicsDimension, PhysicsJointHandle` | Import (type-only) |

**Exports:**
- Interfaces: `PhysicsQueryCapabilities`, `PhysicsTuningCapabilities`, `PhysicsCapabilities`, `PhysicsSolverAdapter`
- Functions: `resolveTuningCapabilities`
- Constants: `NO_TUNING_CAPABILITIES`

---

### `packages/physics/src/body-access.ts` - Per-handle access to a solver's bodies — the seam §37's two `sync*` methods

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Matrix3, Quaternion, Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./types.js` | `AngularVelocityInput, BodyType, CCDMode, PhysicsBodyHandle, PhysicsColliderHandle, PhysicsJointHandle, RotationInput, Vector3Input` | Import (type-only) |

**Exports:**
- Interfaces: `SolverBodyAccess`, `SolverBodyTuningAccess`, `SolverJointMotor`, `SolverJointAccess`
- Functions: `supportsSolverJointAccess`, `missingSolverJointAccess`, `supportsSolverBodyTuning`, `missingSolverBodyTuning`

---

### `packages/physics/src/capabilities.ts` - This package's §81 capability token (RFC 0002; declared here since

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `defineCapability` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./solver-registry.js` | `SolverRegistry` | Import (type-only) |

**Exports:**
- Constants: `SOLVER_REGISTRY`

---

### `packages/physics/src/collider.ts` - The `Collider` component (§6a, §24) and its §25 effective-material

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `EventEmitter, FourError, Component, ComponentHost` |
| `@fourjs/scene` | `Node, Transform` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./descriptors.js` | `ColliderDescriptor` | Import (type-only) |
| `./events.js` | `CollisionEvent, TriggerEvent` | Import (type-only) |
| `./material.js` | `PhysicsMaterial` | Import (type-only) |
| `./material.js` | `DEFAULT_FRICTION, DEFAULT_RESTITUTION, resolveDensity` | Import |
=======
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd
| `./queries.js` | `ALL_COLLISION_GROUPS` | Import |
| `./rigid-body.js` | `RigidBody` | Import (type-only) |
| `./shapes.js` | `CollisionShape` | Import (type-only) |
| `./types.js` | `PhysicsBodyHandle` | Import (type-only) |
| `./world.js` | `PhysicsWorld, WorldShapeCastHit` | Import (type-only) |

**Exports:**
<<<<<<< HEAD
- Classes: `Collider`
- Interfaces: `ColliderEventMap`
- Types: `ColliderOptions`, `ColliderTriggerEvent`, `RigidBodyCollisionEvent`

---

### `packages/physics/src/descriptors.ts` - The descriptors an adapter is built from (§37) and the §21 widening helpers
=======
- Classes: `SweptCharacterController`, `SweptCharacterSystem`
- Interfaces: `SweptCharacterControllerOptions`, `SweptCharacterSystemOptions`
- Constants: `DEFAULT_SLOPE_LIMIT`, `DEFAULT_STEP_HEIGHT`, `DEFAULT_SKIN_WIDTH`, `DEFAULT_GROUND_SNAP_DISTANCE`, `DEFAULT_MAX_SLIDES`, `DEFAULT_PUSH_MASS`, `DEFAULT_PUSH_IMPULSE_SCALE`

---

### `packages/physics/src/physics-event-system.ts` - `PhysicsEventSystem` (§39 step 9, PH-21) — the optional occupant of
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `DEFAULT_GRAVITY_Y, FourError, SpaceMode` |
| `@fourjs/math` | `Quaternion, Vector3` |
| `@fourjs/math` | `Matrix3` |
| `@fourjs/scene` | `Transform` |
| `@fourjs/core` | `DEFAULT_GRAVITY_Y` |
=======
| `@fourjs/core` | `FourError` |
| `@fourjs/motion` | `PRIORITY_EVENT_DISPATCH, SimulationSystem` |
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
<<<<<<< HEAD
| `./material.js` | `PhysicsMaterial` | Import (type-only) |
| `./shapes.js` | `CollisionShape` | Import (type-only) |
| `./types.js` | `AngularVelocityInput, BodyType, CCDMode, DeterminismLevel, PhysicsBodyHandle, PhysicsDimension, RotationInput, SleepingConfig, Vector3Input` | Import (type-only) |
| `./types.js` | `DEFAULT_SLEEPING_CONFIG` | Import |
| `./world-units.js` | `PhysicsWorldUnits` | Import (type-only) |

**Exports:**
- Interfaces: `RigidBodyDescriptor`, `ColliderDescriptor`, `JointLimits`, `AngularJointMotor`, `LinearJointMotor`, `SphericalJointLimits`, `JointDescriptorBase`, `FixedJointDescriptor`, `RevoluteJointDescriptor`, `PrismaticJointDescriptor`, `RopeJointDescriptor`, `SpringJointDescriptor`, `SphericalJointDescriptor`, `PhysicsWorldOptions`, `LocalPlane`
- Types: `JointType`, `ShippedJointType`, `StagedJointType`, `JointDescriptor`
- Functions: `jointTypeSupportsDimension`, `widenToVector3`, `resolveGravity`, `resolveRotation`, `resolveAngularVelocity`, `resolveSleepingConfig`
- Constants: `JOINT_TYPES`, `SHIPPED_JOINT_TYPES`, `SHIPPED_JOINT_TYPES_2D`, `SHIPPED_JOINT_TYPES_3D`, `STAGED_JOINT_TYPES`
- Re-exports: `DEFAULT_GRAVITY_Y`
=======
| `./physics-system.js` | `PhysicsSystem` | Import (type-only) |
| `./world.js` | `PhysicsWorld` | Import (type-only) |

**Exports:**
- Classes: `PhysicsEventSystem`
- Interfaces: `PhysicsEventSystemOptions`

---

### `packages/physics/src/serializers.ts` - The §79 serializers for this package's two components — `RigidBody` (§23) and

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `SPACE_MODES, FourError, JsonValue, SpaceMode` |
| `@fourjs/math` | `Matrix3, Quaternion, Vector2, Vector3` |
| `@fourjs/motion` | `DEFAULT_CHARACTER_GRAVITY, ComponentSerializerShape` |
| `@fourjs/scene` | `Transform` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./collider.js` | `Collider, ColliderOptions` | Import |
| `./descriptors.js` | `RigidBodyDescriptor` | Import (type-only) |
| `./material.js` | `DEFAULT_DENSITY, DEFAULT_FRICTION, DEFAULT_RESTITUTION, PhysicsMaterial, PhysicsMaterialOptions` | Import |
| `./queries.js` | `ALL_COLLISION_GROUPS` | Import |
| `./rigid-body.js` | `RigidBody` | Import |
| `./swept-character-controller.js` | `DEFAULT_GROUND_SNAP_DISTANCE, DEFAULT_MAX_SLIDES, DEFAULT_PUSH_IMPULSE_SCALE, DEFAULT_PUSH_MASS, DEFAULT_SKIN_WIDTH, DEFAULT_SLOPE_LIMIT, DEFAULT_STEP_HEIGHT, SweptCharacterController` | Import |
| `./shapes.js` | `CollisionShape` | Import (type-only) |
| `./types.js` | `BODY_TYPES, CCD_MODES, DEFAULT_CCD_MODE` | Import |
| `./types.js` | `BodyType, CCDMode` | Import (type-only) |

**Exports:**
- Interfaces: `RigidBodyDocument`, `PhysicsMaterialDocument`, `ColliderDocument`
- Functions: `serializeCollisionShape`, `deserializeCollisionShape`
- Constants: `RIGID_BODY_SERIALIZER`, `COLLIDER_SERIALIZER`, `SWEPT_CHARACTER_CONTROLLER_SERIALIZER`

---

### `packages/physics/src/body-access.ts` - Per-handle access to a solver's bodies — the seam §37's two `sync*` methods

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Matrix3, Quaternion, Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./types.js` | `AngularVelocityInput, BodyType, CCDMode, PhysicsBodyHandle, PhysicsColliderHandle, PhysicsJointHandle, RotationInput, Vector3Input` | Import (type-only) |

**Exports:**
- Interfaces: `SolverBodyAccess`, `SolverBodyTuningAccess`, `SolverJointMotor`, `SolverJointAccess`
- Functions: `supportsSolverJointAccess`, `missingSolverJointAccess`, `supportsSolverBodyTuning`, `missingSolverBodyTuning`

---

### `packages/physics/src/world-units.ts` - §40 scale factors a {@link PhysicsWorld} may apply at the authoring boundary.

**Exports:**
- Interfaces: `PhysicsWorldUnits`
- Functions: `resolvePhysicsWorldUnits`, `toSiLength`, `fromSiLength`, `toSiMass`, `fromSiMass`

---

### `packages/physics/src/physics-system.ts` - `PhysicsSystem` (§39 step 6, plan P5-2) — the `SimulationSystem` that steps

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/motion` | `PRIORITY_PHYSICS_SOLVE, FixedUpdateContext, SimulationSystem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./world.js` | `PhysicsWorld` | Import (type-only) |

**Exports:**
- Classes: `PhysicsSystem`
- Interfaces: `PhysicsSystemOptions`
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

---

### `packages/physics/src/events.ts` - Collision, trigger, and sleep event payloads (§29, §32, §37).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./types.js` | `PhysicsBodyHandle, PhysicsColliderHandle, PhysicsJointHandle` | Import (type-only) |

**Exports:**
- Interfaces: `ContactPoint`, `CollisionEvent`, `TriggerEvent`, `SleepEvent`, `JointBreakEvent`
- Types: `CollisionPhase`, `TriggerPhase`, `SleepPhase`, `JointPhase`, `PhysicsEventType`, `PhysicsEvent`

---

<<<<<<< HEAD
### `packages/physics/src/force-field.ts` - §27 force fields for rigid bodies, through §26's force API (PH-8,
=======
### `packages/physics/src/local-plane.ts` - §21's `"local-plane"` simulation frame (PH-12 remainder).
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `DEV_WARNING_PREFIX` |
| `@fourjs/math` | `Vector3` |
| `@fourjs/motion` | `PRIORITY_FORCES, FixedUpdateContext, SimulationSystem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./rigid-body.js` | `RigidBody` | Import (type-only) |
| `./world.js` | `PhysicsWorld` | Import (type-only) |

**Exports:**
- Classes: `ForceFieldSystem`
- Interfaces: `ForceField`, `ForceFieldAddOptions`, `ForceFieldEntry`, `ForceFieldSystemOptions`
- Types: `ForceFieldUnits`

---

### `packages/physics/src/index.ts` - `@fourjs/physics` — the stable, solver-independent physics API (§101, Part IV).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./capabilities.js` | `SOLVER_REGISTRY` | Re-export |
| `./adapter.js` | `NO_TUNING_CAPABILITIES, resolveTuningCapabilities` | Re-export |
| `./body-access.js` | `missingSolverBodyTuning, missingSolverJointAccess, supportsSolverBodyTuning, supportsSolverJointAccess` | Re-export |
| `./collider.js` | `Collider` | Re-export |
| `./descriptors.js` | `DEFAULT_GRAVITY_Y, JOINT_TYPES, SHIPPED_JOINT_TYPES, SHIPPED_JOINT_TYPES_2D, SHIPPED_JOINT_TYPES_3D, STAGED_JOINT_TYPES, jointTypeSupportsDimension, resolveAngularVelocity, resolveGravity, resolveRotation, resolveSleepingConfig, widenToVector3` | Re-export |
| `./force-field.js` | `ForceFieldSystem` | Re-export |
| `./joints.js` | `BallJoint, FixedJoint, HingeJoint, Joint, PrismaticJoint, RevoluteJoint, RopeJoint, SliderJoint, SphericalJoint, SpringJoint, worldAnchorToLocal, worldAxisToLocal` | Re-export |
| `./physics-event-system.js` | `PhysicsEventSystem` | Re-export |
| `./physics-system.js` | `PhysicsSystem` | Re-export |
| `./stale-handle.js` | `rejectStalePhysicsHandle, resetStaleHandleWarnings` | Re-export |
| `./material.js` | `DEFAULT_DENSITY, DEFAULT_FRICTION, DEFAULT_FRICTION_COMBINE_MODE, DEFAULT_RESTITUTION, DEFAULT_RESTITUTION_COMBINE_MODE, PhysicsMaterial, combineFriction, combineRestitution, combineValues, resolveDensity` | Re-export |
| `./queries.js` | `ALL_COLLISION_GROUPS, passesQueryFilter, resolveQueryOptions, sortHitsByDistance` | Re-export |
| `./serializers.js` | `COLLIDER_SERIALIZER, RIGID_BODY_SERIALIZER, SWEPT_CHARACTER_CONTROLLER_SERIALIZER, deserializeCollisionShape, serializeCollisionShape` | Re-export |
| `./rigid-body.js` | `RigidBody` | Re-export |
| `./solver-registry.js` | `SolverRegistry, clearRegisteredSolvers, registerSolver, registeredSolvers, resolveSolver` | Re-export |
| `./shapes.js` | `COLLISION_SHAPE_TYPES_2D, COLLISION_SHAPE_TYPES_3D, COMPOSITE_COLLISION_SHAPE_TYPES, shapeIsConvex, shapeMaximumExtent, shapeSupportsDimension, validateCollisionShape, validateQueryShape` | Re-export |
| `./types.js` | `BODY_TYPES, CCD_MODES, COMBINE_MODES, DEFAULT_CCD_MODE, DEFAULT_DETERMINISM_LEVEL, DEFAULT_ENABLED_CCD_MODE, DEFAULT_SLEEPING_CONFIG, DETERMINISM_LEVELS, PHYSICS_DIMENSIONS` | Re-export |
| `./validation.js` | `validateAngularJointMotor, validateColliderDescriptor, validateInertiaTensor, validateJointBreakThreshold, validateJointDescriptor, validateJointLimits, validateLinearJointMotor, validateMass, validatePhysicsWorldOptions, validateRigidBodyDescriptor, validateSphericalJointLimits` | Re-export |
| `./swept-character-controller.js` | `DEFAULT_GROUND_SNAP_DISTANCE, DEFAULT_MAX_SLIDES, DEFAULT_PUSH_IMPULSE_SCALE, DEFAULT_PUSH_MASS, DEFAULT_SKIN_WIDTH, DEFAULT_SLOPE_LIMIT, DEFAULT_STEP_HEIGHT, SweptCharacterController, SweptCharacterSystem` | Re-export |
| `./local-plane.js` | `DEFAULT_LOCAL_PLANE, isDefaultLocalPlane, planeToWorld, planeToWorldVec, resolveLocalPlane, worldToPlane, worldToPlaneVec` | Re-export |
| `./world-units.js` | `fromSiLength, fromSiMass, resolvePhysicsWorldUnits, toSiLength, toSiMass` | Re-export |
| `./world.js` | `POSE_TARGET_CAPTURE_PRIORITY, PhysicsWorld, createPoseTargetCaptureSystem` | Re-export |
| `./resource-memory.js` | `liveSolverBodyCount, liveSolverColliderCount, liveSolverHandleCount, liveSolverJointCount` | Re-export |
| `./adapter.js` | `PhysicsCapabilities, PhysicsQueryCapabilities, PhysicsSolverAdapter, PhysicsTuningCapabilities` | Re-export (type-only) |
| `./body-access.js` | `SolverBodyAccess, SolverBodyTuningAccess, SolverJointAccess, SolverJointMotor` | Re-export (type-only) |
| `./collider.js` | `ColliderEventMap, ColliderOptions, ColliderTriggerEvent, RigidBodyCollisionEvent` | Re-export (type-only) |
| `./descriptors.js` | `AngularJointMotor, ColliderDescriptor, FixedJointDescriptor, JointDescriptor, JointDescriptorBase, JointLimits, JointType, LinearJointMotor, LocalPlane, PhysicsWorldOptions, PrismaticJointDescriptor, RevoluteJointDescriptor, RigidBodyDescriptor, RopeJointDescriptor, ShippedJointType, SphericalJointDescriptor, SphericalJointLimits, SpringJointDescriptor, StagedJointType` | Re-export (type-only) |
| `./events.js` | `CollisionEvent, CollisionPhase, ContactPoint, JointBreakEvent, JointPhase, PhysicsEvent, PhysicsEventType, SleepEvent, SleepPhase, TriggerEvent, TriggerPhase` | Re-export (type-only) |
| `./force-field.js` | `ForceField, ForceFieldAddOptions, ForceFieldEntry, ForceFieldSystemOptions, ForceFieldUnits` | Re-export (type-only) |
| `./joints.js` | `HingeJointOptions, JointBinding, JointBreakPayload, JointCommands, JointEventMap, JointOptions, RopeJointOptions, SliderJointOptions, SphericalJointOptions, SpringJointOptions` | Re-export (type-only) |
| `./material.js` | `PhysicsMaterialOptions` | Re-export (type-only) |
| `./physics-event-system.js` | `PhysicsEventSystemOptions` | Re-export (type-only) |
| `./physics-system.js` | `PhysicsSystemOptions` | Re-export (type-only) |
| `./stale-handle.js` | `StalePhysicsHandleKind` | Re-export (type-only) |
| `./queries.js` | `OverlapHit, OverlapQuery, PointHit, PointQuery, QueryCandidate, QueryFilter, QueryHit, QueryHitMode, QueryOptions, RaycastHit, RaycastQuery, ResolvedQueryOptions, ShapeCastHit, ShapeCastQuery` | Re-export (type-only) |
| `./serializers.js` | `ColliderDocument, PhysicsMaterialDocument, RigidBodyDocument` | Re-export (type-only) |
| `./rigid-body.js` | `BlendWeights, PointLoad, RigidBodyCommands, RigidBodyEventMap, RigidBodySleepEvent, SleepCommand, TorqueInput` | Re-export (type-only) |
| `./solver-registry.js` | `SolverName, SolverRegistration, SolverRejectionReason, SolverRejectionReport, SolverResolveOptions, SolverSelection` | Re-export (type-only) |
| `./shapes.js` | `BoxShape, CapsuleShape, ChainShape, CircleShape, CollisionShape, CollisionShape2D, CollisionShape3D, CollisionShapeType, ConeShape, ConvexHullShape, CylinderShape, HeightFieldShape, PolygonShape, PolylineShape, RectangleShape, SphereShape, TriangleMeshShape` | Re-export (type-only) |
| `./types.js` | `AngularVelocityInput, BodyType, CCDMode, CombineMode, DeterminismLevel, PhysicsBodyHandle, PhysicsColliderHandle, PhysicsDimension, PhysicsHandle, PhysicsJointHandle, RotationInput, SleepingConfig, Vector3Input` | Re-export (type-only) |
| `./swept-character-controller.js` | `SweptCharacterControllerOptions, SweptCharacterSystemOptions` | Re-export (type-only) |
| `./local-plane.js` | `ResolvedLocalPlane` | Re-export (type-only) |
| `./world-units.js` | `PhysicsWorldUnits` | Re-export (type-only) |
| `./world.js` | `ActiveBodyVisitor, BodyControlModeOptions, PhysicsSnapshot, PhysicsSnapshotConfiguration, PhysicsWorldAdapter, PhysicsWorldInit, PoseTargetCaptureSystemOptions, WorldOverlapHit, WorldPhysicsEvent, WorldPointHit, WorldQueryHit, WorldRaycastHit, WorldShapeCastHit` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `SOLVER_REGISTRY`, `NO_TUNING_CAPABILITIES`, `resolveTuningCapabilities`, `missingSolverBodyTuning`, `missingSolverJointAccess`, `supportsSolverBodyTuning`, `supportsSolverJointAccess`, `Collider`, `DEFAULT_GRAVITY_Y`, `JOINT_TYPES`, `SHIPPED_JOINT_TYPES`, `SHIPPED_JOINT_TYPES_2D`, `SHIPPED_JOINT_TYPES_3D`, `STAGED_JOINT_TYPES`, `jointTypeSupportsDimension`, `resolveAngularVelocity`, `resolveGravity`, `resolveRotation`, `resolveSleepingConfig`, `widenToVector3`, `ForceFieldSystem`, `BallJoint`, `FixedJoint`, `HingeJoint`, `Joint`, `PrismaticJoint`, `RevoluteJoint`, `RopeJoint`, `SliderJoint`, `SphericalJoint`, `SpringJoint`, `worldAnchorToLocal`, `worldAxisToLocal`, `PhysicsEventSystem`, `PhysicsSystem`, `rejectStalePhysicsHandle`, `resetStaleHandleWarnings`, `DEFAULT_DENSITY`, `DEFAULT_FRICTION`, `DEFAULT_FRICTION_COMBINE_MODE`, `DEFAULT_RESTITUTION`, `DEFAULT_RESTITUTION_COMBINE_MODE`, `PhysicsMaterial`, `combineFriction`, `combineRestitution`, `combineValues`, `resolveDensity`, `ALL_COLLISION_GROUPS`, `passesQueryFilter`, `resolveQueryOptions`, `sortHitsByDistance`, `COLLIDER_SERIALIZER`, `RIGID_BODY_SERIALIZER`, `SWEPT_CHARACTER_CONTROLLER_SERIALIZER`, `deserializeCollisionShape`, `serializeCollisionShape`, `RigidBody`, `SolverRegistry`, `clearRegisteredSolvers`, `registerSolver`, `registeredSolvers`, `resolveSolver`, `COLLISION_SHAPE_TYPES_2D`, `COLLISION_SHAPE_TYPES_3D`, `COMPOSITE_COLLISION_SHAPE_TYPES`, `shapeIsConvex`, `shapeMaximumExtent`, `shapeSupportsDimension`, `validateCollisionShape`, `validateQueryShape`, `BODY_TYPES`, `CCD_MODES`, `COMBINE_MODES`, `DEFAULT_CCD_MODE`, `DEFAULT_DETERMINISM_LEVEL`, `DEFAULT_ENABLED_CCD_MODE`, `DEFAULT_SLEEPING_CONFIG`, `DETERMINISM_LEVELS`, `PHYSICS_DIMENSIONS`, `validateAngularJointMotor`, `validateColliderDescriptor`, `validateInertiaTensor`, `validateJointBreakThreshold`, `validateJointDescriptor`, `validateJointLimits`, `validateLinearJointMotor`, `validateMass`, `validatePhysicsWorldOptions`, `validateRigidBodyDescriptor`, `validateSphericalJointLimits`, `DEFAULT_GROUND_SNAP_DISTANCE`, `DEFAULT_MAX_SLIDES`, `DEFAULT_PUSH_IMPULSE_SCALE`, `DEFAULT_PUSH_MASS`, `DEFAULT_SKIN_WIDTH`, `DEFAULT_SLOPE_LIMIT`, `DEFAULT_STEP_HEIGHT`, `SweptCharacterController`, `SweptCharacterSystem`, `DEFAULT_LOCAL_PLANE`, `isDefaultLocalPlane`, `planeToWorld`, `planeToWorldVec`, `resolveLocalPlane`, `worldToPlane`, `worldToPlaneVec`, `fromSiLength`, `fromSiMass`, `resolvePhysicsWorldUnits`, `toSiLength`, `toSiMass`, `POSE_TARGET_CAPTURE_PRIORITY`, `PhysicsWorld`, `createPoseTargetCaptureSystem`, `liveSolverBodyCount`, `liveSolverColliderCount`, `liveSolverHandleCount`, `liveSolverJointCount`, `PhysicsCapabilities`, `PhysicsQueryCapabilities`, `PhysicsSolverAdapter`, `PhysicsTuningCapabilities`, `SolverBodyAccess`, `SolverBodyTuningAccess`, `SolverJointAccess`, `SolverJointMotor`, `ColliderEventMap`, `ColliderOptions`, `ColliderTriggerEvent`, `RigidBodyCollisionEvent`, `AngularJointMotor`, `ColliderDescriptor`, `FixedJointDescriptor`, `JointDescriptor`, `JointDescriptorBase`, `JointLimits`, `JointType`, `LinearJointMotor`, `LocalPlane`, `PhysicsWorldOptions`, `PrismaticJointDescriptor`, `RevoluteJointDescriptor`, `RigidBodyDescriptor`, `RopeJointDescriptor`, `ShippedJointType`, `SphericalJointDescriptor`, `SphericalJointLimits`, `SpringJointDescriptor`, `StagedJointType`, `CollisionEvent`, `CollisionPhase`, `ContactPoint`, `JointBreakEvent`, `JointPhase`, `PhysicsEvent`, `PhysicsEventType`, `SleepEvent`, `SleepPhase`, `TriggerEvent`, `TriggerPhase`, `ForceField`, `ForceFieldAddOptions`, `ForceFieldEntry`, `ForceFieldSystemOptions`, `ForceFieldUnits`, `HingeJointOptions`, `JointBinding`, `JointBreakPayload`, `JointCommands`, `JointEventMap`, `JointOptions`, `RopeJointOptions`, `SliderJointOptions`, `SphericalJointOptions`, `SpringJointOptions`, `PhysicsMaterialOptions`, `PhysicsEventSystemOptions`, `PhysicsSystemOptions`, `StalePhysicsHandleKind`, `OverlapHit`, `OverlapQuery`, `PointHit`, `PointQuery`, `QueryCandidate`, `QueryFilter`, `QueryHit`, `QueryHitMode`, `QueryOptions`, `RaycastHit`, `RaycastQuery`, `ResolvedQueryOptions`, `ShapeCastHit`, `ShapeCastQuery`, `ColliderDocument`, `PhysicsMaterialDocument`, `RigidBodyDocument`, `BlendWeights`, `PointLoad`, `RigidBodyCommands`, `RigidBodyEventMap`, `RigidBodySleepEvent`, `SleepCommand`, `TorqueInput`, `SolverName`, `SolverRegistration`, `SolverRejectionReason`, `SolverRejectionReport`, `SolverResolveOptions`, `SolverSelection`, `BoxShape`, `CapsuleShape`, `ChainShape`, `CircleShape`, `CollisionShape`, `CollisionShape2D`, `CollisionShape3D`, `CollisionShapeType`, `ConeShape`, `ConvexHullShape`, `CylinderShape`, `HeightFieldShape`, `PolygonShape`, `PolylineShape`, `RectangleShape`, `SphereShape`, `TriangleMeshShape`, `AngularVelocityInput`, `BodyType`, `CCDMode`, `CombineMode`, `DeterminismLevel`, `PhysicsBodyHandle`, `PhysicsColliderHandle`, `PhysicsDimension`, `PhysicsHandle`, `PhysicsJointHandle`, `RotationInput`, `SleepingConfig`, `Vector3Input`, `SweptCharacterControllerOptions`, `SweptCharacterSystemOptions`, `ResolvedLocalPlane`, `PhysicsWorldUnits`, `ActiveBodyVisitor`, `BodyControlModeOptions`, `PhysicsSnapshot`, `PhysicsSnapshotConfiguration`, `PhysicsWorldAdapter`, `PhysicsWorldInit`, `PoseTargetCaptureSystemOptions`, `WorldOverlapHit`, `WorldPhysicsEvent`, `WorldPointHit`, `WorldQueryHit`, `WorldRaycastHit`, `WorldShapeCastHit`

---

### `packages/physics/src/joints.ts` - The §28 joint classes — `FixedJoint`, `HingeJoint`, `SliderJoint`,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `EventEmitter, FourError` |
=======
| `@fourjs/core` | `FourError` |
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd
| `@fourjs/math` | `Quaternion, Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
<<<<<<< HEAD
| `./body-access.js` | `SolverJointMotor` | Import (type-only) |
| `./descriptors.js` | `AngularJointMotor, FixedJointDescriptor, JointDescriptor, JointDescriptorBase, JointLimits, LinearJointMotor, PrismaticJointDescriptor, RevoluteJointDescriptor, RopeJointDescriptor, ShippedJointType, SphericalJointDescriptor, SphericalJointLimits, SpringJointDescriptor` | Import (type-only) |
| `./descriptors.js` | `widenToVector3` | Import |
| `./events.js` | `JointBreakEvent` | Import (type-only) |
| `./rigid-body.js` | `RigidBody` | Import (type-only) |
| `./types.js` | `PhysicsBodyHandle, PhysicsDimension, Vector3Input` | Import (type-only) |
| `./validation.js` | `validateAngularJointMotor, validateJointBreakThreshold, validateJointLimits, validateLinearJointMotor, validateSphericalJointLimits` | Import |

**Exports:**
- Classes: `FixedJoint`, `HingeJoint`, `SliderJoint`, `RopeJoint`, `SpringJoint`, `SphericalJoint`
- Interfaces: `JointEventMap`, `JointBinding`, `JointCommands`, `JointOptions`, `HingeJointOptions`, `SliderJointOptions`, `RopeJointOptions`, `SpringJointOptions`, `SphericalJointOptions`
- Types: `JointBreakPayload`, `RevoluteJoint`, `PrismaticJoint`, `BallJoint`
- Functions: `worldAnchorToLocal`, `worldAxisToLocal`, `bindJoint`, `unbindJoint`, `setJointBroken`, `clearJointCommands`, `readJointAnchors`, `readJointLimits`, `readJointMotor`
- Constants: `RevoluteJoint`, `PrismaticJoint`, `BallJoint`

---

### `packages/physics/src/local-plane.ts` - §21's `"local-plane"` simulation frame (PH-12 remainder).
=======
| `./descriptors.js` | `widenToVector3, LocalPlane` | Import |

**Exports:**
- Interfaces: `ResolvedLocalPlane`
- Functions: `isDefaultLocalPlane`, `resolveLocalPlane`, `planeToWorld`, `worldToPlane`, `planeToWorldVec`, `worldToPlaneVec`
- Constants: `DEFAULT_LOCAL_PLANE`

---

### `packages/physics/src/stale-handle.ts` - §83's stale physics handle development warning (A-4/A-5).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV_WARNING_PREFIX, FourError, FourErrorCode` |

**Exports:**
- Types: `StalePhysicsHandleKind`
- Functions: `resetStaleHandleWarnings`, `rejectStalePhysicsHandle`

---

### `packages/physics/src/adapter.ts` - The solver adapter contract (§37) — the seam every physics backend

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Disposable` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./descriptors.js` | `ColliderDescriptor, JointDescriptor, PhysicsWorldOptions, RigidBodyDescriptor` | Import (type-only) |
| `./events.js` | `PhysicsEvent` | Import (type-only) |
| `./queries.js` | `OverlapHit, OverlapQuery, PointHit, PointQuery, RaycastHit, RaycastQuery, ShapeCastHit, ShapeCastQuery` | Import (type-only) |
| `./types.js` | `CCDMode, DeterminismLevel, PhysicsBodyHandle, PhysicsColliderHandle, PhysicsDimension, PhysicsJointHandle` | Import (type-only) |

**Exports:**
- Interfaces: `PhysicsQueryCapabilities`, `PhysicsTuningCapabilities`, `PhysicsCapabilities`, `PhysicsEventInterest`, `PhysicsSolverAdapter`
- Functions: `resolveTuningCapabilities`
- Constants: `NO_TUNING_CAPABILITIES`

---

### `packages/physics/src/queries.ts` - Spatial queries (§30) — options, filter semantics, and result shapes.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./shapes.js` | `CollisionShape` | Import (type-only) |
| `./types.js` | `PhysicsBodyHandle, PhysicsColliderHandle, RotationInput, Vector3Input` | Import (type-only) |

**Exports:**
- Interfaces: `QueryFilter`, `QueryOptions`, `ResolvedQueryOptions`, `QueryCandidate`, `RaycastQuery`, `ShapeCastQuery`, `OverlapQuery`, `PointQuery`, `QueryHit`, `RaycastHit`, `ShapeCastHit`, `PointHit`
- Types: `QueryHitMode`, `OverlapHit`
- Functions: `resolveQueryOptions`, `passesQueryFilter`, `sortHitsByDistance`
- Constants: `ALL_COLLISION_GROUPS`

---

### `packages/physics/src/material.ts` - Physics materials and the §25 combination rules.
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
<<<<<<< HEAD
| `@fourjs/math` | `Quaternion, Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./descriptors.js` | `widenToVector3, LocalPlane` | Import |

**Exports:**
- Interfaces: `ResolvedLocalPlane`
- Functions: `isDefaultLocalPlane`, `resolveLocalPlane`, `planeToWorld`, `worldToPlane`, `planeToWorldVec`, `worldToPlaneVec`
- Constants: `DEFAULT_LOCAL_PLANE`

---

### `packages/physics/src/material.ts` - Physics materials and the §25 combination rules.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
=======
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./types.js` | `CombineMode` | Import (type-only) |

**Exports:**
- Classes: `PhysicsMaterial`
- Interfaces: `PhysicsMaterialOptions`
- Functions: `combineValues`, `combineFriction`, `combineRestitution`, `resolveDensity`
- Constants: `DEFAULT_FRICTION`, `DEFAULT_RESTITUTION`, `DEFAULT_DENSITY`, `DEFAULT_FRICTION_COMBINE_MODE`, `DEFAULT_RESTITUTION_COMBINE_MODE`

---

<<<<<<< HEAD
### `packages/physics/src/physics-event-system.ts` - `PhysicsEventSystem` (§39 step 9, PH-21) — the optional occupant of

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/motion` | `PRIORITY_EVENT_DISPATCH, SimulationSystem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./physics-system.js` | `PhysicsSystem` | Import (type-only) |
| `./world.js` | `PhysicsWorld` | Import (type-only) |

**Exports:**
- Classes: `PhysicsEventSystem`
- Interfaces: `PhysicsEventSystemOptions`

---

### `packages/physics/src/physics-system.ts` - `PhysicsSystem` (§39 step 6, plan P5-2) — the `SimulationSystem` that steps

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/motion` | `PRIORITY_PHYSICS_SOLVE, FixedUpdateContext, SimulationSystem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./world.js` | `PhysicsWorld` | Import (type-only) |

**Exports:**
- Classes: `PhysicsSystem`
- Interfaces: `PhysicsSystemOptions`

---

### `packages/physics/src/queries.ts` - Spatial queries (§30) — options, filter semantics, and result shapes.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./shapes.js` | `CollisionShape` | Import (type-only) |
| `./types.js` | `PhysicsBodyHandle, PhysicsColliderHandle, RotationInput, Vector3Input` | Import (type-only) |

**Exports:**
- Interfaces: `QueryFilter`, `QueryOptions`, `ResolvedQueryOptions`, `QueryCandidate`, `RaycastQuery`, `ShapeCastQuery`, `OverlapQuery`, `PointQuery`, `QueryHit`, `RaycastHit`, `ShapeCastHit`, `PointHit`
- Types: `QueryHitMode`, `OverlapHit`
- Functions: `resolveQueryOptions`, `passesQueryFilter`, `sortHitsByDistance`
- Constants: `ALL_COLLISION_GROUPS`

---

=======
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd
### `packages/physics/src/resource-memory.ts` - §83 resource accounting for solver handles — how many bodies, colliders,

**Exports:**
- Functions: `noteSolverBody`, `noteSolverCollider`, `noteSolverJoint`, `liveSolverBodyCount`, `liveSolverColliderCount`, `liveSolverJointCount`, `liveSolverHandleCount`

---

<<<<<<< HEAD
### `packages/physics/src/rigid-body.ts` - The `RigidBody` component (§6a, §23) and its §26 force/impulse command
=======
### `packages/physics/src/force-field.ts` - §27 force fields for rigid bodies, through §26's force API (PH-8,
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `DEFAULT_SPACE_MODE, DEV_WARNING_PREFIX, EventEmitter, FourError, Component, ComponentHost, SpaceMode` |
| `@fourjs/math` | `Matrix3, Quaternion, Vector3` |
=======
| `@fourjs/core` | `DEV_WARNING_PREFIX` |
| `@fourjs/math` | `Vector3` |
| `@fourjs/motion` | `PRIORITY_FORCES, FixedUpdateContext, SimulationSystem` |
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
<<<<<<< HEAD
| `./descriptors.js` | `RigidBodyDescriptor` | Import (type-only) |
| `./descriptors.js` | `resolveAngularVelocity, resolveRotation, widenToVector3` | Import |
| `./events.js` | `SleepEvent` | Import (type-only) |
| `./types.js` | `BodyType, CCDMode, PhysicsDimension, Vector3Input` | Import (type-only) |
| `./types.js` | `DEFAULT_CCD_MODE, DEFAULT_ENABLED_CCD_MODE` | Import |
| `./validation.js` | `validateMass, validateRigidBodyDescriptor` | Import |

**Exports:**
- Classes: `RigidBody`
- Interfaces: `BlendWeights`, `PointLoad`, `RigidBodyCommands`, `RigidBodyEventMap`
- Types: `TorqueInput`, `SleepCommand`, `RigidBodySleepEvent`
- Functions: `clearRigidBodyCommands`, `setRigidBodyRegistered`, `drainRigidBodySolverWrites`, `setRigidBodyType`, `setRigidBodyDerivedMass`, `setRigidBodySleeping`
- Constants: `RIGID_BODY_MASS_PROPERTIES_DIRTY`, `RIGID_BODY_DAMPING_DIRTY`, `RIGID_BODY_GRAVITY_SCALE_DIRTY`, `RIGID_BODY_CCD_DIRTY`

---

### `packages/physics/src/serializers.ts` - The §79 serializers for this package's two components — `RigidBody` (§23) and

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `SPACE_MODES, FourError, JsonValue, SpaceMode` |
| `@fourjs/math` | `Matrix3, Quaternion, Vector2, Vector3` |
| `@fourjs/motion` | `DEFAULT_CHARACTER_GRAVITY, ComponentSerializerShape` |
| `@fourjs/scene` | `Transform` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./collider.js` | `Collider, ColliderOptions` | Import |
| `./descriptors.js` | `RigidBodyDescriptor` | Import (type-only) |
| `./material.js` | `DEFAULT_DENSITY, DEFAULT_FRICTION, DEFAULT_RESTITUTION, PhysicsMaterial, PhysicsMaterialOptions` | Import |
| `./queries.js` | `ALL_COLLISION_GROUPS` | Import |
| `./rigid-body.js` | `RigidBody` | Import |
| `./swept-character-controller.js` | `DEFAULT_GROUND_SNAP_DISTANCE, DEFAULT_MAX_SLIDES, DEFAULT_PUSH_IMPULSE_SCALE, DEFAULT_PUSH_MASS, DEFAULT_SKIN_WIDTH, DEFAULT_SLOPE_LIMIT, DEFAULT_STEP_HEIGHT, SweptCharacterController` | Import |
| `./shapes.js` | `CollisionShape` | Import (type-only) |
| `./types.js` | `BODY_TYPES, CCD_MODES, DEFAULT_CCD_MODE` | Import |
| `./types.js` | `BodyType, CCDMode` | Import (type-only) |

**Exports:**
- Interfaces: `RigidBodyDocument`, `PhysicsMaterialDocument`, `ColliderDocument`
- Functions: `serializeCollisionShape`, `deserializeCollisionShape`
- Constants: `RIGID_BODY_SERIALIZER`, `COLLIDER_SERIALIZER`, `SWEPT_CHARACTER_CONTROLLER_SERIALIZER`
=======
| `./rigid-body.js` | `RigidBody` | Import (type-only) |
| `./world.js` | `PhysicsWorld` | Import (type-only) |

**Exports:**
- Classes: `ForceFieldSystem`
- Interfaces: `ForceField`, `ForceFieldAddOptions`, `ForceFieldEntry`, `ForceFieldSystemOptions`
- Types: `ForceFieldUnits`
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

---

### `packages/physics/src/shapes.ts` - Collision shapes (§24) and their §85 parameter validation.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Vector2, Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./types.js` | `PhysicsDimension` | Import (type-only) |

**Exports:**
- Interfaces: `CircleShape`, `RectangleShape`, `CapsuleShape`, `PolygonShape`, `PolylineShape`, `ChainShape`, `SphereShape`, `BoxShape`, `CylinderShape`, `ConeShape`, `ConvexHullShape`, `TriangleMeshShape`, `HeightFieldShape`
- Types: `CollisionShape2D`, `CollisionShape3D`, `CollisionShape`, `CollisionShapeType`
- Functions: `shapeIsConvex`, `shapeSupportsDimension`, `shapeMaximumExtent`, `validateQueryShape`, `validateCollisionShape`
<<<<<<< HEAD
- Constants: `COLLISION_SHAPE_TYPES_2D`, `COLLISION_SHAPE_TYPES_3D`, `COMPOSITE_COLLISION_SHAPE_TYPES`

---

### `packages/physics/src/solver-registry.ts` - The §37 solver registry — how `solver: "auto"` becomes an adapter without
=======
- Constants: `COLLISION_SHAPE_TYPES_2D`, `COLLISION_SHAPE_TYPES_3D`, `COMPOSITE_COLLISION_SHAPE_TYPES`, `MAXIMUM_SHAPE_POINTS`

---

### `packages/physics/src/collider.ts` - The `Collider` component (§6a, §24) and its §25 effective-material
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./adapter.js` | `PhysicsSolverAdapter` | Import (type-only) |
| `./descriptors.js` | `PhysicsWorldOptions` | Import (type-only) |
| `./types.js` | `DeterminismLevel` | Import (type-only) |
| `./types.js` | `DEFAULT_DETERMINISM_LEVEL, DETERMINISM_LEVELS` | Import |
| `./world.js` | `PhysicsWorldAdapter` | Import (type-only) |

**Exports:**
- Classes: `SolverRegistry`
- Interfaces: `SolverRegistration`, `SolverRejectionReport`, `SolverResolveOptions`
- Types: `SolverName`, `SolverSelection`, `SolverRejectionReason`
- Functions: `registerSolver`, `registeredSolvers`, `clearRegisteredSolvers`, `resolveSolver`

---

### `packages/physics/src/stale-handle.ts` - §83's stale physics handle development warning (A-4/A-5).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV_WARNING_PREFIX, FourError, FourErrorCode` |

**Exports:**
- Types: `StalePhysicsHandleKind`
- Functions: `resetStaleHandleWarnings`, `rejectStalePhysicsHandle`

---

### `packages/physics/src/swept-character-controller.ts` - §12's **solver-backed** character controller — {@link SweptCharacterController}

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV_WARNING_PREFIX` |
| `@fourjs/core` | `Component, ComponentHost` |
| `@fourjs/math` | `Vector3` |
| `@fourjs/motion` | `CharacterController, PRIORITY_KINEMATICS, FixedUpdateContext, SimulationSystem` |
| `@fourjs/scene` | `warnAuthorityConflict, Node` |
=======
| `@fourjs/core` | `EventEmitter, FourError, Component, ComponentHost` |
| `@fourjs/scene` | `Node, Transform` |
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
<<<<<<< HEAD
| `./queries.js` | `ALL_COLLISION_GROUPS` | Import |
| `./rigid-body.js` | `RigidBody` | Import (type-only) |
| `./shapes.js` | `CollisionShape` | Import (type-only) |
| `./types.js` | `PhysicsBodyHandle` | Import (type-only) |
| `./world.js` | `PhysicsWorld, WorldShapeCastHit` | Import (type-only) |

**Exports:**
- Classes: `SweptCharacterController`, `SweptCharacterSystem`
- Interfaces: `SweptCharacterControllerOptions`, `SweptCharacterSystemOptions`
- Constants: `DEFAULT_SLOPE_LIMIT`, `DEFAULT_STEP_HEIGHT`, `DEFAULT_SKIN_WIDTH`, `DEFAULT_GROUND_SNAP_DISTANCE`, `DEFAULT_MAX_SLIDES`, `DEFAULT_PUSH_MASS`, `DEFAULT_PUSH_IMPULSE_SCALE`
=======
| `./descriptors.js` | `ColliderDescriptor` | Import (type-only) |
| `./events.js` | `CollisionEvent, TriggerEvent` | Import (type-only) |
| `./material.js` | `PhysicsMaterial` | Import (type-only) |
| `./material.js` | `DEFAULT_FRICTION, DEFAULT_RESTITUTION, resolveDensity` | Import |
| `./queries.js` | `ALL_COLLISION_GROUPS` | Import |
| `./rigid-body.js` | `RigidBody` | Import |
| `./shapes.js` | `CollisionShape` | Import (type-only) |
| `./shapes.js` | `shapeSupportsDimension, validateCollisionShape` | Import |
| `./types.js` | `PhysicsBodyHandle, PhysicsDimension` | Import (type-only) |
| `./validation.js` | `validateColliderDescriptor` | Import |

**Exports:**
- Classes: `Collider`
- Interfaces: `ColliderEventMap`
- Types: `ColliderOptions`, `ColliderTriggerEvent`, `RigidBodyCollisionEvent`
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

---

### `packages/physics/src/types.ts` - The physics vocabulary (§21, §22, §25, §31, §32, §33) and the opaque solver

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Quaternion, Vector2, Vector3` |

**Exports:**
- Interfaces: `SleepingConfig`, `PhysicsBodyHandle`, `PhysicsColliderHandle`, `PhysicsJointHandle`
- Types: `PhysicsDimension`, `BodyType`, `CCDMode`, `DeterminismLevel`, `CombineMode`, `Vector3Input`, `RotationInput`, `AngularVelocityInput`, `PhysicsHandle`
- Constants: `PHYSICS_DIMENSIONS`, `BODY_TYPES`, `CCD_MODES`, `DEFAULT_CCD_MODE`, `DEFAULT_ENABLED_CCD_MODE`, `DETERMINISM_LEVELS`, `DEFAULT_DETERMINISM_LEVEL`, `COMBINE_MODES`, `DEFAULT_SLEEPING_CONFIG`

---

<<<<<<< HEAD
### `packages/physics/src/validation.ts` - Descriptor validation (§85), for the physics half of the checklist.
=======
<a id="packages-geometry-dependencies"></a>

## Packages/geometry Dependencies

### `packages/geometry/src/index.ts` - --- R-21: §53 geometry base + bounding volume (begin) ---

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./buffer-geometry.js` | `BufferGeometry` | Re-export |
| `./geometry.js` | `Geometry` | Re-export |
| `./primitives-3d.js` | `capsuleGeometry, coneGeometry, cylinderGeometry, extrudeGeometry, heightFieldGeometry, latheGeometry, sphereGeometry, torusGeometry, tubeGeometry` | Re-export |
| `./path.js` | `DEFAULT_FLATTEN_TOLERANCE, MAX_SUBDIVISION_DEPTH, Path, booleanOp` | Re-export |
| `./svg-document.js` | `DEFAULT_MAXIMUM_SVG_DOCUMENT_LENGTH, parseSvgDocument` | Re-export |
| `./svg-path.js` | `DEFAULT_MAXIMUM_PATH_DATA_LENGTH, formatSvgPathData, parseSvgPathData` | Re-export |
| `./primitives.js` | `boxGeometry, circleGeometry2D, planeGeometry, polygonGeometry2D` | Re-export |
| `./resource-memory.js` | `geometryMemoryBytes, liveGeometryCount` | Re-export |
| `./tessellation.js` | `DEFAULT_MITER_LIMIT, earClippingTessellator, expandStroke, triangulatePolygon` | Re-export |
| `./buffer-geometry.js` | `BufferGeometryOptions, GeometryBounds, GeometryDrawMode, GeometryIndexArray` | Re-export (type-only) |
| `./geometry.js` | `BoundingVolume` | Re-export (type-only) |
| `./primitives-3d.js` | `CapsuleGeometryOptions, ExtrudeGeometryOptions, HeightFieldGeometryOptions, LatheGeometryOptions, Point3D, SphereGeometryOptions, TaperedGeometryOptions, TorusGeometryOptions, TubeGeometryOptions` | Re-export (type-only) |
| `./path.js` | `BooleanOp, FillRule, PathArcCommand, PathClosestPoint, PathCloseCommand, PathCommand, PathCubicCommand, PathFillRings, PathLineCommand, PathMoveCommand, PathOptions, PathQuadraticCommand, PathSegmentCommand` | Re-export (type-only) |
| `./svg-document.js` | `SvgDocument, SvgDocumentParseOptions, SvgDocumentPath, SvgViewBox` | Re-export (type-only) |
| `./svg-path.js` | `SvgPathFormatOptions, SvgPathParseOptions` | Re-export (type-only) |
| `./primitives.js` | `BoxGeometryOptions, CircleGeometry2DOptions, PlaneGeometryOptions, PolygonGeometry2DOptions` | Re-export (type-only) |
| `./tessellation.js` | `Point2D, PolygonTessellator, Polyline2D, StrokeAlignment, StrokeGeometryOptions, StrokeLineCap, StrokeLineJoin, StrokeMesh` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `BufferGeometry`, `Geometry`, `capsuleGeometry`, `coneGeometry`, `cylinderGeometry`, `extrudeGeometry`, `heightFieldGeometry`, `latheGeometry`, `sphereGeometry`, `torusGeometry`, `tubeGeometry`, `DEFAULT_FLATTEN_TOLERANCE`, `MAX_SUBDIVISION_DEPTH`, `Path`, `booleanOp`, `DEFAULT_MAXIMUM_SVG_DOCUMENT_LENGTH`, `parseSvgDocument`, `DEFAULT_MAXIMUM_PATH_DATA_LENGTH`, `formatSvgPathData`, `parseSvgPathData`, `boxGeometry`, `circleGeometry2D`, `planeGeometry`, `polygonGeometry2D`, `geometryMemoryBytes`, `liveGeometryCount`, `DEFAULT_MITER_LIMIT`, `earClippingTessellator`, `expandStroke`, `triangulatePolygon`, `BufferGeometryOptions`, `GeometryBounds`, `GeometryDrawMode`, `GeometryIndexArray`, `BoundingVolume`, `CapsuleGeometryOptions`, `ExtrudeGeometryOptions`, `HeightFieldGeometryOptions`, `LatheGeometryOptions`, `Point3D`, `SphereGeometryOptions`, `TaperedGeometryOptions`, `TorusGeometryOptions`, `TubeGeometryOptions`, `BooleanOp`, `FillRule`, `PathArcCommand`, `PathClosestPoint`, `PathCloseCommand`, `PathCommand`, `PathCubicCommand`, `PathFillRings`, `PathLineCommand`, `PathMoveCommand`, `PathOptions`, `PathQuadraticCommand`, `PathSegmentCommand`, `SvgDocument`, `SvgDocumentParseOptions`, `SvgDocumentPath`, `SvgViewBox`, `SvgPathFormatOptions`, `SvgPathParseOptions`, `BoxGeometryOptions`, `CircleGeometry2DOptions`, `PlaneGeometryOptions`, `PolygonGeometry2DOptions`, `Point2D`, `PolygonTessellator`, `Polyline2D`, `StrokeAlignment`, `StrokeGeometryOptions`, `StrokeLineCap`, `StrokeLineJoin`, `StrokeMesh`

---

### `packages/geometry/src/tessellation.ts` - Polygon tessellation (§52) — the isolated module that turns a closed 2D

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./buffer-geometry.js` | `GeometryIndexArray` | Import (type-only) |
| `./primitive-support.js` | `createIndices, requirePositive` | Import |

**Exports:**
- Interfaces: `Point2D`, `PolygonTessellator`, `Polyline2D`, `StrokeGeometryOptions`, `StrokeMesh`
- Types: `StrokeAlignment`, `StrokeLineCap`, `StrokeLineJoin`
- Functions: `triangulatePolygon`, `expandStroke`
- Constants: `earClippingTessellator`, `DEFAULT_MITER_LIMIT`

---

### `packages/geometry/src/path-boolean.ts` - §51 Boolean operations on flattened closed contours.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./path.js` | `FillRule` | Import (type-only) |
| `./tessellation.js` | `Point2D` | Import (type-only) |

**Exports:**
- Types: `BooleanOp`
- Functions: `booleanPolygons`, `isConvex`, `sutherlandHodgman`, `ringsContain`

---

### `packages/geometry/src/path.ts` - The §51 path model — the vector-level source data every 2D shape, stroke,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Matrix3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./path-boolean.js` | `booleanPolygons, BooleanOp` | Import |
| `./primitive-support.js` | `requirePositive` | Import |
| `./tessellation.js` | `Point2D, Polyline2D` | Import (type-only) |
| `./path-boolean.js` | `BooleanOp` | Re-export (type-only) |

**Exports:**
- Classes: `Path`
- Interfaces: `PathMoveCommand`, `PathLineCommand`, `PathQuadraticCommand`, `PathCubicCommand`, `PathArcCommand`, `PathCloseCommand`, `PathOptions`, `PathFillRings`, `PathClosestPoint`, `PathCursor`
- Types: `FillRule`, `PathSegmentCommand`, `PathCommand`
- Functions: `booleanOp`, `arcPoint`, `newCursor`, `advance`
- Constants: `DEFAULT_FLATTEN_TOLERANCE`, `MAX_SUBDIVISION_DEPTH`
- Re-exports: `BooleanOp`

---

### `packages/geometry/src/svg-document.ts` - §50's SVG **document** tier: a small XML tokenizer that turns `<svg>`
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Matrix3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
<<<<<<< HEAD
| `./descriptors.js` | `AngularJointMotor, ColliderDescriptor, JointDescriptor, JointLimits, LinearJointMotor, PhysicsWorldOptions, RigidBodyDescriptor, ShippedJointType, SphericalJointLimits` | Import (type-only) |
| `./descriptors.js` | `JOINT_TYPES, SHIPPED_JOINT_TYPES, STAGED_JOINT_TYPES, jointTypeSupportsDimension, resolveGravity, resolveRotation` | Import |
| `./shapes.js` | `validateCollisionShape` | Import |
| `./types.js` | `BodyType, PhysicsDimension, Vector3Input` | Import (type-only) |
| `./types.js` | `BODY_TYPES, CCD_MODES, DEFAULT_ENABLED_CCD_MODE, DETERMINISM_LEVELS, PHYSICS_DIMENSIONS` | Import |

**Exports:**
- Functions: `validateMass`, `validateInertiaTensor`, `validateRigidBodyDescriptor`, `validateColliderDescriptor`, `validateJointLimits`, `validateSphericalJointLimits`, `validateAngularJointMotor`, `validateLinearJointMotor`, `validateJointBreakThreshold`, `validateJointDescriptor`, `validatePhysicsWorldOptions`

---

### `packages/physics/src/world-units.ts` - §40 scale factors a {@link PhysicsWorld} may apply at the authoring boundary.

**Exports:**
- Interfaces: `PhysicsWorldUnits`
- Functions: `resolvePhysicsWorldUnits`, `toSiLength`, `fromSiLength`, `toSiMass`, `fromSiMass`

---

### `packages/physics/src/world.ts` - `PhysicsWorld` (§20, §30, §32, §33, §34, §37, §39, §42, §43) — the object an
=======
| `./path.js` | `Path, FillRule` | Import |
| `./svg-path.js` | `DEFAULT_MAXIMUM_PATH_DATA_LENGTH, parseSvgPathData, SvgPathParseOptions` | Import |

**Exports:**
- Interfaces: `SvgDocumentParseOptions`, `SvgViewBox`, `SvgDocumentPath`, `SvgDocument`
- Functions: `parseSvgDocument`, `parseTransform`
- Constants: `DEFAULT_MAXIMUM_SVG_DOCUMENT_LENGTH`

---

### `packages/geometry/src/geometry.ts` - §53's `Geometry` base and its `BoundingVolume` — the two declarations the
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `DEFAULT_SPACE_MODE, DEV_WARNING_PREFIX, FourError, isSimulationSpaceMode` |
| `@fourjs/math` | `Quaternion, Vector2, Vector3` |
| `@fourjs/motion` | `PRIORITY_ANIMATION_TARGETS, SimulationSystem` |
| `@fourjs/scene` | `PoseTarget, warnAuthorityConflict, Node, PoseBuffer, TransformAuthority` |
=======
| `@fourjs/core` | `Disposable` |
| `@fourjs/math` | `Vector3` |

**Exports:**
- Interfaces: `BoundingVolume`, `MutableBoundingVolume`
- Functions: `nextGeometryIdentifier`

---

### `packages/geometry/src/primitives-3d.ts` - The nine 3D primitives §53 requires beyond the box and the plane — sphere,

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./buffer-geometry.js` | `BufferGeometry` | Import |
| `./primitive-support.js` | `createIndices, gridIndices, requireNonNegative, requirePositive, requireSegments, writeCap, IndexArray` | Import |
| `./tessellation.js` | `triangulatePolygon, Point2D` | Import |

**Exports:**
- Interfaces: `Point3D`, `SphereGeometryOptions`, `TaperedGeometryOptions`, `CapsuleGeometryOptions`, `TorusGeometryOptions`, `LatheGeometryOptions`, `ExtrudeGeometryOptions`, `TubeGeometryOptions`, `HeightFieldGeometryOptions`
- Functions: `sphereGeometry`, `cylinderGeometry`, `coneGeometry`, `capsuleGeometry`, `torusGeometry`, `latheGeometry`, `extrudeGeometry`, `tubeGeometry`, `heightFieldGeometry`

---

### `packages/geometry/src/primitive-support.ts` - Shared building blocks of the §53 primitive builders — index allocation,

**Exports:**
- Types: `IndexArray`
- Functions: `createIndices`, `requirePositive`, `requireNonNegative`, `requireSegments`, `gridIndices`, `writeCap`

---

### `packages/geometry/src/resource-memory.ts` - §83 resource accounting for geometries — how many are live, and how many

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, disposeTracked, trackDisposable` |

**Exports:**
- Functions: `noteGeometry`, `geometryMemoryBytes`, `liveGeometryCount`, `trackGeometryDisposable`, `releaseGeometryDisposable`

---

### `packages/geometry/src/buffer-geometry.ts` - `BufferGeometry` (§53) — CPU-side vertex data, in the one shape the MVP

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./geometry.js` | `Geometry, BoundingVolume, MutableBoundingVolume` | Import |
| `./resource-memory.js` | `noteGeometry, releaseGeometryDisposable, trackGeometryDisposable` | Import |

**Exports:**
- Classes: `BufferGeometry`
- Interfaces: `BufferGeometryOptions`
- Types: `GeometryDrawMode`, `GeometryIndexArray`, `GeometryBounds`

---

### `packages/geometry/src/svg-path.ts` - §50's *"SVG import/export compatibility"*, at the **path-data tier**: the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./path.js` | `Path, advance, arcPoint, newCursor, PathArcCommand, PathCursor` | Import |

**Exports:**
- Interfaces: `SvgPathFormatOptions`, `SvgPathParseOptions`
- Functions: `parseSvgPathData`, `formatSvgPathData`
- Constants: `DEFAULT_MAXIMUM_PATH_DATA_LENGTH`

---

### `packages/geometry/src/primitives.ts` - Primitive geometry builders (§53) — the box, the plane, and the 2D circle.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./buffer-geometry.js` | `BufferGeometry` | Import |
| `./primitive-support.js` | `createIndices, requirePositive` | Import |
| `./tessellation.js` | `triangulatePolygon, Point2D` | Import |

**Exports:**
- Interfaces: `BoxGeometryOptions`, `PlaneGeometryOptions`, `CircleGeometry2DOptions`, `PolygonGeometry2DOptions`
- Functions: `boxGeometry`, `planeGeometry`, `circleGeometry2D`, `polygonGeometry2D`

---

<a id="packages-render-dependencies"></a>

## Packages/render Dependencies

### `packages/render/src/read-pixels.ts` - §61's `readPixels` seam, backend-independent half (2026-08-29).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Rectangle2` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./render-target.js` | `RenderTarget` | Import (type-only) |

**Exports:**
- Interfaces: `PixelReader`
- Functions: `supportsReadPixels`, `validateReadbackRegion`

---

### `packages/render/src/shape-paint.ts` - The §58 paint-object tier — validation and paint-to-graph lowering behind

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/materials` | `NodeMaterialBuilder, Material, MaterialTexture, ShaderExpression` |
| `@fourjs/math` | `ColorRGBA` |
| `@fourjs/geometry` | `Point2D` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./shape.js` | `setShapePaintSupport, GradientStop, ConicGradientPaint, LinearGradientPaint, Paint, PatternPaint, RadialGradientPaint, ResolvedConicGradientPaint, ResolvedGradientStop, ResolvedLinearGradientPaint, ResolvedObjectPaint, ResolvedPaint, ResolvedPatternPaint, ResolvedRadialGradientPaint, ResolvedShapeFill, ResolvedStrokeStyle, ShapePaintPlan` | Import |

**Exports:**
- Functions: `registerShapePaints`

---

### `packages/render/src/scissor.ts` - §67 rectangular scissor clipping — a per-draw axis-aligned rectangle in

**Exports:**
- Interfaces: `ScissorRect`
- Functions: `scissorsEqual`, `intersectScissor`

---

### `packages/render/src/sprite.ts` - `Sprite` (§55) — a textured, tinted quad in the scene graph.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Disposable` |
| `@fourjs/geometry` | `BufferGeometry` |
| `@fourjs/math` | `Vector2` |
| `@fourjs/materials` | `SpriteMaterial` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./renderable.js` | `Renderable, RenderableOptions` | Import |

**Exports:**
- Classes: `Sprite`
- Interfaces: `SpriteFrame`, `SpriteTextureRun`, `SpriteTextureCarrier`, `SpriteOptions`
- Functions: `groupSpritesByTexture`

---

### `packages/render/src/capabilities.ts` - This package's §81 capability tokens (RFC 0002; declared here since

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `defineCapability` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./compute-workloads.js` | `ComputeWorkloadRegistry` | Import (type-only) |
| `./render-graph.js` | `RenderGraph` | Import (type-only) |
| `./renderer-registry.js` | `RendererRegistry` | Import (type-only) |

**Exports:**
- Constants: `RENDERER_REGISTRY`, `RENDER_GRAPH`, `COMPUTE_WORKLOADS`

---

### `packages/render/src/view-list.ts` - Per-view render lists (§64 stages 2–3, §66 sort key 4; R-8) — the frame's one

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Frustum, Matrix4, Vector3` |
| `@fourjs/scene` | `layersMatch, Viewport` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./bounds.js` | `computeWorldBoundingSphere, BoundingSphere` | Import |
| `./render-list.js` | `compareRenderItems, viewLayerMask, RenderItem` | Import |

**Exports:**
- Interfaces: `ViewRenderListOptions`
- Functions: `buildViewRenderList`, `sortRenderListByDepth`

---

### `packages/render/src/index.ts` - §81's render-side capability tokens (RFC 0002), declared by the package

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/materials` | `MAX_SHADER_GRAPH_NODES, MAX_SHADER_GRAPH_TEXTURES, SHADER_ATTRIBUTE_TYPES, SHADER_VALUE_COMPONENTS, analyzeShaderGraph, forEachShaderNodeReference` |
| `@fourjs/materials` | `ShaderAttributeName, ShaderBinaryOp, ShaderDomain, ShaderGraph, ShaderGraphAnalysis, ShaderNode, ShaderNodeId, ShaderReflection, ShaderTextureReflection, ShaderUnaryOp, ShaderUniformReflection, ShaderValueType` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./batch.js` | `DEFAULT_MAX_BATCH_VERTICES, RenderBatcher` | Re-export |
| `./bounds.js` | `computeWorldBoundingSphere, computeWorldBoundingSphereFromBox` | Re-export |
| `./capabilities.js` | `COMPUTE_WORKLOADS, RENDERER_REGISTRY, RENDER_GRAPH` | Re-export |
| `./compute-workloads.js` | `ComputeWorkloadRegistry` | Re-export |
| `./clip.js` | `ClipPlaneAllocator, MAX_CLIP_PLANES` | Re-export |
| `./scissor.js` | `intersectScissor, scissorsEqual` | Re-export |
| `./compute.js` | `COMPUTE_ENTRY_POINT, supportsCompute` | Re-export |
| `./effect-pass.js` | `COLOR_GRADE_DEFAULTS, COPY_EFFECT, OUTPUT_TRANSFORM_EFFECT, supportsScreenEffects, validateEffectRenderPass` | Re-export |
| `./lights.js` | `MAX_PUNCTUAL_LIGHTS, collectSceneLights, createSceneLights, isDirectionalLightSource, isHemisphereLightSource, isPunctualLightSource` | Re-export |
| `./particles.js` | `PARTICLE_COLOR_OFFSET, PARTICLE_INSTANCE_FLOATS, PARTICLE_POSITION_OFFSET, PARTICLE_ROTATION_OFFSET, PARTICLE_SIZE_OFFSET, PARTICLE_SOFTNESS_OFFSET, PARTICLE_WIDE_INSTANCE_FLOATS, TRAIL_COLOR_OFFSET, TRAIL_POSITION_OFFSET, TRAIL_VERTEX_FLOATS, isParticleDrawable, particleQuadGeometry` | Re-export |
| `./render-list.js` | `buildInterpolatedRenderList, buildRenderList, compareRenderItems, groupRenderListByPipeline, isLitItem, isNodeItem, isParticlesItem, isSkinnedLitItem, isSkinnedUnlitItem, isSpriteItem, isStandardItem, isUnlitItem, viewLayerMask` | Re-export |
| `./render-graph.js` | `RenderGraph` | Re-export |
| `./raster.js` | `CanvasTexture` | Re-export |
| `./read-pixels.js` | `supportsReadPixels, validateReadbackRegion` | Re-export |
| `./picking.js` | `MAX_PICK_CANDIDATES, assertEncodableCandidateCount, collectPickCandidates, decodePickId, encodePickId, supportsPicking` | Re-export |
| `./render-target.js` | `RenderTarget, isRenderTargetTexture` | Re-export |
| `./render-target-bytes.js` | `RENDER_TARGET_COLOR_BYTES, RENDER_TARGET_DEPTH_RENDERBUFFER_BYTES, RENDER_TARGET_DEPTH_STENCIL_BYTES, RENDER_TARGET_DEPTH_TEXTURE_BYTES, RENDER_TARGET_RGBA16F_BYTES, RENDER_TARGET_RGBA32F_BYTES, RENDER_TARGET_RGBA8_BYTES, colorAttachmentBytesPerTexel, depthAttachmentBytesPerTexel, renderTargetByteLength` | Re-export |
| `./renderable.js` | `Renderable` | Re-export |
| `./mesh.js` | `MAX_SKINNING_JOINTS, Mesh, restoreMeshSkeleton` | Re-export |
| `./renderer-registry.js` | `AUTO_RENDERER_ORDER, RENDERER_CAPABILITY_NAMES, RendererRegistry, clearRegisteredRenderers, missingCapabilities, registerRenderer, registeredRenderers, resolveRenderer, validateCapabilityDeclaration` | Re-export |
| `./renderer.js` | `NullRenderer` | Re-export |
| `./resource-memory.js` | `liveRenderTargetCount, liveTextureCount, textureMemoryBytes` | Re-export |
| `./resource-warnings.js` | `warnDisposedInUse` | Re-export |
| `./statistics.js` | `createRenderStatistics, resetRenderStatistics, supportsRenderStatistics` | Re-export |
| `./shape.js` | `Arc, Circle, clearRegisteredShapePaints, Ellipse, Line, PathShape, Polygon, Polyline, Rectangle, RegularPolygon, resolveShapePaintSupport, Ring, Sector, setShapePaintSupport, Shape2D, Star` | Re-export |
| `./shape-paint.js` | `registerShapePaints` | Re-export |
| `./sprite.js` | `Sprite, groupSpritesByTexture` | Re-export |
| `./texture.js` | `Texture` | Re-export |
| `./view-list.js` | `buildViewRenderList, sortRenderListByDepth` | Re-export |
| `./batch.js` | `BatchableItem, BatchableMaterial, RenderBatch, RenderBatchOptions` | Re-export (type-only) |
| `./bounds.js` | `BoundingSphere` | Re-export (type-only) |
| `./compute-workloads.js` | `ComputeWorkloadFactory` | Re-export (type-only) |
| `./clip.js` | `ClipScope, RenderItemClip, RenderItemStencil` | Re-export (type-only) |
| `./scissor.js` | `ScissorRect` | Re-export (type-only) |
| `./compute.js` | `ComputeBinding, ComputeBindingAccess, ComputeBuffer, ComputeDispatcher, ComputePassDescriptor` | Re-export (type-only) |
| `./effect-pass.js` | `ColorGradeEffect, CopyEffect, EffectDestinationRect, EffectRenderPass, GraphEffect, OutputTransformEffect, ScreenEffect, ScreenEffectKind, ScreenEffectRenderer` | Re-export (type-only) |
| `./lights.js` | `AmbientLightSource, DirectionalLightSource, DirectionalShadowSource, HemisphereLightSource, PointLightSource, PunctualLightSource, PunctualLightSourceBase, SceneLights, SpotLightSource` | Re-export (type-only) |
| `./particles.js` | `ParticleDrawable` | Re-export (type-only) |
| `./render-list.js` | `LitRenderItem, NodeRenderItem, ParticleRenderItem, RenderItem, RenderItemKind, SkinnedLitRenderItem, SkinnedUnlitRenderItem, SpriteRenderItem, StandardRenderItem, UnlitRenderItem` | Re-export (type-only) |
| `./render-graph.js` | `AddPassOptions, CustomRenderPass, RenderGraphIssue, RenderGraphIssueCode, RenderGraphIssueSeverity, RenderGraphPass, RenderPass, RenderPassContext, SceneRenderPass` | Re-export (type-only) |
| `./raster.js` | `CanvasTextureOptions, RasterOrigin, RasterSource` | Re-export (type-only) |
| `./read-pixels.js` | `PixelReader` | Re-export (type-only) |
| `./picking.js` | `PickRequest, PickResult, PickingService` | Re-export (type-only) |
| `./render-target.js` | `RenderTargetFormat, RenderTargetOptions, RenderTargetTexture` | Re-export (type-only) |
| `./renderable.js` | `RenderableOptions, SurfaceMaterial` | Re-export (type-only) |
| `./renderer-registry.js` | `RendererCapabilityDeclaration, RendererCapabilityName, RendererCapabilityShortfall, RendererFallbackReason, RendererFallbackReport, RendererRegistration, RendererResolveOptions, RendererSelection` | Re-export (type-only) |
| `./renderer.js` | `RenderInterpolation, Renderer, RendererBackend, RendererCapabilities, RendererEventMap, RendererOptions, ResizeRecord` | Re-export (type-only) |
| `./resource-warnings.js` | `DisposedResourceKind` | Re-export (type-only) |
| `./statistics.js` | `RenderStatistics, RenderStatisticsReporter` | Re-export (type-only) |
| `./shape.js` | `ArcOptions, CircleOptions, EllipseOptions, ConicGradientPaint, GradientStop, LinearGradientPaint, LineOptions, ObjectPaint, Paint, PathShapeOptions, PatternPaint, PolygonOptions, PolylineOptions, RadialGradientPaint, RectangleOptions, RegularPolygonOptions, RingOptions, SectorOptions, ResolvedConicGradientPaint, ResolvedGradientStop, ResolvedLinearGradientPaint, ResolvedObjectPaint, ResolvedPaint, ResolvedPatternPaint, ResolvedRadialGradientPaint, ResolvedShapeFill, ResolvedSolidPaint, ResolvedStrokeStyle, Shape2DOptions, ShapeFill, ShapePaintPlan, ShapePaintSupport, SolidPaint, StarOptions, StrokeStyle` | Re-export (type-only) |
| `./sprite.js` | `SpriteFrame, SpriteOptions, SpriteTextureCarrier, SpriteTextureRun` | Re-export (type-only) |
| `./texture.js` | `TextureDimension, TextureFilter, TextureMapRole, TextureMinFilter, TextureSource, TextureWrap` | Re-export (type-only) |
| `./view-list.js` | `ViewRenderListOptions` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `DEFAULT_MAX_BATCH_VERTICES`, `RenderBatcher`, `computeWorldBoundingSphere`, `computeWorldBoundingSphereFromBox`, `COMPUTE_WORKLOADS`, `RENDERER_REGISTRY`, `RENDER_GRAPH`, `ComputeWorkloadRegistry`, `ClipPlaneAllocator`, `MAX_CLIP_PLANES`, `intersectScissor`, `scissorsEqual`, `COMPUTE_ENTRY_POINT`, `supportsCompute`, `COLOR_GRADE_DEFAULTS`, `COPY_EFFECT`, `OUTPUT_TRANSFORM_EFFECT`, `supportsScreenEffects`, `validateEffectRenderPass`, `MAX_PUNCTUAL_LIGHTS`, `collectSceneLights`, `createSceneLights`, `isDirectionalLightSource`, `isHemisphereLightSource`, `isPunctualLightSource`, `PARTICLE_COLOR_OFFSET`, `PARTICLE_INSTANCE_FLOATS`, `PARTICLE_POSITION_OFFSET`, `PARTICLE_ROTATION_OFFSET`, `PARTICLE_SIZE_OFFSET`, `PARTICLE_SOFTNESS_OFFSET`, `PARTICLE_WIDE_INSTANCE_FLOATS`, `TRAIL_COLOR_OFFSET`, `TRAIL_POSITION_OFFSET`, `TRAIL_VERTEX_FLOATS`, `isParticleDrawable`, `particleQuadGeometry`, `buildInterpolatedRenderList`, `buildRenderList`, `compareRenderItems`, `groupRenderListByPipeline`, `isLitItem`, `isNodeItem`, `isParticlesItem`, `isSkinnedLitItem`, `isSkinnedUnlitItem`, `isSpriteItem`, `isStandardItem`, `isUnlitItem`, `viewLayerMask`, `MAX_SHADER_GRAPH_NODES`, `MAX_SHADER_GRAPH_TEXTURES`, `SHADER_ATTRIBUTE_TYPES`, `SHADER_VALUE_COMPONENTS`, `analyzeShaderGraph`, `forEachShaderNodeReference`, `RenderGraph`, `CanvasTexture`, `supportsReadPixels`, `validateReadbackRegion`, `MAX_PICK_CANDIDATES`, `assertEncodableCandidateCount`, `collectPickCandidates`, `decodePickId`, `encodePickId`, `supportsPicking`, `RenderTarget`, `isRenderTargetTexture`, `RENDER_TARGET_COLOR_BYTES`, `RENDER_TARGET_DEPTH_RENDERBUFFER_BYTES`, `RENDER_TARGET_DEPTH_STENCIL_BYTES`, `RENDER_TARGET_DEPTH_TEXTURE_BYTES`, `RENDER_TARGET_RGBA16F_BYTES`, `RENDER_TARGET_RGBA32F_BYTES`, `RENDER_TARGET_RGBA8_BYTES`, `colorAttachmentBytesPerTexel`, `depthAttachmentBytesPerTexel`, `renderTargetByteLength`, `Renderable`, `MAX_SKINNING_JOINTS`, `Mesh`, `restoreMeshSkeleton`, `AUTO_RENDERER_ORDER`, `RENDERER_CAPABILITY_NAMES`, `RendererRegistry`, `clearRegisteredRenderers`, `missingCapabilities`, `registerRenderer`, `registeredRenderers`, `resolveRenderer`, `validateCapabilityDeclaration`, `NullRenderer`, `liveRenderTargetCount`, `liveTextureCount`, `textureMemoryBytes`, `warnDisposedInUse`, `createRenderStatistics`, `resetRenderStatistics`, `supportsRenderStatistics`, `Arc`, `Circle`, `clearRegisteredShapePaints`, `Ellipse`, `Line`, `PathShape`, `Polygon`, `Polyline`, `Rectangle`, `RegularPolygon`, `resolveShapePaintSupport`, `Ring`, `Sector`, `setShapePaintSupport`, `Shape2D`, `Star`, `registerShapePaints`, `Sprite`, `groupSpritesByTexture`, `Texture`, `buildViewRenderList`, `sortRenderListByDepth`, `BatchableItem`, `BatchableMaterial`, `RenderBatch`, `RenderBatchOptions`, `BoundingSphere`, `ComputeWorkloadFactory`, `ClipScope`, `RenderItemClip`, `RenderItemStencil`, `ScissorRect`, `ComputeBinding`, `ComputeBindingAccess`, `ComputeBuffer`, `ComputeDispatcher`, `ComputePassDescriptor`, `ColorGradeEffect`, `CopyEffect`, `EffectDestinationRect`, `EffectRenderPass`, `GraphEffect`, `OutputTransformEffect`, `ScreenEffect`, `ScreenEffectKind`, `ScreenEffectRenderer`, `AmbientLightSource`, `DirectionalLightSource`, `DirectionalShadowSource`, `HemisphereLightSource`, `PointLightSource`, `PunctualLightSource`, `PunctualLightSourceBase`, `SceneLights`, `SpotLightSource`, `ParticleDrawable`, `LitRenderItem`, `NodeRenderItem`, `ParticleRenderItem`, `RenderItem`, `RenderItemKind`, `SkinnedLitRenderItem`, `SkinnedUnlitRenderItem`, `SpriteRenderItem`, `StandardRenderItem`, `UnlitRenderItem`, `ShaderAttributeName`, `ShaderBinaryOp`, `ShaderDomain`, `ShaderGraph`, `ShaderGraphAnalysis`, `ShaderNode`, `ShaderNodeId`, `ShaderReflection`, `ShaderTextureReflection`, `ShaderUnaryOp`, `ShaderUniformReflection`, `ShaderValueType`, `AddPassOptions`, `CustomRenderPass`, `RenderGraphIssue`, `RenderGraphIssueCode`, `RenderGraphIssueSeverity`, `RenderGraphPass`, `RenderPass`, `RenderPassContext`, `SceneRenderPass`, `CanvasTextureOptions`, `RasterOrigin`, `RasterSource`, `PixelReader`, `PickRequest`, `PickResult`, `PickingService`, `RenderTargetFormat`, `RenderTargetOptions`, `RenderTargetTexture`, `RenderableOptions`, `SurfaceMaterial`, `RendererCapabilityDeclaration`, `RendererCapabilityName`, `RendererCapabilityShortfall`, `RendererFallbackReason`, `RendererFallbackReport`, `RendererRegistration`, `RendererResolveOptions`, `RendererSelection`, `RenderInterpolation`, `Renderer`, `RendererBackend`, `RendererCapabilities`, `RendererEventMap`, `RendererOptions`, `ResizeRecord`, `DisposedResourceKind`, `RenderStatistics`, `RenderStatisticsReporter`, `ArcOptions`, `CircleOptions`, `EllipseOptions`, `ConicGradientPaint`, `GradientStop`, `LinearGradientPaint`, `LineOptions`, `ObjectPaint`, `Paint`, `PathShapeOptions`, `PatternPaint`, `PolygonOptions`, `PolylineOptions`, `RadialGradientPaint`, `RectangleOptions`, `RegularPolygonOptions`, `RingOptions`, `SectorOptions`, `ResolvedConicGradientPaint`, `ResolvedGradientStop`, `ResolvedLinearGradientPaint`, `ResolvedObjectPaint`, `ResolvedPaint`, `ResolvedPatternPaint`, `ResolvedRadialGradientPaint`, `ResolvedShapeFill`, `ResolvedSolidPaint`, `ResolvedStrokeStyle`, `Shape2DOptions`, `ShapeFill`, `ShapePaintPlan`, `ShapePaintSupport`, `SolidPaint`, `StarOptions`, `StrokeStyle`, `SpriteFrame`, `SpriteOptions`, `SpriteTextureCarrier`, `SpriteTextureRun`, `TextureDimension`, `TextureFilter`, `TextureMapRole`, `TextureMinFilter`, `TextureSource`, `TextureWrap`, `ViewRenderListOptions`

---

### `packages/render/src/compute-workloads.ts` - The §81 compute-workload registry — a named map of

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./compute.js` | `ComputePassDescriptor` | Import (type-only) |

**Exports:**
- Classes: `ComputeWorkloadRegistry`
- Types: `ComputeWorkloadFactory`

---

### `packages/render/src/texture.ts` - `Texture` (§77, §55, §61) — CPU-side texel data with a stable identity and a

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError, Disposable` |
| `@fourjs/materials` | `MaterialTextureFilter, MaterialTextureMinFilter, MaterialTextureWrap, SpriteTexture` |
| `@fourjs/math` | `ColorSpace` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./render-target.js` | `validateColorSpace` | Import |
| `./resource-memory.js` | `noteTexture, releaseRenderDisposable, trackRenderDisposable` | Import |

**Exports:**
- Classes: `Texture`
- Interfaces: `TextureSource`
- Types: `TextureFilter`, `TextureMinFilter`, `TextureWrap`, `TextureDimension`, `TextureMapRole`

---

### `packages/render/src/render-target-bytes.ts` - Per-texel byte accounting for {@link RenderTarget} attachments (§83, §84).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./render-target.js` | `RenderTargetFormat` | Import (type-only) |

**Exports:**
- Functions: `colorAttachmentBytesPerTexel`, `depthAttachmentBytesPerTexel`, `renderTargetByteLength`
- Constants: `RENDER_TARGET_RGBA8_BYTES`, `RENDER_TARGET_RGBA16F_BYTES`, `RENDER_TARGET_RGBA32F_BYTES`, `RENDER_TARGET_DEPTH_RENDERBUFFER_BYTES`, `RENDER_TARGET_DEPTH_TEXTURE_BYTES`, `RENDER_TARGET_DEPTH_STENCIL_BYTES`, `RENDER_TARGET_COLOR_BYTES`

---

### `packages/render/src/render-list.ts` - Render-list construction (§64) — scene graph in, flat sorted draw list out.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, devWarnOnce` |
| `@fourjs/geometry` | `BufferGeometry` |
| `@fourjs/math` | `Matrix4, Quaternion, Vector3` |
| `@fourjs/materials` | `LitMaterial, Material, NodeMaterial, SpriteMaterial, StandardMaterial, UnlitMaterial` |
| `@fourjs/scene` | `ALL_LAYERS, DEFAULT_LAYER_MASK, assertLayerMask, isLayerMask, layersMatch, LayerMask, Node, PoseBuffer, Skeleton, Viewport` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./bounds.js` | `computeWorldBoundingSphereFromBox, BoundingSphere` | Import |
| `./clip.js` | `ClipPlaneAllocator, RenderItemClip` | Import |
| `./particles.js` | `PARTICLE_INSTANCE_FLOATS, isParticleDrawable, particleQuadGeometry` | Import |
| `./renderable.js` | `Renderable` | Import |
| `./scissor.js` | `ScissorRect` | Import (type-only) |
| `./sprite.js` | `SpriteFrame` | Import (type-only) |

**Exports:**
- Interfaces: `UnlitRenderItem`, `SkinnedUnlitRenderItem`, `SkinnedLitRenderItem`, `LitRenderItem`, `StandardRenderItem`, `NodeRenderItem`, `SpriteRenderItem`, `ParticleRenderItem`
- Types: `RenderItemKind`, `RenderItem`
- Functions: `isSpriteItem`, `isUnlitItem`, `isLitItem`, `isStandardItem`, `isParticlesItem`, `isNodeItem`, `isSkinnedUnlitItem`, `isSkinnedLitItem`, `viewLayerMask`, `compareRenderItems`, `groupRenderListByPipeline`, `buildRenderList`, `buildInterpolatedRenderList`

---

### `packages/render/src/effect-pass.ts` - §70's post-processing at the **full-screen effect tier** (R-6, 2026-08-07):

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/materials` | `SHADER_VALUE_COMPONENTS, analyzeShaderGraph, ShaderGraph` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./render-target.js` | `RenderTarget, RenderTargetTexture` | Import (type-only) |
| `./render-target.js` | `isRenderTargetTexture` | Import |

**Exports:**
- Interfaces: `CopyEffect`, `ColorGradeEffect`, `OutputTransformEffect`, `GraphEffect`, `EffectDestinationRect`, `EffectRenderPass`, `ScreenEffectRenderer`
- Types: `ScreenEffect`, `ScreenEffectKind`
- Functions: `supportsScreenEffects`, `validateEffectRenderPass`
- Constants: `OUTPUT_TRANSFORM_EFFECT`, `COLOR_GRADE_DEFAULTS`, `COPY_EFFECT`

---

### `packages/render/src/raster.ts` - Raster painting (§77a; RFC 0004, accepted 2026-08-21) — a surface an

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError, Disposable` |
| `@fourjs/materials` | `MaterialTexture` |
| `@fourjs/math` | `ColorSpace` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./render-target.js` | `validateColorSpace` | Import |
| `./resource-memory.js` | `noteTexture, releaseRenderDisposable, trackRenderDisposable` | Import |

**Exports:**
- Classes: `CanvasTexture`
- Interfaces: `RasterSource`, `CanvasTextureOptions`
- Types: `RasterOrigin`

---

### `packages/render/src/particles.ts` - The particle drawing contract (§36, §49, plan P9-3) — one batched render item

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/geometry` | `BufferGeometry` |
| `@fourjs/math` | `Vector3` |

**Exports:**
- Interfaces: `ParticleDrawable`
- Functions: `isParticleDrawable`, `particleQuadGeometry`
- Constants: `PARTICLE_INSTANCE_FLOATS`, `PARTICLE_WIDE_INSTANCE_FLOATS`, `PARTICLE_POSITION_OFFSET`, `PARTICLE_SIZE_OFFSET`, `PARTICLE_COLOR_OFFSET`, `PARTICLE_ROTATION_OFFSET`, `PARTICLE_SOFTNESS_OFFSET`, `TRAIL_VERTEX_FLOATS`, `TRAIL_POSITION_OFFSET`, `TRAIL_COLOR_OFFSET`

---

### `packages/render/src/statistics.ts` - Per-frame render counters (§84's `drawCalls`/`triangles`/`instances`) — the

**Exports:**
- Interfaces: `RenderStatistics`, `RenderStatisticsReporter`
- Functions: `createRenderStatistics`, `resetRenderStatistics`, `supportsRenderStatistics`

---

### `packages/render/src/mesh.ts` - `Mesh` (§54) — the renderable that can be skinned (RFC 0003 — gaps PH-10 +

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/materials` | `Material` |
| `@fourjs/scene` | `Bone, MorphWeights, Skeleton, Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./renderable.js` | `Renderable, RenderableOptions, SurfaceMaterial` | Import |

**Exports:**
- Classes: `Mesh`
- Functions: `restoreMeshSkeleton`
- Constants: `MAX_SKINNING_JOINTS`

---

### `packages/render/src/renderable.ts` - `Renderable` (§49) — the node that draws something.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/geometry` | `BufferGeometry` |
| `@fourjs/materials` | `LitMaterial, Material, UnlitMaterial` |
| `@fourjs/scene` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./scissor.js` | `ScissorRect` | Import (type-only) |

**Exports:**
- Classes: `Renderable`
- Interfaces: `RenderableOptions`
- Types: `SurfaceMaterial`

---

### `packages/render/src/batch.ts` - §65 batching — merging consecutive compatible draws into one (R-9,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/geometry` | `BufferGeometry` |
| `@fourjs/materials` | `MaterialTexture, SpriteMaterial, UnlitMaterial` |
| `@fourjs/math` | `ColorRGBA` |
| `@fourjs/scene` | `ALL_LAYERS, LayerMask` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./clip.js` | `RenderItemClip` | Import (type-only) |
| `./scissor.js` | `scissorsEqual, ScissorRect` | Import |
| `./render-list.js` | `RenderItem, SpriteRenderItem, UnlitRenderItem` | Import (type-only) |

**Exports:**
- Classes: `RenderBatcher`
- Interfaces: `RenderBatchOptions`, `RenderBatch`
- Types: `BatchableMaterial`, `BatchableItem`
- Constants: `DEFAULT_MAX_BATCH_VERTICES`

---

### `packages/render/src/renderer.ts` - The renderer interface (§61) — the seam every backend implements.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Disposable` |
| `@fourjs/core` | `EventEmitter, FourError` |
| `@fourjs/math` | `Rectangle2` |
| `@fourjs/scene` | `Node, PoseBuffer, Viewport` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./compute.js` | `ComputePassDescriptor` | Import (type-only) |
| `./effect-pass.js` | `EffectRenderPass` | Import (type-only) |
| `./picking.js` | `PickingService` | Import (type-only) |
| `./render-target.js` | `RenderTarget` | Import (type-only) |
| `./statistics.js` | `RenderStatistics` | Import (type-only) |

**Exports:**
- Classes: `NullRenderer`
- Interfaces: `RendererCapabilities`, `RendererOptions`, `RendererEventMap`, `RenderInterpolation`, `Renderer`, `ResizeRecord`
- Types: `RendererBackend`

---

### `packages/render/src/compute.ts` - §82's `ComputePass`, as the backend-independent descriptor — the Q3

**Exports:**
- Interfaces: `ComputeBuffer`, `ComputeBinding`, `ComputePassDescriptor`, `ComputeDispatcher`
- Types: `ComputeBindingAccess`
- Functions: `supportsCompute`
- Constants: `COMPUTE_ENTRY_POINT`

---

### `packages/render/src/picking.ts` - Pixel/GPU-id picking — the backend-neutral half (§71; RFC 0005, accepted

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Matrix4` |
| `@fourjs/scene` | `Node, Viewport` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./particles.js` | `isParticleDrawable` | Import |
| `./renderable.js` | `Renderable` | Import |
| `./renderer.js` | `Renderer` | Import (type-only) |

**Exports:**
- Interfaces: `PickRequest`, `PickResult`, `PickingService`
- Functions: `supportsPicking`, `assertEncodableCandidateCount`, `collectPickCandidates`, `encodePickId`, `decodePickId`
- Constants: `MAX_PICK_CANDIDATES`

---

### `packages/render/src/render-graph.ts` - `RenderGraph` (§63) — an ordered list of passes, executed by one call, with

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/scene` | `Node, Viewport` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./effect-pass.js` | `supportsScreenEffects, validateEffectRenderPass, EffectRenderPass` | Import |
| `./render-list.js` | `buildRenderList, RenderItem` | Import |
| `./render-target.js` | `isRenderTargetTexture, RenderTarget` | Import |
| `./renderer.js` | `RenderInterpolation, Renderer` | Import (type-only) |

**Exports:**
- Classes: `RenderGraph`
- Interfaces: `RenderPassContext`, `SceneRenderPass`, `CustomRenderPass`, `AddPassOptions`, `RenderGraphPass`, `RenderGraphIssue`
- Types: `RenderPass`, `RenderGraphIssueCode`, `RenderGraphIssueSeverity`

---

### `packages/render/src/render-target.ts` - `RenderTarget` (§61, §48, §63, §77) — an off-screen surface a frame can be

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Disposable` |
| `@fourjs/materials` | `MaterialTexture` |
| `@fourjs/math` | `ColorSpace` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./render-target-bytes.js` | `renderTargetByteLength` | Import |
| `./resource-memory.js` | `noteRenderTarget, releaseRenderDisposable, trackRenderDisposable` | Import |

**Exports:**
- Classes: `RenderTarget`
- Interfaces: `RenderTargetOptions`, `RenderTargetTexture`
- Types: `RenderTargetFormat`
- Functions: `isRenderTargetTexture`, `validateColorSpace`

---

### `packages/render/src/bounds.ts` - World-space bounds of a drawable (§87) — the substrate a frustum test needs.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/geometry` | `BufferGeometry` |
| `@fourjs/math` | `Matrix4, Vector3` |

**Exports:**
- Interfaces: `BoundingSphere`
- Functions: `computeWorldBoundingSphere`, `computeWorldBoundingSphereFromBox`

---

### `packages/render/src/clip.ts` - §67 clipping — a node's drawn shape masks its subtree, expressed entirely in

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, devWarn` |
| `@fourjs/materials` | `StencilFunc, StencilOp` |

**Exports:**
- Classes: `ClipPlaneAllocator`
- Interfaces: `RenderItemStencil`, `RenderItemClip`, `ClipScope`
- Constants: `MAX_CLIP_PLANES`

---

### `packages/render/src/resource-memory.ts` - §83 resource accounting for textures and render targets — how many are live,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, disposeTracked, trackDisposable` |

**Exports:**
- Functions: `noteTexture`, `noteRenderTarget`, `textureMemoryBytes`, `liveTextureCount`, `liveRenderTargetCount`, `trackRenderDisposable`, `releaseRenderDisposable`

---

### `packages/render/src/shape.ts` - §50's native 2D shape system — the node tier (R-23, 2026-08-09).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Disposable` |
| `@fourjs/geometry` | `BufferGeometry, DEFAULT_FLATTEN_TOLERANCE, expandStroke, Path, triangulatePolygon, GeometryIndexArray, PathFillRings, Point2D, StrokeAlignment, StrokeLineCap, StrokeLineJoin, StrokeMesh` |
| `@fourjs/materials` | `Material, MaterialTexture` |
| `@fourjs/math` | `ColorRGBA` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./renderable.js` | `Renderable, RenderableOptions, SurfaceMaterial` | Import |

**Exports:**
- Classes: `Circle`, `Ellipse`, `Rectangle`, `RegularPolygon`, `Star`, `Sector`, `Ring`, `Polygon`, `PathShape`, `Line`, `Polyline`, `Arc`
- Interfaces: `SolidPaint`, `GradientStop`, `LinearGradientPaint`, `RadialGradientPaint`, `ConicGradientPaint`, `PatternPaint`, `ResolvedSolidPaint`, `ResolvedGradientStop`, `ResolvedLinearGradientPaint`, `ResolvedRadialGradientPaint`, `ResolvedConicGradientPaint`, `ResolvedPatternPaint`, `StrokeStyle`, `ResolvedStrokeStyle`, `ShapePaintPlan`, `ShapePaintSupport`, `Shape2DOptions`, `CircleOptions`, `EllipseOptions`, `RectangleOptions`, `RegularPolygonOptions`, `StarOptions`, `SectorOptions`, `RingOptions`, `PolygonOptions`, `PathShapeOptions`, `LineOptions`, `PolylineOptions`, `ArcOptions`
- Types: `ObjectPaint`, `Paint`, `ResolvedObjectPaint`, `ResolvedPaint`, `ShapeFill`, `ResolvedShapeFill`
- Functions: `setShapePaintSupport`, `resolveShapePaintSupport`, `clearRegisteredShapePaints`

---

### `packages/render/src/renderer-registry.ts` - The §62 backend registry — how a name becomes a renderer without this

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./renderer.js` | `Renderer, RendererBackend, RendererCapabilities, RendererOptions` | Import (type-only) |

**Exports:**
- Classes: `RendererRegistry`
- Interfaces: `RendererRegistration`, `RendererCapabilityDeclaration`, `RendererCapabilityShortfall`, `RendererFallbackReport`, `RendererResolveOptions`
- Types: `RendererSelection`, `RendererCapabilityName`, `RendererFallbackReason`
- Functions: `validateCapabilityDeclaration`, `missingCapabilities`, `registerRenderer`, `registeredRenderers`, `clearRegisteredRenderers`, `resolveRenderer`
- Constants: `AUTO_RENDERER_ORDER`, `RENDERER_CAPABILITY_NAMES`

---

### `packages/render/src/resource-warnings.ts` - §83's "disposed resource still in use" development warning (A-4/A-5).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, devWarnOnce` |

**Exports:**
- Types: `DisposedResourceKind`
- Functions: `warnDisposedInUse`

---

### `packages/render/src/lights.ts` - Light collection (§68, §64) — scene graph in, one flat light state out.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, DEV_WARNING_PREFIX, devWarnOnce` |
| `@fourjs/math` | `Matrix4, Vector3` |
| `@fourjs/scene` | `Node` |

**Exports:**
- Interfaces: `DirectionalLightSource`, `DirectionalShadowSource`, `PunctualLightSourceBase`, `PointLightSource`, `SpotLightSource`, `AmbientLightSource`, `HemisphereLightSource`, `SceneLights`
- Types: `PunctualLightSource`
- Functions: `isDirectionalLightSource`, `isHemisphereLightSource`, `isPunctualLightSource`, `createSceneLights`, `collectSceneLights`
- Constants: `MAX_PUNCTUAL_LIGHTS`

---

<a id="packages-input-dependencies"></a>

## Packages/input Dependencies

### `packages/input/src/pick.ts` - Picking and hit testing (§71) — the bounds tier.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Matrix4, Vector3, DepthRange` |
| `@fourjs/scene` | `resolveWorldTransform, Camera, Node` |

**Exports:**
- Interfaces: `PickProvider`, `PickableAlphaMask`, `PickableTriangles`, `Pickable`, `PickHit`
- Functions: `createPickRay`, `pick`

---

### `packages/input/src/index.ts` - Polled key state -- "is W down?" -- which is what `@fourjs/input` most

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./drag.js` | `DragManager` | Re-export |
| `./key-events.js` | `SceneKeyEvent, dispatchKeyEvent` | Re-export |
| `./keyboard-input.js` | `KeyboardInput` | Re-export |
| `./keyboard-state.js` | `KeyboardState` | Re-export |
| `./pick.js` | `createPickRay, pick` | Re-export |
| `./pointer-events.js` | `CAPTURE_KEY_PREFIX, ScenePointerEvent, dispatchPointerEvent` | Re-export |
| `./pointer-input.js` | `DEFAULT_CLICK_MOVE_THRESHOLD, PointerInput` | Re-export |
| `./propagation.js` | `SceneInputEvent, buildPropagationPath, dispatchThreePhase` | Re-export |
| `./drag.js` | `DragListener, DragManagerOptions` | Re-export (type-only) |
| `./key-events.js` | `KeyDefaultSuppressor, KeyModifiers, SceneKeyEventInit, SceneKeyEventType` | Re-export (type-only) |
| `./keyboard-input.js` | `KeySurface, KeyboardInputOptions, SurfaceKeyEvent, SurfaceKeyListener` | Re-export (type-only) |
| `./pick.js` | `PickHit, Pickable, PickableAlphaMask, PickableTriangles, PickProvider` | Re-export (type-only) |
| `./pointer-events.js` | `PointerDeviceType, PropagatingPointerEventType, ScenePointerEventInit, ScenePointerEventType` | Re-export (type-only) |
| `./pointer-input.js` | `PointerInputOptions, PointerSurface, SurfacePointerEvent, SurfacePointerListener, SurfaceRect` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `DragManager`, `SceneKeyEvent`, `dispatchKeyEvent`, `KeyboardInput`, `KeyboardState`, `createPickRay`, `pick`, `CAPTURE_KEY_PREFIX`, `ScenePointerEvent`, `dispatchPointerEvent`, `DEFAULT_CLICK_MOVE_THRESHOLD`, `PointerInput`, `SceneInputEvent`, `buildPropagationPath`, `dispatchThreePhase`, `DragListener`, `DragManagerOptions`, `KeyDefaultSuppressor`, `KeyModifiers`, `SceneKeyEventInit`, `SceneKeyEventType`, `KeySurface`, `KeyboardInputOptions`, `SurfaceKeyEvent`, `SurfaceKeyListener`, `PickHit`, `Pickable`, `PickableAlphaMask`, `PickableTriangles`, `PickProvider`, `PointerDeviceType`, `PropagatingPointerEventType`, `ScenePointerEventInit`, `ScenePointerEventType`, `PointerInputOptions`, `PointerSurface`, `SurfacePointerEvent`, `SurfacePointerListener`, `SurfaceRect`

---

### `packages/input/src/keyboard-input.ts` - The keyboard source (§72, 2026-08-07, A-10): platform key events in, scene

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/scene` | `Node` |
| `@fourjs/core` | `DEV, FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./key-events.js` | `SceneKeyEvent, dispatchKeyEvent, KeyDefaultSuppressor, SceneKeyEventType` | Import |
| `./propagation.js` | `buildPropagationPath` | Import |

**Exports:**
- Classes: `KeyboardInput`
- Interfaces: `SurfaceKeyEvent`, `KeySurface`, `KeyboardInputOptions`
- Types: `SurfaceKeyListener`

---

### `packages/input/src/key-events.ts` - Key events and their propagation through the scene graph (§72, §6b,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/scene` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./propagation.js` | `SceneInputEvent, dispatchThreePhase` | Import |

**Exports:**
- Classes: `SceneKeyEvent`
- Interfaces: `KeyModifiers`, `KeyDefaultSuppressor`, `SceneKeyEventInit`
- Types: `SceneKeyEventType`
- Functions: `dispatchKeyEvent`

---

### `packages/input/src/pointer-events.ts` - Pointer events and their propagation through the scene graph (§72, §6b).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3` |
| `@fourjs/scene` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./propagation.js` | `SceneInputEvent, dispatchThreePhase` | Import |
| `./propagation.js` | `buildPropagationPath` | Re-export |

**Exports:**
- Classes: `ScenePointerEvent`
- Interfaces: `ScenePointerEventInit`
- Types: `PropagatingPointerEventType`, `ScenePointerEventType`, `PointerDeviceType`
- Functions: `dispatchPointerEvent`
- Constants: `CAPTURE_KEY_PREFIX`
- Re-exports: `buildPropagationPath`

---

### `packages/input/src/pointer-input.ts` - The pointer source (§72): platform pointer events in, scene pointer events

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3, DepthRange` |
| `@fourjs/scene` | `Camera, Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./pick.js` | `pick, PickHit, Pickable, PickProvider` | Import |
| `./pointer-events.js` | `ScenePointerEvent, buildPropagationPath, dispatchPointerEvent, PointerDeviceType, PropagatingPointerEventType, ScenePointerEventType` | Import |

**Exports:**
- Classes: `PointerInput`
- Interfaces: `SurfacePointerEvent`, `SurfaceRect`, `PointerSurface`, `PointerInputOptions`
- Types: `SurfacePointerListener`
- Constants: `DEFAULT_CLICK_MOVE_THRESHOLD`

---

### `packages/input/src/drag.ts` - Dragging (§72, §120): press a node, move the pointer, get world-space deltas.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Unsubscribe` |
| `@fourjs/math` | `Vector3, DepthRange` |
| `@fourjs/scene` | `resolveWorldTransform, Camera, Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./pick.js` | `createPickRay` | Import |
| `./pointer-events.js` | `ScenePointerEvent` | Import (type-only) |
| `./pointer-input.js` | `PointerInput` | Import (type-only) |

**Exports:**
- Classes: `DragManager`
- Interfaces: `DragManagerOptions`
- Types: `DragListener`

---

### `packages/input/src/keyboard-state.ts` - §72 — polled keyboard state: "is this key held right now?"

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./keyboard-input.js` | `KeySurface, SurfaceKeyListener` | Import (type-only) |

**Exports:**
- Classes: `KeyboardState`

---

### `packages/input/src/propagation.ts` - The propagation machinery every scene input event shares (§72, §6b) — the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/scene` | `Node, NodeEventMap` |

**Exports:**
- Functions: `buildPropagationPath`, `dispatchThreePhase`

---

<a id="packages-render-webgpu-dependencies"></a>

## Packages/render webgpu Dependencies

### `packages/render-webgpu/src/wgpu-geometry.ts` - Per-device store of uploaded geometry (§61, §64 stage 7) — the WebGPU twin of

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `RenderItem` |
| `@fourjs/render` | `warnDisposedInUse` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GpuBuffer, GpuDevice` | Import |

**Exports:**
- Classes: `WgpuGeometryCache`
- Interfaces: `WgpuGeometryRecord`
- Types: `CacheableGeometry`

---

### `packages/render-webgpu/src/webgpu-device.ts` - The WebGPU surface this backend touches, described structurally (§61, §62).

**Exports:**
- Interfaces: `GpuDeviceLostInfo`, `GpuQuerySet`, `GpuBuffer`, `GpuTextureViewDescriptor`, `GpuTexture`, `GpuComputePipelineDescriptor`, `GpuComputePassEncoder`, `GpuVertexBufferLayout`, `GpuBlendState`, `GpuBlendComponent`, `GpuRenderPipelineDescriptor`, `GpuStencilFaceState`, `GpuRenderPassDescriptor`, `GpuRenderPassEncoder`, `GpuCommandEncoder`, `GpuQueue`, `GpuSamplerDescriptor`, `GpuBufferDescriptor`, `GpuTextureDescriptor`, `GpuBindGroupLayoutEntry`, `GpuBufferBinding`, `GpuBindGroupEntry`, `GpuDevice`, `GpuAdapter`, `Gpu`, `GpuCanvasContext`, `WebgpuCanvas`
- Types: `GpuTextureView`, `GpuSampler`, `GpuShaderModule`, `GpuBindGroupLayout`, `GpuPipelineLayout`, `GpuBindGroup`, `GpuRenderPipeline`, `GpuComputePipeline`, `GpuCommandBuffer`
- Constants: `GPU_BUFFER_USAGE`, `GPU_MAP_MODE`, `GPU_TEXTURE_USAGE`, `GPU_SHADER_STAGE`, `UNIFORM_STRIDE_BYTES`

---

### `packages/render-webgpu/src/wgpu-effect.ts` - §70's full-screen effects in hand-written WGSL — the blit, the colour grade,

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_SHADER_STAGE, GpuBindGroupLayout, GpuDevice` | Import |
| `./wgpu-bindings.js` | `MAP_SAMPLER_BINDING, MAP_TEXTURE_BINDING` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT, VERTEX_ENTRY_POINT` | Import |

**Exports:**
- Types: `WgpuEffectKind`
- Functions: `createEffectBindGroupLayout`, `effectShaderSource`
- Constants: `EFFECT_PASS_VERTEX_COUNT`, `EFFECT_GRADE_OFFSET`, `EFFECT_UNIFORM_BYTES`, `EFFECT_BIND_GROUP_INDEX`, `EFFECT_UNIFORM_WGSL`

---

### `packages/render-webgpu/src/index.ts` - `@fourjs/render-webgpu` — the WebGPU backend (§62 backend 1).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GPU_MAP_MODE, GPU_SHADER_STAGE, GPU_TEXTURE_USAGE, UNIFORM_STRIDE_BYTES` | Re-export |
| `./webgpu-renderer.js` | `hostGpu, WebgpuRenderer` | Re-export |
| `./register.js` | `isWebgpuSupported, registerWebgpuRenderer` | Re-export |
| `./wgpu-bindings.js` | `DRAW_COLOR_OFFSET, DRAW_MODEL_OFFSET, DRAW_NORMAL_OFFSET, DRAW_UNIFORM_BYTES, DRAW_UNIFORM_FLOATS, DRAW_UNIFORM_WGSL, DRAW_VIEW_PROJECTION_OFFSET, MAP_BINDING_WGSL, MAP_BIND_GROUP_INDEX, MAP_SAMPLER_BINDING, MAP_TEXTURE_BINDING, createDrawBindGroupLayout, createTextureBindGroupLayout` | Re-export |
| `./wgpu-geometry.js` | `WgpuGeometryCache` | Re-export |
| `./wgpu-pipeline-cache.js` | `blendStateFor, pipelineKey, stencilStateFor, WgpuPipelineCache` | Re-export |
| `./wgpu-batch.js` | `WgpuBatching, batchVertexBufferLayout, createWgpuBatching` | Re-export |
| `./wgpu-sprite.js` | `SPRITE_MODEL_OFFSET, SPRITE_SHADER_SOURCE, SPRITE_TINT_OFFSET, SPRITE_UNIFORM_BYTES, SPRITE_UNIFORM_WGSL, SPRITE_VIEW_PROJECTION_OFFSET, createSpriteBindGroupLayout` | Re-export |
| `./wgpu-texture.js` | `MIPMAP_SHADER_SOURCE, WgpuTextureCache, mipLevelCount, samplerKey, textureByteLength` | Re-export |
| `./wgpu-unlit.js` | `CLEAR_SHADER_SOURCE, CLEAR_VERTEX_COUNT, COLOR_BUFFER_LAYOUT, COLOR_SHADER_LOCATION, FRAGMENT_ENTRY_POINT, POSITION_BUFFER_LAYOUT, POSITION_SHADER_LOCATION, UV_BUFFER_LAYOUT, UV_SHADER_LOCATION, VERTEX_ENTRY_POINT, unlitShaderSource, unlitVertexBufferLayouts, unlitFragmentStageWgsl` | Re-export |
| `./wgpu-lights.js` | `LIGHTS_BIND_GROUP_INDEX, LIGHT_AMBIENT_OFFSET, LIGHT_CAMERA_OFFSET, LIGHT_COLOR_OFFSET, LIGHT_COUNTS_OFFSET, LIGHT_DIRECTION_OFFSET, LIGHT_PUNCTUAL_COLOR_OFFSET, LIGHT_PUNCTUAL_DIRECTION_OFFSET, LIGHT_PUNCTUAL_PARAMS_OFFSET, LIGHT_PUNCTUAL_POSITION_OFFSET, HEMISPHERE_GROUND_OFFSET, HEMISPHERE_IRRADIANCE_WGSL, HEMISPHERE_SKY_OFFSET, HEMISPHERE_UNIFORM_MEMBERS_WGSL, HEMISPHERE_UP_OFFSET, LIGHT_BINDING_BYTES, LIGHT_UNIFORM_BYTES, LIGHT_UNIFORM_FLOATS, LIGHT_UNIFORM_MEMBERS_WGSL, LIGHT_UNIFORM_STRIDE_BYTES, LIGHT_UNIFORM_STRIDE_FLOATS, LIGHT_UNIFORM_WGSL, PUNCTUAL_LIGHT_WGSL, SHADED_MAP_BINDING_WGSL, SHADED_MAP_BIND_GROUP_INDEX, SHADED_MR_BINDING_WGSL, SHADED_MR_BIND_GROUP_INDEX, createLightsBindGroupLayout, shadedMrBindingWgsl, writeLightUniforms` | Re-export |
| `./wgpu-lit.js` | `NORMAL_BUFFER_LAYOUT, NORMAL_MATRIX_WGSL, NORMAL_SHADER_LOCATION, litShaderSource, shadedVertexBufferLayouts, shadedVertexStageWgsl, litFragmentStageWgsl` | Re-export |
| `./wgpu-render-target.js` | `RENDER_TARGET_COLOR_FORMAT, RENDER_TARGET_DEPTH_FORMAT, RENDER_TARGET_DEPTH_STENCIL_FORMAT, RENDER_TARGET_DEPTH_TEXTURE_FORMAT, WgpuRenderTargetCache, renderTargetDepthFormat` | Re-export |
| `./wgpu-effect.js` | `EFFECT_BIND_GROUP_INDEX, EFFECT_GRADE_OFFSET, EFFECT_PASS_VERTEX_COUNT, EFFECT_UNIFORM_BYTES, EFFECT_UNIFORM_WGSL, createEffectBindGroupLayout, effectShaderSource` | Re-export |
| `./wgpu-readback.js` | `READBACK_ROW_ALIGNMENT, readTexturePixels, readbackBytesPerRow` | Re-export |
| `./wgpu-compute.js` | `COMPUTE_ENTRY_POINT, PARTICLE_INTEGRATOR_SHADER_SOURCE, PARTICLE_INTEGRATOR_WORKGROUP_SIZE, PARTICLE_SIMULATION_PARAMS_FLOATS, WgpuComputeBuffer, WgpuComputeCache, createComputeBuffer, particleIntegratorWorkgroups, readComputeBufferBytes, writeComputeBuffer, writeParticleSimulationParams` | Re-export |
| `./wgpu-particles.js` | `PARTICLE_GPU_INSTANCE_BUFFER_LAYOUT, PARTICLE_GPU_POSITION_BUFFER_LAYOUT, PARTICLE_GPU_VERTEX_BUFFER_LAYOUTS, PARTICLE_APPEARANCE_SHADER_SOURCE, PARTICLE_INSTANCE_BUFFER_LAYOUT, PARTICLE_INSTANCE_STRIDE_BYTES, PARTICLE_MODEL_OFFSET, PARTICLE_PROJECTION_OFFSET, PARTICLE_SHADER_SOURCE, PARTICLE_WIDE_INSTANCE_BUFFER_LAYOUT, PARTICLE_WIDE_INSTANCE_STRIDE_BYTES, PARTICLE_UNIFORM_BYTES, PARTICLE_UNIFORM_WGSL, PARTICLE_VERTEX_BUFFER_LAYOUTS, PARTICLE_VIEW_OFFSET, WgpuParticleCache, createParticleBindGroupLayout` | Re-export |
| `./wgpu-particle-simulation.js` | `PARTICLE_SIMULATION_SCRATCH_BYTES, PARTICLE_SIMULATION_VECTOR_BYTES, WgpuParticleSimulation` | Re-export |
| `./wgpu-shadow.js` | `SHADOW_FACTOR_WGSL, SHADOW_LIGHT_UNIFORM_BYTES, SHADOW_LIGHT_UNIFORM_WGSL, SHADOW_MAP_BINDING, SHADOW_MATRIX_OFFSET, SHADOW_PARAMS_OFFSET, SHADOW_SAMPLER_BINDING, SHADOW_SHADER_SOURCE, SHADOW_UNIFORM_SPARE_BYTES, createShadowLightsBindGroupLayout, createShadowSampler, writeShadowUniforms` | Re-export |
| `./wgpu-stencil.js` | `CLEAR_STENCIL, STENCIL_ALL_BITS, applyStencilReference, frameWantsStencil, stencilDescriptor` | Re-export |
| `./wgpu-standard.js` | `STANDARD_BASE_COLOR_OFFSET, STANDARD_EMISSIVE_OFFSET, STANDARD_MODEL_OFFSET, STANDARD_NORMAL_OFFSET, STANDARD_SURFACE_OFFSET, STANDARD_UNIFORM_BYTES, STANDARD_UNIFORM_WGSL, STANDARD_VIEW_PROJECTION_OFFSET, createStandardBindGroupLayout, standardShaderSource` | Re-export |
| `./wgpu-node-registry.js` | `clearRegisteredWebgpuNodeMaterialPipeline, resolveWebgpuNodeMaterialPipelineFactory, setWebgpuNodeMaterialPipelineFactory` | Re-export |
| `./wgpu-node-program.js` | `NODE_SCREEN_BLOCK_BASE_BYTES, NODE_SCREEN_TEXTURE_GROUP, NODE_SURFACE_BLOCK_BASE_BYTES, NODE_SURFACE_BLOCK_GROUP, NODE_SURFACE_TEXTURE_GROUP, WgpuNodePipelineStore, emitShaderGraphWgsl, registerWebgpuNodeMaterialPipeline` | Re-export |
| `./wgpu-picking-registry.js` | `clearRegisteredPickingPipeline, resolvePickingServiceFactory` | Re-export |
| `./wgpu-picking.js` | `ID_MODEL_OFFSET, ID_PICK_OFFSET, ID_SHADER_SOURCE, ID_UNIFORM_BYTES, ID_VIEW_PROJECTION_OFFSET, PARTICLE_ID_MODEL_OFFSET, PARTICLE_ID_PICK_OFFSET, PARTICLE_ID_PROJECTION_OFFSET, PARTICLE_ID_SHADER_SOURCE, PARTICLE_ID_UNIFORM_BYTES, PARTICLE_ID_VIEW_OFFSET, SKINNED_ID_PALETTE_BYTES, SKINNED_ID_SHADER_SOURCE, WebgpuPickingService, registerPickingPipeline` | Re-export |
| `./wgpu-skinning-registry.js` | `clearRegisteredSkinningPipeline, resolveSkinningPipelineFactory` | Re-export |
| `./wgpu-skinning.js` | `JOINTS_BUFFER_LAYOUT, JOINTS_SHADER_LOCATION, JOINT_PALETTE_BINDING, JOINT_PALETTE_BYTES, JOINT_PALETTE_FLOATS, WEIGHTS_BUFFER_LAYOUT, WEIGHTS_SHADER_LOCATION, createJointPaletteBindGroupLayout, registerSkinningPipeline, SKINNED_SHADOW_SHADER_SOURCE, SKINNED_SHADOW_VERTEX_BUFFER_LAYOUTS, skinnedLitShaderSource, skinnedLitVertexBufferLayouts, skinnedPaletteBindGroupIndex, skinnedShadowShaderSource, skinnedUnlitShaderSource, skinnedUnlitVertexBufferLayouts, skinningWgsl` | Re-export |
| `./webgpu-device.js` | `Gpu, GpuAdapter, GpuStencilFaceState, GpuBindGroup, GpuBindGroupEntry, GpuBindGroupLayout, GpuBindGroupLayoutEntry, GpuBlendComponent, GpuBlendState, GpuBuffer, GpuBufferDescriptor, GpuCanvasContext, GpuCommandBuffer, GpuCommandEncoder, GpuComputePassEncoder, GpuComputePipeline, GpuComputePipelineDescriptor, GpuDevice, GpuDeviceLostInfo, GpuPipelineLayout, GpuQuerySet, GpuQueue, GpuRenderPassDescriptor, GpuRenderPassEncoder, GpuRenderPipeline, GpuBufferBinding, GpuRenderPipelineDescriptor, GpuSampler, GpuSamplerDescriptor, GpuShaderModule, GpuTexture, GpuTextureDescriptor, GpuTextureView, GpuTextureViewDescriptor, GpuVertexBufferLayout, WebgpuCanvas` | Re-export (type-only) |
| `./wgpu-geometry.js` | `CacheableGeometry, WgpuGeometryRecord` | Re-export (type-only) |
| `./wgpu-pipeline-cache.js` | `WgpuBatchStream, WgpuPipelineDescriptor, WgpuPipelineKind, WgpuStencilDescriptor` | Re-export (type-only) |
| `./wgpu-batch.js` | `WgpuRenderBatching` | Re-export (type-only) |
| `./wgpu-texture.js` | `ResolvedSamplerState, WgpuCacheableTexture, WgpuTextureRecord` | Re-export (type-only) |
| `./wgpu-render-target.js` | `WgpuCacheableRenderTarget, WgpuRenderTargetRecord` | Re-export (type-only) |
| `./wgpu-effect.js` | `WgpuEffectKind` | Re-export (type-only) |
| `./wgpu-compute.js` | `ComputeBinding, ComputeBindingAccess, ComputeBufferOptions, ComputePassDescriptor` | Re-export (type-only) |
| `./wgpu-compute.js` | `ParticleSimulationFieldParams` | Re-export (type-only) |
| `./wgpu-particles.js` | `WgpuParticleRecord` | Re-export (type-only) |
| `./wgpu-particle-simulation.js` | `WgpuParticleSimulationOptions` | Re-export (type-only) |
| `./wgpu-stencil.js` | `WgpuStencilSource` | Re-export (type-only) |
| `./wgpu-node-registry.js` | `WgpuNodeFrameState, WgpuNodeItemMaterial, WgpuNodeMaterialPipelineFactory, WgpuNodeMaterialPipelines, WgpuNodePipelineHost` | Re-export (type-only) |
| `./wgpu-node-program.js` | `EmittedWgslNodeShader` | Re-export (type-only) |
| `./wgpu-picking-registry.js` | `PickingRendererHost, PickingServiceFactory` | Re-export (type-only) |
| `./wgpu-skinning-registry.js` | `SkinningPipelineFactory, SkinningPipelineHost, SkinnedLitPipeline, SkinnedPrograms, SkinnedUnlitPipeline, WgpuSkinnedDrawDescriptor, WgpuSkinnedShadowDescriptor` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `GPU_BUFFER_USAGE`, `GPU_MAP_MODE`, `GPU_SHADER_STAGE`, `GPU_TEXTURE_USAGE`, `UNIFORM_STRIDE_BYTES`, `hostGpu`, `WebgpuRenderer`, `isWebgpuSupported`, `registerWebgpuRenderer`, `DRAW_COLOR_OFFSET`, `DRAW_MODEL_OFFSET`, `DRAW_NORMAL_OFFSET`, `DRAW_UNIFORM_BYTES`, `DRAW_UNIFORM_FLOATS`, `DRAW_UNIFORM_WGSL`, `DRAW_VIEW_PROJECTION_OFFSET`, `MAP_BINDING_WGSL`, `MAP_BIND_GROUP_INDEX`, `MAP_SAMPLER_BINDING`, `MAP_TEXTURE_BINDING`, `createDrawBindGroupLayout`, `createTextureBindGroupLayout`, `WgpuGeometryCache`, `blendStateFor`, `pipelineKey`, `stencilStateFor`, `WgpuPipelineCache`, `WgpuBatching`, `batchVertexBufferLayout`, `createWgpuBatching`, `SPRITE_MODEL_OFFSET`, `SPRITE_SHADER_SOURCE`, `SPRITE_TINT_OFFSET`, `SPRITE_UNIFORM_BYTES`, `SPRITE_UNIFORM_WGSL`, `SPRITE_VIEW_PROJECTION_OFFSET`, `createSpriteBindGroupLayout`, `MIPMAP_SHADER_SOURCE`, `WgpuTextureCache`, `mipLevelCount`, `samplerKey`, `textureByteLength`, `CLEAR_SHADER_SOURCE`, `CLEAR_VERTEX_COUNT`, `COLOR_BUFFER_LAYOUT`, `COLOR_SHADER_LOCATION`, `FRAGMENT_ENTRY_POINT`, `POSITION_BUFFER_LAYOUT`, `POSITION_SHADER_LOCATION`, `UV_BUFFER_LAYOUT`, `UV_SHADER_LOCATION`, `VERTEX_ENTRY_POINT`, `unlitShaderSource`, `unlitVertexBufferLayouts`, `unlitFragmentStageWgsl`, `LIGHTS_BIND_GROUP_INDEX`, `LIGHT_AMBIENT_OFFSET`, `LIGHT_CAMERA_OFFSET`, `LIGHT_COLOR_OFFSET`, `LIGHT_COUNTS_OFFSET`, `LIGHT_DIRECTION_OFFSET`, `LIGHT_PUNCTUAL_COLOR_OFFSET`, `LIGHT_PUNCTUAL_DIRECTION_OFFSET`, `LIGHT_PUNCTUAL_PARAMS_OFFSET`, `LIGHT_PUNCTUAL_POSITION_OFFSET`, `HEMISPHERE_GROUND_OFFSET`, `HEMISPHERE_IRRADIANCE_WGSL`, `HEMISPHERE_SKY_OFFSET`, `HEMISPHERE_UNIFORM_MEMBERS_WGSL`, `HEMISPHERE_UP_OFFSET`, `LIGHT_BINDING_BYTES`, `LIGHT_UNIFORM_BYTES`, `LIGHT_UNIFORM_FLOATS`, `LIGHT_UNIFORM_MEMBERS_WGSL`, `LIGHT_UNIFORM_STRIDE_BYTES`, `LIGHT_UNIFORM_STRIDE_FLOATS`, `LIGHT_UNIFORM_WGSL`, `PUNCTUAL_LIGHT_WGSL`, `SHADED_MAP_BINDING_WGSL`, `SHADED_MAP_BIND_GROUP_INDEX`, `SHADED_MR_BINDING_WGSL`, `SHADED_MR_BIND_GROUP_INDEX`, `createLightsBindGroupLayout`, `shadedMrBindingWgsl`, `writeLightUniforms`, `NORMAL_BUFFER_LAYOUT`, `NORMAL_MATRIX_WGSL`, `NORMAL_SHADER_LOCATION`, `litShaderSource`, `shadedVertexBufferLayouts`, `shadedVertexStageWgsl`, `litFragmentStageWgsl`, `RENDER_TARGET_COLOR_FORMAT`, `RENDER_TARGET_DEPTH_FORMAT`, `RENDER_TARGET_DEPTH_STENCIL_FORMAT`, `RENDER_TARGET_DEPTH_TEXTURE_FORMAT`, `WgpuRenderTargetCache`, `renderTargetDepthFormat`, `EFFECT_BIND_GROUP_INDEX`, `EFFECT_GRADE_OFFSET`, `EFFECT_PASS_VERTEX_COUNT`, `EFFECT_UNIFORM_BYTES`, `EFFECT_UNIFORM_WGSL`, `createEffectBindGroupLayout`, `effectShaderSource`, `READBACK_ROW_ALIGNMENT`, `readTexturePixels`, `readbackBytesPerRow`, `COMPUTE_ENTRY_POINT`, `PARTICLE_INTEGRATOR_SHADER_SOURCE`, `PARTICLE_INTEGRATOR_WORKGROUP_SIZE`, `PARTICLE_SIMULATION_PARAMS_FLOATS`, `WgpuComputeBuffer`, `WgpuComputeCache`, `createComputeBuffer`, `particleIntegratorWorkgroups`, `readComputeBufferBytes`, `writeComputeBuffer`, `writeParticleSimulationParams`, `PARTICLE_GPU_INSTANCE_BUFFER_LAYOUT`, `PARTICLE_GPU_POSITION_BUFFER_LAYOUT`, `PARTICLE_GPU_VERTEX_BUFFER_LAYOUTS`, `PARTICLE_APPEARANCE_SHADER_SOURCE`, `PARTICLE_INSTANCE_BUFFER_LAYOUT`, `PARTICLE_INSTANCE_STRIDE_BYTES`, `PARTICLE_MODEL_OFFSET`, `PARTICLE_PROJECTION_OFFSET`, `PARTICLE_SHADER_SOURCE`, `PARTICLE_WIDE_INSTANCE_BUFFER_LAYOUT`, `PARTICLE_WIDE_INSTANCE_STRIDE_BYTES`, `PARTICLE_UNIFORM_BYTES`, `PARTICLE_UNIFORM_WGSL`, `PARTICLE_VERTEX_BUFFER_LAYOUTS`, `PARTICLE_VIEW_OFFSET`, `WgpuParticleCache`, `createParticleBindGroupLayout`, `PARTICLE_SIMULATION_SCRATCH_BYTES`, `PARTICLE_SIMULATION_VECTOR_BYTES`, `WgpuParticleSimulation`, `SHADOW_FACTOR_WGSL`, `SHADOW_LIGHT_UNIFORM_BYTES`, `SHADOW_LIGHT_UNIFORM_WGSL`, `SHADOW_MAP_BINDING`, `SHADOW_MATRIX_OFFSET`, `SHADOW_PARAMS_OFFSET`, `SHADOW_SAMPLER_BINDING`, `SHADOW_SHADER_SOURCE`, `SHADOW_UNIFORM_SPARE_BYTES`, `createShadowLightsBindGroupLayout`, `createShadowSampler`, `writeShadowUniforms`, `CLEAR_STENCIL`, `STENCIL_ALL_BITS`, `applyStencilReference`, `frameWantsStencil`, `stencilDescriptor`, `STANDARD_BASE_COLOR_OFFSET`, `STANDARD_EMISSIVE_OFFSET`, `STANDARD_MODEL_OFFSET`, `STANDARD_NORMAL_OFFSET`, `STANDARD_SURFACE_OFFSET`, `STANDARD_UNIFORM_BYTES`, `STANDARD_UNIFORM_WGSL`, `STANDARD_VIEW_PROJECTION_OFFSET`, `createStandardBindGroupLayout`, `standardShaderSource`, `clearRegisteredWebgpuNodeMaterialPipeline`, `resolveWebgpuNodeMaterialPipelineFactory`, `setWebgpuNodeMaterialPipelineFactory`, `NODE_SCREEN_BLOCK_BASE_BYTES`, `NODE_SCREEN_TEXTURE_GROUP`, `NODE_SURFACE_BLOCK_BASE_BYTES`, `NODE_SURFACE_BLOCK_GROUP`, `NODE_SURFACE_TEXTURE_GROUP`, `WgpuNodePipelineStore`, `emitShaderGraphWgsl`, `registerWebgpuNodeMaterialPipeline`, `clearRegisteredPickingPipeline`, `resolvePickingServiceFactory`, `ID_MODEL_OFFSET`, `ID_PICK_OFFSET`, `ID_SHADER_SOURCE`, `ID_UNIFORM_BYTES`, `ID_VIEW_PROJECTION_OFFSET`, `PARTICLE_ID_MODEL_OFFSET`, `PARTICLE_ID_PICK_OFFSET`, `PARTICLE_ID_PROJECTION_OFFSET`, `PARTICLE_ID_SHADER_SOURCE`, `PARTICLE_ID_UNIFORM_BYTES`, `PARTICLE_ID_VIEW_OFFSET`, `SKINNED_ID_PALETTE_BYTES`, `SKINNED_ID_SHADER_SOURCE`, `WebgpuPickingService`, `registerPickingPipeline`, `clearRegisteredSkinningPipeline`, `resolveSkinningPipelineFactory`, `JOINTS_BUFFER_LAYOUT`, `JOINTS_SHADER_LOCATION`, `JOINT_PALETTE_BINDING`, `JOINT_PALETTE_BYTES`, `JOINT_PALETTE_FLOATS`, `WEIGHTS_BUFFER_LAYOUT`, `WEIGHTS_SHADER_LOCATION`, `createJointPaletteBindGroupLayout`, `registerSkinningPipeline`, `SKINNED_SHADOW_SHADER_SOURCE`, `SKINNED_SHADOW_VERTEX_BUFFER_LAYOUTS`, `skinnedLitShaderSource`, `skinnedLitVertexBufferLayouts`, `skinnedPaletteBindGroupIndex`, `skinnedShadowShaderSource`, `skinnedUnlitShaderSource`, `skinnedUnlitVertexBufferLayouts`, `skinningWgsl`, `Gpu`, `GpuAdapter`, `GpuStencilFaceState`, `GpuBindGroup`, `GpuBindGroupEntry`, `GpuBindGroupLayout`, `GpuBindGroupLayoutEntry`, `GpuBlendComponent`, `GpuBlendState`, `GpuBuffer`, `GpuBufferDescriptor`, `GpuCanvasContext`, `GpuCommandBuffer`, `GpuCommandEncoder`, `GpuComputePassEncoder`, `GpuComputePipeline`, `GpuComputePipelineDescriptor`, `GpuDevice`, `GpuDeviceLostInfo`, `GpuPipelineLayout`, `GpuQuerySet`, `GpuQueue`, `GpuRenderPassDescriptor`, `GpuRenderPassEncoder`, `GpuRenderPipeline`, `GpuBufferBinding`, `GpuRenderPipelineDescriptor`, `GpuSampler`, `GpuSamplerDescriptor`, `GpuShaderModule`, `GpuTexture`, `GpuTextureDescriptor`, `GpuTextureView`, `GpuTextureViewDescriptor`, `GpuVertexBufferLayout`, `WebgpuCanvas`, `CacheableGeometry`, `WgpuGeometryRecord`, `WgpuBatchStream`, `WgpuPipelineDescriptor`, `WgpuPipelineKind`, `WgpuStencilDescriptor`, `WgpuRenderBatching`, `ResolvedSamplerState`, `WgpuCacheableTexture`, `WgpuTextureRecord`, `WgpuCacheableRenderTarget`, `WgpuRenderTargetRecord`, `WgpuEffectKind`, `ComputeBinding`, `ComputeBindingAccess`, `ComputeBufferOptions`, `ComputePassDescriptor`, `ParticleSimulationFieldParams`, `WgpuParticleRecord`, `WgpuParticleSimulationOptions`, `WgpuStencilSource`, `WgpuNodeFrameState`, `WgpuNodeItemMaterial`, `WgpuNodeMaterialPipelineFactory`, `WgpuNodeMaterialPipelines`, `WgpuNodePipelineHost`, `EmittedWgslNodeShader`, `PickingRendererHost`, `PickingServiceFactory`, `SkinningPipelineFactory`, `SkinningPipelineHost`, `SkinnedLitPipeline`, `SkinnedPrograms`, `SkinnedUnlitPipeline`, `WgpuSkinnedDrawDescriptor`, `WgpuSkinnedShadowDescriptor`

---

### `packages/render-webgpu/src/wgpu-bindings.ts` - This backend's binding layout, **declared as data** (§7 of the R-1 plan).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_SHADER_STAGE, GpuBindGroupLayout, GpuDevice` | Import |

**Exports:**
- Functions: `createDrawBindGroupLayout`, `createTextureBindGroupLayout`
- Constants: `DRAW_VIEW_PROJECTION_OFFSET`, `DRAW_MODEL_OFFSET`, `DRAW_COLOR_OFFSET`, `DRAW_NORMAL_OFFSET`, `DRAW_UNIFORM_BYTES`, `DRAW_UNIFORM_FLOATS`, `DRAW_UNIFORM_WGSL`, `MAP_BIND_GROUP_INDEX`, `MAP_TEXTURE_BINDING`, `MAP_SAMPLER_BINDING`, `MAP_BINDING_WGSL`

---

### `packages/render-webgpu/src/wgpu-skinning.ts` - The skinned colour pipelines (§54, §62; RFC 0003) — a skinned variant of

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `MAX_SKINNING_JOINTS` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GPU_SHADER_STAGE, GpuBindGroup, GpuBindGroupLayout, GpuBuffer, GpuDevice, GpuPipelineLayout, GpuRenderPipeline, GpuShaderModule, GpuVertexBufferLayout` | Import |
| `./wgpu-bindings.js` | `DRAW_UNIFORM_WGSL, MAP_BINDING_WGSL` | Import |
| `./wgpu-lights.js` | `HEMISPHERE_IRRADIANCE_WGSL, LIGHT_UNIFORM_WGSL, PUNCTUAL_LIGHT_WGSL, SHADED_MAP_BINDING_WGSL` | Import |
| `./wgpu-lit.js` | `NORMAL_MATRIX_WGSL, litFragmentStageWgsl, shadedVertexBufferLayouts` | Import |
| `./wgpu-pipeline-cache.js` | `blendStateFor, stencilStateFor` | Import |
| `./wgpu-shadow.js` | `SHADOW_FACTOR_WGSL, SHADOW_LIGHT_UNIFORM_WGSL` | Import |
| `./wgpu-skinning-registry.js` | `setSkinningPipelineFactory, SkinnedLitPipeline, SkinnedPrograms, SkinnedUnlitPipeline, SkinningPipelineHost, WgpuSkinnedDrawDescriptor, WgpuSkinnedShadowDescriptor` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT, POSITION_BUFFER_LAYOUT, POSITION_SHADER_LOCATION, VERTEX_ENTRY_POINT, unlitFragmentStageWgsl, unlitVertexBufferLayouts` | Import |

**Exports:**
- Functions: `skinnedPaletteBindGroupIndex`, `createJointPaletteBindGroupLayout`, `skinningWgsl`, `skinnedUnlitVertexBufferLayouts`, `skinnedLitVertexBufferLayouts`, `skinnedShadowShaderSource`, `skinnedUnlitShaderSource`, `skinnedLitShaderSource`, `registerSkinningPipeline`
- Constants: `JOINTS_SHADER_LOCATION`, `WEIGHTS_SHADER_LOCATION`, `JOINTS_BUFFER_LAYOUT`, `WEIGHTS_BUFFER_LAYOUT`, `JOINT_PALETTE_BYTES`, `JOINT_PALETTE_FLOATS`, `JOINT_PALETTE_BINDING`, `SKINNED_SHADOW_VERTEX_BUFFER_LAYOUTS`, `SKINNED_SHADOW_SHADER_SOURCE`

---

### `packages/render-webgpu/src/wgpu-node-program.ts` - The node-material pipeline for WebGPU (§60, §62; RFC 0001 — WP-R1.9): a

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, devWarnOnce, Disposable` |
| `@fourjs/render` | `SHADER_VALUE_COMPONENTS, analyzeShaderGraph, isRenderTargetTexture, GraphEffect, NodeRenderItem, RenderItem, RenderStatistics, ShaderAttributeName, ShaderDomain, ShaderGraph, ShaderGraphAnalysis, ShaderNode, ShaderUniformReflection, ShaderValueType` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GPU_SHADER_STAGE, GpuBindGroup, GpuBindGroupEntry, GpuBindGroupLayout, GpuBuffer, GpuPipelineLayout, GpuRenderPassEncoder, GpuRenderPipeline, GpuShaderModule, GpuTextureView, GpuVertexBufferLayout` | Import |
| `./wgpu-effect.js` | `EFFECT_PASS_VERTEX_COUNT` | Import |
| `./wgpu-lit.js` | `NORMAL_BUFFER_LAYOUT` | Import |
| `./wgpu-pipeline-cache.js` | `blendStateFor, stencilStateFor, WgpuStencilDescriptor` | Import |
| `./wgpu-node-registry.js` | `setWebgpuNodeMaterialPipelineFactory, WgpuNodeFrameState, WgpuNodeItemMaterial, WgpuNodeMaterialPipelines, WgpuNodePipelineHost` | Import |
| `./wgpu-render-target.js` | `WgpuCacheableRenderTarget, WgpuRenderTargetCache` | Import (type-only) |
| `./wgpu-stencil.js` | `applyStencilReference, stencilDescriptor` | Import |
| `./wgpu-unlit.js` | `COLOR_BUFFER_LAYOUT, FRAGMENT_ENTRY_POINT, POSITION_BUFFER_LAYOUT, UV_BUFFER_LAYOUT, VERTEX_ENTRY_POINT` | Import |

**Exports:**
- Classes: `WgpuNodePipelineStore`
- Interfaces: `EmittedWgslNodeShader`
- Functions: `emitShaderGraphWgsl`, `registerWebgpuNodeMaterialPipeline`
- Constants: `NODE_SURFACE_BLOCK_BASE_BYTES`, `NODE_SCREEN_BLOCK_BASE_BYTES`, `NODE_SURFACE_BLOCK_GROUP`, `NODE_SURFACE_TEXTURE_GROUP`, `NODE_SCREEN_TEXTURE_GROUP`

---

### `packages/render-webgpu/src/wgpu-shadow.ts` - §69's shadow tier on WebGPU (WP-R1.7): the depth-only caster module, the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `SceneLights` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_SHADER_STAGE, GpuBindGroupLayout, GpuDevice, GpuSampler` | Import |
| `./wgpu-bindings.js` | `DRAW_UNIFORM_WGSL` | Import |
| `./wgpu-lights.js` | `LIGHTS_BIND_GROUP_INDEX, HEMISPHERE_UNIFORM_MEMBERS_WGSL, LIGHT_UNIFORM_BYTES, LIGHT_UNIFORM_MEMBERS_WGSL, LIGHT_UNIFORM_STRIDE_BYTES` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT, POSITION_SHADER_LOCATION, VERTEX_ENTRY_POINT` | Import |

**Exports:**
- Functions: `createShadowLightsBindGroupLayout`, `createShadowSampler`, `writeShadowUniforms`
- Constants: `SHADOW_MATRIX_OFFSET`, `SHADOW_PARAMS_OFFSET`, `SHADOW_LIGHT_UNIFORM_BYTES`, `SHADOW_MAP_BINDING`, `SHADOW_SAMPLER_BINDING`, `SHADOW_LIGHT_UNIFORM_WGSL`, `SHADOW_FACTOR_WGSL`, `SHADOW_SHADER_SOURCE`, `SHADOW_UNIFORM_SPARE_BYTES`

---

### `packages/render-webgpu/src/wgpu-gpu-timer.ts` - WebGPU GPU-frame timer — `timestamp-query` ping-pong (A-1, §62, §84).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GPU_MAP_MODE, GpuBuffer, GpuCommandEncoder, GpuDevice, GpuQuerySet` | Import |

**Exports:**
- Classes: `WgpuGpuTimer`

---

### `packages/render-webgpu/src/wgpu-readback.ts` - `readPixels`' mechanism: `copyTextureToBuffer` + `mapAsync` (WP-R1.6; §61,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Rectangle2` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GPU_MAP_MODE, GpuDevice, GpuTexture` | Import |

**Exports:**
- Functions: `readbackBytesPerRow`, `readTexturePixels`
- Constants: `READBACK_ROW_ALIGNMENT`

---

### `packages/render-webgpu/src/wgpu-picking.ts` - The WebGPU picking service (§71, §62; RFC 0005) — the id-buffer pass and

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, FourError, devWarnOnce` |
| `@fourjs/math` | `Frustum, Matrix4, Rectangle2` |
| `@fourjs/render` | `MAX_SKINNING_JOINTS, PARTICLE_INSTANCE_FLOATS, RenderTarget, assertEncodableCandidateCount, buildRenderList, buildViewRenderList, collectPickCandidates, decodePickId, encodePickId, ParticleRenderItem, PickRequest, PickResult, PickingService, RenderItem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GPU_SHADER_STAGE, UNIFORM_STRIDE_BYTES, GpuBindGroup, GpuBindGroupLayout, GpuBuffer, GpuDevice, GpuRenderPipeline, GpuTextureView, GpuVertexBufferLayout` | Import |
| `./wgpu-geometry.js` | `WgpuGeometryCache, WgpuGeometryRecord` | Import (type-only) |
| `./wgpu-particles.js` | `PARTICLE_VERTEX_BUFFER_LAYOUTS, WgpuParticleCache, WgpuParticleRecord` | Import |
| `./wgpu-picking-registry.js` | `setPickingServiceFactory, PickingRendererHost` | Import |
| `./wgpu-readback.js` | `readTexturePixels` | Import |
| `./wgpu-render-target.js` | `RENDER_TARGET_COLOR_FORMAT, RENDER_TARGET_DEPTH_FORMAT, WgpuRenderTargetRecord` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT, POSITION_BUFFER_LAYOUT, VERTEX_ENTRY_POINT` | Import |

**Exports:**
- Classes: `WebgpuPickingService`
- Functions: `registerPickingPipeline`
- Constants: `ID_VIEW_PROJECTION_OFFSET`, `ID_MODEL_OFFSET`, `ID_PICK_OFFSET`, `ID_UNIFORM_BYTES`, `PARTICLE_ID_PROJECTION_OFFSET`, `PARTICLE_ID_VIEW_OFFSET`, `PARTICLE_ID_MODEL_OFFSET`, `PARTICLE_ID_PICK_OFFSET`, `PARTICLE_ID_UNIFORM_BYTES`, `SKINNED_ID_PALETTE_BYTES`, `ID_SHADER_SOURCE`, `PARTICLE_ID_SHADER_SOURCE`, `SKINNED_ID_SHADER_SOURCE`

---

### `packages/render-webgpu/src/wgpu-texture.ts` - GPU-side textures and samplers for the WebGPU backend: one `GPUTexture` per

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `RenderItem` |
| `@fourjs/render` | `warnDisposedInUse` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_TEXTURE_USAGE, GpuBindGroup, GpuBindGroupLayout, GpuDevice, GpuPipelineLayout, GpuRenderPipeline, GpuSampler, GpuShaderModule, GpuTexture, GpuTextureView` | Import |
| `./wgpu-bindings.js` | `MAP_SAMPLER_BINDING, MAP_TEXTURE_BINDING, createTextureBindGroupLayout` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT, VERTEX_ENTRY_POINT` | Import |

**Exports:**
- Classes: `WgpuTextureCache`
- Interfaces: `ResolvedSamplerState`, `WgpuTextureRecord`
- Types: `WgpuCacheableTexture`
- Functions: `mipLevelCount`, `textureByteLength`, `samplerKey`
- Constants: `MIPMAP_SHADER_SOURCE`

---

### `packages/render-webgpu/src/wgpu-unlit.ts` - The unlit pipeline in hand-written WGSL (§64, §120's MVP tier), plus the

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./wgpu-bindings.js` | `DRAW_UNIFORM_WGSL, MAP_BINDING_WGSL` | Import |
| `./webgpu-device.js` | `GpuVertexBufferLayout` | Import (type-only) |

**Exports:**
- Functions: `unlitVertexBufferLayouts`, `unlitShaderSource`, `unlitFragmentStageWgsl`
- Constants: `POSITION_SHADER_LOCATION`, `COLOR_SHADER_LOCATION`, `POSITION_BUFFER_LAYOUT`, `COLOR_BUFFER_LAYOUT`, `UV_SHADER_LOCATION`, `UV_BUFFER_LAYOUT`, `VERTEX_ENTRY_POINT`, `FRAGMENT_ENTRY_POINT`, `CLEAR_VERTEX_COUNT`, `CLEAR_SHADER_SOURCE`

---

### `packages/render-webgpu/src/wgpu-skinning-registry.ts` - The skinning pipeline's registration slot (§54, §62; RFC 0003) — the

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GpuBindGroup, GpuBindGroupLayout, GpuDevice, GpuRenderPipeline` | Import (type-only) |
| `./wgpu-pipeline-cache.js` | `WgpuStencilDescriptor` | Import (type-only) |

**Exports:**
- Interfaces: `SkinningPipelineHost`, `WgpuSkinnedDrawDescriptor`, `WgpuSkinnedShadowDescriptor`, `SkinnedUnlitPipeline`, `SkinnedLitPipeline`, `SkinnedPrograms`, `SkinningPipelineFactory`
- Functions: `setSkinningPipelineFactory`, `resolveSkinningPipelineFactory`, `clearRegisteredSkinningPipeline`

---

### `packages/render-webgpu/src/wgpu-stencil.ts` - §57/§67 stencil parity for the WebGPU backend (WP-R1.7) — the per-frame

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `RenderItem, RenderItemStencil` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GpuRenderPassEncoder` | Import (type-only) |
| `./wgpu-pipeline-cache.js` | `WgpuStencilDescriptor` | Import (type-only) |

**Exports:**
- Types: `WgpuStencilSource`
- Functions: `stencilDescriptor`, `applyStencilReference`, `frameWantsStencil`
- Constants: `STENCIL_ALL_BITS`, `CLEAR_STENCIL`

---

### `packages/render-webgpu/src/wgpu-render-target.ts` - GPU-side render targets for the WebGPU backend: one colour (and optional

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `RenderTarget` |
| `@fourjs/render` | `warnDisposedInUse` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_TEXTURE_USAGE, GpuBindGroup, GpuBindGroupLayout, GpuDevice, GpuSampler, GpuTexture, GpuTextureView` | Import |
| `./wgpu-bindings.js` | `MAP_SAMPLER_BINDING, MAP_TEXTURE_BINDING` | Import |

**Exports:**
- Classes: `WgpuRenderTargetCache`
- Interfaces: `WgpuRenderTargetRecord`
- Types: `WgpuCacheableRenderTarget`
- Functions: `renderTargetDepthFormat`
- Constants: `RENDER_TARGET_COLOR_FORMAT`, `RENDER_TARGET_DEPTH_FORMAT`, `RENDER_TARGET_DEPTH_TEXTURE_FORMAT`, `RENDER_TARGET_DEPTH_STENCIL_FORMAT`

---

### `packages/render-webgpu/src/wgpu-lights.ts` - The frame's lighting as **one uniform buffer** (§68, WP-R1.5), plus the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `MAX_PUNCTUAL_LIGHTS, SceneLights` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_SHADER_STAGE, GpuBindGroupLayout, GpuDevice` | Import |
| `./wgpu-bindings.js` | `MAP_SAMPLER_BINDING, MAP_TEXTURE_BINDING` | Import |

**Exports:**
- Functions: `createLightsBindGroupLayout`, `shadedMrBindingWgsl`, `writeLightUniforms`
- Constants: `LIGHTS_BIND_GROUP_INDEX`, `SHADED_MAP_BIND_GROUP_INDEX`, `SHADED_MR_BIND_GROUP_INDEX`, `LIGHT_AMBIENT_OFFSET`, `LIGHT_DIRECTION_OFFSET`, `LIGHT_COLOR_OFFSET`, `LIGHT_CAMERA_OFFSET`, `LIGHT_COUNTS_OFFSET`, `LIGHT_PUNCTUAL_POSITION_OFFSET`, `LIGHT_PUNCTUAL_COLOR_OFFSET`, `LIGHT_PUNCTUAL_DIRECTION_OFFSET`, `LIGHT_PUNCTUAL_PARAMS_OFFSET`, `LIGHT_UNIFORM_BYTES`, `LIGHT_UNIFORM_FLOATS`, `HEMISPHERE_SKY_OFFSET`, `HEMISPHERE_GROUND_OFFSET`, `HEMISPHERE_UP_OFFSET`, `LIGHT_BINDING_BYTES`, `LIGHT_UNIFORM_STRIDE_BYTES`, `LIGHT_UNIFORM_STRIDE_FLOATS`, `LIGHT_UNIFORM_MEMBERS_WGSL`, `HEMISPHERE_UNIFORM_MEMBERS_WGSL`, `LIGHT_UNIFORM_WGSL`, `HEMISPHERE_IRRADIANCE_WGSL`, `PUNCTUAL_LIGHT_WGSL`, `SHADED_MAP_BINDING_WGSL`, `SHADED_MR_BINDING_WGSL`

---

### `packages/render-webgpu/src/wgpu-pipeline-memo.ts` - A "same as the previous draw" fast path in front of {@link WgpuPipelineCache}

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GpuRenderPipeline` | Import (type-only) |
| `./wgpu-pipeline-cache.js` | `WgpuPipelineCache, WgpuPipelineDescriptor, WgpuPipelineKind` | Import (type-only) |
| `./wgpu-stencil.js` | `STENCIL_ALL_BITS, stencilDescriptor, WgpuStencilSource` | Import |

**Exports:**
- Classes: `WgpuPipelineMemo`
- Interfaces: `WgpuPipelineRequest`, `MutableWgpuPipelineRequest`
- Functions: `createPipelineRequest`

---

### `packages/render-webgpu/src/wgpu-particles.ts` - The batched particle pipeline for the WebGPU backend (§36, §64 stage 6,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `PARTICLE_COLOR_OFFSET, PARTICLE_INSTANCE_FLOATS, PARTICLE_POSITION_OFFSET, PARTICLE_ROTATION_OFFSET, PARTICLE_SIZE_OFFSET, PARTICLE_SOFTNESS_OFFSET, PARTICLE_WIDE_INSTANCE_FLOATS, ParticleRenderItem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GPU_SHADER_STAGE, GpuBindGroupLayout, GpuBuffer, GpuDevice, GpuVertexBufferLayout` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT, POSITION_BUFFER_LAYOUT, VERTEX_ENTRY_POINT` | Import |

**Exports:**
- Classes: `WgpuParticleCache`
- Interfaces: `WgpuParticleRecord`
- Functions: `createParticleBindGroupLayout`
- Constants: `PARTICLE_PROJECTION_OFFSET`, `PARTICLE_VIEW_OFFSET`, `PARTICLE_MODEL_OFFSET`, `PARTICLE_UNIFORM_BYTES`, `PARTICLE_INSTANCE_STRIDE_BYTES`, `PARTICLE_UNIFORM_WGSL`, `PARTICLE_INSTANCE_BUFFER_LAYOUT`, `PARTICLE_VERTEX_BUFFER_LAYOUTS`, `PARTICLE_GPU_POSITION_BUFFER_LAYOUT`, `PARTICLE_GPU_INSTANCE_BUFFER_LAYOUT`, `PARTICLE_GPU_VERTEX_BUFFER_LAYOUTS`, `PARTICLE_WIDE_INSTANCE_STRIDE_BYTES`, `PARTICLE_WIDE_INSTANCE_BUFFER_LAYOUT`, `PARTICLE_APPEARANCE_SHADER_SOURCE`, `PARTICLE_SHADER_SOURCE`

---

### `packages/render-webgpu/src/wgpu-particle-simulation.ts` - `WgpuParticleSimulation` — the device side of §36's `simulation: "gpu"`

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GpuBuffer, GpuDevice` | Import |
| `./wgpu-compute.js` | `PARTICLE_INTEGRATOR_SHADER_SOURCE, PARTICLE_SIMULATION_PARAMS_FLOATS, WgpuComputeBuffer, WgpuComputeCache, createComputeBuffer, particleIntegratorWorkgroups, writeComputeBuffer, writeParticleSimulationParams, ParticleSimulationFieldParams` | Import |

**Exports:**
- Classes: `WgpuParticleSimulation`
- Interfaces: `WgpuParticleSimulationOptions`
- Constants: `PARTICLE_SIMULATION_VECTOR_BYTES`, `PARTICLE_SIMULATION_SCRATCH_BYTES`

---

### `packages/render-webgpu/src/wgpu-compute.ts` - §82's GPU compute on the WebGPU backend (WP-R1.8) — compute pipelines, bind

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/render` | `COMPUTE_ENTRY_POINT, ComputeBinding, ComputeBindingAccess, ComputeBuffer, ComputePassDescriptor` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GPU_MAP_MODE, GPU_SHADER_STAGE, GpuBindGroupLayout, GpuComputePipeline, GpuDevice, GpuPipelineLayout, GpuShaderModule, GpuBuffer` | Import |

**Exports:**
- Classes: `WgpuComputeBuffer`, `WgpuComputeCache`
- Interfaces: `ComputeBufferOptions`, `ParticleSimulationFieldParams`
- Functions: `createComputeBuffer`, `writeComputeBuffer`, `readComputeBufferBytes`, `writeParticleSimulationParams`, `particleIntegratorWorkgroups`
- Constants: `PARTICLE_INTEGRATOR_WORKGROUP_SIZE`, `PARTICLE_SIMULATION_PARAMS_FLOATS`, `PARTICLE_INTEGRATOR_SHADER_SOURCE`

---

### `packages/render-webgpu/src/register.ts` - This backend's opt-in to §62's renderer registry (R-2, A-8, WP-R1.1).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `registerRenderer, RendererOptions, RendererRegistry` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-renderer.js` | `hostGpu` | Import |
| `./webgpu-renderer.js` | `WebgpuRenderer` | Import |

**Exports:**
- Functions: `isWebgpuSupported`, `registerWebgpuRenderer`

---

### `packages/render-webgpu/src/wgpu-node-registry.ts` - The WebGPU node-material pipeline's registration slot (§60, §62; RFC 0001;

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Matrix4` |
| `@fourjs/render` | `GraphEffect, NodeRenderItem, RenderItem, RenderStatistics` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GpuDevice, GpuRenderPassEncoder, GpuTextureView` | Import (type-only) |
| `./wgpu-geometry.js` | `WgpuGeometryCache` | Import (type-only) |
| `./wgpu-render-target.js` | `WgpuCacheableRenderTarget, WgpuRenderTargetCache` | Import (type-only) |
| `./wgpu-texture.js` | `WgpuTextureCache` | Import (type-only) |

**Exports:**
- Interfaces: `WgpuNodePipelineHost`, `WgpuNodeFrameState`, `WgpuNodeMaterialPipelines`, `WgpuNodeMaterialPipelineFactory`
- Types: `WgpuNodeItemMaterial`
- Functions: `setWebgpuNodeMaterialPipelineFactory`, `resolveWebgpuNodeMaterialPipelineFactory`, `clearRegisteredWebgpuNodeMaterialPipeline`

---

### `packages/render-webgpu/src/wgpu-batch.ts` - §65 batching for the WebGPU backend — the GPU half of `@fourjs/render`'s

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/render` | `RenderBatcher, RenderBatch, RenderBatchOptions, RenderItem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GpuBuffer, GpuDevice, GpuRenderPassEncoder, GpuVertexBufferLayout` | Import |
| `./wgpu-unlit.js` | `COLOR_SHADER_LOCATION, POSITION_SHADER_LOCATION, UV_SHADER_LOCATION` | Import |

**Exports:**
- Classes: `WgpuBatching`
- Interfaces: `WgpuRenderBatching`
- Functions: `batchVertexBufferLayout`, `createWgpuBatching`

---

### `packages/render-webgpu/src/wgpu-standard.ts` - The metallic-roughness pipeline in hand-written WGSL (§57

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_SHADER_STAGE, GpuBindGroupLayout, GpuDevice` | Import |
| `./wgpu-lights.js` | `LIGHT_UNIFORM_WGSL, HEMISPHERE_IRRADIANCE_WGSL, PUNCTUAL_LIGHT_WGSL, SHADED_MAP_BIND_GROUP_INDEX, SHADED_MAP_BINDING_WGSL, SHADED_MR_BIND_GROUP_INDEX, shadedMrBindingWgsl` | Import |
| `./wgpu-lit.js` | `shadedVertexStageWgsl` | Import |
| `./wgpu-shadow.js` | `SHADOW_FACTOR_WGSL, SHADOW_LIGHT_UNIFORM_WGSL` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT` | Import |

**Exports:**
- Functions: `createStandardBindGroupLayout`, `standardShaderSource`
- Constants: `STANDARD_VIEW_PROJECTION_OFFSET`, `STANDARD_MODEL_OFFSET`, `STANDARD_BASE_COLOR_OFFSET`, `STANDARD_NORMAL_OFFSET`, `STANDARD_EMISSIVE_OFFSET`, `STANDARD_SURFACE_OFFSET`, `STANDARD_UNIFORM_BYTES`, `STANDARD_UNIFORM_WGSL`

---

### `packages/render-webgpu/src/wgpu-sprite.ts` - The sprite pipeline in hand-written WGSL (§55, WP-R1.3), plus the uniform

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_SHADER_STAGE, GpuBindGroupLayout, GpuDevice` | Import |
| `./wgpu-bindings.js` | `MAP_BINDING_WGSL` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT, UV_SHADER_LOCATION, VERTEX_ENTRY_POINT` | Import |

**Exports:**
- Functions: `createSpriteBindGroupLayout`
- Constants: `SPRITE_VIEW_PROJECTION_OFFSET`, `SPRITE_MODEL_OFFSET`, `SPRITE_TINT_OFFSET`, `SPRITE_UNIFORM_BYTES`, `SPRITE_UNIFORM_WGSL`, `SPRITE_SHADER_SOURCE`

---

### `packages/render-webgpu/src/wgpu-picking-registry.ts` - The picking pipeline's registration slot (§71, §62; RFC 0005) — the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `PickingService` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GpuDevice` | Import (type-only) |
| `./wgpu-geometry.js` | `WgpuGeometryCache` | Import (type-only) |
| `./wgpu-particles.js` | `WgpuParticleCache` | Import (type-only) |
| `./wgpu-render-target.js` | `WgpuRenderTargetCache` | Import (type-only) |

**Exports:**
- Interfaces: `PickingRendererHost`, `PickingServiceFactory`
- Functions: `setPickingServiceFactory`, `resolvePickingServiceFactory`, `clearRegisteredPickingPipeline`

---

### `packages/render-webgpu/src/wgpu-pipeline-cache.ts` - The lazy, descriptor-keyed render-pipeline cache (§4.2 of the R-1 plan).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `RenderItemStencil` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GpuBindGroupLayout, GpuBlendState, GpuDevice, GpuPipelineLayout, GpuRenderPipeline, GpuShaderModule, GpuStencilFaceState, GpuVertexBufferLayout` | Import |
| `./wgpu-batch.js` | `batchVertexBufferLayout` | Import |
| `./wgpu-effect.js` | `effectShaderSource, WgpuEffectKind` | Import |
| `./wgpu-lit.js` | `litShaderSource, shadedVertexBufferLayouts` | Import |
| `./wgpu-particles.js` | `PARTICLE_GPU_VERTEX_BUFFER_LAYOUTS, PARTICLE_SHADER_SOURCE, PARTICLE_VERTEX_BUFFER_LAYOUTS` | Import |
| `./wgpu-shadow.js` | `SHADOW_SHADER_SOURCE` | Import |
| `./wgpu-sprite.js` | `SPRITE_SHADER_SOURCE` | Import |
| `./wgpu-standard.js` | `standardShaderSource` | Import |
| `./wgpu-unlit.js` | `CLEAR_SHADER_SOURCE, FRAGMENT_ENTRY_POINT, POSITION_BUFFER_LAYOUT, UV_BUFFER_LAYOUT, VERTEX_ENTRY_POINT, unlitShaderSource, unlitVertexBufferLayouts` | Import |

**Exports:**
- Classes: `WgpuPipelineCache`
- Interfaces: `WgpuStencilDescriptor`, `WgpuBatchStream`, `WgpuPipelineDescriptor`
- Types: `WgpuPipelineKind`
- Functions: `blendStateFor`, `pipelineKey`, `stencilStateFor`

---

### `packages/render-webgpu/src/wgpu-lit.ts` - The Lambert-lit pipeline in hand-written WGSL (§57 `LitMaterial`, §68,

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./wgpu-bindings.js` | `DRAW_UNIFORM_WGSL` | Import |
| `./webgpu-device.js` | `GpuVertexBufferLayout` | Import (type-only) |
| `./wgpu-lights.js` | `HEMISPHERE_IRRADIANCE_WGSL, LIGHT_UNIFORM_WGSL, PUNCTUAL_LIGHT_WGSL, SHADED_MAP_BINDING_WGSL` | Import |
| `./wgpu-shadow.js` | `SHADOW_FACTOR_WGSL, SHADOW_LIGHT_UNIFORM_WGSL` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT, POSITION_BUFFER_LAYOUT, POSITION_SHADER_LOCATION, UV_BUFFER_LAYOUT, UV_SHADER_LOCATION, VERTEX_ENTRY_POINT` | Import |

**Exports:**
- Functions: `shadedVertexBufferLayouts`, `shadedVertexStageWgsl`, `litShaderSource`, `litFragmentStageWgsl`
- Constants: `NORMAL_SHADER_LOCATION`, `NORMAL_BUFFER_LAYOUT`, `NORMAL_MATRIX_WGSL`

---

### `packages/render-webgpu/src/webgpu-renderer.ts` - Draws fourJS scenes with WebGPU (§61, §62 backend 1).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, EventEmitter, FourError, devWarnOnce` |
| `@fourjs/math` | `Frustum, Matrix3, Matrix4, Rectangle2` |
| `@fourjs/render` | `COLOR_GRADE_DEFAULTS, RenderTarget, buildInterpolatedRenderList, buildRenderList, buildViewRenderList, MAX_SKINNING_JOINTS, collectSceneLights, createSceneLights, isRenderTargetTexture, isSkinnedLitItem, isSkinnedUnlitItem, intersectScissor, validateReadbackRegion, EffectRenderPass, RenderBatch, PickingService, RenderInterpolation, RenderItem, RenderStatistics, Renderer, RendererCapabilities, RendererEventMap, RendererOptions, ScissorRect` |
| `@fourjs/scene` | `Node, Viewport` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GPU_TEXTURE_USAGE, UNIFORM_STRIDE_BYTES, Gpu, GpuBindGroup, GpuBindGroupLayout, GpuBuffer, GpuCanvasContext, GpuCommandEncoder, GpuDevice, GpuRenderPassEncoder, GpuRenderPipeline, GpuSampler, GpuTexture, GpuTextureView, WebgpuCanvas` | Import |
| `./wgpu-bindings.js` | `DRAW_COLOR_OFFSET, DRAW_MODEL_OFFSET, DRAW_NORMAL_OFFSET, DRAW_UNIFORM_BYTES, DRAW_VIEW_PROJECTION_OFFSET, MAP_BIND_GROUP_INDEX, createDrawBindGroupLayout` | Import |
| `./wgpu-batch.js` | `WgpuRenderBatching` | Import (type-only) |
| `./wgpu-effect.js` | `EFFECT_BIND_GROUP_INDEX, EFFECT_PASS_VERTEX_COUNT, EFFECT_UNIFORM_BYTES, createEffectBindGroupLayout, WgpuEffectKind` | Import |
| `./wgpu-geometry.js` | `WgpuGeometryCache, WgpuGeometryRecord` | Import |
| `./wgpu-gpu-timer.js` | `WgpuGpuTimer` | Import |
| `./wgpu-lights.js` | `LIGHTS_BIND_GROUP_INDEX, LIGHT_BINDING_BYTES, LIGHT_UNIFORM_STRIDE_BYTES, LIGHT_UNIFORM_STRIDE_FLOATS, SHADED_MAP_BIND_GROUP_INDEX, SHADED_MR_BIND_GROUP_INDEX, createLightsBindGroupLayout, writeLightUniforms` | Import |
| `./wgpu-compute.js` | `WgpuComputeCache, createComputeBuffer, readComputeBufferBytes, writeComputeBuffer, ComputeBufferOptions, ComputePassDescriptor, WgpuComputeBuffer` | Import |
| `./wgpu-particles.js` | `PARTICLE_MODEL_OFFSET, PARTICLE_PROJECTION_OFFSET, PARTICLE_UNIFORM_BYTES, PARTICLE_VIEW_OFFSET, WgpuParticleCache, createParticleBindGroupLayout, WgpuParticleRecord` | Import |
| `./wgpu-particle-simulation.js` | `WgpuParticleSimulation, WgpuParticleSimulationOptions` | Import |
| `./wgpu-pipeline-cache.js` | `WgpuPipelineCache, WgpuPipelineDescriptor` | Import |
| `./wgpu-pipeline-memo.js` | `WgpuPipelineMemo, createPipelineRequest` | Import |
| `./wgpu-readback.js` | `readTexturePixels` | Import |
| `./wgpu-render-target.js` | `RENDER_TARGET_COLOR_FORMAT, WgpuRenderTargetCache, WgpuRenderTargetRecord` | Import |
| `./wgpu-standard.js` | `STANDARD_EMISSIVE_OFFSET, STANDARD_SURFACE_OFFSET, STANDARD_UNIFORM_BYTES, createStandardBindGroupLayout` | Import |
| `./wgpu-sprite.js` | `SPRITE_UNIFORM_BYTES, createSpriteBindGroupLayout` | Import |
| `./wgpu-shadow.js` | `SHADOW_LIGHT_UNIFORM_BYTES, SHADOW_MAP_BINDING, SHADOW_SAMPLER_BINDING, createShadowLightsBindGroupLayout, createShadowSampler, writeShadowUniforms` | Import |
| `./wgpu-stencil.js` | `CLEAR_STENCIL, applyStencilReference, frameWantsStencil, stencilDescriptor` | Import |
| `./wgpu-texture.js` | `WgpuTextureCache, WgpuCacheableTexture` | Import |
| `./wgpu-node-registry.js` | `resolveWebgpuNodeMaterialPipelineFactory, WgpuNodeFrameState, WgpuNodeMaterialPipelines` | Import |
| `./wgpu-picking-registry.js` | `resolvePickingServiceFactory, PickingRendererHost` | Import |
| `./wgpu-skinning-registry.js` | `resolveSkinningPipelineFactory, SkinnedPrograms, SkinningPipelineHost, WgpuSkinnedDrawDescriptor` | Import |
| `./wgpu-unlit.js` | `CLEAR_VERTEX_COUNT` | Import |

**Exports:**
- Classes: `WebgpuRenderer`
- Functions: `hostGpu`

---

<a id="packages-render-canvas-dependencies"></a>

## Packages/render canvas Dependencies

### `packages/render-canvas/src/index.ts` - Entry point exporting 1 symbols

**Exports:**
- Constants: `PACKAGE_NAME`

---

<a id="packages-motion-dependencies"></a>

## Packages/motion Dependencies

### `packages/motion/src/systems.ts` - Simulation systems and the priority registry (§39).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./clock.js` | `ReadonlyTimeState` | Import (type-only) |
| `./scheduler.js` | `Scheduler, SchedulerCallback` | Import (type-only) |

**Exports:**
- Classes: `SystemRegistry`
- Interfaces: `SimulationContext`, `FixedUpdateContext`, `SimulationSystem`
- Types: `Unregister`, `Detach`
- Constants: `PRIORITY_INPUT`, `PRIORITY_COMMANDS`, `PRIORITY_ANIMATION_TARGETS`, `PRIORITY_KINEMATICS`, `PRIORITY_FORCES`, `PRIORITY_PHYSICS_SOLVE`, `PRIORITY_CONSTRAINTS`, `PRIORITY_SENSOR_UPDATE`, `PRIORITY_EVENT_DISPATCH`, `PRIORITY_SNAPSHOT`, `PRIORITY_RENDER_INTERPOLATION`

---

### `packages/motion/src/ik.ts` - Analytic two-bone inverse kinematics (§111 "inverse kinematics"; plan P8-1).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3` |
| `@fourjs/scene` | `resolveWorldTransform, Node` |

**Exports:**
- Interfaces: `TwoBoneIKSolution`, `JointLimit`, `IKSolveOptions`, `IKSolveResult`
- Types: `IKChain`
- Functions: `createTwoBoneIKSolution`, `solveTwoBoneIK`, `solveCCD`, `solveFABRIK`
- Constants: `DEFAULT_IK_TOLERANCE`, `DEFAULT_IK_MAX_ITERATIONS`

---

### `packages/motion/src/capabilities.ts` - This package's §81 capability token (RFC 0002; declared here since

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `defineCapability` |
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./adapter.js` | `PhysicsSolverAdapter, PhysicsTuningCapabilities` | Import (type-only) |
| `./adapter.js` | `resolveTuningCapabilities` | Import |
| `./body-access.js` | `SolverBodyAccess, SolverBodyTuningAccess, SolverJointAccess` | Import (type-only) |
| `./body-access.js` | `missingSolverJointAccess, supportsSolverBodyTuning, supportsSolverJointAccess` | Import |
| `./collider.js` | `Collider` | Import |
| `./collider.js` | `ColliderTriggerEvent, RigidBodyCollisionEvent` | Import (type-only) |
| `./descriptors.js` | `PhysicsWorldOptions, RigidBodyDescriptor` | Import (type-only) |
| `./descriptors.js` | `resolveAngularVelocity, resolveGravity, resolveRotation, resolveSleepingConfig, widenToVector3` | Import |
| `./local-plane.js` | `planeToWorld, planeToWorldVec, resolveLocalPlane, worldToPlane, worldToPlaneVec, ResolvedLocalPlane` | Import |
| `./world-units.js` | `fromSiLength, fromSiMass, resolvePhysicsWorldUnits, toSiLength, toSiMass, PhysicsWorldUnits` | Import |
| `./events.js` | `JointBreakEvent, PhysicsEvent` | Import (type-only) |
| `./joints.js` | `Joint, JointBinding, JointBreakPayload` | Import (type-only) |
| `./joints.js` | `bindJoint, clearJointCommands, readJointAnchors, readJointLimits, readJointMotor, setJointBroken, unbindJoint, worldAnchorToLocal, worldAxisToLocal` | Import |
| `./queries.js` | `OverlapQuery, PointQuery, QueryOptions, RaycastQuery, ShapeCastQuery` | Import (type-only) |
| `./rigid-body.js` | `BlendWeights, RigidBodySleepEvent` | Import (type-only) |
| `./rigid-body.js` | `RIGID_BODY_CCD_DIRTY, RIGID_BODY_DAMPING_DIRTY, RIGID_BODY_GRAVITY_SCALE_DIRTY, RIGID_BODY_MASS_PROPERTIES_DIRTY, RigidBody, clearRigidBodyCommands, drainRigidBodySolverWrites, setRigidBodyDerivedMass, setRigidBodyRegistered, setRigidBodySleeping, setRigidBodyType` | Import |
| `./shapes.js` | `CollisionShape` | Import (type-only) |
| `./shapes.js` | `shapeMaximumExtent` | Import |
| `./solver-registry.js` | `SolverRegistry, SolverRejectionReport, SolverSelection` | Import (type-only) |
| `./solver-registry.js` | `resolveSolver` | Import |
| `./types.js` | `AngularVelocityInput, BodyType, DeterminismLevel, PhysicsBodyHandle, PhysicsColliderHandle, PhysicsDimension, PhysicsJointHandle, RotationInput, SleepingConfig, Vector3Input` | Import (type-only) |
| `./types.js` | `DEFAULT_DETERMINISM_LEVEL, DEFAULT_SLEEPING_CONFIG, DETERMINISM_LEVELS` | Import |
| `./validation.js` | `validateJointDescriptor, validateMass, validatePhysicsWorldOptions` | Import |
| `./resource-memory.js` | `noteSolverBody, noteSolverCollider, noteSolverJoint` | Import |

**Exports:**
- Classes: `PhysicsWorld`
- Interfaces: `PhysicsWorldInit`, `WorldQueryHit`, `WorldRaycastHit`, `WorldShapeCastHit`, `WorldPointHit`, `PhysicsSnapshot`, `PhysicsSnapshotConfiguration`, `BodyControlModeOptions`, `PoseTargetCaptureSystemOptions`
- Types: `PhysicsWorldAdapter`, `ActiveBodyVisitor`, `WorldOverlapHit`, `WorldPhysicsEvent`
- Functions: `createPoseTargetCaptureSystem`
- Constants: `POSE_TARGET_CAPTURE_PRIORITY`

---

<<<<<<< HEAD
<a id="packages-physics-box2d-dependencies"></a>

## Packages/physics box2d Dependencies

### `packages/physics-box2d/src/index.ts` - Entry point exporting 1 symbols

**Exports:**
- Constants: `PACKAGE_NAME`

---

<a id="packages-physics-rapier-dependencies"></a>

## Packages/physics rapier Dependencies

### `packages/physics-rapier/src/ccd.ts` - The §31 CCD-mode resolution both Rapier adapters share.
=======
### `packages/motion/src/character-controller.ts` - §12's **character controllers** — {@link CharacterController}, the one yaw

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Component, ComponentHost` |
| `@fourjs/scene` | `Transform` |

**Exports:**
- Classes: `CharacterController`, `FirstPersonLook`
- Interfaces: `CharacterControllerOptions`, `FirstPersonLookOptions`
- Constants: `DEFAULT_CHARACTER_GRAVITY`, `DEFAULT_FIRST_PERSON_PITCH_LIMIT`

---

### `packages/motion/src/clock.ts` - Clock and time domains (§9).

**Exports:**
- Interfaces: `TimeState`, `TimeStateOptions`
- Types: `ReadonlyTimeState`, `Clock`, `ReadonlyClock`
- Functions: `createTimeState`, `copyTimeState`, `assertFixedDeltaTime`, `assertTimeScale`
- Constants: `DEFAULT_FIXED_DELTA_TIME`, `DEFAULT_MAXIMUM_SUB_STEPS`

---

### `packages/motion/src/index.ts` - §81's motion-side capability token (RFC 0002), declared by the package that

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./capabilities.js` | `SIMULATION_SYSTEMS` | Re-export |
| `./camera-rigs.js` | `DEFAULT_ORBIT_PITCH_LIMIT, FollowRig, OrbitRig` | Re-export |
| `./camera-shake.js` | `CameraShake` | Re-export |
| `./character-controller.js` | `CharacterController, DEFAULT_CHARACTER_GRAVITY, DEFAULT_FIRST_PERSON_PITCH_LIMIT, FirstPersonLook` | Re-export |
| `./clock.js` | `DEFAULT_FIXED_DELTA_TIME, DEFAULT_MAXIMUM_SUB_STEPS, assertFixedDeltaTime, assertTimeScale, copyTimeState, createTimeState` | Re-export |
| `./constraints.js` | `ConstraintSystem, LookAtConstraint` | Re-export |
| `./ik.js` | `DEFAULT_IK_MAX_ITERATIONS, DEFAULT_IK_TOLERANCE, createTwoBoneIKSolution, solveCCD, solveFABRIK, solveTwoBoneIK` | Re-export |
| `./integrators.js` | `DEFAULT_INTEGRATOR, INTEGRATORS, explicitEuler, rk2, rk4, semiImplicitEuler, velocityVerlet` | Re-export |
| `./kinematic-controller.js` | `KINEMATIC_COMPLETION_TOLERANCE, KinematicController, KinematicSystem` | Re-export |
| `./motion-component.js` | `MotionComponent, MotionSystem` | Re-export |
| `./serializers.js` | `CHARACTER_CONTROLLER_SERIALIZER, FIRST_PERSON_LOOK_SERIALIZER, CAMERA_SHAKE_SERIALIZER, FOLLOW_RIG_SERIALIZER, KINEMATIC_CONTROLLER_SERIALIZER, LOOK_AT_CONSTRAINT_SERIALIZER, MOTION_COMPONENT_SERIALIZER, ORBIT_RIG_SERIALIZER` | Re-export |
| `./pid.js` | `DEFAULT_PID_OUTPUT_LIMITS, PIDController` | Re-export |
| `./prediction.js` | `ballisticApexHeight, ballisticTimeOfFlightToPlane, ballisticTimeToApex, interceptPoint, interceptTime, predictBallistic, predictLinear` | Re-export |
| `./random.js` | `SeededRandom` | Re-export |
| `./scheduler.js` | `Scheduler` | Re-export |
| `./spring-damper.js` | `SpringDamper` | Re-export |
| `./spatial-hash.js` | `SpatialHash` | Re-export |
| `./steering.js` | `SteeringAgent, WanderState, alignment, arrive, cohesion, evade, flee, pursue, seek, separation, truncate, wander, wanderSpherical` | Re-export |
| `./systems.js` | `PRIORITY_ANIMATION_TARGETS, PRIORITY_COMMANDS, PRIORITY_CONSTRAINTS, PRIORITY_EVENT_DISPATCH, PRIORITY_FORCES, PRIORITY_INPUT, PRIORITY_KINEMATICS, PRIORITY_PHYSICS_SOLVE, PRIORITY_RENDER_INTERPOLATION, PRIORITY_SENSOR_UPDATE, PRIORITY_SNAPSHOT, SystemRegistry` | Re-export |
| `./trajectories.js` | `BallisticTrajectory, CENTRAL_DIFFERENCE_STEP, CatmullRomTrajectory, CircularTrajectory, CubicBezierTrajectory, DEFAULT_BALLISTIC_ACCELERATION_Y, DampedSpringTrajectory, EllipticalTrajectory, LinearTrajectory, ParabolicTrajectory, ParametricTrajectory` | Re-export |
| `./camera-rigs.js` | `FollowFrame, FollowRigOptions, OrbitRigOptions` | Re-export (type-only) |
| `./camera-shake.js` | `CameraShakeOptions` | Re-export (type-only) |
| `./character-controller.js` | `CharacterControllerOptions, FirstPersonLookOptions` | Re-export (type-only) |
| `./clock.js` | `Clock, ReadonlyClock, ReadonlyTimeState, TimeState, TimeStateOptions` | Re-export (type-only) |
| `./constraints.js` | `ConstraintSystemOptions, LookAtConstraintOptions` | Re-export (type-only) |
| `./ik.js` | `IKChain, IKSolveOptions, IKSolveResult, JointLimit, TwoBoneIKSolution` | Re-export (type-only) |
| `./integrators.js` | `AccelerationFn, Integrator, IntegratorFn, IntegratorState` | Re-export (type-only) |
| `./kinematic-controller.js` | `KinematicSystemOptions, MoveOptions, PathFollowOptions, RotateOptions` | Re-export (type-only) |
| `./motion-component.js` | `MotionComponentOptions, MotionSystemOptions` | Re-export (type-only) |
| `./rig-target.js` | `RigTarget` | Re-export (type-only) |
| `./serializers.js` | `ComponentSerializerShape` | Re-export (type-only) |
| `./pid.js` | `PIDControllerOptions, PIDDerivativeSource` | Re-export (type-only) |
| `./prediction.js` | `InterceptTimeOptions` | Re-export (type-only) |
| `./scheduler.js` | `SchedulerCallback, SchedulerOptions` | Re-export (type-only) |
| `./spring-damper.js` | `SpringDamperCoefficientOptions, SpringDamperFrequencyOptions, SpringDamperOptions, SpringDamperResult, SpringDamperVector3Result` | Re-export (type-only) |
| `./spatial-hash.js` | `SpatialHashEntry, SpatialHashOptions` | Re-export (type-only) |
| `./steering.js` | `SteeringAgentOptions, SteeringContext, SteeringNeighbor, WanderStateOptions` | Re-export (type-only) |
| `./systems.js` | `Detach, FixedUpdateContext, SimulationContext, SimulationSystem, Unregister` | Re-export (type-only) |
| `./trajectories.js` | `BallisticTrajectoryOptions, CatmullRomTrajectoryOptions, CircularTrajectoryOptions, CubicBezierTrajectoryOptions, DampedSpringTrajectoryOptions, EllipticalTrajectoryOptions, LinearTrajectoryOptions, ParabolicTrajectoryOptions, ParametricTrajectoryOptions, Trajectory` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `SIMULATION_SYSTEMS`, `DEFAULT_ORBIT_PITCH_LIMIT`, `FollowRig`, `OrbitRig`, `CameraShake`, `CharacterController`, `DEFAULT_CHARACTER_GRAVITY`, `DEFAULT_FIRST_PERSON_PITCH_LIMIT`, `FirstPersonLook`, `DEFAULT_FIXED_DELTA_TIME`, `DEFAULT_MAXIMUM_SUB_STEPS`, `assertFixedDeltaTime`, `assertTimeScale`, `copyTimeState`, `createTimeState`, `ConstraintSystem`, `LookAtConstraint`, `DEFAULT_IK_MAX_ITERATIONS`, `DEFAULT_IK_TOLERANCE`, `createTwoBoneIKSolution`, `solveCCD`, `solveFABRIK`, `solveTwoBoneIK`, `DEFAULT_INTEGRATOR`, `INTEGRATORS`, `explicitEuler`, `rk2`, `rk4`, `semiImplicitEuler`, `velocityVerlet`, `KINEMATIC_COMPLETION_TOLERANCE`, `KinematicController`, `KinematicSystem`, `MotionComponent`, `MotionSystem`, `CHARACTER_CONTROLLER_SERIALIZER`, `FIRST_PERSON_LOOK_SERIALIZER`, `CAMERA_SHAKE_SERIALIZER`, `FOLLOW_RIG_SERIALIZER`, `KINEMATIC_CONTROLLER_SERIALIZER`, `LOOK_AT_CONSTRAINT_SERIALIZER`, `MOTION_COMPONENT_SERIALIZER`, `ORBIT_RIG_SERIALIZER`, `DEFAULT_PID_OUTPUT_LIMITS`, `PIDController`, `ballisticApexHeight`, `ballisticTimeOfFlightToPlane`, `ballisticTimeToApex`, `interceptPoint`, `interceptTime`, `predictBallistic`, `predictLinear`, `SeededRandom`, `Scheduler`, `SpringDamper`, `SpatialHash`, `SteeringAgent`, `WanderState`, `alignment`, `arrive`, `cohesion`, `evade`, `flee`, `pursue`, `seek`, `separation`, `truncate`, `wander`, `wanderSpherical`, `PRIORITY_ANIMATION_TARGETS`, `PRIORITY_COMMANDS`, `PRIORITY_CONSTRAINTS`, `PRIORITY_EVENT_DISPATCH`, `PRIORITY_FORCES`, `PRIORITY_INPUT`, `PRIORITY_KINEMATICS`, `PRIORITY_PHYSICS_SOLVE`, `PRIORITY_RENDER_INTERPOLATION`, `PRIORITY_SENSOR_UPDATE`, `PRIORITY_SNAPSHOT`, `SystemRegistry`, `BallisticTrajectory`, `CENTRAL_DIFFERENCE_STEP`, `CatmullRomTrajectory`, `CircularTrajectory`, `CubicBezierTrajectory`, `DEFAULT_BALLISTIC_ACCELERATION_Y`, `DampedSpringTrajectory`, `EllipticalTrajectory`, `LinearTrajectory`, `ParabolicTrajectory`, `ParametricTrajectory`, `FollowFrame`, `FollowRigOptions`, `OrbitRigOptions`, `CameraShakeOptions`, `CharacterControllerOptions`, `FirstPersonLookOptions`, `Clock`, `ReadonlyClock`, `ReadonlyTimeState`, `TimeState`, `TimeStateOptions`, `ConstraintSystemOptions`, `LookAtConstraintOptions`, `IKChain`, `IKSolveOptions`, `IKSolveResult`, `JointLimit`, `TwoBoneIKSolution`, `AccelerationFn`, `Integrator`, `IntegratorFn`, `IntegratorState`, `KinematicSystemOptions`, `MoveOptions`, `PathFollowOptions`, `RotateOptions`, `MotionComponentOptions`, `MotionSystemOptions`, `RigTarget`, `ComponentSerializerShape`, `PIDControllerOptions`, `PIDDerivativeSource`, `InterceptTimeOptions`, `SchedulerCallback`, `SchedulerOptions`, `SpringDamperCoefficientOptions`, `SpringDamperFrequencyOptions`, `SpringDamperOptions`, `SpringDamperResult`, `SpringDamperVector3Result`, `SpatialHashEntry`, `SpatialHashOptions`, `SteeringAgentOptions`, `SteeringContext`, `SteeringNeighbor`, `WanderStateOptions`, `Detach`, `FixedUpdateContext`, `SimulationContext`, `SimulationSystem`, `Unregister`, `BallisticTrajectoryOptions`, `CatmullRomTrajectoryOptions`, `CircularTrajectoryOptions`, `CubicBezierTrajectoryOptions`, `DampedSpringTrajectoryOptions`, `EllipticalTrajectoryOptions`, `LinearTrajectoryOptions`, `ParabolicTrajectoryOptions`, `ParametricTrajectoryOptions`, `Trajectory`

---

### `packages/motion/src/kinematic-controller.ts` - Kinematic motion (§12) — the {@link KinematicController} component and the
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/physics` | `DEFAULT_ENABLED_CCD_MODE` |
| `@fourjs/physics` | `CCDMode, RigidBodyDescriptor` |

**Exports:**
- Functions: `resolveCcdMode`

---

### `packages/physics-rapier/src/conversions2d.ts` - The §21/P5-3 mapping between the engine's 3D-typed physics API and Rapier's

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Quaternion, Vector3` |
| `@fourjs/physics` | `ALL_COLLISION_GROUPS, resolveAngularVelocity, resolveRotation` |
| `@fourjs/physics` | `AngularVelocityInput, BodyType, CollisionShape, RotationInput, Vector3Input` |
=======
| `@fourjs/core` | `FourError, Component, ComponentHost` |
| `@fourjs/math` | `Quaternion, Vector3` |
| `@fourjs/scene` | `warnAuthorityConflict, Node, Transform` |
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
<<<<<<< HEAD
| `./init.js` | `RAPIER_2D` | Import |
| `./init.js` | `RapierColliderDesc, RapierShape, RapierVector` | Import (type-only) |

**Exports:**
- Types: `RapierVector2`
- Functions: `createRapierVector2`, `toRapierVector2`, `fromRapierVector2`, `toRapierAngle`, `quaternionToAngleZ`, `fromRapierAngle`, `toRapierAngularScalar`, `toRapierBodyType`, `revoluteAxisSignZ`, `toRapierJointAxis2d`, `packInteractionGroups`, `createRapierShape`, `createRapierColliderDesc`, `requireHullDesc`

---

### `packages/physics-rapier/src/conversions3d.ts` - The §21/P5-3 mapping between the engine's 3D-typed physics API and Rapier's
=======
| `./character-controller.js` | `CharacterController, FirstPersonLook` | Import |
| `./systems.js` | `PRIORITY_KINEMATICS, FixedUpdateContext, SimulationSystem` | Import |
| `./trajectories.js` | `Trajectory` | Import (type-only) |

**Exports:**
- Classes: `KinematicController`, `KinematicSystem`
- Interfaces: `MoveOptions`, `RotateOptions`, `PathFollowOptions`, `KinematicSystemOptions`
- Constants: `KINEMATIC_COMPLETION_TOLERANCE`

---

### `packages/motion/src/scheduler.ts` - Fixed-step scheduler (§10).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./clock.js` | `DEFAULT_FIXED_DELTA_TIME, DEFAULT_MAXIMUM_SUB_STEPS, assertFixedDeltaTime, assertTimeScale, createTimeState, ReadonlyTimeState, TimeState` | Import |

**Exports:**
- Classes: `Scheduler`
- Interfaces: `SchedulerOptions`
- Types: `SchedulerCallback`

---

### `packages/motion/src/steering.ts` - Steering behaviours and flocking (§12 "steering behaviours", §111), plan
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Matrix3, Quaternion, Vector3` |
| `@fourjs/physics` | `ALL_COLLISION_GROUPS, resolveAngularVelocity, resolveRotation` |
| `@fourjs/physics` | `AngularVelocityInput, BodyType, CollisionShape, RotationInput, Vector3Input` |
=======
| `@fourjs/math` | `Vector3` |
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
<<<<<<< HEAD
| `./init.js` | `RAPIER_3D` | Import |
| `./init.js` | `RapierColliderDesc3d, RapierRotation3, RapierShape3d, RapierVector3` | Import (type-only) |
| `./init.js` | `RapierRotation3, RapierVector3` | Re-export (type-only) |

**Exports:**
- Functions: `createRapierVector3`, `createRapierRotation3`, `toRapierVector3`, `fromRapierVector3`, `toRapierRotation3`, `fromRapierRotation3`, `toRapierAngularVector3`, `toRapierBodyType3d`, `toPrincipalInertia3d`, `packInteractionGroups3d`, `createRapierShape3d`, `createRapierColliderDesc3d`, `requireHullDesc3d`, `rotateVectorByRotation3`
- Re-exports: `RapierRotation3`, `RapierVector3`

---

### `packages/physics-rapier/src/index.ts` - `@fourjs/physics-rapier` — the Rapier solver adapters (§37, §102, §108).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./conversions2d.js` | `createRapierColliderDesc, createRapierShape, createRapierVector2, fromRapierAngle, fromRapierVector2, packInteractionGroups, quaternionToAngleZ, revoluteAxisSignZ, toRapierAngle, toRapierAngularScalar, toRapierBodyType, toRapierJointAxis2d, toRapierVector2` | Re-export |
| `./conversions3d.js` | `createRapierColliderDesc3d, createRapierRotation3, createRapierShape3d, createRapierVector3, fromRapierRotation3, fromRapierVector3, packInteractionGroups3d, rotateVectorByRotation3, toPrincipalInertia3d, toRapierAngularVector3, toRapierBodyType3d, toRapierRotation3, toRapierVector3` | Re-export |
| `./init.js` | `initializeRapier2d, rapier2dModule, rapier2dVersion` | Re-export |
| `./init.js` | `initializeRapier3d, rapier3dModule, rapier3dVersion` | Re-export |
| `./register.js` | `createRapierAdapter, isRapierSupported, registerRapierSolver` | Re-export |
| `./rapier2d-adapter.js` | `Rapier2dAdapter` | Re-export |
| `./rapier3d-adapter.js` | `Rapier3dAdapter` | Re-export |
| `./conversions2d.js` | `RapierVector2` | Re-export (type-only) |
| `./conversions3d.js` | `RapierRotation3, RapierVector3` | Re-export (type-only) |
| `./init.js` | `Rapier2dModule, Rapier3dModule` | Re-export (type-only) |
| `./rapier2d-adapter.js` | `RapierBodyAccess` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `createRapierColliderDesc`, `createRapierShape`, `createRapierVector2`, `fromRapierAngle`, `fromRapierVector2`, `packInteractionGroups`, `quaternionToAngleZ`, `revoluteAxisSignZ`, `toRapierAngle`, `toRapierAngularScalar`, `toRapierBodyType`, `toRapierJointAxis2d`, `toRapierVector2`, `createRapierColliderDesc3d`, `createRapierRotation3`, `createRapierShape3d`, `createRapierVector3`, `fromRapierRotation3`, `fromRapierVector3`, `packInteractionGroups3d`, `rotateVectorByRotation3`, `toPrincipalInertia3d`, `toRapierAngularVector3`, `toRapierBodyType3d`, `toRapierRotation3`, `toRapierVector3`, `initializeRapier2d`, `rapier2dModule`, `rapier2dVersion`, `initializeRapier3d`, `rapier3dModule`, `rapier3dVersion`, `createRapierAdapter`, `isRapierSupported`, `registerRapierSolver`, `Rapier2dAdapter`, `Rapier3dAdapter`, `RapierVector2`, `RapierRotation3`, `RapierVector3`, `Rapier2dModule`, `Rapier3dModule`, `RapierBodyAccess`

---

### `packages/physics-rapier/src/init.ts` - Shared loading of the Rapier WebAssembly modules, and the typed view of them

**External Dependencies:**
| Package | Import |
|---------|--------|
| `@dimforge/rapier2d-compat` | `RAPIER2D` |
| `@dimforge/rapier3d-compat` | `RAPIER3D` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `@dimforge/rapier2d-compat` | `Vector` | Re-export (type-only) |
| `@dimforge/rapier2d-compat` | `Shape` | Re-export (type-only) |
| `@dimforge/rapier2d-compat` | `RigidBody` | Re-export (type-only) |
| `@dimforge/rapier2d-compat` | `RigidBodyDesc` | Re-export (type-only) |
| `@dimforge/rapier2d-compat` | `Collider` | Re-export (type-only) |
| `@dimforge/rapier2d-compat` | `ColliderDesc` | Re-export (type-only) |
| `@dimforge/rapier2d-compat` | `JointData` | Re-export (type-only) |
| `@dimforge/rapier2d-compat` | `ImpulseJoint` | Re-export (type-only) |
| `@dimforge/rapier2d-compat` | `UnitImpulseJoint` | Re-export (type-only) |
| `@dimforge/rapier2d-compat` | `EventQueue` | Re-export (type-only) |
| `@dimforge/rapier2d-compat` | `World` | Re-export (type-only) |
| `@dimforge/rapier3d-compat` | `Vector` | Re-export (type-only) |
| `@dimforge/rapier3d-compat` | `Rotation` | Re-export (type-only) |
| `@dimforge/rapier3d-compat` | `Shape` | Re-export (type-only) |
| `@dimforge/rapier3d-compat` | `RigidBody` | Re-export (type-only) |
| `@dimforge/rapier3d-compat` | `RigidBodyDesc` | Re-export (type-only) |
| `@dimforge/rapier3d-compat` | `Collider` | Re-export (type-only) |
| `@dimforge/rapier3d-compat` | `ColliderDesc` | Re-export (type-only) |
| `@dimforge/rapier3d-compat` | `EventQueue` | Re-export (type-only) |
| `@dimforge/rapier3d-compat` | `World` | Re-export (type-only) |

**Exports:**
- Types: `Rapier2dModule`, `Rapier3dModule`
- Functions: `initializeRapier2d`, `rapier2dModule`, `rapier2dVersion`, `initializeRapier3d`, `rapier3dModule`, `rapier3dVersion`
- Constants: `RAPIER_2D`, `RAPIER_3D`
- Re-exports: `Vector`, `Shape`, `RigidBody`, `RigidBodyDesc`, `Collider`, `ColliderDesc`, `JointData`, `ImpulseJoint`, `UnitImpulseJoint`, `EventQueue`, `World`, `Rotation`

---

### `packages/physics-rapier/src/rapier2d-adapter.ts` - The Rapier 2D solver adapter (§37, §102, plan WP-5.4).
=======
| `./prediction.js` | `interceptTime` | Import |
| `./random.js` | `SeededRandom` | Import (type-only) |

**Exports:**
- Classes: `WanderState`, `SteeringAgent`
- Interfaces: `SteeringNeighbor`, `SteeringContext`, `WanderStateOptions`, `SteeringAgentOptions`
- Functions: `truncate`, `seek`, `flee`, `arrive`, `pursue`, `evade`, `wander`, `wanderSpherical`, `separation`, `cohesion`, `alignment`

---

### `packages/motion/src/serializers.ts` - The §79 serializers for this package's components (PH-17, 2026-08-06;
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Quaternion, Vector3` |
| `@fourjs/math` | `Matrix3` |
| `@fourjs/physics` | `ALL_COLLISION_GROUPS, DEFAULT_FRICTION, DEFAULT_RESTITUTION, DETERMINISM_LEVELS, passesQueryFilter, resolveDensity, resolveGravity, resolveQueryOptions, resolveSleepingConfig, sortHitsByDistance, validateColliderDescriptor, validateJointDescriptor, validatePhysicsWorldOptions, validateQueryShape, validateRigidBodyDescriptor, rejectStalePhysicsHandle` |
| `@fourjs/physics` | `AngularVelocityInput, BodyType, CCDMode, ColliderDescriptor, ContactPoint, JointDescriptor, ShippedJointType, SolverBodyTuningAccess, SolverJointAccess, SolverJointMotor, OverlapHit, OverlapQuery, PhysicsBodyHandle, PhysicsCapabilities, PhysicsColliderHandle, PhysicsDimension, PhysicsEvent, PhysicsJointHandle, PhysicsSolverAdapter, PhysicsWorldOptions, PointHit, PointQuery, QueryCandidate, RaycastHit, RaycastQuery, ResolvedQueryOptions, RigidBodyDescriptor, RotationInput, ShapeCastHit, ShapeCastQuery, SleepingConfig, Vector3Input` |
=======
| `@fourjs/core` | `JsonValue` |
| `@fourjs/math` | `Vector3` |
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
<<<<<<< HEAD
| `./ccd.js` | `resolveCcdMode` | Import |
| `./conversions2d.js` | `createRapierColliderDesc, createRapierShape, createRapierVector2, fromRapierAngle, fromRapierVector2, packInteractionGroups, revoluteAxisSignZ, toRapierAngle, toRapierAngularScalar, toRapierBodyType, toRapierJointAxis2d, toRapierVector2` | Import |
| `./conversions2d.js` | `RapierVector2` | Import (type-only) |
| `./init.js` | `initializeRapier2d` | Import |
| `./init.js` | `Rapier2dModule, RapierCollider, RapierColliderDesc, RapierEventQueue, RapierImpulseJoint, RapierJointData, RapierRigidBody, RapierRigidBodyDesc, RapierUnitImpulseJoint, RapierWorld` | Import (type-only) |

**Exports:**
- Classes: `Rapier2dAdapter`
- Interfaces: `RapierBodyAccess`

---

### `packages/physics-rapier/src/rapier3d-adapter.ts` - The Rapier 3D solver adapter (§37, §102, plan WP-5.5).
=======
| `./camera-rigs.js` | `DEFAULT_ORBIT_MIN_DISTANCE, DEFAULT_ORBIT_PITCH_LIMIT, FollowRig, OrbitRig` | Import |
| `./camera-shake.js` | `CameraShake` | Import |
| `./character-controller.js` | `CharacterController, DEFAULT_CHARACTER_GRAVITY, DEFAULT_FIRST_PERSON_PITCH_LIMIT, FirstPersonLook` | Import |
| `./constraints.js` | `LookAtConstraint` | Import |
| `./kinematic-controller.js` | `KinematicController` | Import |
| `./motion-component.js` | `MotionComponent` | Import |
| `./rig-target.js` | `RigTarget` | Import (type-only) |
| `./spring-damper.js` | `SpringDamper` | Import |

**Exports:**
- Interfaces: `ComponentSerializerShape`
- Constants: `MOTION_COMPONENT_SERIALIZER`, `KINEMATIC_CONTROLLER_SERIALIZER`, `ORBIT_RIG_SERIALIZER`, `FOLLOW_RIG_SERIALIZER`, `LOOK_AT_CONSTRAINT_SERIALIZER`, `CHARACTER_CONTROLLER_SERIALIZER`, `FIRST_PERSON_LOOK_SERIALIZER`, `CAMERA_SHAKE_SERIALIZER`

---

### `packages/motion/src/spatial-hash.ts` - Uniform-grid spatial hash for radius neighbour queries (§12 flocking, §36

**Exports:**
- Classes: `SpatialHash`
- Interfaces: `SpatialHashOptions`, `SpatialHashEntry`

---

### `packages/motion/src/rig-target.ts` - What a rig aims at, and how a rig writes a world-space placement back onto a
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Quaternion, Vector3` |
| `@fourjs/math` | `Matrix3` |
| `@fourjs/physics` | `ALL_COLLISION_GROUPS, DEFAULT_FRICTION, DEFAULT_RESTITUTION, DETERMINISM_LEVELS, passesQueryFilter, resolveDensity, resolveGravity, resolveQueryOptions, resolveSleepingConfig, sortHitsByDistance, validateColliderDescriptor, validateJointDescriptor, validatePhysicsWorldOptions, validateQueryShape, validateRigidBodyDescriptor, rejectStalePhysicsHandle` |
| `@fourjs/physics` | `AngularVelocityInput, BodyType, CCDMode, ColliderDescriptor, ContactPoint, JointDescriptor, OverlapHit, OverlapQuery, PhysicsBodyHandle, PhysicsCapabilities, PhysicsColliderHandle, PhysicsDimension, PhysicsEvent, PhysicsJointHandle, PhysicsSolverAdapter, PhysicsWorldOptions, PointHit, PointQuery, QueryCandidate, RaycastHit, RaycastQuery, ResolvedQueryOptions, RigidBodyDescriptor, RotationInput, ShapeCastHit, ShapeCastQuery, ShippedJointType, SleepingConfig, SolverBodyTuningAccess, SolverJointAccess, SolverJointMotor, Vector3Input` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./ccd.js` | `resolveCcdMode` | Import |
| `./conversions3d.js` | `createRapierColliderDesc3d, createRapierRotation3, createRapierShape3d, createRapierVector3, fromRapierRotation3, fromRapierVector3, packInteractionGroups3d, rotateVectorByRotation3, toPrincipalInertia3d, toRapierAngularVector3, toRapierBodyType3d, toRapierRotation3, toRapierVector3` | Import |
| `./init.js` | `initializeRapier3d` | Import |
| `./init.js` | `Rapier3dModule, RapierCollider3d, RapierColliderDesc3d, RapierEventQueue3d, RapierRigidBody3d, RapierRigidBodyDesc3d, RapierRotation3, RapierVector3, RapierWorld3d` | Import (type-only) |
| `./rapier2d-adapter.js` | `RapierBodyAccess` | Import (type-only) |

**Exports:**
- Classes: `Rapier3dAdapter`

---

### `packages/physics-rapier/src/register.ts` - This package's opt-in to §37's solver registry (PH-19).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/physics` | `registerSolver, PhysicsWorldAdapter, PhysicsWorldOptions, SolverRegistry` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./rapier2d-adapter.js` | `Rapier2dAdapter` | Import |
| `./rapier3d-adapter.js` | `Rapier3dAdapter` | Import |

**Exports:**
- Functions: `isRapierSupported`, `createRapierAdapter`, `registerRapierSolver`

---

<a id="packages-physics-soft-dependencies"></a>

## Packages/physics soft Dependencies

### `packages/physics-soft/src/index.ts` - Entry point exporting 1 symbols

**Exports:**
- Constants: `PACKAGE_NAME`

---

<a id="packages-render-dependencies"></a>

## Packages/render Dependencies

### `packages/render/src/batch.ts` - §65 batching — merging consecutive compatible draws into one (R-9,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/geometry` | `BufferGeometry` |
| `@fourjs/materials` | `MaterialTexture, SpriteMaterial, UnlitMaterial` |
| `@fourjs/math` | `ColorRGBA` |
| `@fourjs/scene` | `ALL_LAYERS, LayerMask` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./clip.js` | `RenderItemClip` | Import (type-only) |
| `./scissor.js` | `scissorsEqual, ScissorRect` | Import |
| `./render-list.js` | `RenderItem, SpriteRenderItem, UnlitRenderItem` | Import (type-only) |

**Exports:**
- Classes: `RenderBatcher`
- Interfaces: `RenderBatchOptions`, `RenderBatch`
- Types: `BatchableMaterial`, `BatchableItem`
- Constants: `DEFAULT_MAX_BATCH_VERTICES`

---

### `packages/render/src/bounds.ts` - World-space bounds of a drawable (§87) — the substrate a frustum test needs.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/geometry` | `BufferGeometry` |
| `@fourjs/math` | `Matrix4, Vector3` |

**Exports:**
- Interfaces: `BoundingSphere`
- Functions: `computeWorldBoundingSphere`, `computeWorldBoundingSphereFromBox`

---

### `packages/render/src/capabilities.ts` - This package's §81 capability tokens (RFC 0002; declared here since
=======
| `@fourjs/math` | `Matrix4, Vector3` |
| `@fourjs/scene` | `resolveWorldTransform, Node` |

**Exports:**
- Types: `RigTarget`
- Functions: `resolveTargetPosition`, `worldPositionOf`, `placeAtWorldPosition`

---

### `packages/motion/src/camera-rigs.ts` - §44 camera rigs: {@link OrbitRig} (orbit) and {@link FollowRig} (follow target

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Component, ComponentHost` |
| `@fourjs/math` | `Vector3` |
| `@fourjs/scene` | `resolveWorldTransform, Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./rig-target.js` | `placeAtWorldPosition, resolveTargetPosition, worldPositionOf, RigTarget` | Import |
| `./spring-damper.js` | `SpringDamper, SpringDamperVector3Result` | Import (type-only) |

**Exports:**
- Classes: `OrbitRig`, `FollowRig`
- Interfaces: `OrbitRigOptions`, `FollowRigOptions`
- Types: `FollowFrame`
- Constants: `DEFAULT_ORBIT_PITCH_LIMIT`, `DEFAULT_ORBIT_MIN_DISTANCE`

---

### `packages/motion/src/integrators.ts` - Numerical integrators (§38).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3` |

**Exports:**
- Types: `Integrator`, `IntegratorState`, `AccelerationFn`, `IntegratorFn`
- Constants: `explicitEuler`, `semiImplicitEuler`, `velocityVerlet`, `rk2`, `rk4`, `INTEGRATORS`, `DEFAULT_INTEGRATOR`

---

### `packages/motion/src/spring-damper.ts` - Spring-damper controller (§111), the game-smoothing primitive.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3` |

**Exports:**
- Classes: `SpringDamper`
- Interfaces: `SpringDamperCoefficientOptions`, `SpringDamperFrequencyOptions`, `SpringDamperResult`, `SpringDamperVector3Result`
- Types: `SpringDamperOptions`

---

### `packages/motion/src/random.ts` - `SeededRandom`'s original home (WP-8.2), now a re-export of `@fourjs/core`.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `SeededRandom` |

**Exports:**
- Re-exports: `SeededRandom`

---

### `packages/motion/src/constraints.ts` - §12's look-at constraint and the §39 step-7 system that runs it, together

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError, Component, ComponentHost` |
| `@fourjs/math` | `Quaternion, Vector3` |
| `@fourjs/scene` | `resolveWorldTransform, warnAuthorityConflict, Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./camera-rigs.js` | `FollowRig, OrbitRig` | Import |
| `./camera-shake.js` | `CameraShake` | Import |
| `./rig-target.js` | `resolveTargetPosition, RigTarget` | Import |
| `./systems.js` | `PRIORITY_CONSTRAINTS, FixedUpdateContext, SimulationSystem` | Import |

**Exports:**
- Classes: `LookAtConstraint`, `ConstraintSystem`
- Interfaces: `LookAtConstraintOptions`, `ConstraintSystemOptions`

---

### `packages/motion/src/camera-shake.ts` - §44 camera shake: an additive pose offset driven by interpolated value

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Component, ComponentHost` |
| `@fourjs/math` | `Quaternion, Vector3` |
| `@fourjs/scene` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./random.js` | `SeededRandom` | Import |
| `./rig-target.js` | `placeAtWorldPosition, worldPositionOf` | Import |

**Exports:**
- Classes: `CameraShake`
- Interfaces: `CameraShakeOptions`

---

### `packages/motion/src/motion-component.ts` - `MotionComponent` (§11) and the system that advances it (§39 step 4).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError, Component, ComponentHost` |
| `@fourjs/math` | `Quaternion, Vector3` |
| `@fourjs/scene` | `warnAuthorityConflict, Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./systems.js` | `PRIORITY_KINEMATICS, FixedUpdateContext, SimulationSystem` | Import |

**Exports:**
- Classes: `MotionComponent`, `MotionSystem`
- Interfaces: `MotionComponentOptions`, `MotionSystemOptions`

---

### `packages/motion/src/prediction.ts` - Trajectory prediction (§111 "trajectory prediction"; plan P8-1).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3` |

**Exports:**
- Interfaces: `InterceptTimeOptions`
- Functions: `predictBallistic`, `predictLinear`, `ballisticTimeToApex`, `ballisticApexHeight`, `ballisticTimeOfFlightToPlane`, `interceptTime`, `interceptPoint`

---

### `packages/motion/src/trajectories.ts` - Trajectory system (§13).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector3` |

**Exports:**
- Classes: `LinearTrajectory`, `ParabolicTrajectory`, `BallisticTrajectory`, `CircularTrajectory`, `EllipticalTrajectory`, `CubicBezierTrajectory`, `CatmullRomTrajectory`, `DampedSpringTrajectory`, `ParametricTrajectory`
- Interfaces: `Trajectory`, `LinearTrajectoryOptions`, `ParabolicTrajectoryOptions`, `BallisticTrajectoryOptions`, `CircularTrajectoryOptions`, `EllipticalTrajectoryOptions`, `CubicBezierTrajectoryOptions`, `CatmullRomTrajectoryOptions`, `DampedSpringTrajectoryOptions`, `ParametricTrajectoryOptions`
- Constants: `CENTRAL_DIFFERENCE_STEP`, `DEFAULT_BALLISTIC_ACCELERATION_Y`

---

### `packages/motion/src/pid.ts` - PID controller utility (§111).

**Exports:**
- Classes: `PIDController`
- Interfaces: `PIDControllerOptions`
- Types: `PIDDerivativeSource`
- Constants: `DEFAULT_PID_OUTPUT_LIMITS`

---

<a id="packages-animation-dependencies"></a>

## Packages/animation Dependencies

### `packages/animation/src/tween.ts` - Tweens (§15).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV_WARNING_PREFIX, FourError` |
| `@fourjs/math` | `Quaternion, Vector2, Vector3, Vector4` |
| `@fourjs/scene` | `Node, warnAuthorityConflict` |
| `@fourjs/scene` | `TransformAuthority` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./binding.js` | `createBinding, PropertyBinding` | Import |
| `./easing.js` | `resolveEasing, EasingFunction, EasingName` | Import |
| `./values.js` | `detectAdapter, ColorRGBA, ValueAdapter` | Import |

**Exports:**
- Classes: `Tween`
- Interfaces: `TweenProperties`, `PropertyClaim`
- Types: `TweenValue`, `TweenState`
- Functions: `claimProperty`, `releaseProperty`, `requireNonNegativeSeconds`, `isTransformOwner`, `animate`, `tween`

---

### `packages/animation/src/timeline.ts` - Timelines (§16).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./tween.js` | `requireNonNegativeSeconds` | Import |

**Exports:**
- Classes: `Timeline`
- Interfaces: `TimelineMarkerOptions`, `TimelineChild`
- Types: `TimelineState`, `TimelineMarkerCallback`, `TimelineEntry`

---

### `packages/animation/src/animation-system.ts` - The fixed-step animation system (§39 step 3, plan decision P4-1).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/motion` | `PRIORITY_ANIMATION_TARGETS, FixedUpdateContext, SimulationSystem` |

**Exports:**
- Classes: `AnimationSystem`
- Interfaces: `Advanceable`, `AnimationSystemOptions`
- Types: `AnimationPlaybackState`

---

### `packages/animation/src/index.ts` - `@fourjs/animation` — the public surface of the animation pillar (Part III).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./animation-system.js` | `AnimationSystem` | Re-export |
| `./binding.js` | `createArrayElementBinding, createBinding` | Re-export |
| `./clip.js` | `AnimationClip` | Re-export |
| `./blend-tree.js` | `isBlendTree` | Re-export |
| `./controller.js` | `ANY_STATE, AnimationController` | Re-export |
| `./layer-stack.js` | `AnimationLayerStack` | Re-export |
| `./easing.js` | `BACK_OVERSHOOT, BACK_OVERSHOOT_IN_OUT, BOUNCE_AMPLITUDE, BOUNCE_SEGMENT_DIVISOR, EASINGS, EASING_NAMES, ELASTIC_AMPLITUDE, ELASTIC_PERIOD, ELASTIC_PERIOD_IN_OUT, SPRING_DAMPING_RATIO, SPRING_OSCILLATIONS, backIn, backInOut, backOut, bounceIn, bounceInOut, bounceOut, circularIn, circularInOut, circularOut, cubicIn, cubicInOut, cubicOut, elasticIn, elasticInOut, elasticOut, exponentialIn, exponentialInOut, exponentialOut, linear, quadraticIn, quadraticInOut, quadraticOut, quarticIn, quarticInOut, quarticOut, quinticIn, quinticInOut, quinticOut, resolveEasing, sineIn, sineInOut, sineOut, springIn, springInOut, springOut` | Re-export |
| `./mixer.js` | `AnimationMixer` | Re-export |
| `./timeline.js` | `Timeline` | Re-export |
| `./track.js` | `AnimationTrack` | Re-export |
| `./tween.js` | `Tween, animate, tween` | Re-export |
| `./when.js` | `compileWhenExpression` | Re-export |
| `./values.js` | `booleanAdapter, colorAdapter, detectAdapter, discreteAdapter, discreteAdapterFor, numberAdapter, quaternionAdapter, vector2Adapter, vector3Adapter, vector4Adapter` | Re-export |
| `./animation-system.js` | `Advanceable, AnimationPlaybackState, AnimationSystemOptions` | Re-export (type-only) |
| `./binding.js` | `PropertyBinding` | Re-export (type-only) |
| `./clip.js` | `AnimationClipOptions, AnimationEvent, AnimationEventVisitor, TrackSampleSink` | Re-export (type-only) |
| `./blend-tree.js` | `BlendTree, BlendTree1D, BlendTree1DPoint, BlendTree2D, BlendTree2DPoint` | Re-export (type-only) |
| `./controller.js` | `AnimationControllerOptions, AnimationControllerParameters, AnimationStateInput, AnimationStateOptions, AnimationTransition, BooleanCondition, ControllerAdvanceOptions, ControllerPlaybackState, NumericComparison, NumericCondition, StateChangeListener, TransitionCondition, TransitionWhen, TriggerCondition` | Re-export (type-only) |
| `./layer-stack.js` | `AnimationLayer, AnimationLayerStackOptions` | Re-export (type-only) |
| `./easing.js` | `EasingFunction, EasingName` | Re-export (type-only) |
| `./mixer.js` | `AnimationEventListener, MixerPlayOptions, MixerRootMotionOptions, MixerState` | Re-export (type-only) |
| `./timeline.js` | `TimelineChild, TimelineEntry, TimelineMarkerCallback, TimelineMarkerOptions, TimelineState` | Re-export (type-only) |
| `./track.js` | `AnimationTrackLike, AnimationTrackOptions, InterpolationMode` | Re-export (type-only) |
| `./tween.js` | `TweenProperties, TweenState, TweenValue` | Re-export (type-only) |
| `./when.js` | `WhenParameterLookup` | Re-export (type-only) |
| `./values.js` | `ColorRGBA, ValueAdapter, ValueKind` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `AnimationSystem`, `createArrayElementBinding`, `createBinding`, `AnimationClip`, `isBlendTree`, `ANY_STATE`, `AnimationController`, `AnimationLayerStack`, `BACK_OVERSHOOT`, `BACK_OVERSHOOT_IN_OUT`, `BOUNCE_AMPLITUDE`, `BOUNCE_SEGMENT_DIVISOR`, `EASINGS`, `EASING_NAMES`, `ELASTIC_AMPLITUDE`, `ELASTIC_PERIOD`, `ELASTIC_PERIOD_IN_OUT`, `SPRING_DAMPING_RATIO`, `SPRING_OSCILLATIONS`, `backIn`, `backInOut`, `backOut`, `bounceIn`, `bounceInOut`, `bounceOut`, `circularIn`, `circularInOut`, `circularOut`, `cubicIn`, `cubicInOut`, `cubicOut`, `elasticIn`, `elasticInOut`, `elasticOut`, `exponentialIn`, `exponentialInOut`, `exponentialOut`, `linear`, `quadraticIn`, `quadraticInOut`, `quadraticOut`, `quarticIn`, `quarticInOut`, `quarticOut`, `quinticIn`, `quinticInOut`, `quinticOut`, `resolveEasing`, `sineIn`, `sineInOut`, `sineOut`, `springIn`, `springInOut`, `springOut`, `AnimationMixer`, `Timeline`, `AnimationTrack`, `Tween`, `animate`, `tween`, `compileWhenExpression`, `booleanAdapter`, `colorAdapter`, `detectAdapter`, `discreteAdapter`, `discreteAdapterFor`, `numberAdapter`, `quaternionAdapter`, `vector2Adapter`, `vector3Adapter`, `vector4Adapter`, `Advanceable`, `AnimationPlaybackState`, `AnimationSystemOptions`, `PropertyBinding`, `AnimationClipOptions`, `AnimationEvent`, `AnimationEventVisitor`, `TrackSampleSink`, `BlendTree`, `BlendTree1D`, `BlendTree1DPoint`, `BlendTree2D`, `BlendTree2DPoint`, `AnimationControllerOptions`, `AnimationControllerParameters`, `AnimationStateInput`, `AnimationStateOptions`, `AnimationTransition`, `BooleanCondition`, `ControllerAdvanceOptions`, `ControllerPlaybackState`, `NumericComparison`, `NumericCondition`, `StateChangeListener`, `TransitionCondition`, `TransitionWhen`, `TriggerCondition`, `AnimationLayer`, `AnimationLayerStackOptions`, `EasingFunction`, `EasingName`, `AnimationEventListener`, `MixerPlayOptions`, `MixerRootMotionOptions`, `MixerState`, `TimelineChild`, `TimelineEntry`, `TimelineMarkerCallback`, `TimelineMarkerOptions`, `TimelineState`, `AnimationTrackLike`, `AnimationTrackOptions`, `InterpolationMode`, `TweenProperties`, `TweenState`, `TweenValue`, `WhenParameterLookup`, `ColorRGBA`, `ValueAdapter`, `ValueKind`

---

### `packages/animation/src/when.ts` - Optional `when` string sugar for {@link ./controller.js#AnimationTransition}

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./controller.js` | `NumericComparison, TransitionCondition` | Import (type-only) |

**Exports:**
- Interfaces: `WhenParameterLookup`
- Functions: `compileWhenExpression`

---

### `packages/animation/src/track.ts` - Animation tracks (§17).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Vector2, Vector3, Vector4` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./values.js` | `ColorRGBA, ValueAdapter, ValueKind` | Import (type-only) |

**Exports:**
- Classes: `AnimationTrack`
- Interfaces: `AnimationTrackOptions`, `AnimationTrackLike`
- Types: `InterpolationMode`

---

### `packages/animation/src/binding.ts` - Property bindings (§16).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./values.js` | `detectAdapter, numberAdapter, ValueAdapter` | Import |

**Exports:**
- Interfaces: `PropertyBinding`
- Functions: `createBinding`, `createArrayElementBinding`

---

### `packages/animation/src/mixer.ts` - The clip player (§17 clips, §16 playback semantics, §107 "playback controls").

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Quaternion, Vector3` |
| `@fourjs/scene` | `Node, warnAuthorityConflict` |
| `@fourjs/scene` | `TransformAuthority` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./binding.js` | `createBinding, PropertyBinding` | Import |
| `./clip.js` | `AnimationClip, AnimationEvent, TrackSampleSink` | Import (type-only) |
| `./track.js` | `AnimationTrackLike` | Import (type-only) |
| `./tween.js` | `claimProperty, isTransformOwner, releaseProperty, requireNonNegativeSeconds, PropertyClaim` | Import |
| `./values.js` | `detectAdapter, ValueAdapter` | Import |

**Exports:**
- Classes: `AnimationMixer`
- Interfaces: `MixerRootMotionOptions`, `MixerPlayOptions`
- Types: `MixerState`, `AnimationEventListener`

---

### `packages/animation/src/blend-tree.ts` - Blend trees for {@link ./controller.js#AnimationController} (PH-9, §18).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./clip.js` | `AnimationClip` | Import (type-only) |

**Exports:**
- Interfaces: `BlendTree1DPoint`, `BlendTree2DPoint`, `BlendTree1D`, `BlendTree2D`, `Blend2DRank`
- Types: `BlendTree`
- Functions: `isBlendTree`, `locateBlend1D`, `locateBlend2D`

---

### `packages/animation/src/values.ts` - Value adapters (§16 property bindings, §17 track value types).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Quaternion, Vector2, Vector3, Vector4, ColorRGBA` |
| `@fourjs/math` | `ColorRGBA` |

**Exports:**
- Interfaces: `ValueAdapter`
- Types: `ValueKind`
- Functions: `discreteAdapterFor`, `detectAdapter`
- Constants: `numberAdapter`, `vector2Adapter`, `vector3Adapter`, `vector4Adapter`, `quaternionAdapter`, `colorAdapter`, `booleanAdapter`, `discreteAdapter`
- Re-exports: `ColorRGBA`

---

### `packages/animation/src/controller.ts` - §18 animation state machines — {@link AnimationController}.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/scene` | `Node, warnAuthorityConflict` |
| `@fourjs/scene` | `TransformAuthority` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./animation-system.js` | `Advanceable` | Import (type-only) |
| `./blend-tree.js` | `isBlendTree, locateBlend1D, locateBlend2D, Blend2DRank, BlendTree` | Import |
| `./binding.js` | `createBinding, PropertyBinding` | Import |
| `./clip.js` | `AnimationClip` | Import |
| `./mixer.js` | `AnimationEventListener` | Import (type-only) |
| `./track.js` | `AnimationTrackLike` | Import (type-only) |
| `./tween.js` | `claimProperty, isTransformOwner, releaseProperty, requireNonNegativeSeconds, PropertyClaim` | Import |
| `./values.js` | `detectAdapter, ValueAdapter` | Import |
| `./when.js` | `compileWhenExpression` | Import |
| `./blend-tree.js` | `BlendTree, BlendTree1D, BlendTree2D, BlendTree1DPoint, BlendTree2DPoint` | Re-export (type-only) |

**Exports:**
- Classes: `AnimationController`
- Interfaces: `AnimationStateOptions`, `NumericCondition`, `BooleanCondition`, `TriggerCondition`, `AnimationTransition`, `AnimationControllerParameters`, `AnimationControllerOptions`, `ControllerAdvanceOptions`
- Types: `ControllerPlaybackState`, `AnimationStateInput`, `NumericComparison`, `TransitionCondition`, `TransitionWhen`, `StateChangeListener`
- Constants: `ANY_STATE`
- Re-exports: `BlendTree`, `BlendTree1D`, `BlendTree2D`, `BlendTree1DPoint`, `BlendTree2DPoint`

---

### `packages/animation/src/clip.ts` - Animation clips (§17).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./track.js` | `AnimationTrackLike` | Import (type-only) |

**Exports:**
- Classes: `AnimationClip`
- Interfaces: `AnimationEvent`, `TrackSampleSink`, `AnimationClipOptions`
- Types: `AnimationEventVisitor`

---

### `packages/animation/src/layer-stack.ts` - Layered / additive animation (PH-9, §18, §100).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/scene` | `Node, warnAuthorityConflict` |
| `@fourjs/scene` | `TransformAuthority` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./animation-system.js` | `Advanceable` | Import (type-only) |
| `./binding.js` | `createBinding, PropertyBinding` | Import |
| `./controller.js` | `AnimationController, ControllerPlaybackState` | Import (type-only) |
| `./tween.js` | `claimProperty, isTransformOwner, releaseProperty, requireNonNegativeSeconds, PropertyClaim` | Import |
| `./values.js` | `detectAdapter, ValueAdapter` | Import |

**Exports:**
- Classes: `AnimationLayerStack`
- Interfaces: `AnimationLayer`, `AnimationLayerStackOptions`

---

### `packages/animation/src/easing.ts` - Easing functions (§15).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Exports:**
- Types: `EasingFunction`, `EasingName`
- Functions: `resolveEasing`
- Constants: `BACK_OVERSHOOT`, `BACK_OVERSHOOT_IN_OUT`, `BOUNCE_AMPLITUDE`, `BOUNCE_SEGMENT_DIVISOR`, `ELASTIC_AMPLITUDE`, `ELASTIC_PERIOD`, `ELASTIC_PERIOD_IN_OUT`, `SPRING_DAMPING_RATIO`, `SPRING_OSCILLATIONS`, `linear`, `quadraticIn`, `quadraticOut`, `quadraticInOut`, `cubicIn`, `cubicOut`, `cubicInOut`, `quarticIn`, `quarticOut`, `quarticInOut`, `quinticIn`, `quinticOut`, `quinticInOut`, `sineIn`, `sineOut`, `sineInOut`, `exponentialIn`, `exponentialOut`, `exponentialInOut`, `circularIn`, `circularOut`, `circularInOut`, `backIn`, `backOut`, `backInOut`, `bounceOut`, `bounceIn`, `bounceInOut`, `elasticIn`, `elasticOut`, `elasticInOut`, `springOut`, `springIn`, `springInOut`, `EASINGS`, `EASING_NAMES`

---

<a id="packages-diagnostics-dependencies"></a>

## Packages/diagnostics Dependencies

### `packages/diagnostics/src/checksum.ts` - Deterministic checksums over float sequences (§33, plan D6).

**Exports:**
- Interfaces: `Checksum`
- Functions: `createChecksum`, `hashFloats`

---

### `packages/diagnostics/src/leak-registry.ts` - Re-export of `@fourjs/core`'s §83 FinalizationRegistry leak bookkeeping.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `auditFinalizedLeaks, disposeTracked, reportFinalized, resetLeakRegistry, trackDisposable, trackedDisposableId` |

**Exports:**
- Re-exports: `auditFinalizedLeaks`, `disposeTracked`, `reportFinalized`, `resetLeakRegistry`, `trackDisposable`, `trackedDisposableId`

---

### `packages/diagnostics/src/index.ts` - --- PH-20 (§33 rollback) ---------------------------------------------------

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./checksum.js` | `createChecksum, hashFloats` | Re-export |
| `./recorder.js` | `ReplayRecorder` | Re-export |
| `./rollback.js` | `RollbackBuffer` | Re-export |
| `./replay-format.js` | `LATEST_REPLAY_FORMAT_VERSION, MINIMUM_REPLAY_FORMAT_VERSION, REPLAY_FORMAT_VERSION, SUPPORTED_REPLAY_FORMAT_VERSIONS, assertReplayCompatible, cloneJsonValue, decodeBase64, decodeReplayRecording, encodeBase64, encodeReplayRecording, isReplayCompatible, validateReplayRecording` | Re-export |
| `./replay-player.js` | `DEFAULT_REPLAY_MAXIMUM_SUB_STEPS, ReplayPlayer` | Re-export |
| `./debug-draw.js` | `DEBUG_COLOR_FLOATS_PER_SEGMENT, DEBUG_DRAW_DEFAULT_COLORS, DEBUG_DRAW_STAGED, DEBUG_POSITION_FLOATS_PER_SEGMENT, DEBUG_SEGMENT_FLOATS, DEBUG_VERTEX_FLOATS, DEFAULT_DEBUG_BUFFER_CAPACITY, DebugDrawBuffer, applyDebugDrawStreams, collectBodyOrigins, collectBodyVelocities, collectCentersOfMass, collectContactImpulses, collectContactPoints, debugDrawStreams, solverJointStatistics` | Re-export |
| `./resource-audit.js` | `NO_RESOURCE_LEAKS, auditResourceLeaks` | Re-export |
| `./leak-registry.js` | `auditFinalizedLeaks, disposeTracked, reportFinalized, resetLeakRegistry, trackDisposable, trackedDisposableId` | Re-export |
| `./validation.js` | `COORDINATE_ENVELOPE, NEAR_ZERO_SCALE, UNSTABLE_SCALE_RATIO, assertFinite, assertFiniteVec3, assertNoSceneGraphCycle, validateSceneNode, validateSceneSubtree, warnCoordinateEnvelope, warnImpossibleInertia, warnImpossibleMass, warnSingularScale, warnUnstableScale, warnVersionMismatch` | Re-export |
| `./allocation-audit.js` | `NO_FRAME_ALLOCATIONS, auditFrameAllocations` | Re-export |
| `./stats.js` | `copyFrameStats, createFrameStats, createMonotonicClock, monotonicNowSeconds, recordRenderStatistics, recordResourceMemory, recordSolverStatistics, resetFrameStats, solverStatistics` | Re-export |
| `./checksum.js` | `Checksum` | Re-export (type-only) |
| `./recorder.js` | `ReplayRecorderOptions, ReplaySnapshot, ReplayTarget` | Re-export (type-only) |
| `./rollback.js` | `RollbackBufferOptions, RollbackTarget` | Re-export (type-only) |
| `./replay-format.js` | `JsonValue, ReplayAdapterIdentity, ReplayFrameRecord, ReplayInputRecord, ReplayRecording, ReplaySnapshotRecord, UntrustedJsonLimits` | Re-export (type-only) |
| `./replay-player.js` | `ReplayPlayerOptions, ReplayStepEvent, ReplayStepListener` | Re-export (type-only) |
| `./debug-draw.js` | `CollectBodyOriginsOptions, CollectBodyVelocitiesOptions, CollectCentersOfMassOptions, CollectContactImpulsesOptions, CollectContactPointsOptions, DebugBodyAccess, DebugCenterOfMassAccess, DebugCollisionEventLike, DebugColor, DebugContactPoint, DebugDrawBufferOptions, DebugDrawStreams, DebugGeometrySink, DebugJointAccess, DebugPhysicsEventLike, SolverJointStatistics, SolverStatistics, StagedVisualization, Vector3Like` | Re-export (type-only) |
| `./resource-audit.js` | `AuditResourceLeaksOptions, LiveResourceCounts, ResourceLeakReport` | Re-export (type-only) |
| `./validation.js` | `ValidationCatalogueOptions, ValidationCheckOptions, ValidationNodeLike, ValidationTransformLike` | Re-export (type-only) |
| `./allocation-audit.js` | `AuditFrameAllocationsOptions, FrameAllocationReport` | Re-export (type-only) |
| `./stats.js` | `ClockSource, FrameStats, RenderStatisticsLike` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `createChecksum`, `hashFloats`, `ReplayRecorder`, `RollbackBuffer`, `LATEST_REPLAY_FORMAT_VERSION`, `MINIMUM_REPLAY_FORMAT_VERSION`, `REPLAY_FORMAT_VERSION`, `SUPPORTED_REPLAY_FORMAT_VERSIONS`, `assertReplayCompatible`, `cloneJsonValue`, `decodeBase64`, `decodeReplayRecording`, `encodeBase64`, `encodeReplayRecording`, `isReplayCompatible`, `validateReplayRecording`, `DEFAULT_REPLAY_MAXIMUM_SUB_STEPS`, `ReplayPlayer`, `DEBUG_COLOR_FLOATS_PER_SEGMENT`, `DEBUG_DRAW_DEFAULT_COLORS`, `DEBUG_DRAW_STAGED`, `DEBUG_POSITION_FLOATS_PER_SEGMENT`, `DEBUG_SEGMENT_FLOATS`, `DEBUG_VERTEX_FLOATS`, `DEFAULT_DEBUG_BUFFER_CAPACITY`, `DebugDrawBuffer`, `applyDebugDrawStreams`, `collectBodyOrigins`, `collectBodyVelocities`, `collectCentersOfMass`, `collectContactImpulses`, `collectContactPoints`, `debugDrawStreams`, `solverJointStatistics`, `NO_RESOURCE_LEAKS`, `auditResourceLeaks`, `auditFinalizedLeaks`, `disposeTracked`, `reportFinalized`, `resetLeakRegistry`, `trackDisposable`, `trackedDisposableId`, `COORDINATE_ENVELOPE`, `NEAR_ZERO_SCALE`, `UNSTABLE_SCALE_RATIO`, `assertFinite`, `assertFiniteVec3`, `assertNoSceneGraphCycle`, `validateSceneNode`, `validateSceneSubtree`, `warnCoordinateEnvelope`, `warnImpossibleInertia`, `warnImpossibleMass`, `warnSingularScale`, `warnUnstableScale`, `warnVersionMismatch`, `NO_FRAME_ALLOCATIONS`, `auditFrameAllocations`, `copyFrameStats`, `createFrameStats`, `createMonotonicClock`, `monotonicNowSeconds`, `recordRenderStatistics`, `recordResourceMemory`, `recordSolverStatistics`, `resetFrameStats`, `solverStatistics`, `Checksum`, `ReplayRecorderOptions`, `ReplaySnapshot`, `ReplayTarget`, `RollbackBufferOptions`, `RollbackTarget`, `JsonValue`, `ReplayAdapterIdentity`, `ReplayFrameRecord`, `ReplayInputRecord`, `ReplayRecording`, `ReplaySnapshotRecord`, `UntrustedJsonLimits`, `ReplayPlayerOptions`, `ReplayStepEvent`, `ReplayStepListener`, `CollectBodyOriginsOptions`, `CollectBodyVelocitiesOptions`, `CollectCentersOfMassOptions`, `CollectContactImpulsesOptions`, `CollectContactPointsOptions`, `DebugBodyAccess`, `DebugCenterOfMassAccess`, `DebugCollisionEventLike`, `DebugColor`, `DebugContactPoint`, `DebugDrawBufferOptions`, `DebugDrawStreams`, `DebugGeometrySink`, `DebugJointAccess`, `DebugPhysicsEventLike`, `SolverJointStatistics`, `SolverStatistics`, `StagedVisualization`, `Vector3Like`, `AuditResourceLeaksOptions`, `LiveResourceCounts`, `ResourceLeakReport`, `ValidationCatalogueOptions`, `ValidationCheckOptions`, `ValidationNodeLike`, `ValidationTransformLike`, `AuditFrameAllocationsOptions`, `FrameAllocationReport`, `ClockSource`, `FrameStats`, `RenderStatisticsLike`

---

### `packages/diagnostics/src/validation.ts` - §85's validation catalogue (A-4 remainder step 2, 2026-09-06).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, devAssert, devWarnOnce` |

**Exports:**
- Interfaces: `ValidationCheckOptions`, `ValidationCatalogueOptions`, `ValidationNodeLike`, `ValidationTransformLike`
- Functions: `warnCoordinateEnvelope`, `warnSingularScale`, `warnUnstableScale`, `assertFinite`, `assertFiniteVec3`, `warnImpossibleMass`, `warnImpossibleInertia`, `warnVersionMismatch`, `assertNoSceneGraphCycle`, `validateSceneNode`, `validateSceneSubtree`
- Constants: `COORDINATE_ENVELOPE`, `UNSTABLE_SCALE_RATIO`, `NEAR_ZERO_SCALE`

---

### `packages/diagnostics/src/replay-format.ts` - The §34 replay document — its types, its JSON encoding, and its validation

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError, cloneJsonValue, parseUntrustedJson, JsonValue, UntrustedJsonLimits` |
| `@fourjs/core` | `cloneJsonValue` |
| `@fourjs/core` | `JsonValue` |
| `@fourjs/core` | `UntrustedJsonLimits` |

**Exports:**
- Interfaces: `ReplayInputRecord`, `ReplayFrameRecord`, `ReplaySnapshotRecord`, `ReplayAdapterIdentity`, `ReplayRecording`
- Functions: `encodeBase64`, `decodeBase64`, `validateReplayRecording`, `encodeReplayRecording`, `decodeReplayRecording`, `assertReplayCompatible`, `isReplayCompatible`
- Constants: `LATEST_REPLAY_FORMAT_VERSION`, `MINIMUM_REPLAY_FORMAT_VERSION`, `REPLAY_FORMAT_VERSION`, `SUPPORTED_REPLAY_FORMAT_VERSIONS`
- Re-exports: `cloneJsonValue`, `JsonValue`, `UntrustedJsonLimits`

---

### `packages/diagnostics/src/recorder.ts` - Session recording (§33–34, plan P10-1) — the producing half of the replay

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./replay-format.js` | `LATEST_REPLAY_FORMAT_VERSION, JsonValue, ReplayFrameRecord, ReplayInputRecord, ReplayRecording, ReplaySnapshotRecord, cloneJsonValue, encodeBase64, validateReplayRecording` | Import |

**Exports:**
- Classes: `ReplayRecorder`
- Interfaces: `ReplaySnapshot`, `ReplayTarget`, `ReplayRecorderOptions`

---

### `packages/diagnostics/src/stats.ts` - §84 runtime statistics — the record behind `app.stats` (A-1, 2026-08-07).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./debug-draw.js` | `DebugBodyAccess, SolverStatistics` | Import (type-only) |

**Exports:**
- Interfaces: `FrameStats`, `RenderStatisticsLike`, `ClockSource`
- Functions: `createFrameStats`, `resetFrameStats`, `copyFrameStats`, `recordRenderStatistics`, `recordResourceMemory`, `solverStatistics`, `recordSolverStatistics`, `createMonotonicClock`
- Constants: `monotonicNowSeconds`

---

### `packages/diagnostics/src/rollback.ts` - `RollbackBuffer` (§33 *"rollback"*, §34; PH-20, 2026-08-21) — a bounded ring

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./recorder.js` | `ReplaySnapshot` | Import (type-only) |

**Exports:**
- Classes: `RollbackBuffer`
- Interfaces: `RollbackTarget`, `RollbackBufferOptions`

---

### `packages/diagnostics/src/replay-player.ts` - Replay playback and inspection (§33–34, §113; plan P10-3) — the consuming

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./recorder.js` | `ReplaySnapshot, ReplayTarget` | Import (type-only) |
| `./replay-format.js` | `ReplayRecording, assertReplayCompatible, decodeBase64, validateReplayRecording` | Import |

**Exports:**
- Classes: `ReplayPlayer`
- Interfaces: `ReplayStepEvent`, `ReplayPlayerOptions`
- Types: `ReplayStepListener`
- Constants: `DEFAULT_REPLAY_MAXIMUM_SUB_STEPS`

---

### `packages/diagnostics/src/debug-draw.ts` - Debug-draw data providers (§113, plan P10-3) — the diagnostic visualization

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Quaternion, Vector3` |

**Exports:**
- Classes: `DebugDrawBuffer`
- Interfaces: `Vector3Like`, `DebugDrawBufferOptions`, `DebugDrawStreams`, `DebugGeometrySink`, `DebugBodyAccess`, `DebugJointAccess`, `DebugContactPoint`, `DebugCollisionEventLike`, `DebugPhysicsEventLike`, `CollectBodyVelocitiesOptions`, `CollectBodyOriginsOptions`, `DebugCenterOfMassAccess`, `CollectCentersOfMassOptions`, `CollectContactPointsOptions`, `CollectContactImpulsesOptions`, `SolverStatistics`, `SolverJointStatistics`, `StagedVisualization`
- Types: `DebugColor`
- Functions: `debugDrawStreams`, `applyDebugDrawStreams`, `collectBodyVelocities`, `collectBodyOrigins`, `collectCentersOfMass`, `collectContactPoints`, `collectContactImpulses`, `solverJointStatistics`
- Constants: `DEBUG_VERTEX_FLOATS`, `DEBUG_SEGMENT_FLOATS`, `DEBUG_POSITION_FLOATS_PER_SEGMENT`, `DEBUG_COLOR_FLOATS_PER_SEGMENT`, `DEFAULT_DEBUG_BUFFER_CAPACITY`, `DEBUG_DRAW_DEFAULT_COLORS`, `DEBUG_DRAW_STAGED`

---

### `packages/diagnostics/src/allocation-audit.ts` - §83's "excessive per-frame allocations" development warning (A-4/A-5,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, devWarnOnce` |

**Exports:**
- Interfaces: `FrameAllocationReport`, `AuditFrameAllocationsOptions`
- Functions: `auditFrameAllocations`
- Constants: `NO_FRAME_ALLOCATIONS`

---

### `packages/diagnostics/src/resource-audit.ts` - §83's first development warning — **leaked textures and buffers** (A-4/A-5,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, devWarnOnce` |

**Exports:**
- Interfaces: `LiveResourceCounts`, `ResourceLeakReport`, `AuditResourceLeaksOptions`
- Functions: `auditResourceLeaks`
- Constants: `NO_RESOURCE_LEAKS`

---

<a id="packages-core-dependencies"></a>

## Packages/core Dependencies

### `packages/core/src/units.ts` - The §40 unit system — **display and authoring conversion only** (§40, §98).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./errors.js` | `FourError` | Import |

**Exports:**
- Interfaces: `UnitScale`, `UnitSystem`, `UnitSystemInit`
- Types: `LengthUnit`, `MassUnit`, `TimeUnit`, `AngleUnit`, `UnitQuantity`
- Functions: `resolveUnitSystem`, `angleToDisplay`, `angleFromDisplay`, `timeToDisplay`, `timeFromDisplay`, `lengthToDisplay`, `lengthFromDisplay`, `massToDisplay`, `massFromDisplay`, `worldLengthToMeters`, `metersToWorldLength`, `worldMassToKilograms`, `kilogramsToWorldMass`, `unitSymbol`, `formatLength`, `formatMass`, `formatTime`, `formatAngle`
- Constants: `SI_UNITS`

---

### `packages/core/src/leak-registry.ts` - §83's **leaked-resource** development warning via `FinalizationRegistry`

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./dev.js` | `DEV, devWarnOnce` | Import |

**Exports:**
- Functions: `trackDisposable`, `disposeTracked`, `trackedDisposableId`, `reportFinalized`, `auditFinalizedLeaks`, `resetLeakRegistry`

---

### `packages/core/src/index.ts` - §83 FinalizationRegistry leak bookkeeping (A-4 remainder, 2026-09-06).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./conventions.js` | `DEFAULT_GRAVITY_Y` | Re-export |
| `./json.js` | `cloneJsonValue` | Re-export |
| `./random.js` | `SeededRandom` | Re-export |
| `./component.js` | `ComponentRegistry` | Re-export |
| `./disposable.js` | `disposeAll` | Re-export |
| `./leak-registry.js` | `auditFinalizedLeaks, disposeTracked, reportFinalized, resetLeakRegistry, trackDisposable, trackedDisposableId` | Re-export |
| `./dev.js` | `DEV, DEV_WARNING_PREFIX, devAssert, devWarn, devWarnOnce, resetDevWarnings` | Re-export |
| `./errors.js` | `FourError, isFourError` | Re-export |
| `./events.js` | `EventEmitter` | Re-export |
| `./plugin.js` | `PLUGIN_API_VERSION, PluginHost, bindCapability, defineCapability, installPlugins, satisfiesPluginRange` | Re-export |
| `./space.js` | `DEFAULT_SPACE_MODE, SPACE_MODES, isSimulationSpaceMode` | Re-export |
| `./units.js` | `SI_UNITS, angleFromDisplay, angleToDisplay, formatAngle, formatLength, formatMass, formatTime, kilogramsToWorldMass, lengthFromDisplay, lengthToDisplay, massFromDisplay, massToDisplay, metersToWorldLength, resolveUnitSystem, timeFromDisplay, timeToDisplay, unitSymbol, worldLengthToMeters, worldMassToKilograms` | Re-export |
| `./untrusted.js` | `DEFAULT_MAXIMUM_DEPTH, DEFAULT_MAXIMUM_TEXT_LENGTH, parseUntrustedJson` | Re-export |
| `./json.js` | `JsonValue` | Re-export (type-only) |
| `./component.js` | `Component, ComponentHost, ComponentHostBinding, ComponentType` | Re-export (type-only) |
| `./disposable.js` | `Disposable` | Re-export (type-only) |
| `./errors.js` | `FourErrorCode, FourErrorOptions` | Re-export (type-only) |
| `./events.js` | `EventListener, Unsubscribe` | Re-export (type-only) |
| `./plugin.js` | `DefineCapabilityOptions, FourPlugin, PluginCapability, PluginCapabilityBinding, PluginContext, PluginDependency` | Re-export (type-only) |
| `./space.js` | `SpaceMode` | Re-export (type-only) |
| `./units.js` | `AngleUnit, LengthUnit, MassUnit, TimeUnit, UnitQuantity, UnitScale, UnitSystem, UnitSystemInit` | Re-export (type-only) |
| `./untrusted.js` | `UntrustedJsonLimits` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `DEFAULT_GRAVITY_Y`, `cloneJsonValue`, `SeededRandom`, `ComponentRegistry`, `disposeAll`, `auditFinalizedLeaks`, `disposeTracked`, `reportFinalized`, `resetLeakRegistry`, `trackDisposable`, `trackedDisposableId`, `DEV`, `DEV_WARNING_PREFIX`, `devAssert`, `devWarn`, `devWarnOnce`, `resetDevWarnings`, `FourError`, `isFourError`, `EventEmitter`, `PLUGIN_API_VERSION`, `PluginHost`, `bindCapability`, `defineCapability`, `installPlugins`, `satisfiesPluginRange`, `DEFAULT_SPACE_MODE`, `SPACE_MODES`, `isSimulationSpaceMode`, `SI_UNITS`, `angleFromDisplay`, `angleToDisplay`, `formatAngle`, `formatLength`, `formatMass`, `formatTime`, `kilogramsToWorldMass`, `lengthFromDisplay`, `lengthToDisplay`, `massFromDisplay`, `massToDisplay`, `metersToWorldLength`, `resolveUnitSystem`, `timeFromDisplay`, `timeToDisplay`, `unitSymbol`, `worldLengthToMeters`, `worldMassToKilograms`, `DEFAULT_MAXIMUM_DEPTH`, `DEFAULT_MAXIMUM_TEXT_LENGTH`, `parseUntrustedJson`, `JsonValue`, `Component`, `ComponentHost`, `ComponentHostBinding`, `ComponentType`, `Disposable`, `FourErrorCode`, `FourErrorOptions`, `EventListener`, `Unsubscribe`, `DefineCapabilityOptions`, `FourPlugin`, `PluginCapability`, `PluginCapabilityBinding`, `PluginContext`, `PluginDependency`, `SpaceMode`, `AngleUnit`, `LengthUnit`, `MassUnit`, `TimeUnit`, `UnitQuantity`, `UnitScale`, `UnitSystem`, `UnitSystemInit`, `UntrustedJsonLimits`

---

### `packages/core/src/disposable.ts` - Explicit disposal (§83).

**Exports:**
- Interfaces: `Disposable`
- Functions: `disposeAll`

---

### `packages/core/src/conventions.ts` - Normative default constants shared across pillars (Appendix A, §7a).

**Exports:**
- Constants: `DEFAULT_GRAVITY_Y`

---

### `packages/core/src/dev.ts` - The build-mode flag (§85, A-4, 2026-08-07) — one place that answers "is this

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./errors.js` | `FourError` | Import |
| `./errors.js` | `FourErrorCode` | Import (type-only) |

**Exports:**
- Functions: `devWarn`, `devWarnOnce`, `resetDevWarnings`, `devAssert`
- Constants: `DEV`, `DEV_WARNING_PREFIX`

---

### `packages/core/src/plugin.ts` - The §81 plugin system (RFC 0002, accepted 2026-08-21; gap `A-3`).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./errors.js` | `FourError` | Import |

**Exports:**
- Classes: `PluginHost`
- Interfaces: `PluginDependency`, `FourPlugin`, `PluginCapability`, `DefineCapabilityOptions`, `PluginCapabilityBinding`, `PluginContext`
- Functions: `defineCapability`, `bindCapability`, `satisfiesPluginRange`, `installPlugins`
- Constants: `PLUGIN_API_VERSION`

---

### `packages/core/src/events.ts` - Typed event emitter (§6b).

**Exports:**
- Classes: `EventEmitter`
- Types: `EventListener`, `Unsubscribe`

---

### `packages/core/src/space.ts` - §8 *Space Modes* — the vocabulary, and the one rule §8 states (PH-12,

**Exports:**
- Types: `SpaceMode`
- Functions: `isSimulationSpaceMode`
- Constants: `DEFAULT_SPACE_MODE`, `SPACE_MODES`

---

### `packages/core/src/random.ts` - Seeded pseudo-random numbers for deterministic engine code (§33, plan P8-3).

**Exports:**
- Classes: `SeededRandom`

---

### `packages/core/src/untrusted.ts` - Untrusted-input guards for the document formats (§96).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./errors.js` | `FourError` | Import |

**Exports:**
- Interfaces: `UntrustedJsonLimits`
- Functions: `parseUntrustedJson`
- Constants: `DEFAULT_MAXIMUM_TEXT_LENGTH`, `DEFAULT_MAXIMUM_DEPTH`

---

### `packages/core/src/json.ts` - JSON value typing and validation shared by every document format (§34, §79).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./errors.js` | `FourError` | Import |

**Exports:**
- Types: `JsonValue`
- Functions: `cloneJsonValue`

---

### `packages/core/src/errors.ts` - Error model (§89).

**Exports:**
- Classes: `FourError`
- Interfaces: `FourErrorOptions`
- Types: `FourErrorCode`
- Functions: `isFourError`

---

### `packages/core/src/component.ts` - Component model (§6a, plan D2).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./dev.js` | `DEV, devWarn` | Import |
| `./errors.js` | `FourError` | Import |

**Exports:**
- Classes: `ComponentRegistry`
- Interfaces: `ComponentHost`, `Component`, `ComponentHostBinding`
- Types: `ComponentType`

---

<a id="packages-fourjs-dependencies"></a>

## Packages/fourjs Dependencies

### `packages/fourjs/src/physics-box2d.ts` - physics-box2d module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/physics-box2d` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/physics-box2d`

---

### `packages/fourjs/src/gltf.ts` - §78 glTF assembly — `instantiateGltf` (A-19's closing packet, 2026-08-29).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/assets` | `GltfAsset` |
| `@fourjs/animation` | `AnimationClip, AnimationTrack, quaternionAdapter, vector3Adapter, AnimationTrackLike` |
| `@fourjs/core` | `FourError, devWarnOnce` |
| `@fourjs/geometry` | `BufferGeometry` |
| `@fourjs/materials` | `StandardMaterial` |
| `@fourjs/math` | `Matrix4, Quaternion, Vector3` |
| `@fourjs/render` | `Mesh, Texture` |
| `@fourjs/scene` | `Bone, Group, Skeleton, Node` |

**Exports:**
- Interfaces: `GltfInstance`
- Functions: `instantiateGltf`

---

### `packages/fourjs/src/application.ts` - The `Application` composition root (§45, plan D4).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, EventEmitter, FourError, bindCapability, devWarnOnce, installPlugins, FourPlugin, PluginCapabilityBinding, PluginContext` |
| `@fourjs/diagnostics` | `auditFrameAllocations, createFrameStats, monotonicNowSeconds, recordRenderStatistics, recordResourceMemory, recordSolverStatistics, resetFrameStats, solverStatistics, FrameStats, SolverStatistics` |
| `@fourjs/geometry` | `geometryMemoryBytes` |
| `@fourjs/motion` | `DEFAULT_FIXED_DELTA_TIME, DEFAULT_MAXIMUM_SUB_STEPS, PRIORITY_PHYSICS_SOLVE, Scheduler, SystemRegistry, Detach, ReadonlyTimeState, SimulationSystem` |
| `@fourjs/math` | `constructionCount, DepthRange` |
| `@fourjs/assets` | `AssetManager` |
| `@fourjs/physics` | `PhysicsWorld` |
| `@fourjs/scene` | `PerspectiveCamera, PoseBuffer, Scene, createSnapshotSystem, resolveWorldTransforms, Camera, SurfaceSizedCamera, Viewport, WorldTransformStats` |
| `@fourjs/render` | `RenderStatistics, Renderer, RendererCapabilityDeclaration, RendererCapabilityShortfall, RendererFallbackReport, RendererRegistry, RendererSelection` |
| `@fourjs/render` | `resolveRenderer, textureMemoryBytes` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./plugins.js` | `RENDERER_REGISTRY, SIMULATION_SYSTEMS` | Import |

**Exports:**
- Classes: `Application`
- Interfaces: `ApplicationEventMap`, `PhysicsWorldContext`, `ApplicationOptions`
- Types: `PhysicsWorldFactory`, `SurfaceResize`, `SurfaceObserver`

---

### `packages/fourjs/src/capabilities.ts` - The umbrella's own §81 capability token (RFC 0002).
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `defineCapability` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
<<<<<<< HEAD
| `./compute-workloads.js` | `ComputeWorkloadRegistry` | Import (type-only) |
| `./render-graph.js` | `RenderGraph` | Import (type-only) |
| `./renderer-registry.js` | `RendererRegistry` | Import (type-only) |

**Exports:**
- Constants: `RENDERER_REGISTRY`, `RENDER_GRAPH`, `COMPUTE_WORKLOADS`

---

### `packages/render/src/clip.ts` - §67 clipping — a node's drawn shape masks its subtree, expressed entirely in
=======
| `./editor-tools.js` | `EditorToolRegistry` | Import (type-only) |

**Exports:**
- Constants: `EDITOR_TOOLS`

---

### `packages/fourjs/src/plugins.ts` - The §81 capability tokens (RFC 0002, accepted 2026-08-21; gap `A-3`) —
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `DEV, devWarn` |
| `@fourjs/materials` | `StencilFunc, StencilOp` |

**Exports:**
- Classes: `ClipPlaneAllocator`
- Interfaces: `RenderItemStencil`, `RenderItemClip`, `ClipScope`
- Constants: `MAX_CLIP_PLANES`

---

### `packages/render/src/compute-workloads.ts` - The §81 compute-workload registry — a named map of

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
=======
| `@fourjs/assets` | `ASSET_LOADERS` |
| `@fourjs/materials` | `SHADER_OPERATORS` |
| `@fourjs/motion` | `SIMULATION_SYSTEMS` |
| `@fourjs/physics` | `SOLVER_REGISTRY` |
| `@fourjs/render` | `COMPUTE_WORKLOADS, RENDERER_REGISTRY, RENDER_GRAPH` |
| `@fourjs/serialization` | `COMPONENT_SERIALIZERS, SCENE_MIGRATIONS` |
| `@fourjs/ui` | `UI_CONTROLS` |
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
<<<<<<< HEAD
| `./compute.js` | `ComputePassDescriptor` | Import (type-only) |

**Exports:**
- Classes: `ComputeWorkloadRegistry`
- Types: `ComputeWorkloadFactory`

---

### `packages/render/src/compute.ts` - §82's `ComputePass`, as the backend-independent descriptor — the Q3

**Exports:**
- Interfaces: `ComputeBuffer`, `ComputeBinding`, `ComputePassDescriptor`, `ComputeDispatcher`
- Types: `ComputeBindingAccess`
- Functions: `supportsCompute`
- Constants: `COMPUTE_ENTRY_POINT`

---

### `packages/render/src/effect-pass.ts` - §70's post-processing at the **full-screen effect tier** (R-6, 2026-08-07):
=======
| `./capabilities.js` | `EDITOR_TOOLS` | Re-export |
| `./editor-tools.js` | `EditorToolRegistry` | Re-export |
| `./editor-tools.js` | `EditorToolFactory` | Re-export (type-only) |

**Exports:**
- Re-exports: `ASSET_LOADERS`, `SHADER_OPERATORS`, `SIMULATION_SYSTEMS`, `SOLVER_REGISTRY`, `COMPUTE_WORKLOADS`, `RENDERER_REGISTRY`, `RENDER_GRAPH`, `COMPONENT_SERIALIZERS`, `SCENE_MIGRATIONS`, `UI_CONTROLS`, `EDITOR_TOOLS`, `EditorToolRegistry`, `EditorToolFactory`

---

### `packages/fourjs/src/physics.ts` - physics module
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/materials` | `SHADER_VALUE_COMPONENTS, analyzeShaderGraph, ShaderGraph` |
=======
| `@fourjs/physics` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/physics`

---

### `packages/fourjs/src/compute-pass.ts` - §82's `Four.ComputePass` — the named-map sugar over `@fourjs/render`'s

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `ComputeBinding, ComputeBuffer, ComputePassDescriptor` |

**Exports:**
- Classes: `ComputePass`
- Interfaces: `ComputePassOptions`
- Types: `ComputePassBindingEntry`, `ComputePassBindings`

---

### `packages/fourjs/src/index.ts` - The umbrella package (§98): one namespace per workspace package, plus the
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
<<<<<<< HEAD
| `./render-target.js` | `RenderTarget, RenderTargetTexture` | Import (type-only) |
| `./render-target.js` | `isRenderTargetTexture` | Import |

**Exports:**
- Interfaces: `CopyEffect`, `ColorGradeEffect`, `OutputTransformEffect`, `GraphEffect`, `EffectDestinationRect`, `EffectRenderPass`, `ScreenEffectRenderer`
- Types: `ScreenEffect`, `ScreenEffectKind`
- Functions: `supportsScreenEffects`, `validateEffectRenderPass`
- Constants: `OUTPUT_TRANSFORM_EFFECT`, `COLOR_GRADE_DEFAULTS`, `COPY_EFFECT`

---

### `packages/render/src/gpu-readback.ts` - gpu-readback module
=======
| `./application.js` | `Application` | Re-export |
| `./live-resource-counts.js` | `readLiveResourceCounts` | Re-export |
| `./plugins.js` | `ASSET_LOADERS, COMPONENT_SERIALIZERS, COMPUTE_WORKLOADS, EDITOR_TOOLS, RENDERER_REGISTRY, RENDER_GRAPH, SCENE_MIGRATIONS, SHADER_OPERATORS, SIMULATION_SYSTEMS, SOLVER_REGISTRY, UI_CONTROLS` | Re-export |
| `./plugins.js` | `EditorToolRegistry` | Re-export |
| `./scene-serializers.js` | `BUTTON_NODE_TYPE, CHECKBOX_NODE_TYPE, CIRCLE_NODE_TYPE, DIRECTIONAL_LIGHT_NODE_TYPE, HEMISPHERE_LIGHT_NODE_TYPE, ELLIPSE_NODE_TYPE, IMAGE_NODE_TYPE, LABEL_NODE_TYPE, ORTHOGRAPHIC_CAMERA_NODE_TYPE, PANEL_NODE_TYPE, PATH_SHAPE_NODE_TYPE, PERSPECTIVE_CAMERA_NODE_TYPE, POINT_LIGHT_NODE_TYPE, POLYGON_NODE_TYPE, PROGRESS_NODE_TYPE, RADIO_BUTTON_NODE_TYPE, RECTANGLE_NODE_TYPE, REGULAR_POLYGON_NODE_TYPE, RENDERABLE_NODE_TYPE, RING_NODE_TYPE, SECTOR_NODE_TYPE, SLIDER_NODE_TYPE, SPOT_LIGHT_NODE_TYPE, SPRITE_NODE_TYPE, STAR_NODE_TYPE, TEXT_NODE_TYPE, TOGGLE_NODE_TYPE, composeSceneNodeTypes, registerPhysicsSerializers, registerRenderSerializers, registerSceneNodeTypes, registerShapeSerializers, registerTextSerializers, registerUISerializers, resourceCatalog, restoreNodeId` | Re-export |
| `./text-node.js` | `Text` | Re-export |
| `./compute-pass.js` | `ComputePass` | Re-export |
| `./gltf.js` | `instantiateGltf` | Re-export |
| `./pick-provider.js` | `createPickProvider` | Re-export |
| `./manifest-catalog.js` | `preloadManifestIntoCatalog` | Re-export |
| `./application.js` | `ApplicationEventMap, ApplicationOptions, PhysicsWorldContext, PhysicsWorldFactory, SurfaceObserver, SurfaceResize` | Re-export (type-only) |
| `./plugins.js` | `EditorToolFactory` | Re-export (type-only) |
| `./scene-serializers.js` | `SceneNodeTypeOptions, SceneNodeTypeSupport, SceneResourceCatalog, SceneSerializationSupport, UnknownResourcePolicy` | Re-export (type-only) |
| `./text-node.js` | `TextOptions` | Re-export (type-only) |
| `./compute-pass.js` | `ComputePassBindingEntry, ComputePassBindings, ComputePassOptions` | Re-export (type-only) |
| `./gltf.js` | `GltfInstance` | Re-export (type-only) |
| `./manifest-catalog.js` | `PreloadManifestIntoCatalogOptions` | Re-export (type-only) |

**Exports:**
- Re-exports: `Application`, `readLiveResourceCounts`, `ASSET_LOADERS`, `COMPONENT_SERIALIZERS`, `COMPUTE_WORKLOADS`, `EDITOR_TOOLS`, `RENDERER_REGISTRY`, `RENDER_GRAPH`, `SCENE_MIGRATIONS`, `SHADER_OPERATORS`, `SIMULATION_SYSTEMS`, `SOLVER_REGISTRY`, `UI_CONTROLS`, `EditorToolRegistry`, `BUTTON_NODE_TYPE`, `CHECKBOX_NODE_TYPE`, `CIRCLE_NODE_TYPE`, `DIRECTIONAL_LIGHT_NODE_TYPE`, `HEMISPHERE_LIGHT_NODE_TYPE`, `ELLIPSE_NODE_TYPE`, `IMAGE_NODE_TYPE`, `LABEL_NODE_TYPE`, `ORTHOGRAPHIC_CAMERA_NODE_TYPE`, `PANEL_NODE_TYPE`, `PATH_SHAPE_NODE_TYPE`, `PERSPECTIVE_CAMERA_NODE_TYPE`, `POINT_LIGHT_NODE_TYPE`, `POLYGON_NODE_TYPE`, `PROGRESS_NODE_TYPE`, `RADIO_BUTTON_NODE_TYPE`, `RECTANGLE_NODE_TYPE`, `REGULAR_POLYGON_NODE_TYPE`, `RENDERABLE_NODE_TYPE`, `RING_NODE_TYPE`, `SECTOR_NODE_TYPE`, `SLIDER_NODE_TYPE`, `SPOT_LIGHT_NODE_TYPE`, `SPRITE_NODE_TYPE`, `STAR_NODE_TYPE`, `TEXT_NODE_TYPE`, `TOGGLE_NODE_TYPE`, `composeSceneNodeTypes`, `registerPhysicsSerializers`, `registerRenderSerializers`, `registerSceneNodeTypes`, `registerShapeSerializers`, `registerTextSerializers`, `registerUISerializers`, `resourceCatalog`, `restoreNodeId`, `Text`, `ComputePass`, `instantiateGltf`, `createPickProvider`, `preloadManifestIntoCatalog`, `ApplicationEventMap`, `ApplicationOptions`, `PhysicsWorldContext`, `PhysicsWorldFactory`, `SurfaceObserver`, `SurfaceResize`, `EditorToolFactory`, `SceneNodeTypeOptions`, `SceneNodeTypeSupport`, `SceneResourceCatalog`, `SceneSerializationSupport`, `UnknownResourcePolicy`, `TextOptions`, `ComputePassBindingEntry`, `ComputePassBindings`, `ComputePassOptions`, `GltfInstance`, `PreloadManifestIntoCatalogOptions`

---

### `packages/fourjs/src/core.ts` - core module
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `FourError, Disposable` |
| `@fourjs/math` | `Rectangle2, ColorSpace` |
=======
| `@fourjs/core` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/core`

---

### `packages/fourjs/src/render-webgpu.ts` - render-webgpu module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render-webgpu` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/render-webgpu`

---

### `packages/fourjs/src/render-svg.ts` - render-svg module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render-svg` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/render-svg`

---

### `packages/fourjs/src/input.ts` - input module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/input` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/input`

---

### `packages/fourjs/src/motion.ts` - motion module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/motion` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/motion`

---

### `packages/fourjs/src/manifest-catalog.ts` - Preload a §79 manifest into a synchronous {@link SceneResourceCatalog}

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/assets` | `loadFromManifest, AssetLoader, AssetManager, AssetManifest, ManifestLoadOptions` |
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
<<<<<<< HEAD
| `./raster.js` | `RasterSource` | Import (type-only) |
| `./renderer.js` | `Renderer` | Import (type-only) |
| `./render-target.js` | `RenderTarget, validateColorSpace` | Import |
| `./read-pixels.js` | `supportsReadPixels, validateReadbackRegion` | Import |
| `./raster-limits.js` | `DEFAULT_RASTER_MAXIMUM_BYTES` | Import |

**Exports:**
- Classes: `GpuReadbackSource`
- Interfaces: `GpuReadbackSourceOptions`
- Functions: `isGpuReadbackSource`

---

### `packages/render/src/host-texture.ts` - Copies an ImageBitmap (or other width/height image) into restorable RGBA8 storage.
=======
| `./scene-serializers.js` | `resourceCatalog, SceneResourceCatalog` | Import |

**Exports:**
- Interfaces: `PreloadManifestIntoCatalogOptions`
- Functions: `preloadManifestIntoCatalog`, `preloadManifestIntoCatalog`, `preloadManifestIntoCatalog`

---

### `packages/fourjs/src/text.ts` - text module
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Rectangle2` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./raster-limits.js` | `DEFAULT_RASTER_MAXIMUM_BYTES` | Import |
| `./texture.js` | `Texture, validateTextureSource, TextureSource` | Import |

**Exports:**
- Classes: `ImageBitmapTexture`, `VideoTexture`
- Interfaces: `ImageReadSurface`, `HostTextureOptions`, `VideoTextureSource`

---

### `packages/render/src/index.ts` - §81's render-side capability tokens (RFC 0002), declared by the package
=======
| `@fourjs/text` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/text`

---

### `packages/fourjs/src/assets.ts` - assets module
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/materials` | `MAX_SHADER_GRAPH_NODES, MAX_SHADER_GRAPH_TEXTURES, SHADER_ATTRIBUTE_TYPES, SHADER_VALUE_COMPONENTS, analyzeShaderGraph, forEachShaderNodeReference` |
| `@fourjs/materials` | `createShaderSourceMap` |
| `@fourjs/materials` | `ShaderAttributeName, ShaderBinaryOp, ShaderDomain, ShaderGraph, ShaderGraphAnalysis, ShaderNode, ShaderNodeId, ShaderReflection, ShaderTextureReflection, ShaderUnaryOp, ShaderUniformReflection, ShaderValueType` |
| `@fourjs/materials` | `ShaderSourceLocation, ShaderSourceMap` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./batch.js` | `DEFAULT_MAX_BATCH_VERTICES, RenderBatcher` | Re-export |
| `./bounds.js` | `computeWorldBoundingSphere, computeWorldBoundingSphereFromBox` | Re-export |
| `./capabilities.js` | `COMPUTE_WORKLOADS, RENDERER_REGISTRY, RENDER_GRAPH` | Re-export |
| `./compute-workloads.js` | `ComputeWorkloadRegistry` | Re-export |
| `./clip.js` | `ClipPlaneAllocator, MAX_CLIP_PLANES` | Re-export |
| `./scissor.js` | `intersectScissor, scissorsEqual` | Re-export |
| `./compute.js` | `COMPUTE_ENTRY_POINT, supportsCompute` | Re-export |
| `./effect-pass.js` | `COLOR_GRADE_DEFAULTS, COPY_EFFECT, OUTPUT_TRANSFORM_EFFECT, supportsScreenEffects, validateEffectRenderPass` | Re-export |
| `./lights.js` | `MAX_PUNCTUAL_LIGHTS, collectSceneLights, createSceneLights, isDirectionalLightSource, isHemisphereLightSource, isPunctualLightSource` | Re-export |
| `./particles.js` | `PARTICLE_COLOR_OFFSET, PARTICLE_INSTANCE_FLOATS, PARTICLE_POSITION_OFFSET, PARTICLE_ROTATION_OFFSET, PARTICLE_SIZE_OFFSET, PARTICLE_SOFTNESS_OFFSET, PARTICLE_WIDE_INSTANCE_FLOATS, TRAIL_COLOR_OFFSET, TRAIL_POSITION_OFFSET, TRAIL_VERTEX_FLOATS, isParticleDrawable, particleQuadGeometry` | Re-export |
| `./render-list.js` | `buildInterpolatedRenderList, buildRenderList, compareRenderItems, groupRenderListByPipeline, isLitItem, isNodeItem, isParticlesItem, isSkinnedLitItem, isSkinnedUnlitItem, isSpriteItem, isStandardItem, isUnlitItem, viewLayerMask` | Re-export |
| `./render-graph.js` | `RenderGraph` | Re-export |
| `./raster.js` | `CanvasTexture` | Re-export |
| `./read-pixels.js` | `supportsReadPixels, validateReadbackRegion` | Re-export |
| `./picking.js` | `MAX_PICK_CANDIDATES, assertEncodableCandidateCount, collectPickCandidates, decodePickId, encodePickId, supportsPicking` | Re-export |
| `./render-target.js` | `RenderTarget, isRenderTargetTexture` | Re-export |
| `./render-target-bytes.js` | `RENDER_TARGET_COLOR_BYTES, RENDER_TARGET_DEPTH_RENDERBUFFER_BYTES, RENDER_TARGET_DEPTH_STENCIL_BYTES, RENDER_TARGET_DEPTH_TEXTURE_BYTES, RENDER_TARGET_RGBA16F_BYTES, RENDER_TARGET_RGBA32F_BYTES, RENDER_TARGET_RGBA8_BYTES, colorAttachmentBytesPerTexel, depthAttachmentBytesPerTexel, renderTargetByteLength` | Re-export |
| `./renderable.js` | `Renderable` | Re-export |
| `./mesh.js` | `MAX_SKINNING_JOINTS, Mesh, restoreMeshSkeleton` | Re-export |
| `./renderer-registry.js` | `AUTO_RENDERER_ORDER, RENDERER_CAPABILITY_NAMES, RendererRegistry, clearRegisteredRenderers, missingCapabilities, registerRenderer, registeredRenderers, resolveRenderer, validateCapabilityDeclaration` | Re-export |
| `./renderer.js` | `NullRenderer` | Re-export |
| `./resource-memory.js` | `liveRenderTargetCount, liveTextureCount, textureMemoryBytes` | Re-export |
| `./resource-warnings.js` | `warnDisposedInUse` | Re-export |
| `./statistics.js` | `createRenderStatistics, resetRenderStatistics, supportsRenderStatistics` | Re-export |
| `./shape.js` | `Arc, Circle, clearRegisteredShapePaints, Ellipse, Line, PathShape, Polygon, Polyline, Rectangle, RegularPolygon, resolveShapePaintSupport, Ring, Sector, setShapePaintSupport, Shape2D, Star` | Re-export |
| `./shape-paint.js` | `registerShapePaints` | Re-export |
| `./sprite.js` | `Sprite, groupSpritesByTexture` | Re-export |
| `./texture.js` | `Texture` | Re-export |
| `./view-list.js` | `buildViewRenderList, sortRenderListByDepth` | Re-export |
| `./gpu-readback.js` | `GpuReadbackSource, isGpuReadbackSource` | Re-export |
| `./raster-limits.js` | `DEFAULT_RASTER_MAXIMUM_BYTES` | Re-export |
| `./host-texture.js` | `ImageBitmapTexture, VideoTexture` | Re-export |
| `./batch.js` | `BatchableItem, BatchableMaterial, RenderBatch, RenderBatchOptions` | Re-export (type-only) |
| `./bounds.js` | `BoundingSphere` | Re-export (type-only) |
| `./compute-workloads.js` | `ComputeWorkloadFactory` | Re-export (type-only) |
| `./clip.js` | `ClipScope, RenderItemClip, RenderItemStencil` | Re-export (type-only) |
| `./scissor.js` | `ScissorRect` | Re-export (type-only) |
| `./compute.js` | `ComputeBinding, ComputeBindingAccess, ComputeBuffer, ComputeDispatcher, ComputePassDescriptor` | Re-export (type-only) |
| `./effect-pass.js` | `ColorGradeEffect, CopyEffect, EffectDestinationRect, EffectRenderPass, GraphEffect, OutputTransformEffect, ScreenEffect, ScreenEffectKind, ScreenEffectRenderer` | Re-export (type-only) |
| `./lights.js` | `AmbientLightSource, DirectionalLightSource, DirectionalShadowSource, HemisphereLightSource, PointLightSource, PunctualLightSource, PunctualLightSourceBase, SceneLights, SpotLightSource` | Re-export (type-only) |
| `./particles.js` | `ParticleDrawable` | Re-export (type-only) |
| `./render-list.js` | `LitRenderItem, NodeRenderItem, ParticleRenderItem, RenderItem, RenderItemKind, SkinnedLitRenderItem, SkinnedUnlitRenderItem, SpriteRenderItem, StandardRenderItem, UnlitRenderItem` | Re-export (type-only) |
| `./render-graph.js` | `AddPassOptions, CustomRenderPass, RenderGraphIssue, RenderGraphIssueCode, RenderGraphIssueSeverity, RenderGraphPass, RenderPass, RenderPassContext, SceneRenderPass` | Re-export (type-only) |
| `./raster.js` | `CanvasTextureOptions, RasterOrigin, RasterSource` | Re-export (type-only) |
| `./read-pixels.js` | `PixelReader` | Re-export (type-only) |
| `./picking.js` | `PickRequest, PickResult, PickingService` | Re-export (type-only) |
| `./render-target.js` | `RenderTargetFormat, RenderTargetOptions, RenderTargetTexture` | Re-export (type-only) |
| `./renderable.js` | `RenderableOptions, SurfaceMaterial` | Re-export (type-only) |
| `./renderer-registry.js` | `RendererCapabilityDeclaration, RendererCapabilityName, RendererCapabilityShortfall, RendererFallbackReason, RendererFallbackReport, RendererRegistration, RendererResolveOptions, RendererSelection` | Re-export (type-only) |
| `./renderer.js` | `RenderInterpolation, Renderer, RendererBackend, RendererCapabilities, RendererEventMap, RendererOptions, ResizeRecord` | Re-export (type-only) |
| `./resource-warnings.js` | `DisposedResourceKind` | Re-export (type-only) |
| `./statistics.js` | `RenderStatistics, RenderStatisticsReporter` | Re-export (type-only) |
| `./shape.js` | `ArcOptions, CircleOptions, EllipseOptions, ConicGradientPaint, GradientStop, LinearGradientPaint, LineOptions, ObjectPaint, Paint, PathShapeOptions, PatternPaint, PolygonOptions, PolylineOptions, RadialGradientPaint, RectangleOptions, RegularPolygonOptions, RingOptions, SectorOptions, ResolvedConicGradientPaint, ResolvedGradientStop, ResolvedLinearGradientPaint, ResolvedObjectPaint, ResolvedPaint, ResolvedPatternPaint, ResolvedRadialGradientPaint, ResolvedShapeFill, ResolvedSolidPaint, ResolvedStrokeStyle, Shape2DOptions, ShapeFill, ShapePaintPlan, ShapePaintSupport, SolidPaint, StarOptions, StrokeStyle` | Re-export (type-only) |
| `./sprite.js` | `SpriteFrame, SpriteOptions, SpriteTextureCarrier, SpriteTextureRun` | Re-export (type-only) |
| `./texture.js` | `TextureDimension, TextureFilter, TextureMapRole, TextureMinFilter, TextureSource, TextureWrap` | Re-export (type-only) |
| `./view-list.js` | `ViewRenderListOptions` | Re-export (type-only) |
| `./gpu-readback.js` | `GpuReadbackSourceOptions` | Re-export (type-only) |
| `./host-texture.js` | `ImageReadSurface, HostTextureOptions, VideoTextureSource` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `DEFAULT_MAX_BATCH_VERTICES`, `RenderBatcher`, `computeWorldBoundingSphere`, `computeWorldBoundingSphereFromBox`, `COMPUTE_WORKLOADS`, `RENDERER_REGISTRY`, `RENDER_GRAPH`, `ComputeWorkloadRegistry`, `ClipPlaneAllocator`, `MAX_CLIP_PLANES`, `intersectScissor`, `scissorsEqual`, `COMPUTE_ENTRY_POINT`, `supportsCompute`, `COLOR_GRADE_DEFAULTS`, `COPY_EFFECT`, `OUTPUT_TRANSFORM_EFFECT`, `supportsScreenEffects`, `validateEffectRenderPass`, `MAX_PUNCTUAL_LIGHTS`, `collectSceneLights`, `createSceneLights`, `isDirectionalLightSource`, `isHemisphereLightSource`, `isPunctualLightSource`, `PARTICLE_COLOR_OFFSET`, `PARTICLE_INSTANCE_FLOATS`, `PARTICLE_POSITION_OFFSET`, `PARTICLE_ROTATION_OFFSET`, `PARTICLE_SIZE_OFFSET`, `PARTICLE_SOFTNESS_OFFSET`, `PARTICLE_WIDE_INSTANCE_FLOATS`, `TRAIL_COLOR_OFFSET`, `TRAIL_POSITION_OFFSET`, `TRAIL_VERTEX_FLOATS`, `isParticleDrawable`, `particleQuadGeometry`, `buildInterpolatedRenderList`, `buildRenderList`, `compareRenderItems`, `groupRenderListByPipeline`, `isLitItem`, `isNodeItem`, `isParticlesItem`, `isSkinnedLitItem`, `isSkinnedUnlitItem`, `isSpriteItem`, `isStandardItem`, `isUnlitItem`, `viewLayerMask`, `MAX_SHADER_GRAPH_NODES`, `MAX_SHADER_GRAPH_TEXTURES`, `SHADER_ATTRIBUTE_TYPES`, `SHADER_VALUE_COMPONENTS`, `analyzeShaderGraph`, `forEachShaderNodeReference`, `RenderGraph`, `CanvasTexture`, `supportsReadPixels`, `validateReadbackRegion`, `MAX_PICK_CANDIDATES`, `assertEncodableCandidateCount`, `collectPickCandidates`, `decodePickId`, `encodePickId`, `supportsPicking`, `RenderTarget`, `isRenderTargetTexture`, `RENDER_TARGET_COLOR_BYTES`, `RENDER_TARGET_DEPTH_RENDERBUFFER_BYTES`, `RENDER_TARGET_DEPTH_STENCIL_BYTES`, `RENDER_TARGET_DEPTH_TEXTURE_BYTES`, `RENDER_TARGET_RGBA16F_BYTES`, `RENDER_TARGET_RGBA32F_BYTES`, `RENDER_TARGET_RGBA8_BYTES`, `colorAttachmentBytesPerTexel`, `depthAttachmentBytesPerTexel`, `renderTargetByteLength`, `Renderable`, `MAX_SKINNING_JOINTS`, `Mesh`, `restoreMeshSkeleton`, `AUTO_RENDERER_ORDER`, `RENDERER_CAPABILITY_NAMES`, `RendererRegistry`, `clearRegisteredRenderers`, `missingCapabilities`, `registerRenderer`, `registeredRenderers`, `resolveRenderer`, `validateCapabilityDeclaration`, `NullRenderer`, `liveRenderTargetCount`, `liveTextureCount`, `textureMemoryBytes`, `warnDisposedInUse`, `createRenderStatistics`, `resetRenderStatistics`, `supportsRenderStatistics`, `Arc`, `Circle`, `clearRegisteredShapePaints`, `Ellipse`, `Line`, `PathShape`, `Polygon`, `Polyline`, `Rectangle`, `RegularPolygon`, `resolveShapePaintSupport`, `Ring`, `Sector`, `setShapePaintSupport`, `Shape2D`, `Star`, `registerShapePaints`, `Sprite`, `groupSpritesByTexture`, `Texture`, `buildViewRenderList`, `sortRenderListByDepth`, `GpuReadbackSource`, `isGpuReadbackSource`, `DEFAULT_RASTER_MAXIMUM_BYTES`, `createShaderSourceMap`, `ImageBitmapTexture`, `VideoTexture`, `BatchableItem`, `BatchableMaterial`, `RenderBatch`, `RenderBatchOptions`, `BoundingSphere`, `ComputeWorkloadFactory`, `ClipScope`, `RenderItemClip`, `RenderItemStencil`, `ScissorRect`, `ComputeBinding`, `ComputeBindingAccess`, `ComputeBuffer`, `ComputeDispatcher`, `ComputePassDescriptor`, `ColorGradeEffect`, `CopyEffect`, `EffectDestinationRect`, `EffectRenderPass`, `GraphEffect`, `OutputTransformEffect`, `ScreenEffect`, `ScreenEffectKind`, `ScreenEffectRenderer`, `AmbientLightSource`, `DirectionalLightSource`, `DirectionalShadowSource`, `HemisphereLightSource`, `PointLightSource`, `PunctualLightSource`, `PunctualLightSourceBase`, `SceneLights`, `SpotLightSource`, `ParticleDrawable`, `LitRenderItem`, `NodeRenderItem`, `ParticleRenderItem`, `RenderItem`, `RenderItemKind`, `SkinnedLitRenderItem`, `SkinnedUnlitRenderItem`, `SpriteRenderItem`, `StandardRenderItem`, `UnlitRenderItem`, `ShaderAttributeName`, `ShaderBinaryOp`, `ShaderDomain`, `ShaderGraph`, `ShaderGraphAnalysis`, `ShaderNode`, `ShaderNodeId`, `ShaderReflection`, `ShaderTextureReflection`, `ShaderUnaryOp`, `ShaderUniformReflection`, `ShaderValueType`, `AddPassOptions`, `CustomRenderPass`, `RenderGraphIssue`, `RenderGraphIssueCode`, `RenderGraphIssueSeverity`, `RenderGraphPass`, `RenderPass`, `RenderPassContext`, `SceneRenderPass`, `CanvasTextureOptions`, `RasterOrigin`, `RasterSource`, `PixelReader`, `PickRequest`, `PickResult`, `PickingService`, `RenderTargetFormat`, `RenderTargetOptions`, `RenderTargetTexture`, `RenderableOptions`, `SurfaceMaterial`, `RendererCapabilityDeclaration`, `RendererCapabilityName`, `RendererCapabilityShortfall`, `RendererFallbackReason`, `RendererFallbackReport`, `RendererRegistration`, `RendererResolveOptions`, `RendererSelection`, `RenderInterpolation`, `Renderer`, `RendererBackend`, `RendererCapabilities`, `RendererEventMap`, `RendererOptions`, `ResizeRecord`, `DisposedResourceKind`, `RenderStatistics`, `RenderStatisticsReporter`, `ArcOptions`, `CircleOptions`, `EllipseOptions`, `ConicGradientPaint`, `GradientStop`, `LinearGradientPaint`, `LineOptions`, `ObjectPaint`, `Paint`, `PathShapeOptions`, `PatternPaint`, `PolygonOptions`, `PolylineOptions`, `RadialGradientPaint`, `RectangleOptions`, `RegularPolygonOptions`, `RingOptions`, `SectorOptions`, `ResolvedConicGradientPaint`, `ResolvedGradientStop`, `ResolvedLinearGradientPaint`, `ResolvedObjectPaint`, `ResolvedPaint`, `ResolvedPatternPaint`, `ResolvedRadialGradientPaint`, `ResolvedShapeFill`, `ResolvedSolidPaint`, `ResolvedStrokeStyle`, `Shape2DOptions`, `ShapeFill`, `ShapePaintPlan`, `ShapePaintSupport`, `SolidPaint`, `StarOptions`, `StrokeStyle`, `SpriteFrame`, `SpriteOptions`, `SpriteTextureCarrier`, `SpriteTextureRun`, `TextureDimension`, `TextureFilter`, `TextureMapRole`, `TextureMinFilter`, `TextureSource`, `TextureWrap`, `ViewRenderListOptions`, `GpuReadbackSourceOptions`, `ShaderSourceLocation`, `ShaderSourceMap`, `ImageReadSurface`, `HostTextureOptions`, `VideoTextureSource`

---

### `packages/render/src/lights.ts` - Light collection (§68, §64) — scene graph in, one flat light state out.
=======
| `@fourjs/assets` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/assets`

---

### `packages/fourjs/src/ui.ts` - ui module
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `DEV, DEV_WARNING_PREFIX, devWarnOnce` |
| `@fourjs/math` | `Matrix4, Vector3` |
| `@fourjs/scene` | `Node` |

**Exports:**
- Interfaces: `DirectionalLightSource`, `DirectionalShadowSource`, `PunctualLightSourceBase`, `PointLightSource`, `SpotLightSource`, `AmbientLightSource`, `HemisphereLightSource`, `SceneLights`
- Types: `PunctualLightSource`
- Functions: `isDirectionalLightSource`, `isHemisphereLightSource`, `isPunctualLightSource`, `createSceneLights`, `collectSceneLights`
- Constants: `MAX_PUNCTUAL_LIGHTS`

---

### `packages/render/src/mesh.ts` - `Mesh` (§54) — the renderable that can be skinned (RFC 0003 — gaps PH-10 +
=======
| `@fourjs/ui` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/ui`

---

### `packages/fourjs/src/particles.ts` - particles module
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `FourError` |
| `@fourjs/geometry` | `CpuSkinning, BufferGeometry` |
| `@fourjs/materials` | `Material` |
| `@fourjs/math` | `Matrix4` |
| `@fourjs/scene` | `Bone, MorphWeights, Skeleton, Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./renderable.js` | `Renderable, RenderableOptions, SurfaceMaterial` | Import |

**Exports:**
- Classes: `Mesh`
- Functions: `restoreMeshSkeleton`
- Constants: `MAX_SKINNING_JOINTS`

---

### `packages/render/src/particles.ts` - The particle drawing contract (§36, §49, plan P9-3) — one batched render item
=======
| `@fourjs/particles` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/particles`

---

### `packages/fourjs/src/physics-soft.ts` - physics-soft module
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/geometry` | `BufferGeometry` |
| `@fourjs/math` | `Vector3` |

**Exports:**
- Interfaces: `ParticleDrawable`
- Functions: `isParticleDrawable`, `particleQuadGeometry`
- Constants: `PARTICLE_INSTANCE_FLOATS`, `PARTICLE_WIDE_INSTANCE_FLOATS`, `PARTICLE_POSITION_OFFSET`, `PARTICLE_SIZE_OFFSET`, `PARTICLE_COLOR_OFFSET`, `PARTICLE_ROTATION_OFFSET`, `PARTICLE_SOFTNESS_OFFSET`, `TRAIL_VERTEX_FLOATS`, `TRAIL_POSITION_OFFSET`, `TRAIL_COLOR_OFFSET`

---

### `packages/render/src/picking.ts` - Pixel/GPU-id picking — the backend-neutral half (§71; RFC 0005, accepted
=======
| `@fourjs/physics-soft` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/physics-soft`

---

### `packages/fourjs/src/serialization.ts` - serialization module
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `Matrix4` |
| `@fourjs/scene` | `Node, Viewport` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./particles.js` | `isParticleDrawable` | Import |
| `./renderable.js` | `Renderable` | Import |
| `./renderer.js` | `Renderer` | Import (type-only) |

**Exports:**
- Interfaces: `PickRequest`, `PickResult`, `PickingService`
- Functions: `supportsPicking`, `assertEncodableCandidateCount`, `collectPickCandidates`, `encodePickId`, `decodePickId`
- Constants: `MAX_PICK_CANDIDATES`

---

### `packages/render/src/raster-limits.ts` - raster-limits module

**Exports:**
- Constants: `DEFAULT_RASTER_MAXIMUM_BYTES`

---

### `packages/render/src/raster.ts` - Raster painting (§77a; RFC 0004, accepted 2026-08-21) — a surface an
=======
| `@fourjs/serialization` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/serialization`

---

### `packages/fourjs/src/render-canvas.ts` - render-canvas module
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `FourError, Disposable` |
| `@fourjs/materials` | `MaterialTexture` |
| `@fourjs/math` | `ColorSpace, Rectangle2` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./raster-limits.js` | `DEFAULT_RASTER_MAXIMUM_BYTES` | Import |
| `./gpu-readback.js` | `isGpuReadbackSource` | Import |
| `./render-target.js` | `RenderTarget` | Import (type-only) |
| `./texture-updates.js` | `TextureUpdates` | Import |
| `./texture.js` | `validateTextureSource, TextureSource` | Import |
| `./render-target.js` | `validateColorSpace` | Import |
| `./resource-memory.js` | `noteTexture, releaseRenderDisposable, trackRenderDisposable` | Import |
| `./raster-limits.js` | `DEFAULT_RASTER_MAXIMUM_BYTES` | Re-export |

**Exports:**
- Classes: `CanvasTexture`
- Interfaces: `RasterSource`, `CanvasTextureOptions`
- Types: `RasterOrigin`
- Re-exports: `DEFAULT_RASTER_MAXIMUM_BYTES`

---

### `packages/render/src/read-pixels.ts` - §61's `readPixels` seam, backend-independent half (2026-08-29).
=======
| `@fourjs/render-canvas` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/render-canvas`

---

### `packages/fourjs/src/scene.ts` - scene module
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/math` | `Rectangle2` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./render-target.js` | `RenderTarget` | Import (type-only) |

**Exports:**
- Interfaces: `PixelReader`
- Functions: `supportsReadPixels`, `validateReadbackRegion`

---

### `packages/render/src/render-graph.ts` - `RenderGraph` (§63) — an ordered list of passes, executed by one call, with
=======
| `@fourjs/scene` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/scene`

---

### `packages/fourjs/src/geometry.ts` - geometry module
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `FourError` |
| `@fourjs/scene` | `Node, Viewport` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./raster.js` | `CanvasTexture` | Import |
| `./effect-pass.js` | `supportsScreenEffects, validateEffectRenderPass, EffectRenderPass` | Import |
| `./render-list.js` | `buildRenderList, RenderItem` | Import |
| `./render-target.js` | `isRenderTargetTexture, RenderTarget` | Import |
| `./renderer.js` | `RenderInterpolation, Renderer` | Import (type-only) |

**Exports:**
- Classes: `RenderGraph`
- Interfaces: `RenderPassContext`, `SceneRenderPass`, `CustomRenderPass`, `AddPassOptions`, `RenderGraphPass`, `RenderGraphIssue`
- Types: `RenderPass`, `RenderGraphIssueCode`, `RenderGraphIssueSeverity`

---

### `packages/render/src/render-list.ts` - Render-list construction (§64) — scene graph in, flat sorted draw list out.
=======
| `@fourjs/geometry` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/geometry`

---

### `packages/fourjs/src/render.ts` - render module
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `DEV, devWarnOnce` |
| `@fourjs/geometry` | `BufferGeometry` |
| `@fourjs/math` | `Matrix4, Quaternion, Vector3` |
| `@fourjs/materials` | `LitMaterial, Material, NodeMaterial, SpriteMaterial, StandardMaterial, UnlitMaterial` |
| `@fourjs/scene` | `ALL_LAYERS, DEFAULT_LAYER_MASK, assertLayerMask, isLayerMask, layersMatch, LayerMask, Node, PoseBuffer, Skeleton, Viewport` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./bounds.js` | `computeWorldBoundingSphereFromBox, BoundingSphere` | Import |
| `./clip.js` | `ClipPlaneAllocator, RenderItemClip` | Import |
| `./particles.js` | `PARTICLE_INSTANCE_FLOATS, isParticleDrawable, particleQuadGeometry` | Import |
| `./renderable.js` | `Renderable` | Import |
| `./scissor.js` | `ScissorRect` | Import (type-only) |
| `./sprite.js` | `SpriteFrame` | Import (type-only) |

**Exports:**
- Interfaces: `UnlitRenderItem`, `SkinnedUnlitRenderItem`, `SkinnedLitRenderItem`, `LitRenderItem`, `StandardRenderItem`, `NodeRenderItem`, `SpriteRenderItem`, `ParticleRenderItem`
- Types: `RenderItemKind`, `RenderItem`
- Functions: `isSpriteItem`, `isUnlitItem`, `isLitItem`, `isStandardItem`, `isParticlesItem`, `isNodeItem`, `isSkinnedUnlitItem`, `isSkinnedLitItem`, `viewLayerMask`, `compareRenderItems`, `groupRenderListByPipeline`, `buildRenderList`, `buildInterpolatedRenderList`

---

### `packages/render/src/render-target-bytes.ts` - Per-texel byte accounting for {@link RenderTarget} attachments (§83, §84).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./render-target.js` | `RenderTargetFormat` | Import (type-only) |

**Exports:**
- Functions: `colorAttachmentBytesPerTexel`, `depthAttachmentBytesPerTexel`, `renderTargetByteLength`
- Constants: `RENDER_TARGET_RGBA8_BYTES`, `RENDER_TARGET_RGBA16F_BYTES`, `RENDER_TARGET_RGBA32F_BYTES`, `RENDER_TARGET_DEPTH_RENDERBUFFER_BYTES`, `RENDER_TARGET_DEPTH_TEXTURE_BYTES`, `RENDER_TARGET_DEPTH_STENCIL_BYTES`, `RENDER_TARGET_COLOR_BYTES`

---

### `packages/render/src/render-target.ts` - `RenderTarget` (§61, §48, §63, §77) — an off-screen surface a frame can be
=======
| `@fourjs/render` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/render`

---

### `packages/fourjs/src/render-webgl.ts` - render-webgl module
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `Disposable` |
| `@fourjs/materials` | `MaterialTexture` |
| `@fourjs/math` | `ColorSpace` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./render-target-bytes.js` | `renderTargetByteLength` | Import |
| `./resource-memory.js` | `noteRenderTarget, releaseRenderDisposable, trackRenderDisposable` | Import |

**Exports:**
- Classes: `RenderTarget`
- Interfaces: `RenderTargetOptions`, `RenderTargetTexture`
- Types: `RenderTargetFormat`
- Functions: `isRenderTargetTexture`, `validateColorSpace`

---

### `packages/render/src/renderable.ts` - `Renderable` (§49) — the node that draws something.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/geometry` | `BufferGeometry` |
| `@fourjs/materials` | `LitMaterial, Material, UnlitMaterial` |
| `@fourjs/scene` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./scissor.js` | `ScissorRect` | Import (type-only) |

**Exports:**
- Classes: `Renderable`
- Interfaces: `RenderableOptions`
- Types: `SurfaceMaterial`

---

### `packages/render/src/renderer-registry.ts` - The §62 backend registry — how a name becomes a renderer without this

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./renderer.js` | `Renderer, RendererBackend, RendererCapabilities, RendererOptions` | Import (type-only) |

**Exports:**
- Classes: `RendererRegistry`
- Interfaces: `RendererRegistration`, `RendererCapabilityDeclaration`, `RendererCapabilityShortfall`, `RendererFallbackReport`, `RendererResolveOptions`
- Types: `RendererSelection`, `RendererCapabilityName`, `RendererFallbackReason`
- Functions: `validateCapabilityDeclaration`, `missingCapabilities`, `registerRenderer`, `registeredRenderers`, `clearRegisteredRenderers`, `resolveRenderer`
- Constants: `AUTO_RENDERER_ORDER`, `RENDERER_CAPABILITY_NAMES`

---

### `packages/render/src/renderer.ts` - The renderer interface (§61) — the seam every backend implements.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Disposable` |
| `@fourjs/core` | `EventEmitter, FourError` |
| `@fourjs/materials` | `MaterialTexture` |
| `@fourjs/math` | `Rectangle2` |
| `@fourjs/scene` | `Node, PoseBuffer, Viewport` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./compute.js` | `ComputePassDescriptor` | Import (type-only) |
| `./effect-pass.js` | `EffectRenderPass` | Import (type-only) |
| `./picking.js` | `PickingService` | Import (type-only) |
| `./render-target.js` | `RenderTarget` | Import (type-only) |
| `./statistics.js` | `RenderStatistics` | Import (type-only) |

**Exports:**
- Classes: `NullRenderer`
- Interfaces: `RendererCapabilities`, `RendererOptions`, `RendererEventMap`, `RenderInterpolation`, `Renderer`, `ResizeRecord`
- Types: `RendererBackend`

---

### `packages/render/src/resource-memory.ts` - §83 resource accounting for textures and render targets — how many are live,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, disposeTracked, trackDisposable` |

**Exports:**
- Functions: `noteTexture`, `noteRenderTarget`, `textureMemoryBytes`, `liveTextureCount`, `liveRenderTargetCount`, `trackRenderDisposable`, `releaseRenderDisposable`

---

### `packages/render/src/resource-warnings.ts` - §83's "disposed resource still in use" development warning (A-4/A-5).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, devWarnOnce` |

**Exports:**
- Types: `DisposedResourceKind`
- Functions: `warnDisposedInUse`

---

### `packages/render/src/scissor.ts` - §67 rectangular scissor clipping — a per-draw axis-aligned rectangle in

**Exports:**
- Interfaces: `ScissorRect`
- Functions: `scissorsEqual`, `intersectScissor`

---

### `packages/render/src/shape-paint.ts` - The §58 paint-object tier — validation and paint-to-graph lowering behind

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/materials` | `NodeMaterialBuilder, Material, MaterialTexture, ShaderExpression` |
| `@fourjs/math` | `ColorRGBA` |
| `@fourjs/geometry` | `Point2D` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./shape.js` | `setShapePaintSupport, GradientStop, ConicGradientPaint, LinearGradientPaint, Paint, PatternPaint, RadialGradientPaint, ResolvedConicGradientPaint, ResolvedGradientStop, ResolvedLinearGradientPaint, ResolvedObjectPaint, ResolvedPaint, ResolvedPatternPaint, ResolvedRadialGradientPaint, ResolvedShapeFill, ResolvedStrokeStyle, ShapePaintPlan` | Import |

**Exports:**
- Functions: `registerShapePaints`

---

### `packages/render/src/shape.ts` - §50's native 2D shape system — the node tier (R-23, 2026-08-09).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Disposable` |
| `@fourjs/geometry` | `BufferGeometry, DEFAULT_FLATTEN_TOLERANCE, expandStroke, Path, triangulatePolygon, GeometryIndexArray, PathFillRings, Point2D, StrokeAlignment, StrokeLineCap, StrokeLineJoin, StrokeMesh` |
| `@fourjs/materials` | `Material, MaterialTexture` |
| `@fourjs/math` | `ColorRGBA` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./renderable.js` | `Renderable, RenderableOptions, SurfaceMaterial` | Import |

**Exports:**
- Classes: `Circle`, `Ellipse`, `Rectangle`, `RegularPolygon`, `Star`, `Sector`, `Ring`, `Polygon`, `PathShape`, `Line`, `Polyline`, `Arc`
- Interfaces: `SolidPaint`, `GradientStop`, `LinearGradientPaint`, `RadialGradientPaint`, `ConicGradientPaint`, `PatternPaint`, `ResolvedSolidPaint`, `ResolvedGradientStop`, `ResolvedLinearGradientPaint`, `ResolvedRadialGradientPaint`, `ResolvedConicGradientPaint`, `ResolvedPatternPaint`, `StrokeStyle`, `ResolvedStrokeStyle`, `ShapePaintPlan`, `ShapePaintSupport`, `Shape2DOptions`, `CircleOptions`, `EllipseOptions`, `RectangleOptions`, `RegularPolygonOptions`, `StarOptions`, `SectorOptions`, `RingOptions`, `PolygonOptions`, `PathShapeOptions`, `LineOptions`, `PolylineOptions`, `ArcOptions`
- Types: `ObjectPaint`, `Paint`, `ResolvedObjectPaint`, `ResolvedPaint`, `ShapeFill`, `ResolvedShapeFill`
- Functions: `setShapePaintSupport`, `resolveShapePaintSupport`, `clearRegisteredShapePaints`

---

### `packages/render/src/sprite.ts` - `Sprite` (§55) — a textured, tinted quad in the scene graph.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Disposable` |
| `@fourjs/geometry` | `BufferGeometry` |
| `@fourjs/math` | `Vector2` |
| `@fourjs/materials` | `SpriteMaterial` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./renderable.js` | `Renderable, RenderableOptions` | Import |

**Exports:**
- Classes: `Sprite`
- Interfaces: `SpriteFrame`, `SpriteTextureRun`, `SpriteTextureCarrier`, `SpriteOptions`
- Functions: `groupSpritesByTexture`

---

### `packages/render/src/statistics.ts` - Per-frame render counters (§84's `drawCalls`/`triangles`/`instances`) — the

**Exports:**
- Interfaces: `RenderStatistics`, `RenderStatisticsReporter`
- Functions: `createRenderStatistics`, `resetRenderStatistics`, `supportsRenderStatistics`

---

### `packages/render/src/texture-updates.ts` - texture-updates module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Rectangle2` |

**Exports:**
- Classes: `TextureUpdates`

---

### `packages/render/src/texture.ts` - `Texture` (§77, §55, §61) — CPU-side texel data with a stable identity and a

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError, Disposable` |
| `@fourjs/materials` | `MaterialTextureFilter, MaterialTextureMinFilter, MaterialTextureWrap, SpriteTexture` |
| `@fourjs/math` | `ColorSpace, Rectangle2` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./texture-updates.js` | `TextureUpdates` | Import |
| `./render-target.js` | `validateColorSpace` | Import |
| `./resource-memory.js` | `noteTexture, releaseRenderDisposable, trackRenderDisposable` | Import |

**Exports:**
- Classes: `Texture`
- Interfaces: `TextureSource`
- Types: `TextureFilter`, `TextureMinFilter`, `TextureWrap`, `TextureDimension`, `TextureMapRole`
- Functions: `validateTextureSource`

---

### `packages/render/src/view-list.ts` - Per-view render lists (§64 stages 2–3, §66 sort key 4; R-8) — the frame's one

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Frustum, Matrix4, Vector3` |
| `@fourjs/scene` | `layersMatch, Viewport` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./bounds.js` | `computeWorldBoundingSphere, BoundingSphere` | Import |
| `./render-list.js` | `compareRenderItems, viewLayerMask, RenderItem` | Import |

**Exports:**
- Interfaces: `ViewRenderListOptions`
- Functions: `buildViewRenderList`, `sortRenderListByDepth`

---

<a id="packages-render-canvas-dependencies"></a>

## Packages/render canvas Dependencies

### `packages/render-canvas/src/index.ts` - Entry point exporting 1 symbols

**Exports:**
- Constants: `PACKAGE_NAME`

---

<a id="packages-render-svg-dependencies"></a>

## Packages/render svg Dependencies

### `packages/render-svg/src/index.ts` - Entry point exporting 1 symbols

**Exports:**
- Constants: `PACKAGE_NAME`

---

<a id="packages-render-webgl-dependencies"></a>

## Packages/render webgl Dependencies

### `packages/render-webgl/src/gl-batch.ts` - §65 batching for the WebGL 2 backend — the GPU half of `@fourjs/render`'s

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Matrix4` |
| `@fourjs/render` | `RenderBatcher, RenderBatch, RenderBatchOptions, RenderItem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `COLOR_ATTRIBUTE_LOCATION, GL, POSITION_ATTRIBUTE_LOCATION, UV_ATTRIBUTE_LOCATION, GlBuffer, GlVertexArray, UnlitProgram, WebglContext` | Import |

**Exports:**
- Classes: `GlBatching`
- Interfaces: `BatchGlContext`, `RenderBatching`
- Functions: `createGlBatching`

---

### `packages/render-webgl/src/gl-effect.ts` - The full-screen effect pipeline for the WebGL 2 backend — §70's blit, colour

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Disposable` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `createLinkedProgram, requireUniform, GlProgramHandle, GlUniformLocation, WebglContext` | Import |

**Exports:**
- Classes: `EffectProgram`
- Constants: `EFFECT_TEXTURE_UNIT`, `EFFECT_VERTEX_COUNT`

---

### `packages/render-webgl/src/gl-geometry.ts` - GPU-side geometry for the WebGL 2 backend: one vertex array per

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `RenderItem` |
| `@fourjs/render` | `warnDisposedInUse` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `COLOR_ATTRIBUTE_LOCATION, GL, JOINTS_ATTRIBUTE_LOCATION, NORMAL_ATTRIBUTE_LOCATION, POSITION_ATTRIBUTE_LOCATION, UV_ATTRIBUTE_LOCATION, WEIGHTS_ATTRIBUTE_LOCATION, WebglContext` | Import |
| `./gl-program.js` | `GlBuffer, GlVertexArray` | Import (type-only) |

**Exports:**
- Classes: `GeometryCache`
- Interfaces: `GeometryRecord`
- Types: `CacheableGeometry`

---

### `packages/render-webgl/src/gl-gpu-timer.ts` - WebGL 2 GPU-frame timer — `EXT_disjoint_timer_query_webgl2` (A-1, §62, §84).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `GL, GlQuery` | Import |

**Exports:**
- Classes: `GlGpuTimer`
- Functions: `hasDisjointTimerQuery`

---

### `packages/render-webgl/src/gl-node-program.ts` - The node-material pipeline (§60, §62; RFC 0001 — gap R-14): a GLSL ES 3.00

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, FourError, devWarnOnce, Disposable` |
| `@fourjs/math` | `Matrix4` |
| `@fourjs/render` | `analyzeShaderGraph, createShaderSourceMap, ShaderSourceMap, ShaderAttributeName, ShaderDomain, ShaderGraph, ShaderGraphAnalysis, ShaderNode, ShaderUniformReflection, ShaderValueType` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `createLinkedProgram, matrixScratch, requireUniform, GlProgramHandle, GlUniformLocation, WebglContext` | Import |
| `./node-pipeline-registry.js` | `NODE_SURFACE_TEXTURE_UNIT_BASE, setNodeMaterialPipelineFactory, NodeItemMaterial, NodeMaterialProgram, NodeMaterialPrograms` | Import |
| `./gl-node-uniform-block.js` | `GlNodeUniformBlock` | Import |

**Exports:**
- Classes: `GlNodeProgram`, `GlNodeProgramCache`
- Interfaces: `EmittedNodeShader`
- Functions: `emitShaderGraphGlsl`, `registerNodeMaterialPipeline`

---

### `packages/render-webgl/src/gl-node-uniform-block.ts` - Opt-in std140 transport. Scalars and vectors occupy one vec4 lane; matrices

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/render` | `ShaderUniformReflection` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `GlBuffer, GlProgramHandle, WebglContext` | Import (type-only) |

**Exports:**
- Classes: `GlNodeUniformBlock`

---

### `packages/render-webgl/src/gl-particles.ts` - The batched particle pipeline for the WebGL 2 backend (§36, §64 stage 6,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Disposable` |
| `@fourjs/math` | `Matrix4` |
| `@fourjs/render` | `PARTICLE_COLOR_OFFSET, PARTICLE_INSTANCE_FLOATS, PARTICLE_POSITION_OFFSET, PARTICLE_ROTATION_OFFSET, PARTICLE_SIZE_OFFSET, PARTICLE_SOFTNESS_OFFSET, PARTICLE_WIDE_INSTANCE_FLOATS, TRAIL_COLOR_OFFSET, TRAIL_POSITION_OFFSET, TRAIL_VERTEX_FLOATS, ParticleRenderItem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `GL, POSITION_ATTRIBUTE_LOCATION, MAP_TEXTURE_UNIT, createLinkedProgram, matrixScratch, requireUniform, GlBuffer, GlProgramHandle, GlUniformLocation, GlVertexArray, WebglContext` | Import |

**Exports:**
- Classes: `ParticleProgram`, `ParticleAppearanceProgram`, `ParticleBatchCache`, `ParticleTrailProgram`, `ParticleTrailBatchCache`
- Interfaces: `ParticleGlContext`, `ParticleBatchRecord`, `ParticleTrailBatchRecord`
- Functions: `particleItemFloats`
- Constants: `PARTICLE_GL`, `PARTICLE_ATTRIBUTE_LOCATIONS`, `PARTICLE_VERTEX_SHADER_SOURCE`, `PARTICLE_DEPTH_TEXTURE_UNIT`

---

### `packages/render-webgl/src/gl-picking-registry.ts` - The picking pipeline's registration slot (§71, §62; RFC 0005, 2026-08-28) —
=======
| `@fourjs/render-webgl` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/render-webgl`

---

### `packages/fourjs/src/pick-provider.ts` - The four-line adapter RFC 0005 §2 promised (§71, §45; 2026-08-28): a
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/render` | `PickingService` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-geometry.js` | `GeometryCache` | Import (type-only) |
| `./gl-particles.js` | `ParticleBatchCache` | Import (type-only) |
| `./gl-program.js` | `WebglContext` | Import (type-only) |
| `./gl-render-target.js` | `RenderTargetCache` | Import (type-only) |

**Exports:**
- Interfaces: `PickingRendererHost`, `PickingServiceFactory`
- Functions: `setPickingServiceFactory`, `resolvePickingServiceFactory`, `clearRegisteredPickingPipeline`

---

### `packages/render-webgl/src/gl-picking.ts` - The WebGL 2 picking service (§71, §62; RFC 0005, 2026-08-28) — the id-buffer
=======
| `@fourjs/input` | `PickProvider` |
| `@fourjs/render` | `PickingService` |
| `@fourjs/scene` | `Viewport` |

**Exports:**
- Functions: `createPickProvider`

---

### `packages/fourjs/src/math.ts` - math module
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `DEV, FourError, devWarnOnce` |
| `@fourjs/math` | `Frustum, Matrix4` |
| `@fourjs/render` | `RenderTarget, assertEncodableCandidateCount, buildRenderList, buildViewRenderList, collectPickCandidates, decodePickId, encodePickId, PickRequest, PickResult, PickingService, RenderItem, RenderItemClip, RenderItemStencil` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-geometry.js` | `GeometryCache` | Import (type-only) |
| `./gl-particles.js` | `PARTICLE_VERTEX_SHADER_SOURCE, ParticleBatchCache, ParticleGlContext` | Import |
| `./gl-picking-registry.js` | `setPickingServiceFactory, PickingRendererHost` | Import |
| `./gl-program.js` | `GL, createLinkedProgram, matrixScratch, requireUniform, GlProgramHandle, GlUniformLocation, WebglContext` | Import |
| `./gl-render-target.js` | `RenderTargetRecord` | Import (type-only) |
| `./gl-skinning-glsl.js` | `SKINNING_GLSL` | Import |

**Exports:**
- Classes: `IdPassProgram`, `ParticleIdProgram`, `SkinnedIdProgram`, `WebglPickingService`
- Functions: `registerPickingPipeline`
- Constants: `PICKING_GL`

---

### `packages/render-webgl/src/gl-program.ts` - The WebGL 2 surface this backend uses, and the pipelines it draws with
=======
| `@fourjs/math` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/math`

---

### `packages/fourjs/src/diagnostics.ts` - diagnostics module
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `FourError, Disposable` |
| `@fourjs/math` | `Matrix3, Matrix4, Vector3` |
| `@fourjs/render` | `MAX_PUNCTUAL_LIGHTS, SceneLights` |

**Exports:**
- Classes: `HemisphereLightUniforms`, `PunctualLightUniforms`, `ShadowUniforms`, `UnlitProgram`, `SpriteProgram`, `LitProgram`
- Interfaces: `WebglContext`
- Types: `GlShader`, `GlProgramHandle`, `GlBuffer`, `GlVertexArray`, `GlUniformLocation`, `GlTexture`, `GlFramebuffer`, `GlRenderbuffer`, `GlSync`, `GlQuery`
- Functions: `uploadNormalMatrix`, `createLinkedProgram`, `requireUniform`
- Constants: `GL`, `POSITION_ATTRIBUTE_LOCATION`, `NORMAL_ATTRIBUTE_LOCATION`, `UV_ATTRIBUTE_LOCATION`, `COLOR_ATTRIBUTE_LOCATION`, `JOINTS_ATTRIBUTE_LOCATION`, `WEIGHTS_ATTRIBUTE_LOCATION`, `MAP_TEXTURE_UNIT`, `SHADOW_TEXTURE_UNIT`, `METAL_ROUGHNESS_TEXTURE_UNIT`, `EMISSIVE_TEXTURE_UNIT`, `FRAGMENT_SHADER_SOURCE`, `PUNCTUAL_LIGHT_GLSL`, `HEMISPHERE_LIGHT_GLSL`, `SHADOW_GLSL`, `LIT_FRAGMENT_SHADER_SOURCE`, `matrixScratch`

---

### `packages/render-webgl/src/gl-render-target.ts` - GPU-side render targets for the WebGL 2 backend: one framebuffer object per

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `RenderTarget` |
| `@fourjs/render` | `warnDisposedInUse` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `GL, GlFramebuffer, GlRenderbuffer, GlTexture, WebglContext` | Import |

**Exports:**
- Classes: `RenderTargetCache`
- Interfaces: `RenderTargetRecord`
- Types: `CacheableRenderTarget`

---

### `packages/render-webgl/src/gl-shadow.ts` - The depth-only caster pipeline (§69) — this backend's seventh program (R-18,
=======
| `@fourjs/diagnostics` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/diagnostics`

---

### `packages/fourjs/src/text-node.ts` - `Text` (§49, §56) — a string, a font atlas and a material become **one** draw
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `Disposable` |
| `@fourjs/math` | `Matrix4` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `createLinkedProgram, matrixScratch, requireUniform, GlProgramHandle, GlUniformLocation, WebglContext` | Import |

**Exports:**
- Classes: `ShadowProgram`

---

### `packages/render-webgl/src/gl-skinning-glsl.ts` - The vertex-stage skinning chunk both the colour/caster programs
=======
| `@fourjs/geometry` | `BufferGeometry` |
| `@fourjs/materials` | `UnlitMaterial` |
| `@fourjs/render` | `Renderable, RenderableOptions` |
| `@fourjs/text` | `layoutText, GlyphAtlas, TextAlign, TextLayout` |
| `@fourjs/core` | `Disposable` |

**Exports:**
- Classes: `Text`
- Interfaces: `TextOptions`

---

### `packages/fourjs/src/live-resource-counts.ts` - Aggregates §83 live-resource counts for `auditResourceLeaks`.
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/render` | `MAX_SKINNING_JOINTS` |

**Exports:**
- Constants: `SKINNING_GLSL`

---

### `packages/render-webgl/src/gl-skinning-registry.ts` - The skinning pipeline's registration slot (§54, §62; RFC 0003, 2026-08-28)
=======
| `@fourjs/diagnostics` | `LiveResourceCounts` |
| `@fourjs/geometry` | `geometryMemoryBytes, liveGeometryCount` |
| `@fourjs/materials` | `liveMaterialCount` |
| `@fourjs/physics` | `liveSolverBodyCount, liveSolverColliderCount, liveSolverHandleCount, liveSolverJointCount` |
| `@fourjs/render` | `liveRenderTargetCount, liveTextureCount, textureMemoryBytes` |

**Exports:**
- Functions: `readLiveResourceCounts`

---

### `packages/fourjs/src/materials.ts` - materials module
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/math` | `Matrix4` |
| `@fourjs/render` | `SceneLights` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `WebglContext` | Import (type-only) |

**Exports:**
- Interfaces: `SkinnedUnlitPipeline`, `SkinnedLitPipeline`, `SkinnedShadowPipeline`, `SkinnedPrograms`, `SkinningPipelineFactory`
- Functions: `setSkinningPipelineFactory`, `resolveSkinningPipelineFactory`, `clearRegisteredSkinningPipeline`

---

### `packages/render-webgl/src/gl-skinning.ts` - The skinned pipelines (§54, §62; RFC 0003 — gaps PH-10 + R-22, 2026-08-28):

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Disposable` |
| `@fourjs/math` | `Matrix4` |
| `@fourjs/render` | `SceneLights` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-skinning-glsl.js` | `SKINNING_GLSL` | Import |
| `./gl-program.js` | `FRAGMENT_SHADER_SOURCE, LIT_FRAGMENT_SHADER_SOURCE, MAP_TEXTURE_UNIT, HemisphereLightUniforms, PunctualLightUniforms, ShadowUniforms, createLinkedProgram, matrixScratch, requireUniform, GlProgramHandle, GlUniformLocation, WebglContext` | Import |
| `./gl-skinning-registry.js` | `setSkinningPipelineFactory, SkinnedLitPipeline, SkinnedPrograms, SkinnedShadowPipeline, SkinnedUnlitPipeline` | Import |

**Exports:**
- Classes: `SkinnedUnlitProgram`, `SkinnedLitProgram`, `SkinnedShadowProgram`
- Functions: `registerSkinningPipeline`

---

### `packages/render-webgl/src/gl-standard.ts` - The metallic-roughness pipeline (§59, §68) — this backend's sixth program,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Disposable` |
| `@fourjs/math` | `Matrix4, Vector3` |
| `@fourjs/render` | `SceneLights` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `EMISSIVE_TEXTURE_UNIT, MAP_TEXTURE_UNIT, METAL_ROUGHNESS_TEXTURE_UNIT, HEMISPHERE_LIGHT_GLSL, HemisphereLightUniforms, PUNCTUAL_LIGHT_GLSL, PunctualLightUniforms, SHADOW_GLSL, ShadowUniforms, createLinkedProgram, matrixScratch, requireUniform, uploadNormalMatrix, GlProgramHandle, GlUniformLocation, WebglContext` | Import |

**Exports:**
- Classes: `StandardProgram`
- Constants: `NORMAL_TEXTURE_UNIT`, `OCCLUSION_TEXTURE_UNIT`

---

### `packages/render-webgl/src/gl-texture.ts` - GPU-side textures for the WebGL 2 backend: one `WebGLTexture` per
=======
| `@fourjs/materials` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/materials`

---

### `packages/fourjs/src/editor-tools.ts` - The §81 editor-tool registry — a named map of tool factories the **host**
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
<<<<<<< HEAD
| `@fourjs/render` | `SpriteRenderItem` |
| `@fourjs/render` | `warnDisposedInUse` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `GL, GlTexture, WebglContext` | Import |

**Exports:**
- Classes: `TextureCache`
- Interfaces: `TextureRecord`
- Types: `CacheableTexture`

---

### `packages/render-webgl/src/index.ts` - `@fourjs/render-webgl` — the WebGL 2 backend (§62 backend 2, §120's MVP tier).
=======

**Exports:**
- Classes: `EditorToolRegistry`
- Types: `EditorToolFactory`

---

### `packages/fourjs/src/scene-serializers.ts` - §79 node types and component serializers for the classes the engine itself

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError, JsonValue` |
| `@fourjs/geometry` | `Path, BufferGeometry, Point2D` |
| `@fourjs/materials` | `Material, MaterialTexture, SpriteMaterial, UnlitMaterial` |
| `@fourjs/motion` | `CAMERA_SHAKE_SERIALIZER, CHARACTER_CONTROLLER_SERIALIZER, CameraShake, CharacterController, FIRST_PERSON_LOOK_SERIALIZER, FOLLOW_RIG_SERIALIZER, FirstPersonLook, FollowRig, KINEMATIC_CONTROLLER_SERIALIZER, KinematicController, LOOK_AT_CONSTRAINT_SERIALIZER, LookAtConstraint, MOTION_COMPONENT_SERIALIZER, MotionComponent, ORBIT_RIG_SERIALIZER, OrbitRig` |
| `@fourjs/physics` | `COLLIDER_SERIALIZER, Collider, RIGID_BODY_SERIALIZER, RigidBody, SWEPT_CHARACTER_CONTROLLER_SERIALIZER, SweptCharacterController` |
| `@fourjs/render` | `Arc, Circle, Ellipse, Line, Mesh, PathShape, Polygon, Polyline, Rectangle, RegularPolygon, Renderable, Ring, Sector, Shape2D, Sprite, Star, resolveShapePaintSupport, restoreMeshSkeleton` |
| `@fourjs/render` | `GradientStop, Paint, ResolvedPaint, ResolvedShapeFill, ResolvedStrokeStyle, ScissorRect` |
| `@fourjs/scene` | `Bone, DirectionalLight, HemisphereLight, MORPH_WEIGHTS_SERIALIZER, MorphWeights, NODE_SPACE_SERIALIZER, NodeSpace, OrthographicCamera, PerspectiveCamera, PointLight, SCREEN_ORIGINS, SCREEN_UNITS, ScreenCamera, SpotLight, restoreNodeId, HitTestMode, Node` |
| `@fourjs/serialization` | `ComponentSerializerRegistry, createDefaultComponentSerializers, InstantiateSceneOptions, SceneNodeDocument, SerializeSceneOptions` |
| `@fourjs/text` | `GlyphAtlas, TextAlign` |
| `@fourjs/ui` | `Button, CanvasViewWidget, Checkbox, ImageWidget, Label, Panel, ProgressIndicator, RadioButton, Slider, Toggle, UIWidget, CheckableWidget, UIWidgetOptions, WidgetAccessibility` |
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
<<<<<<< HEAD
| `./gl-batch.js` | `GlBatching, createGlBatching` | Re-export |
| `./gl-effect.js` | `EFFECT_TEXTURE_UNIT, EFFECT_VERTEX_COUNT, EffectProgram` | Re-export |
| `./gl-geometry.js` | `GeometryCache` | Re-export |
| `./gl-particles.js` | `PARTICLE_ATTRIBUTE_LOCATIONS, PARTICLE_DEPTH_TEXTURE_UNIT, PARTICLE_GL, PARTICLE_VERTEX_SHADER_SOURCE, ParticleAppearanceProgram, ParticleBatchCache, ParticleProgram, ParticleTrailBatchCache, ParticleTrailProgram, particleItemFloats` | Re-export |
| `./gl-program.js` | `COLOR_ATTRIBUTE_LOCATION, GL, LitProgram, MAP_TEXTURE_UNIT, METAL_ROUGHNESS_TEXTURE_UNIT, EMISSIVE_TEXTURE_UNIT, NORMAL_ATTRIBUTE_LOCATION, POSITION_ATTRIBUTE_LOCATION, HEMISPHERE_LIGHT_GLSL, HemisphereLightUniforms, PUNCTUAL_LIGHT_GLSL, PunctualLightUniforms, SHADOW_GLSL, SHADOW_TEXTURE_UNIT, ShadowUniforms, SpriteProgram, UV_ATTRIBUTE_LOCATION, UnlitProgram` | Re-export |
| `./gl-picking-registry.js` | `clearRegisteredPickingPipeline, resolvePickingServiceFactory` | Re-export |
| `./gl-picking.js` | `IdPassProgram, PICKING_GL, ParticleIdProgram, SkinnedIdProgram, WebglPickingService, registerPickingPipeline` | Re-export |
| `./gl-render-target.js` | `RenderTargetCache` | Re-export |
| `./gl-program.js` | `JOINTS_ATTRIBUTE_LOCATION, WEIGHTS_ATTRIBUTE_LOCATION` | Re-export |
| `./gl-skinning-registry.js` | `clearRegisteredSkinningPipeline, resolveSkinningPipelineFactory` | Re-export |
| `./gl-skinning.js` | `SKINNING_GLSL, SkinnedLitProgram, SkinnedShadowProgram, SkinnedUnlitProgram, registerSkinningPipeline` | Re-export |
| `./node-pipeline-registry.js` | `NODE_SURFACE_TEXTURE_UNIT_BASE, clearRegisteredNodeMaterialPipeline, resolveNodeMaterialPipelineFactory` | Re-export |
| `./gl-node-program.js` | `GlNodeProgram, GlNodeProgramCache, emitShaderGraphGlsl, registerNodeMaterialPipeline` | Re-export |
| `./gl-shadow.js` | `ShadowProgram` | Re-export |
| `./gl-standard.js` | `StandardProgram` | Re-export |
| `./gl-texture.js` | `TextureCache` | Re-export |
| `./register.js` | `isWebgl2Supported, registerWebglRenderer` | Re-export |
| `./webgl-renderer.js` | `WebglRenderer` | Re-export |
| `./gl-batch.js` | `BatchGlContext, RenderBatching` | Re-export (type-only) |
| `./gl-geometry.js` | `CacheableGeometry, GeometryRecord` | Re-export (type-only) |
| `./gl-particles.js` | `ParticleBatchRecord, ParticleGlContext, ParticleTrailBatchRecord` | Re-export (type-only) |
| `./gl-program.js` | `GlBuffer, GlProgramHandle, GlShader, GlQuery, GlSync, GlTexture, GlUniformLocation, GlVertexArray, WebglContext` | Re-export (type-only) |
| `./gl-program.js` | `GlFramebuffer, GlRenderbuffer` | Re-export (type-only) |
| `./gl-picking-registry.js` | `PickingRendererHost, PickingServiceFactory` | Re-export (type-only) |
| `./gl-render-target.js` | `CacheableRenderTarget, RenderTargetRecord` | Re-export (type-only) |
| `./gl-skinning-registry.js` | `SkinnedLitPipeline, SkinnedPrograms, SkinnedShadowPipeline, SkinnedUnlitPipeline, SkinningPipelineFactory` | Re-export (type-only) |
| `./node-pipeline-registry.js` | `NodeItemMaterial, NodeMaterialPipelineFactory, NodeMaterialProgram, NodeMaterialPrograms` | Re-export (type-only) |
| `./gl-node-program.js` | `EmittedNodeShader` | Re-export (type-only) |
| `./gl-texture.js` | `CacheableTexture, TextureRecord` | Re-export (type-only) |
| `./webgl-renderer.js` | `WebglCanvas, WebglContextAttributes, WebglContextEventLike` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `GlBatching`, `createGlBatching`, `EFFECT_TEXTURE_UNIT`, `EFFECT_VERTEX_COUNT`, `EffectProgram`, `GeometryCache`, `PARTICLE_ATTRIBUTE_LOCATIONS`, `PARTICLE_DEPTH_TEXTURE_UNIT`, `PARTICLE_GL`, `PARTICLE_VERTEX_SHADER_SOURCE`, `ParticleAppearanceProgram`, `ParticleBatchCache`, `ParticleProgram`, `ParticleTrailBatchCache`, `ParticleTrailProgram`, `particleItemFloats`, `COLOR_ATTRIBUTE_LOCATION`, `GL`, `LitProgram`, `MAP_TEXTURE_UNIT`, `METAL_ROUGHNESS_TEXTURE_UNIT`, `EMISSIVE_TEXTURE_UNIT`, `NORMAL_ATTRIBUTE_LOCATION`, `POSITION_ATTRIBUTE_LOCATION`, `HEMISPHERE_LIGHT_GLSL`, `HemisphereLightUniforms`, `PUNCTUAL_LIGHT_GLSL`, `PunctualLightUniforms`, `SHADOW_GLSL`, `SHADOW_TEXTURE_UNIT`, `ShadowUniforms`, `SpriteProgram`, `UV_ATTRIBUTE_LOCATION`, `UnlitProgram`, `clearRegisteredPickingPipeline`, `resolvePickingServiceFactory`, `IdPassProgram`, `PICKING_GL`, `ParticleIdProgram`, `SkinnedIdProgram`, `WebglPickingService`, `registerPickingPipeline`, `RenderTargetCache`, `JOINTS_ATTRIBUTE_LOCATION`, `WEIGHTS_ATTRIBUTE_LOCATION`, `clearRegisteredSkinningPipeline`, `resolveSkinningPipelineFactory`, `SKINNING_GLSL`, `SkinnedLitProgram`, `SkinnedShadowProgram`, `SkinnedUnlitProgram`, `registerSkinningPipeline`, `NODE_SURFACE_TEXTURE_UNIT_BASE`, `clearRegisteredNodeMaterialPipeline`, `resolveNodeMaterialPipelineFactory`, `GlNodeProgram`, `GlNodeProgramCache`, `emitShaderGraphGlsl`, `registerNodeMaterialPipeline`, `ShadowProgram`, `StandardProgram`, `TextureCache`, `isWebgl2Supported`, `registerWebglRenderer`, `WebglRenderer`, `BatchGlContext`, `RenderBatching`, `CacheableGeometry`, `GeometryRecord`, `ParticleBatchRecord`, `ParticleGlContext`, `ParticleTrailBatchRecord`, `GlBuffer`, `GlProgramHandle`, `GlShader`, `GlQuery`, `GlSync`, `GlTexture`, `GlUniformLocation`, `GlVertexArray`, `WebglContext`, `GlFramebuffer`, `GlRenderbuffer`, `PickingRendererHost`, `PickingServiceFactory`, `CacheableRenderTarget`, `RenderTargetRecord`, `SkinnedLitPipeline`, `SkinnedPrograms`, `SkinnedShadowPipeline`, `SkinnedUnlitPipeline`, `SkinningPipelineFactory`, `NodeItemMaterial`, `NodeMaterialPipelineFactory`, `NodeMaterialProgram`, `NodeMaterialPrograms`, `EmittedNodeShader`, `CacheableTexture`, `TextureRecord`, `WebglCanvas`, `WebglContextAttributes`, `WebglContextEventLike`
=======
| `./text-node.js` | `Text` | Import |

**Exports:**
- Interfaces: `SceneResourceCatalog`, `SceneNodeTypeOptions`, `SceneNodeTypeSupport`, `SceneSerializationSupport`
- Types: `UnknownResourcePolicy`
- Functions: `resourceCatalog`, `registerUISerializers`, `registerRenderSerializers`, `registerShapeSerializers`, `registerTextSerializers`, `composeSceneNodeTypes`, `registerPhysicsSerializers`, `registerSceneNodeTypes`
- Constants: `PANEL_NODE_TYPE`, `LABEL_NODE_TYPE`, `BUTTON_NODE_TYPE`, `TOGGLE_NODE_TYPE`, `CHECKBOX_NODE_TYPE`, `RADIO_BUTTON_NODE_TYPE`, `SLIDER_NODE_TYPE`, `PROGRESS_NODE_TYPE`, `IMAGE_NODE_TYPE`, `CANVAS_VIEW_NODE_TYPE`, `RENDERABLE_NODE_TYPE`, `SPRITE_NODE_TYPE`, `MESH_NODE_TYPE`, `BONE_NODE_TYPE`, `TEXT_NODE_TYPE`, `PERSPECTIVE_CAMERA_NODE_TYPE`, `ORTHOGRAPHIC_CAMERA_NODE_TYPE`, `SCREEN_CAMERA_NODE_TYPE`, `DIRECTIONAL_LIGHT_NODE_TYPE`, `POINT_LIGHT_NODE_TYPE`, `SPOT_LIGHT_NODE_TYPE`, `HEMISPHERE_LIGHT_NODE_TYPE`, `CIRCLE_NODE_TYPE`, `ELLIPSE_NODE_TYPE`, `RECTANGLE_NODE_TYPE`, `REGULAR_POLYGON_NODE_TYPE`, `POLYGON_NODE_TYPE`, `STAR_NODE_TYPE`, `SECTOR_NODE_TYPE`, `RING_NODE_TYPE`, `PATH_SHAPE_NODE_TYPE`, `LINE_NODE_TYPE`, `POLYLINE_NODE_TYPE`, `ARC_NODE_TYPE`

---

### `packages/fourjs/src/animation.ts` - animation module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/animation` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/animation`

---

### `packages/fourjs/src/physics-rapier.ts` - physics-rapier module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/physics-rapier` | `*` |

**Exports:**
- Re-exports: `* from @fourjs/physics-rapier`
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

---

### `packages/render-webgl/src/node-pipeline-registry.ts` - The node-material pipeline's registration slot (§60, §62; RFC 0001, gap

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Matrix4` |
| `@fourjs/render` | `NodeRenderItem, ShaderGraph` |

<<<<<<< HEAD
**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-program.js` | `WebglContext` | Import (type-only) |

**Exports:**
- Interfaces: `NodeMaterialProgram`, `NodeMaterialPrograms`, `NodeMaterialPipelineFactory`
- Types: `NodeItemMaterial`
- Functions: `setNodeMaterialPipelineFactory`, `resolveNodeMaterialPipelineFactory`, `clearRegisteredNodeMaterialPipeline`
- Constants: `NODE_SURFACE_TEXTURE_UNIT_BASE`

---

### `packages/render-webgl/src/register.ts` - This backend's opt-in to §62's renderer registry (R-2, A-8).
=======
### `packages/serialization/src/capabilities.ts` - This package's §81 capability tokens (RFC 0002; declared here since
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/render` | `registerRenderer, RendererOptions, RendererRegistry` |
=======
| `@fourjs/core` | `defineCapability` |
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
<<<<<<< HEAD
| `./webgl-renderer.js` | `WebglRenderer` | Import |

**Exports:**
- Functions: `isWebgl2Supported`, `registerWebglRenderer`

---

### `packages/render-webgl/src/webgl-renderer.ts` - The WebGL 2 backend (§61, §62, §120) — the MVP's only renderer.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, devWarnOnce, EventEmitter, FourError` |
| `@fourjs/math` | `Frustum, Matrix4, Rectangle2` |
| `@fourjs/render` | `MAX_SKINNING_JOINTS, RenderTarget, buildInterpolatedRenderList, buildRenderList, buildViewRenderList, collectSceneLights, createSceneLights, isLitItem, isNodeItem, isParticlesItem, isRenderTargetTexture, isSkinnedLitItem, isSkinnedUnlitItem, isSpriteItem, isStandardItem, intersectScissor, validateReadbackRegion, COLOR_GRADE_DEFAULTS, EffectRenderPass, GraphEffect, PickingService, RenderItem, RenderItemKind, RenderStatistics, Renderer, RendererCapabilities, ScissorRect, RendererEventMap, RendererOptions, ScreenEffectRenderer` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./gl-batch.js` | `RenderBatching` | Import (type-only) |
| `./gl-effect.js` | `EFFECT_TEXTURE_UNIT, EFFECT_VERTEX_COUNT, EffectProgram` | Import |
| `./gl-geometry.js` | `GeometryCache` | Import |
| `./gl-gpu-timer.js` | `GlGpuTimer, hasDisjointTimerQuery` | Import |
| `./gl-particles.js` | `ParticleAppearanceProgram, ParticleBatchCache, ParticleProgram, ParticleTrailBatchCache, ParticleTrailProgram, particleItemFloats, ParticleGlContext` | Import |
| `./gl-program.js` | `GL, LitProgram, EMISSIVE_TEXTURE_UNIT, MAP_TEXTURE_UNIT, METAL_ROUGHNESS_TEXTURE_UNIT, SHADOW_TEXTURE_UNIT, SpriteProgram, UnlitProgram, GlTexture` | Import |
| `./gl-picking-registry.js` | `resolvePickingServiceFactory, PickingRendererHost` | Import |
| `./gl-render-target.js` | `RenderTargetCache, RenderTargetRecord` | Import |
| `./gl-skinning-registry.js` | `resolveSkinningPipelineFactory, SkinnedPrograms, SkinnedShadowPipeline` | Import |
| `./node-pipeline-registry.js` | `NODE_SURFACE_TEXTURE_UNIT_BASE, resolveNodeMaterialPipelineFactory, NodeMaterialProgram, NodeMaterialPrograms` | Import |
| `./gl-shadow.js` | `ShadowProgram` | Import |
| `./gl-standard.js` | `StandardProgram, NORMAL_TEXTURE_UNIT, OCCLUSION_TEXTURE_UNIT` | Import |
| `./gl-texture.js` | `TextureCache, CacheableTexture` | Import |

**Exports:**
- Classes: `WebglRenderer`
- Interfaces: `WebglContextEventLike`, `WebglCanvas`, `WebglContextAttributes`

---

<a id="packages-render-webgpu-dependencies"></a>

## Packages/render webgpu Dependencies

### `packages/render-webgpu/src/index.ts` - `@fourjs/render-webgpu` — the WebGPU backend (§62 backend 1).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GPU_MAP_MODE, GPU_SHADER_STAGE, GPU_TEXTURE_USAGE, UNIFORM_STRIDE_BYTES` | Re-export |
| `./webgpu-renderer.js` | `hostGpu, WebgpuRenderer` | Re-export |
| `./register.js` | `isWebgpuSupported, registerWebgpuRenderer` | Re-export |
| `./wgpu-bindings.js` | `DRAW_COLOR_OFFSET, DRAW_MODEL_OFFSET, DRAW_NORMAL_OFFSET, DRAW_UNIFORM_BYTES, DRAW_UNIFORM_FLOATS, DRAW_UNIFORM_WGSL, DRAW_VIEW_PROJECTION_OFFSET, MAP_BINDING_WGSL, MAP_BIND_GROUP_INDEX, MAP_SAMPLER_BINDING, MAP_TEXTURE_BINDING, createDrawBindGroupLayout, createTextureBindGroupLayout` | Re-export |
| `./wgpu-geometry.js` | `WgpuGeometryCache` | Re-export |
| `./wgpu-pipeline-cache.js` | `blendStateFor, pipelineKey, stencilStateFor, WgpuPipelineCache` | Re-export |
| `./wgpu-batch.js` | `WgpuBatching, batchVertexBufferLayout, createWgpuBatching` | Re-export |
| `./wgpu-sprite.js` | `SPRITE_MODEL_OFFSET, SPRITE_SHADER_SOURCE, SPRITE_TINT_OFFSET, SPRITE_UNIFORM_BYTES, SPRITE_UNIFORM_WGSL, SPRITE_VIEW_PROJECTION_OFFSET, createSpriteBindGroupLayout` | Re-export |
| `./wgpu-texture.js` | `MIPMAP_SHADER_SOURCE, WgpuTextureCache, mipLevelCount, samplerKey, textureByteLength` | Re-export |
| `./wgpu-unlit.js` | `CLEAR_SHADER_SOURCE, CLEAR_VERTEX_COUNT, COLOR_BUFFER_LAYOUT, COLOR_SHADER_LOCATION, FRAGMENT_ENTRY_POINT, POSITION_BUFFER_LAYOUT, POSITION_SHADER_LOCATION, UV_BUFFER_LAYOUT, UV_SHADER_LOCATION, VERTEX_ENTRY_POINT, unlitShaderSource, unlitVertexBufferLayouts, unlitFragmentStageWgsl` | Re-export |
| `./wgpu-lights.js` | `LIGHTS_BIND_GROUP_INDEX, LIGHT_AMBIENT_OFFSET, LIGHT_CAMERA_OFFSET, LIGHT_COLOR_OFFSET, LIGHT_COUNTS_OFFSET, LIGHT_DIRECTION_OFFSET, LIGHT_PUNCTUAL_COLOR_OFFSET, LIGHT_PUNCTUAL_DIRECTION_OFFSET, LIGHT_PUNCTUAL_PARAMS_OFFSET, LIGHT_PUNCTUAL_POSITION_OFFSET, HEMISPHERE_GROUND_OFFSET, HEMISPHERE_IRRADIANCE_WGSL, HEMISPHERE_SKY_OFFSET, HEMISPHERE_UNIFORM_MEMBERS_WGSL, HEMISPHERE_UP_OFFSET, LIGHT_BINDING_BYTES, LIGHT_UNIFORM_BYTES, LIGHT_UNIFORM_FLOATS, LIGHT_UNIFORM_MEMBERS_WGSL, LIGHT_UNIFORM_STRIDE_BYTES, LIGHT_UNIFORM_STRIDE_FLOATS, LIGHT_UNIFORM_WGSL, PUNCTUAL_LIGHT_WGSL, SHADED_MAP_BINDING_WGSL, SHADED_MAP_BIND_GROUP_INDEX, SHADED_MR_BINDING_WGSL, SHADED_MR_BIND_GROUP_INDEX, createLightsBindGroupLayout, shadedMrBindingWgsl, writeLightUniforms` | Re-export |
| `./wgpu-lit.js` | `NORMAL_BUFFER_LAYOUT, NORMAL_MATRIX_WGSL, NORMAL_SHADER_LOCATION, litShaderSource, shadedVertexBufferLayouts, shadedVertexStageWgsl, litFragmentStageWgsl` | Re-export |
| `./wgpu-render-target.js` | `RENDER_TARGET_COLOR_FORMAT, RENDER_TARGET_DEPTH_FORMAT, RENDER_TARGET_DEPTH_STENCIL_FORMAT, RENDER_TARGET_DEPTH_TEXTURE_FORMAT, WgpuRenderTargetCache, renderTargetDepthFormat` | Re-export |
| `./wgpu-effect.js` | `EFFECT_BIND_GROUP_INDEX, EFFECT_GRADE_OFFSET, EFFECT_PASS_VERTEX_COUNT, EFFECT_UNIFORM_BYTES, EFFECT_UNIFORM_WGSL, createEffectBindGroupLayout, effectShaderSource` | Re-export |
| `./wgpu-readback.js` | `READBACK_ROW_ALIGNMENT, readTexturePixels, readbackBytesPerRow` | Re-export |
| `./wgpu-compute.js` | `COMPUTE_ENTRY_POINT, PARTICLE_INTEGRATOR_SHADER_SOURCE, PARTICLE_INTEGRATOR_WORKGROUP_SIZE, PARTICLE_SIMULATION_PARAMS_FLOATS, WgpuComputeBuffer, WgpuComputeCache, createComputeBuffer, particleIntegratorWorkgroups, readComputeBufferBytes, writeComputeBuffer, writeParticleSimulationParams` | Re-export |
| `./wgpu-particles.js` | `PARTICLE_GPU_INSTANCE_BUFFER_LAYOUT, PARTICLE_GPU_POSITION_BUFFER_LAYOUT, PARTICLE_GPU_VERTEX_BUFFER_LAYOUTS, PARTICLE_APPEARANCE_SHADER_SOURCE, PARTICLE_INSTANCE_BUFFER_LAYOUT, PARTICLE_INSTANCE_STRIDE_BYTES, PARTICLE_MODEL_OFFSET, PARTICLE_PROJECTION_OFFSET, PARTICLE_SHADER_SOURCE, PARTICLE_WIDE_INSTANCE_BUFFER_LAYOUT, PARTICLE_WIDE_INSTANCE_STRIDE_BYTES, PARTICLE_UNIFORM_BYTES, PARTICLE_UNIFORM_WGSL, PARTICLE_VERTEX_BUFFER_LAYOUTS, PARTICLE_VIEW_OFFSET, WgpuParticleCache, createParticleBindGroupLayout` | Re-export |
| `./wgpu-particle-simulation.js` | `PARTICLE_SIMULATION_SCRATCH_BYTES, PARTICLE_SIMULATION_VECTOR_BYTES, WgpuParticleSimulation` | Re-export |
| `./wgpu-shadow.js` | `SHADOW_FACTOR_WGSL, SHADOW_LIGHT_UNIFORM_BYTES, SHADOW_LIGHT_UNIFORM_WGSL, SHADOW_MAP_BINDING, SHADOW_MATRIX_OFFSET, SHADOW_PARAMS_OFFSET, SHADOW_SAMPLER_BINDING, SHADOW_SHADER_SOURCE, SHADOW_UNIFORM_SPARE_BYTES, createShadowLightsBindGroupLayout, createShadowSampler, writeShadowUniforms` | Re-export |
| `./wgpu-stencil.js` | `CLEAR_STENCIL, STENCIL_ALL_BITS, applyStencilReference, frameWantsStencil, stencilDescriptor` | Re-export |
| `./wgpu-standard.js` | `STANDARD_BASE_COLOR_OFFSET, STANDARD_EMISSIVE_OFFSET, STANDARD_MODEL_OFFSET, STANDARD_NORMAL_OFFSET, STANDARD_SURFACE_OFFSET, STANDARD_UNIFORM_BYTES, STANDARD_UNIFORM_WGSL, STANDARD_VIEW_PROJECTION_OFFSET, createStandardBindGroupLayout, standardShaderSource` | Re-export |
| `./wgpu-node-registry.js` | `clearRegisteredWebgpuNodeMaterialPipeline, resolveWebgpuNodeMaterialPipelineFactory, setWebgpuNodeMaterialPipelineFactory` | Re-export |
| `./wgpu-node-program.js` | `NODE_SCREEN_BLOCK_BASE_BYTES, NODE_SCREEN_TEXTURE_GROUP, NODE_SURFACE_BLOCK_BASE_BYTES, NODE_SURFACE_BLOCK_GROUP, NODE_SURFACE_TEXTURE_GROUP, WgpuNodePipelineStore, emitShaderGraphWgsl, registerWebgpuNodeMaterialPipeline` | Re-export |
| `./wgpu-picking-registry.js` | `clearRegisteredPickingPipeline, resolvePickingServiceFactory` | Re-export |
| `./wgpu-picking.js` | `ID_MODEL_OFFSET, ID_PICK_OFFSET, ID_SHADER_SOURCE, ID_UNIFORM_BYTES, ID_VIEW_PROJECTION_OFFSET, PARTICLE_ID_MODEL_OFFSET, PARTICLE_ID_PICK_OFFSET, PARTICLE_ID_PROJECTION_OFFSET, PARTICLE_ID_SHADER_SOURCE, PARTICLE_ID_UNIFORM_BYTES, PARTICLE_ID_VIEW_OFFSET, SKINNED_ID_PALETTE_BYTES, SKINNED_ID_SHADER_SOURCE, WebgpuPickingService, registerPickingPipeline` | Re-export |
| `./wgpu-skinning-registry.js` | `clearRegisteredSkinningPipeline, resolveSkinningPipelineFactory` | Re-export |
| `./wgpu-skinning.js` | `JOINTS_BUFFER_LAYOUT, JOINTS_SHADER_LOCATION, JOINT_PALETTE_BINDING, JOINT_PALETTE_BYTES, JOINT_PALETTE_FLOATS, WEIGHTS_BUFFER_LAYOUT, WEIGHTS_SHADER_LOCATION, createJointPaletteBindGroupLayout, registerSkinningPipeline, SKINNED_SHADOW_SHADER_SOURCE, SKINNED_SHADOW_VERTEX_BUFFER_LAYOUTS, skinnedLitShaderSource, skinnedLitVertexBufferLayouts, skinnedPaletteBindGroupIndex, skinnedShadowShaderSource, skinnedUnlitShaderSource, skinnedUnlitVertexBufferLayouts, skinningWgsl` | Re-export |
| `./webgpu-device.js` | `Gpu, GpuAdapter, GpuStencilFaceState, GpuBindGroup, GpuBindGroupEntry, GpuBindGroupLayout, GpuBindGroupLayoutEntry, GpuBlendComponent, GpuBlendState, GpuBuffer, GpuBufferDescriptor, GpuCanvasContext, GpuCommandBuffer, GpuCommandEncoder, GpuComputePassEncoder, GpuComputePipeline, GpuComputePipelineDescriptor, GpuDevice, GpuDeviceLostInfo, GpuPipelineLayout, GpuQuerySet, GpuQueue, GpuRenderPassDescriptor, GpuRenderPassEncoder, GpuRenderPipeline, GpuBufferBinding, GpuRenderPipelineDescriptor, GpuSampler, GpuSamplerDescriptor, GpuShaderModule, GpuTexture, GpuTextureDescriptor, GpuTextureView, GpuTextureViewDescriptor, GpuVertexBufferLayout, WebgpuCanvas` | Re-export (type-only) |
| `./wgpu-geometry.js` | `CacheableGeometry, WgpuGeometryRecord` | Re-export (type-only) |
| `./wgpu-pipeline-cache.js` | `WgpuBatchStream, WgpuPipelineDescriptor, WgpuPipelineKind, WgpuStencilDescriptor` | Re-export (type-only) |
| `./wgpu-batch.js` | `WgpuRenderBatching` | Re-export (type-only) |
| `./wgpu-texture.js` | `ResolvedSamplerState, WgpuCacheableTexture, WgpuTextureRecord` | Re-export (type-only) |
| `./wgpu-render-target.js` | `WgpuCacheableRenderTarget, WgpuRenderTargetRecord` | Re-export (type-only) |
| `./wgpu-effect.js` | `WgpuEffectKind` | Re-export (type-only) |
| `./wgpu-compute.js` | `ComputeBinding, ComputeBindingAccess, ComputeBufferOptions, ComputePassDescriptor` | Re-export (type-only) |
| `./wgpu-compute.js` | `ParticleSimulationFieldParams` | Re-export (type-only) |
| `./wgpu-particles.js` | `WgpuParticleRecord` | Re-export (type-only) |
| `./wgpu-particle-simulation.js` | `WgpuParticleSimulationOptions` | Re-export (type-only) |
| `./wgpu-stencil.js` | `WgpuStencilSource` | Re-export (type-only) |
| `./wgpu-node-registry.js` | `WgpuNodeFrameState, WgpuNodeItemMaterial, WgpuNodeMaterialPipelineFactory, WgpuNodeMaterialPipelines, WgpuNodePipelineHost` | Re-export (type-only) |
| `./wgpu-node-program.js` | `EmittedWgslNodeShader` | Re-export (type-only) |
| `./wgpu-picking-registry.js` | `PickingRendererHost, PickingServiceFactory` | Re-export (type-only) |
| `./wgpu-skinning-registry.js` | `SkinningPipelineFactory, SkinningPipelineHost, SkinnedLitPipeline, SkinnedPrograms, SkinnedUnlitPipeline, WgpuSkinnedDrawDescriptor, WgpuSkinnedShadowDescriptor` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `GPU_BUFFER_USAGE`, `GPU_MAP_MODE`, `GPU_SHADER_STAGE`, `GPU_TEXTURE_USAGE`, `UNIFORM_STRIDE_BYTES`, `hostGpu`, `WebgpuRenderer`, `isWebgpuSupported`, `registerWebgpuRenderer`, `DRAW_COLOR_OFFSET`, `DRAW_MODEL_OFFSET`, `DRAW_NORMAL_OFFSET`, `DRAW_UNIFORM_BYTES`, `DRAW_UNIFORM_FLOATS`, `DRAW_UNIFORM_WGSL`, `DRAW_VIEW_PROJECTION_OFFSET`, `MAP_BINDING_WGSL`, `MAP_BIND_GROUP_INDEX`, `MAP_SAMPLER_BINDING`, `MAP_TEXTURE_BINDING`, `createDrawBindGroupLayout`, `createTextureBindGroupLayout`, `WgpuGeometryCache`, `blendStateFor`, `pipelineKey`, `stencilStateFor`, `WgpuPipelineCache`, `WgpuBatching`, `batchVertexBufferLayout`, `createWgpuBatching`, `SPRITE_MODEL_OFFSET`, `SPRITE_SHADER_SOURCE`, `SPRITE_TINT_OFFSET`, `SPRITE_UNIFORM_BYTES`, `SPRITE_UNIFORM_WGSL`, `SPRITE_VIEW_PROJECTION_OFFSET`, `createSpriteBindGroupLayout`, `MIPMAP_SHADER_SOURCE`, `WgpuTextureCache`, `mipLevelCount`, `samplerKey`, `textureByteLength`, `CLEAR_SHADER_SOURCE`, `CLEAR_VERTEX_COUNT`, `COLOR_BUFFER_LAYOUT`, `COLOR_SHADER_LOCATION`, `FRAGMENT_ENTRY_POINT`, `POSITION_BUFFER_LAYOUT`, `POSITION_SHADER_LOCATION`, `UV_BUFFER_LAYOUT`, `UV_SHADER_LOCATION`, `VERTEX_ENTRY_POINT`, `unlitShaderSource`, `unlitVertexBufferLayouts`, `unlitFragmentStageWgsl`, `LIGHTS_BIND_GROUP_INDEX`, `LIGHT_AMBIENT_OFFSET`, `LIGHT_CAMERA_OFFSET`, `LIGHT_COLOR_OFFSET`, `LIGHT_COUNTS_OFFSET`, `LIGHT_DIRECTION_OFFSET`, `LIGHT_PUNCTUAL_COLOR_OFFSET`, `LIGHT_PUNCTUAL_DIRECTION_OFFSET`, `LIGHT_PUNCTUAL_PARAMS_OFFSET`, `LIGHT_PUNCTUAL_POSITION_OFFSET`, `HEMISPHERE_GROUND_OFFSET`, `HEMISPHERE_IRRADIANCE_WGSL`, `HEMISPHERE_SKY_OFFSET`, `HEMISPHERE_UNIFORM_MEMBERS_WGSL`, `HEMISPHERE_UP_OFFSET`, `LIGHT_BINDING_BYTES`, `LIGHT_UNIFORM_BYTES`, `LIGHT_UNIFORM_FLOATS`, `LIGHT_UNIFORM_MEMBERS_WGSL`, `LIGHT_UNIFORM_STRIDE_BYTES`, `LIGHT_UNIFORM_STRIDE_FLOATS`, `LIGHT_UNIFORM_WGSL`, `PUNCTUAL_LIGHT_WGSL`, `SHADED_MAP_BINDING_WGSL`, `SHADED_MAP_BIND_GROUP_INDEX`, `SHADED_MR_BINDING_WGSL`, `SHADED_MR_BIND_GROUP_INDEX`, `createLightsBindGroupLayout`, `shadedMrBindingWgsl`, `writeLightUniforms`, `NORMAL_BUFFER_LAYOUT`, `NORMAL_MATRIX_WGSL`, `NORMAL_SHADER_LOCATION`, `litShaderSource`, `shadedVertexBufferLayouts`, `shadedVertexStageWgsl`, `litFragmentStageWgsl`, `RENDER_TARGET_COLOR_FORMAT`, `RENDER_TARGET_DEPTH_FORMAT`, `RENDER_TARGET_DEPTH_STENCIL_FORMAT`, `RENDER_TARGET_DEPTH_TEXTURE_FORMAT`, `WgpuRenderTargetCache`, `renderTargetDepthFormat`, `EFFECT_BIND_GROUP_INDEX`, `EFFECT_GRADE_OFFSET`, `EFFECT_PASS_VERTEX_COUNT`, `EFFECT_UNIFORM_BYTES`, `EFFECT_UNIFORM_WGSL`, `createEffectBindGroupLayout`, `effectShaderSource`, `READBACK_ROW_ALIGNMENT`, `readTexturePixels`, `readbackBytesPerRow`, `COMPUTE_ENTRY_POINT`, `PARTICLE_INTEGRATOR_SHADER_SOURCE`, `PARTICLE_INTEGRATOR_WORKGROUP_SIZE`, `PARTICLE_SIMULATION_PARAMS_FLOATS`, `WgpuComputeBuffer`, `WgpuComputeCache`, `createComputeBuffer`, `particleIntegratorWorkgroups`, `readComputeBufferBytes`, `writeComputeBuffer`, `writeParticleSimulationParams`, `PARTICLE_GPU_INSTANCE_BUFFER_LAYOUT`, `PARTICLE_GPU_POSITION_BUFFER_LAYOUT`, `PARTICLE_GPU_VERTEX_BUFFER_LAYOUTS`, `PARTICLE_APPEARANCE_SHADER_SOURCE`, `PARTICLE_INSTANCE_BUFFER_LAYOUT`, `PARTICLE_INSTANCE_STRIDE_BYTES`, `PARTICLE_MODEL_OFFSET`, `PARTICLE_PROJECTION_OFFSET`, `PARTICLE_SHADER_SOURCE`, `PARTICLE_WIDE_INSTANCE_BUFFER_LAYOUT`, `PARTICLE_WIDE_INSTANCE_STRIDE_BYTES`, `PARTICLE_UNIFORM_BYTES`, `PARTICLE_UNIFORM_WGSL`, `PARTICLE_VERTEX_BUFFER_LAYOUTS`, `PARTICLE_VIEW_OFFSET`, `WgpuParticleCache`, `createParticleBindGroupLayout`, `PARTICLE_SIMULATION_SCRATCH_BYTES`, `PARTICLE_SIMULATION_VECTOR_BYTES`, `WgpuParticleSimulation`, `SHADOW_FACTOR_WGSL`, `SHADOW_LIGHT_UNIFORM_BYTES`, `SHADOW_LIGHT_UNIFORM_WGSL`, `SHADOW_MAP_BINDING`, `SHADOW_MATRIX_OFFSET`, `SHADOW_PARAMS_OFFSET`, `SHADOW_SAMPLER_BINDING`, `SHADOW_SHADER_SOURCE`, `SHADOW_UNIFORM_SPARE_BYTES`, `createShadowLightsBindGroupLayout`, `createShadowSampler`, `writeShadowUniforms`, `CLEAR_STENCIL`, `STENCIL_ALL_BITS`, `applyStencilReference`, `frameWantsStencil`, `stencilDescriptor`, `STANDARD_BASE_COLOR_OFFSET`, `STANDARD_EMISSIVE_OFFSET`, `STANDARD_MODEL_OFFSET`, `STANDARD_NORMAL_OFFSET`, `STANDARD_SURFACE_OFFSET`, `STANDARD_UNIFORM_BYTES`, `STANDARD_UNIFORM_WGSL`, `STANDARD_VIEW_PROJECTION_OFFSET`, `createStandardBindGroupLayout`, `standardShaderSource`, `clearRegisteredWebgpuNodeMaterialPipeline`, `resolveWebgpuNodeMaterialPipelineFactory`, `setWebgpuNodeMaterialPipelineFactory`, `NODE_SCREEN_BLOCK_BASE_BYTES`, `NODE_SCREEN_TEXTURE_GROUP`, `NODE_SURFACE_BLOCK_BASE_BYTES`, `NODE_SURFACE_BLOCK_GROUP`, `NODE_SURFACE_TEXTURE_GROUP`, `WgpuNodePipelineStore`, `emitShaderGraphWgsl`, `registerWebgpuNodeMaterialPipeline`, `clearRegisteredPickingPipeline`, `resolvePickingServiceFactory`, `ID_MODEL_OFFSET`, `ID_PICK_OFFSET`, `ID_SHADER_SOURCE`, `ID_UNIFORM_BYTES`, `ID_VIEW_PROJECTION_OFFSET`, `PARTICLE_ID_MODEL_OFFSET`, `PARTICLE_ID_PICK_OFFSET`, `PARTICLE_ID_PROJECTION_OFFSET`, `PARTICLE_ID_SHADER_SOURCE`, `PARTICLE_ID_UNIFORM_BYTES`, `PARTICLE_ID_VIEW_OFFSET`, `SKINNED_ID_PALETTE_BYTES`, `SKINNED_ID_SHADER_SOURCE`, `WebgpuPickingService`, `registerPickingPipeline`, `clearRegisteredSkinningPipeline`, `resolveSkinningPipelineFactory`, `JOINTS_BUFFER_LAYOUT`, `JOINTS_SHADER_LOCATION`, `JOINT_PALETTE_BINDING`, `JOINT_PALETTE_BYTES`, `JOINT_PALETTE_FLOATS`, `WEIGHTS_BUFFER_LAYOUT`, `WEIGHTS_SHADER_LOCATION`, `createJointPaletteBindGroupLayout`, `registerSkinningPipeline`, `SKINNED_SHADOW_SHADER_SOURCE`, `SKINNED_SHADOW_VERTEX_BUFFER_LAYOUTS`, `skinnedLitShaderSource`, `skinnedLitVertexBufferLayouts`, `skinnedPaletteBindGroupIndex`, `skinnedShadowShaderSource`, `skinnedUnlitShaderSource`, `skinnedUnlitVertexBufferLayouts`, `skinningWgsl`, `Gpu`, `GpuAdapter`, `GpuStencilFaceState`, `GpuBindGroup`, `GpuBindGroupEntry`, `GpuBindGroupLayout`, `GpuBindGroupLayoutEntry`, `GpuBlendComponent`, `GpuBlendState`, `GpuBuffer`, `GpuBufferDescriptor`, `GpuCanvasContext`, `GpuCommandBuffer`, `GpuCommandEncoder`, `GpuComputePassEncoder`, `GpuComputePipeline`, `GpuComputePipelineDescriptor`, `GpuDevice`, `GpuDeviceLostInfo`, `GpuPipelineLayout`, `GpuQuerySet`, `GpuQueue`, `GpuRenderPassDescriptor`, `GpuRenderPassEncoder`, `GpuRenderPipeline`, `GpuBufferBinding`, `GpuRenderPipelineDescriptor`, `GpuSampler`, `GpuSamplerDescriptor`, `GpuShaderModule`, `GpuTexture`, `GpuTextureDescriptor`, `GpuTextureView`, `GpuTextureViewDescriptor`, `GpuVertexBufferLayout`, `WebgpuCanvas`, `CacheableGeometry`, `WgpuGeometryRecord`, `WgpuBatchStream`, `WgpuPipelineDescriptor`, `WgpuPipelineKind`, `WgpuStencilDescriptor`, `WgpuRenderBatching`, `ResolvedSamplerState`, `WgpuCacheableTexture`, `WgpuTextureRecord`, `WgpuCacheableRenderTarget`, `WgpuRenderTargetRecord`, `WgpuEffectKind`, `ComputeBinding`, `ComputeBindingAccess`, `ComputeBufferOptions`, `ComputePassDescriptor`, `ParticleSimulationFieldParams`, `WgpuParticleRecord`, `WgpuParticleSimulationOptions`, `WgpuStencilSource`, `WgpuNodeFrameState`, `WgpuNodeItemMaterial`, `WgpuNodeMaterialPipelineFactory`, `WgpuNodeMaterialPipelines`, `WgpuNodePipelineHost`, `EmittedWgslNodeShader`, `PickingRendererHost`, `PickingServiceFactory`, `SkinningPipelineFactory`, `SkinningPipelineHost`, `SkinnedLitPipeline`, `SkinnedPrograms`, `SkinnedUnlitPipeline`, `WgpuSkinnedDrawDescriptor`, `WgpuSkinnedShadowDescriptor`

---

### `packages/render-webgpu/src/register.ts` - This backend's opt-in to §62's renderer registry (R-2, A-8, WP-R1.1).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `registerRenderer, RendererOptions, RendererRegistry` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-renderer.js` | `hostGpu` | Import |
| `./webgpu-renderer.js` | `WebgpuRenderer` | Import |

**Exports:**
- Functions: `isWebgpuSupported`, `registerWebgpuRenderer`

---

### `packages/render-webgpu/src/webgpu-device.ts` - The WebGPU surface this backend touches, described structurally (§61, §62).

**Exports:**
- Interfaces: `GpuDeviceLostInfo`, `GpuQuerySet`, `GpuBuffer`, `GpuTextureViewDescriptor`, `GpuTexture`, `GpuComputePipelineDescriptor`, `GpuComputePassEncoder`, `GpuVertexBufferLayout`, `GpuBlendState`, `GpuBlendComponent`, `GpuRenderPipelineDescriptor`, `GpuStencilFaceState`, `GpuRenderPassDescriptor`, `GpuRenderPassEncoder`, `GpuCommandEncoder`, `GpuQueue`, `GpuSamplerDescriptor`, `GpuBufferDescriptor`, `GpuTextureDescriptor`, `GpuBindGroupLayoutEntry`, `GpuBufferBinding`, `GpuBindGroupEntry`, `GpuDevice`, `GpuAdapter`, `Gpu`, `GpuCanvasContext`, `WebgpuCanvas`
- Types: `GpuTextureView`, `GpuSampler`, `GpuShaderModule`, `GpuBindGroupLayout`, `GpuPipelineLayout`, `GpuBindGroup`, `GpuRenderPipeline`, `GpuComputePipeline`, `GpuCommandBuffer`
- Constants: `GPU_BUFFER_USAGE`, `GPU_MAP_MODE`, `GPU_TEXTURE_USAGE`, `GPU_SHADER_STAGE`, `UNIFORM_STRIDE_BYTES`

---

### `packages/render-webgpu/src/webgpu-renderer.ts` - Draws fourJS scenes with WebGPU (§61, §62 backend 1).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, EventEmitter, FourError, devWarnOnce` |
| `@fourjs/math` | `Frustum, Matrix3, Matrix4, Rectangle2` |
| `@fourjs/render` | `COLOR_GRADE_DEFAULTS, RenderTarget, buildInterpolatedRenderList, buildRenderList, buildViewRenderList, MAX_SKINNING_JOINTS, collectSceneLights, createSceneLights, isRenderTargetTexture, isSkinnedLitItem, isSkinnedUnlitItem, intersectScissor, validateReadbackRegion, EffectRenderPass, RenderBatch, PickingService, RenderInterpolation, RenderItem, RenderStatistics, Renderer, RendererCapabilities, RendererEventMap, RendererOptions, ScissorRect` |
| `@fourjs/scene` | `Node, Viewport` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GPU_TEXTURE_USAGE, UNIFORM_STRIDE_BYTES, Gpu, GpuBindGroup, GpuBindGroupLayout, GpuBuffer, GpuCanvasContext, GpuCommandEncoder, GpuDevice, GpuRenderPassEncoder, GpuRenderPipeline, GpuSampler, GpuTexture, GpuTextureView, WebgpuCanvas` | Import |
| `./wgpu-bindings.js` | `DRAW_COLOR_OFFSET, DRAW_MODEL_OFFSET, DRAW_NORMAL_OFFSET, DRAW_UNIFORM_BYTES, DRAW_VIEW_PROJECTION_OFFSET, MAP_BIND_GROUP_INDEX, createDrawBindGroupLayout` | Import |
| `./wgpu-batch.js` | `WgpuRenderBatching` | Import (type-only) |
| `./wgpu-effect.js` | `EFFECT_BIND_GROUP_INDEX, EFFECT_PASS_VERTEX_COUNT, EFFECT_UNIFORM_BYTES, createEffectBindGroupLayout, WgpuEffectKind` | Import |
| `./wgpu-geometry.js` | `WgpuGeometryCache, WgpuGeometryRecord` | Import |
| `./wgpu-gpu-timer.js` | `WgpuGpuTimer` | Import |
| `./wgpu-lights.js` | `LIGHTS_BIND_GROUP_INDEX, LIGHT_BINDING_BYTES, LIGHT_UNIFORM_STRIDE_BYTES, LIGHT_UNIFORM_STRIDE_FLOATS, SHADED_MAP_BIND_GROUP_INDEX, SHADED_MR_BIND_GROUP_INDEX, createLightsBindGroupLayout, writeLightUniforms` | Import |
| `./wgpu-compute.js` | `WgpuComputeCache, createComputeBuffer, readComputeBufferBytes, writeComputeBuffer, ComputeBufferOptions, ComputePassDescriptor, WgpuComputeBuffer` | Import |
| `./wgpu-particles.js` | `PARTICLE_MODEL_OFFSET, PARTICLE_PROJECTION_OFFSET, PARTICLE_UNIFORM_BYTES, PARTICLE_VIEW_OFFSET, WgpuParticleCache, createParticleBindGroupLayout, WgpuParticleRecord` | Import |
| `./wgpu-particle-simulation.js` | `WgpuParticleSimulation, WgpuParticleSimulationOptions` | Import |
| `./wgpu-pipeline-cache.js` | `WgpuPipelineCache, WgpuPipelineDescriptor, WgpuStencilDescriptor` | Import |
| `./wgpu-readback.js` | `readTexturePixels` | Import |
| `./wgpu-render-target.js` | `RENDER_TARGET_COLOR_FORMAT, WgpuRenderTargetCache, WgpuRenderTargetRecord` | Import |
| `./wgpu-standard.js` | `STANDARD_EMISSIVE_OFFSET, STANDARD_SURFACE_OFFSET, STANDARD_UNIFORM_BYTES, createStandardBindGroupLayout` | Import |
| `./wgpu-sprite.js` | `SPRITE_UNIFORM_BYTES, createSpriteBindGroupLayout` | Import |
| `./wgpu-shadow.js` | `SHADOW_LIGHT_UNIFORM_BYTES, SHADOW_MAP_BINDING, SHADOW_SAMPLER_BINDING, createShadowLightsBindGroupLayout, createShadowSampler, writeShadowUniforms` | Import |
| `./wgpu-stencil.js` | `CLEAR_STENCIL, applyStencilReference, frameWantsStencil, stencilDescriptor` | Import |
| `./wgpu-texture.js` | `WgpuTextureCache, WgpuCacheableTexture` | Import |
| `./wgpu-node-registry.js` | `resolveWebgpuNodeMaterialPipelineFactory, WgpuNodeFrameState, WgpuNodeMaterialPipelines` | Import |
| `./wgpu-picking-registry.js` | `resolvePickingServiceFactory, PickingRendererHost` | Import |
| `./wgpu-skinning-registry.js` | `resolveSkinningPipelineFactory, SkinnedPrograms, SkinningPipelineHost, WgpuSkinnedDrawDescriptor` | Import |
| `./wgpu-unlit.js` | `CLEAR_VERTEX_COUNT` | Import |

**Exports:**
- Classes: `WebgpuRenderer`
- Functions: `hostGpu`

---

### `packages/render-webgpu/src/wgpu-batch.ts` - §65 batching for the WebGPU backend — the GPU half of `@fourjs/render`'s

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `RenderBatcher, RenderBatch, RenderBatchOptions, RenderItem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GpuBuffer, GpuDevice, GpuRenderPassEncoder, GpuVertexBufferLayout` | Import |
| `./wgpu-unlit.js` | `COLOR_SHADER_LOCATION, POSITION_SHADER_LOCATION, UV_SHADER_LOCATION` | Import |

**Exports:**
- Classes: `WgpuBatching`
- Interfaces: `WgpuRenderBatching`
- Functions: `batchVertexBufferLayout`, `createWgpuBatching`

---

### `packages/render-webgpu/src/wgpu-bindings.ts` - This backend's binding layout, **declared as data** (§7 of the R-1 plan).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_SHADER_STAGE, GpuBindGroupLayout, GpuDevice` | Import |

**Exports:**
- Functions: `createDrawBindGroupLayout`, `createTextureBindGroupLayout`
- Constants: `DRAW_VIEW_PROJECTION_OFFSET`, `DRAW_MODEL_OFFSET`, `DRAW_COLOR_OFFSET`, `DRAW_NORMAL_OFFSET`, `DRAW_UNIFORM_BYTES`, `DRAW_UNIFORM_FLOATS`, `DRAW_UNIFORM_WGSL`, `MAP_BIND_GROUP_INDEX`, `MAP_TEXTURE_BINDING`, `MAP_SAMPLER_BINDING`, `MAP_BINDING_WGSL`

---

### `packages/render-webgpu/src/wgpu-compute.ts` - §82's GPU compute on the WebGPU backend (WP-R1.8) — compute pipelines, bind

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/render` | `COMPUTE_ENTRY_POINT, ComputeBinding, ComputeBindingAccess, ComputeBuffer, ComputePassDescriptor` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GPU_MAP_MODE, GPU_SHADER_STAGE, GpuBindGroupLayout, GpuComputePipeline, GpuDevice, GpuPipelineLayout, GpuShaderModule, GpuBuffer` | Import |

**Exports:**
- Classes: `WgpuComputeBuffer`, `WgpuComputeCache`
- Interfaces: `ComputeBufferOptions`, `ParticleSimulationFieldParams`
- Functions: `createComputeBuffer`, `writeComputeBuffer`, `readComputeBufferBytes`, `writeParticleSimulationParams`, `particleIntegratorWorkgroups`
- Constants: `PARTICLE_INTEGRATOR_WORKGROUP_SIZE`, `PARTICLE_SIMULATION_PARAMS_FLOATS`, `PARTICLE_INTEGRATOR_SHADER_SOURCE`

---

### `packages/render-webgpu/src/wgpu-effect.ts` - §70's full-screen effects in hand-written WGSL — the blit, the colour grade,

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_SHADER_STAGE, GpuBindGroupLayout, GpuDevice` | Import |
| `./wgpu-bindings.js` | `MAP_SAMPLER_BINDING, MAP_TEXTURE_BINDING` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT, VERTEX_ENTRY_POINT` | Import |

**Exports:**
- Types: `WgpuEffectKind`
- Functions: `createEffectBindGroupLayout`, `effectShaderSource`
- Constants: `EFFECT_PASS_VERTEX_COUNT`, `EFFECT_GRADE_OFFSET`, `EFFECT_UNIFORM_BYTES`, `EFFECT_BIND_GROUP_INDEX`, `EFFECT_UNIFORM_WGSL`

---

### `packages/render-webgpu/src/wgpu-geometry.ts` - Per-device store of uploaded geometry (§61, §64 stage 7) — the WebGPU twin of

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `RenderItem` |
| `@fourjs/render` | `warnDisposedInUse` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GpuBuffer, GpuDevice` | Import |

**Exports:**
- Classes: `WgpuGeometryCache`
- Interfaces: `WgpuGeometryRecord`
- Types: `CacheableGeometry`

---

### `packages/render-webgpu/src/wgpu-gpu-timer.ts` - WebGPU GPU-frame timer — `timestamp-query` ping-pong (A-1, §62, §84).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GPU_MAP_MODE, GpuBuffer, GpuCommandEncoder, GpuDevice, GpuQuerySet` | Import |

**Exports:**
- Classes: `WgpuGpuTimer`

---

### `packages/render-webgpu/src/wgpu-lights.ts` - The frame's lighting as **one uniform buffer** (§68, WP-R1.5), plus the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `MAX_PUNCTUAL_LIGHTS, SceneLights` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_SHADER_STAGE, GpuBindGroupLayout, GpuDevice` | Import |
| `./wgpu-bindings.js` | `MAP_SAMPLER_BINDING, MAP_TEXTURE_BINDING` | Import |

**Exports:**
- Functions: `createLightsBindGroupLayout`, `shadedMrBindingWgsl`, `writeLightUniforms`
- Constants: `LIGHTS_BIND_GROUP_INDEX`, `SHADED_MAP_BIND_GROUP_INDEX`, `SHADED_MR_BIND_GROUP_INDEX`, `LIGHT_AMBIENT_OFFSET`, `LIGHT_DIRECTION_OFFSET`, `LIGHT_COLOR_OFFSET`, `LIGHT_CAMERA_OFFSET`, `LIGHT_COUNTS_OFFSET`, `LIGHT_PUNCTUAL_POSITION_OFFSET`, `LIGHT_PUNCTUAL_COLOR_OFFSET`, `LIGHT_PUNCTUAL_DIRECTION_OFFSET`, `LIGHT_PUNCTUAL_PARAMS_OFFSET`, `LIGHT_UNIFORM_BYTES`, `LIGHT_UNIFORM_FLOATS`, `HEMISPHERE_SKY_OFFSET`, `HEMISPHERE_GROUND_OFFSET`, `HEMISPHERE_UP_OFFSET`, `LIGHT_BINDING_BYTES`, `LIGHT_UNIFORM_STRIDE_BYTES`, `LIGHT_UNIFORM_STRIDE_FLOATS`, `LIGHT_UNIFORM_MEMBERS_WGSL`, `HEMISPHERE_UNIFORM_MEMBERS_WGSL`, `LIGHT_UNIFORM_WGSL`, `HEMISPHERE_IRRADIANCE_WGSL`, `PUNCTUAL_LIGHT_WGSL`, `SHADED_MAP_BINDING_WGSL`, `SHADED_MR_BINDING_WGSL`

---

### `packages/render-webgpu/src/wgpu-lit.ts` - The Lambert-lit pipeline in hand-written WGSL (§57 `LitMaterial`, §68,

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./wgpu-bindings.js` | `DRAW_UNIFORM_WGSL` | Import |
| `./webgpu-device.js` | `GpuVertexBufferLayout` | Import (type-only) |
| `./wgpu-lights.js` | `HEMISPHERE_IRRADIANCE_WGSL, LIGHT_UNIFORM_WGSL, PUNCTUAL_LIGHT_WGSL, SHADED_MAP_BINDING_WGSL` | Import |
| `./wgpu-shadow.js` | `SHADOW_FACTOR_WGSL, SHADOW_LIGHT_UNIFORM_WGSL` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT, POSITION_BUFFER_LAYOUT, POSITION_SHADER_LOCATION, UV_BUFFER_LAYOUT, UV_SHADER_LOCATION, VERTEX_ENTRY_POINT` | Import |

**Exports:**
- Functions: `shadedVertexBufferLayouts`, `shadedVertexStageWgsl`, `litShaderSource`, `litFragmentStageWgsl`
- Constants: `NORMAL_SHADER_LOCATION`, `NORMAL_BUFFER_LAYOUT`, `NORMAL_MATRIX_WGSL`

---

### `packages/render-webgpu/src/wgpu-node-program.ts` - The node-material pipeline for WebGPU (§60, §62; RFC 0001 — WP-R1.9): a

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, FourError, devWarnOnce, Disposable` |
| `@fourjs/render` | `SHADER_VALUE_COMPONENTS, analyzeShaderGraph, createShaderSourceMap, ShaderSourceMap, isRenderTargetTexture, GraphEffect, NodeRenderItem, RenderItem, RenderStatistics, ShaderAttributeName, ShaderDomain, ShaderGraph, ShaderGraphAnalysis, ShaderNode, ShaderUniformReflection, ShaderValueType` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GPU_SHADER_STAGE, GpuBindGroup, GpuBindGroupEntry, GpuBindGroupLayout, GpuBuffer, GpuPipelineLayout, GpuRenderPassEncoder, GpuRenderPipeline, GpuShaderModule, GpuTextureView, GpuVertexBufferLayout` | Import |
| `./wgpu-effect.js` | `EFFECT_PASS_VERTEX_COUNT` | Import |
| `./wgpu-lit.js` | `NORMAL_BUFFER_LAYOUT` | Import |
| `./wgpu-pipeline-cache.js` | `blendStateFor, stencilStateFor, WgpuStencilDescriptor` | Import |
| `./wgpu-node-registry.js` | `setWebgpuNodeMaterialPipelineFactory, WgpuNodeFrameState, WgpuNodeItemMaterial, WgpuNodeMaterialPipelines, WgpuNodePipelineHost` | Import |
| `./wgpu-render-target.js` | `WgpuCacheableRenderTarget, WgpuRenderTargetCache` | Import (type-only) |
| `./wgpu-stencil.js` | `applyStencilReference, stencilDescriptor` | Import |
| `./wgpu-unlit.js` | `COLOR_BUFFER_LAYOUT, FRAGMENT_ENTRY_POINT, POSITION_BUFFER_LAYOUT, UV_BUFFER_LAYOUT, VERTEX_ENTRY_POINT` | Import |

**Exports:**
- Classes: `WgpuNodePipelineStore`
- Interfaces: `EmittedWgslNodeShader`
- Functions: `emitShaderGraphWgsl`, `registerWebgpuNodeMaterialPipeline`
- Constants: `NODE_SURFACE_BLOCK_BASE_BYTES`, `NODE_SCREEN_BLOCK_BASE_BYTES`, `NODE_SURFACE_BLOCK_GROUP`, `NODE_SURFACE_TEXTURE_GROUP`, `NODE_SCREEN_TEXTURE_GROUP`

---

### `packages/render-webgpu/src/wgpu-node-registry.ts` - The WebGPU node-material pipeline's registration slot (§60, §62; RFC 0001;

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Matrix4` |
| `@fourjs/render` | `GraphEffect, NodeRenderItem, RenderItem, RenderStatistics` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GpuDevice, GpuRenderPassEncoder, GpuTextureView` | Import (type-only) |
| `./wgpu-geometry.js` | `WgpuGeometryCache` | Import (type-only) |
| `./wgpu-render-target.js` | `WgpuCacheableRenderTarget, WgpuRenderTargetCache` | Import (type-only) |
| `./wgpu-texture.js` | `WgpuTextureCache` | Import (type-only) |

**Exports:**
- Interfaces: `WgpuNodePipelineHost`, `WgpuNodeFrameState`, `WgpuNodeMaterialPipelines`, `WgpuNodeMaterialPipelineFactory`
- Types: `WgpuNodeItemMaterial`
- Functions: `setWebgpuNodeMaterialPipelineFactory`, `resolveWebgpuNodeMaterialPipelineFactory`, `clearRegisteredWebgpuNodeMaterialPipeline`

---

### `packages/render-webgpu/src/wgpu-particle-simulation.ts` - `WgpuParticleSimulation` — the device side of §36's `simulation: "gpu"`
=======
| `./migration.js` | `SceneMigrationRegistry` | Import (type-only) |
| `./serializer.js` | `ComponentSerializerRegistry` | Import (type-only) |

**Exports:**
- Constants: `COMPONENT_SERIALIZERS`, `SCENE_MIGRATIONS`

---

### `packages/serialization/src/migration.ts` - Scene migration (§80) — the registry of upgrade steps and the chain runner
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GpuBuffer, GpuDevice` | Import |
| `./wgpu-compute.js` | `PARTICLE_INTEGRATOR_SHADER_SOURCE, PARTICLE_SIMULATION_PARAMS_FLOATS, WgpuComputeBuffer, WgpuComputeCache, createComputeBuffer, particleIntegratorWorkgroups, writeComputeBuffer, writeParticleSimulationParams, ParticleSimulationFieldParams` | Import |

**Exports:**
- Classes: `WgpuParticleSimulation`
- Interfaces: `WgpuParticleSimulationOptions`
- Constants: `PARTICLE_SIMULATION_VECTOR_BYTES`, `PARTICLE_SIMULATION_SCRATCH_BYTES`

---

<<<<<<< HEAD
### `packages/render-webgpu/src/wgpu-particles.ts` - The batched particle pipeline for the WebGPU backend (§36, §64 stage 6,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `PARTICLE_COLOR_OFFSET, PARTICLE_INSTANCE_FLOATS, PARTICLE_POSITION_OFFSET, PARTICLE_ROTATION_OFFSET, PARTICLE_SIZE_OFFSET, PARTICLE_SOFTNESS_OFFSET, PARTICLE_WIDE_INSTANCE_FLOATS, ParticleRenderItem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GPU_SHADER_STAGE, GpuBindGroupLayout, GpuBuffer, GpuDevice, GpuVertexBufferLayout` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT, POSITION_BUFFER_LAYOUT, VERTEX_ENTRY_POINT` | Import |

**Exports:**
- Classes: `WgpuParticleCache`
- Interfaces: `WgpuParticleRecord`
- Functions: `createParticleBindGroupLayout`
- Constants: `PARTICLE_PROJECTION_OFFSET`, `PARTICLE_VIEW_OFFSET`, `PARTICLE_MODEL_OFFSET`, `PARTICLE_UNIFORM_BYTES`, `PARTICLE_INSTANCE_STRIDE_BYTES`, `PARTICLE_UNIFORM_WGSL`, `PARTICLE_INSTANCE_BUFFER_LAYOUT`, `PARTICLE_VERTEX_BUFFER_LAYOUTS`, `PARTICLE_GPU_POSITION_BUFFER_LAYOUT`, `PARTICLE_GPU_INSTANCE_BUFFER_LAYOUT`, `PARTICLE_GPU_VERTEX_BUFFER_LAYOUTS`, `PARTICLE_WIDE_INSTANCE_STRIDE_BYTES`, `PARTICLE_WIDE_INSTANCE_BUFFER_LAYOUT`, `PARTICLE_APPEARANCE_SHADER_SOURCE`, `PARTICLE_SHADER_SOURCE`

---

### `packages/render-webgpu/src/wgpu-picking-registry.ts` - The picking pipeline's registration slot (§71, §62; RFC 0005) — the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `PickingService` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GpuDevice` | Import (type-only) |
| `./wgpu-geometry.js` | `WgpuGeometryCache` | Import (type-only) |
| `./wgpu-particles.js` | `WgpuParticleCache` | Import (type-only) |
| `./wgpu-render-target.js` | `WgpuRenderTargetCache` | Import (type-only) |

**Exports:**
- Interfaces: `PickingRendererHost`, `PickingServiceFactory`
- Functions: `setPickingServiceFactory`, `resolvePickingServiceFactory`, `clearRegisteredPickingPipeline`

---

### `packages/render-webgpu/src/wgpu-picking.ts` - The WebGPU picking service (§71, §62; RFC 0005) — the id-buffer pass and

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV, FourError, devWarnOnce` |
| `@fourjs/math` | `Frustum, Matrix4, Rectangle2` |
| `@fourjs/render` | `MAX_SKINNING_JOINTS, PARTICLE_INSTANCE_FLOATS, RenderTarget, assertEncodableCandidateCount, buildRenderList, buildViewRenderList, collectPickCandidates, decodePickId, encodePickId, ParticleRenderItem, PickRequest, PickResult, PickingService, RenderItem` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GPU_SHADER_STAGE, UNIFORM_STRIDE_BYTES, GpuBindGroup, GpuBindGroupLayout, GpuBuffer, GpuDevice, GpuRenderPipeline, GpuTextureView, GpuVertexBufferLayout` | Import |
| `./wgpu-geometry.js` | `WgpuGeometryCache, WgpuGeometryRecord` | Import (type-only) |
| `./wgpu-particles.js` | `PARTICLE_VERTEX_BUFFER_LAYOUTS, WgpuParticleCache, WgpuParticleRecord` | Import |
| `./wgpu-picking-registry.js` | `setPickingServiceFactory, PickingRendererHost` | Import |
| `./wgpu-readback.js` | `readTexturePixels` | Import |
| `./wgpu-render-target.js` | `RENDER_TARGET_COLOR_FORMAT, RENDER_TARGET_DEPTH_FORMAT, WgpuRenderTargetRecord` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT, POSITION_BUFFER_LAYOUT, VERTEX_ENTRY_POINT` | Import |

**Exports:**
- Classes: `WebgpuPickingService`
- Functions: `registerPickingPipeline`
- Constants: `ID_VIEW_PROJECTION_OFFSET`, `ID_MODEL_OFFSET`, `ID_PICK_OFFSET`, `ID_UNIFORM_BYTES`, `PARTICLE_ID_PROJECTION_OFFSET`, `PARTICLE_ID_VIEW_OFFSET`, `PARTICLE_ID_MODEL_OFFSET`, `PARTICLE_ID_PICK_OFFSET`, `PARTICLE_ID_UNIFORM_BYTES`, `SKINNED_ID_PALETTE_BYTES`, `ID_SHADER_SOURCE`, `PARTICLE_ID_SHADER_SOURCE`, `SKINNED_ID_SHADER_SOURCE`

---

### `packages/render-webgpu/src/wgpu-pipeline-cache.ts` - The lazy, descriptor-keyed render-pipeline cache (§4.2 of the R-1 plan).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `RenderItemStencil` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GpuBindGroupLayout, GpuBlendState, GpuDevice, GpuPipelineLayout, GpuRenderPipeline, GpuShaderModule, GpuStencilFaceState, GpuVertexBufferLayout` | Import |
| `./wgpu-batch.js` | `batchVertexBufferLayout` | Import |
| `./wgpu-effect.js` | `effectShaderSource, WgpuEffectKind` | Import |
| `./wgpu-lit.js` | `litShaderSource, shadedVertexBufferLayouts` | Import |
| `./wgpu-particles.js` | `PARTICLE_GPU_VERTEX_BUFFER_LAYOUTS, PARTICLE_SHADER_SOURCE, PARTICLE_VERTEX_BUFFER_LAYOUTS` | Import |
| `./wgpu-shadow.js` | `SHADOW_SHADER_SOURCE` | Import |
| `./wgpu-sprite.js` | `SPRITE_SHADER_SOURCE` | Import |
| `./wgpu-standard.js` | `standardShaderSource` | Import |
| `./wgpu-unlit.js` | `CLEAR_SHADER_SOURCE, FRAGMENT_ENTRY_POINT, POSITION_BUFFER_LAYOUT, UV_BUFFER_LAYOUT, VERTEX_ENTRY_POINT, unlitShaderSource, unlitVertexBufferLayouts` | Import |

**Exports:**
- Classes: `WgpuPipelineCache`
- Interfaces: `WgpuStencilDescriptor`, `WgpuBatchStream`, `WgpuPipelineDescriptor`
- Types: `WgpuPipelineKind`
- Functions: `blendStateFor`, `pipelineKey`, `stencilStateFor`

---

### `packages/render-webgpu/src/wgpu-readback.ts` - `readPixels`' mechanism: `copyTextureToBuffer` + `mapAsync` (WP-R1.6; §61,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Rectangle2` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GPU_MAP_MODE, GpuDevice, GpuTexture` | Import |

**Exports:**
- Functions: `readbackBytesPerRow`, `readTexturePixels`
- Constants: `READBACK_ROW_ALIGNMENT`

---

### `packages/render-webgpu/src/wgpu-render-target.ts` - GPU-side render targets for the WebGPU backend: one colour (and optional

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `RenderTarget` |
| `@fourjs/render` | `warnDisposedInUse` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_TEXTURE_USAGE, GpuBindGroup, GpuBindGroupLayout, GpuDevice, GpuSampler, GpuTexture, GpuTextureView` | Import |
| `./wgpu-bindings.js` | `MAP_SAMPLER_BINDING, MAP_TEXTURE_BINDING` | Import |

**Exports:**
- Classes: `WgpuRenderTargetCache`
- Interfaces: `WgpuRenderTargetRecord`
- Types: `WgpuCacheableRenderTarget`
- Functions: `renderTargetDepthFormat`
- Constants: `RENDER_TARGET_COLOR_FORMAT`, `RENDER_TARGET_DEPTH_FORMAT`, `RENDER_TARGET_DEPTH_TEXTURE_FORMAT`, `RENDER_TARGET_DEPTH_STENCIL_FORMAT`

---

### `packages/render-webgpu/src/wgpu-shadow.ts` - §69's shadow tier on WebGPU (WP-R1.7): the depth-only caster module, the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `SceneLights` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_SHADER_STAGE, GpuBindGroupLayout, GpuDevice, GpuSampler` | Import |
| `./wgpu-bindings.js` | `DRAW_UNIFORM_WGSL` | Import |
| `./wgpu-lights.js` | `LIGHTS_BIND_GROUP_INDEX, HEMISPHERE_UNIFORM_MEMBERS_WGSL, LIGHT_UNIFORM_BYTES, LIGHT_UNIFORM_MEMBERS_WGSL, LIGHT_UNIFORM_STRIDE_BYTES` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT, POSITION_SHADER_LOCATION, VERTEX_ENTRY_POINT` | Import |

**Exports:**
- Functions: `createShadowLightsBindGroupLayout`, `createShadowSampler`, `writeShadowUniforms`
- Constants: `SHADOW_MATRIX_OFFSET`, `SHADOW_PARAMS_OFFSET`, `SHADOW_LIGHT_UNIFORM_BYTES`, `SHADOW_MAP_BINDING`, `SHADOW_SAMPLER_BINDING`, `SHADOW_LIGHT_UNIFORM_WGSL`, `SHADOW_FACTOR_WGSL`, `SHADOW_SHADER_SOURCE`, `SHADOW_UNIFORM_SPARE_BYTES`

---

### `packages/render-webgpu/src/wgpu-skinning-registry.ts` - The skinning pipeline's registration slot (§54, §62; RFC 0003) — the

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GpuBindGroup, GpuBindGroupLayout, GpuDevice, GpuRenderPipeline` | Import (type-only) |
| `./wgpu-pipeline-cache.js` | `WgpuStencilDescriptor` | Import (type-only) |

**Exports:**
- Interfaces: `SkinningPipelineHost`, `WgpuSkinnedDrawDescriptor`, `WgpuSkinnedShadowDescriptor`, `SkinnedUnlitPipeline`, `SkinnedLitPipeline`, `SkinnedPrograms`, `SkinningPipelineFactory`
- Functions: `setSkinningPipelineFactory`, `resolveSkinningPipelineFactory`, `clearRegisteredSkinningPipeline`

---

### `packages/render-webgpu/src/wgpu-skinning.ts` - The skinned colour pipelines (§54, §62; RFC 0003) — a skinned variant of

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `MAX_SKINNING_JOINTS` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_BUFFER_USAGE, GPU_SHADER_STAGE, GpuBindGroup, GpuBindGroupLayout, GpuBuffer, GpuDevice, GpuPipelineLayout, GpuRenderPipeline, GpuShaderModule, GpuVertexBufferLayout` | Import |
| `./wgpu-bindings.js` | `DRAW_UNIFORM_WGSL, MAP_BINDING_WGSL` | Import |
| `./wgpu-lights.js` | `HEMISPHERE_IRRADIANCE_WGSL, LIGHT_UNIFORM_WGSL, PUNCTUAL_LIGHT_WGSL, SHADED_MAP_BINDING_WGSL` | Import |
| `./wgpu-lit.js` | `NORMAL_MATRIX_WGSL, litFragmentStageWgsl, shadedVertexBufferLayouts` | Import |
| `./wgpu-pipeline-cache.js` | `blendStateFor, stencilStateFor` | Import |
| `./wgpu-shadow.js` | `SHADOW_FACTOR_WGSL, SHADOW_LIGHT_UNIFORM_WGSL` | Import |
| `./wgpu-skinning-registry.js` | `setSkinningPipelineFactory, SkinnedLitPipeline, SkinnedPrograms, SkinnedUnlitPipeline, SkinningPipelineHost, WgpuSkinnedDrawDescriptor, WgpuSkinnedShadowDescriptor` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT, POSITION_BUFFER_LAYOUT, POSITION_SHADER_LOCATION, VERTEX_ENTRY_POINT, unlitFragmentStageWgsl, unlitVertexBufferLayouts` | Import |

**Exports:**
- Functions: `skinnedPaletteBindGroupIndex`, `createJointPaletteBindGroupLayout`, `skinningWgsl`, `skinnedUnlitVertexBufferLayouts`, `skinnedLitVertexBufferLayouts`, `skinnedShadowShaderSource`, `skinnedUnlitShaderSource`, `skinnedLitShaderSource`, `registerSkinningPipeline`
- Constants: `JOINTS_SHADER_LOCATION`, `WEIGHTS_SHADER_LOCATION`, `JOINTS_BUFFER_LAYOUT`, `WEIGHTS_BUFFER_LAYOUT`, `JOINT_PALETTE_BYTES`, `JOINT_PALETTE_FLOATS`, `JOINT_PALETTE_BINDING`, `SKINNED_SHADOW_VERTEX_BUFFER_LAYOUTS`, `SKINNED_SHADOW_SHADER_SOURCE`

---

### `packages/render-webgpu/src/wgpu-sprite.ts` - The sprite pipeline in hand-written WGSL (§55, WP-R1.3), plus the uniform

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_SHADER_STAGE, GpuBindGroupLayout, GpuDevice` | Import |
| `./wgpu-bindings.js` | `MAP_BINDING_WGSL` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT, UV_SHADER_LOCATION, VERTEX_ENTRY_POINT` | Import |

**Exports:**
- Functions: `createSpriteBindGroupLayout`
- Constants: `SPRITE_VIEW_PROJECTION_OFFSET`, `SPRITE_MODEL_OFFSET`, `SPRITE_TINT_OFFSET`, `SPRITE_UNIFORM_BYTES`, `SPRITE_UNIFORM_WGSL`, `SPRITE_SHADER_SOURCE`

---

### `packages/render-webgpu/src/wgpu-standard.ts` - The metallic-roughness pipeline in hand-written WGSL (§57

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_SHADER_STAGE, GpuBindGroupLayout, GpuDevice` | Import |
| `./wgpu-lights.js` | `LIGHT_UNIFORM_WGSL, HEMISPHERE_IRRADIANCE_WGSL, PUNCTUAL_LIGHT_WGSL, SHADED_MAP_BIND_GROUP_INDEX, SHADED_MAP_BINDING_WGSL, SHADED_MR_BIND_GROUP_INDEX, shadedMrBindingWgsl` | Import |
| `./wgpu-lit.js` | `shadedVertexStageWgsl` | Import |
| `./wgpu-shadow.js` | `SHADOW_FACTOR_WGSL, SHADOW_LIGHT_UNIFORM_WGSL` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT` | Import |

**Exports:**
- Functions: `createStandardBindGroupLayout`, `standardShaderSource`
- Constants: `STANDARD_VIEW_PROJECTION_OFFSET`, `STANDARD_MODEL_OFFSET`, `STANDARD_BASE_COLOR_OFFSET`, `STANDARD_NORMAL_OFFSET`, `STANDARD_EMISSIVE_OFFSET`, `STANDARD_SURFACE_OFFSET`, `STANDARD_UNIFORM_BYTES`, `STANDARD_UNIFORM_WGSL`

---

### `packages/render-webgpu/src/wgpu-stencil.ts` - §57/§67 stencil parity for the WebGPU backend (WP-R1.7) — the per-frame

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/render` | `RenderItem, RenderItemStencil` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GpuRenderPassEncoder` | Import (type-only) |
| `./wgpu-pipeline-cache.js` | `WgpuStencilDescriptor` | Import (type-only) |

**Exports:**
- Types: `WgpuStencilSource`
- Functions: `stencilDescriptor`, `applyStencilReference`, `frameWantsStencil`
- Constants: `STENCIL_ALL_BITS`, `CLEAR_STENCIL`

---

### `packages/render-webgpu/src/wgpu-texture.ts` - GPU-side textures and samplers for the WebGPU backend: one `GPUTexture` per

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/render` | `RenderItem` |
| `@fourjs/render` | `warnDisposedInUse` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./webgpu-device.js` | `GPU_TEXTURE_USAGE, GpuBindGroup, GpuBindGroupLayout, GpuDevice, GpuPipelineLayout, GpuRenderPipeline, GpuSampler, GpuShaderModule, GpuTexture, GpuTextureView` | Import |
| `./wgpu-bindings.js` | `MAP_SAMPLER_BINDING, MAP_TEXTURE_BINDING, createTextureBindGroupLayout` | Import |
| `./wgpu-unlit.js` | `FRAGMENT_ENTRY_POINT, VERTEX_ENTRY_POINT` | Import |

**Exports:**
- Classes: `WgpuTextureCache`
- Interfaces: `ResolvedSamplerState`, `WgpuTextureRecord`
- Types: `WgpuCacheableTexture`
- Functions: `mipLevelCount`, `textureByteLength`, `samplerKey`
- Constants: `MIPMAP_SHADER_SOURCE`

---

### `packages/render-webgpu/src/wgpu-unlit.ts` - The unlit pipeline in hand-written WGSL (§64, §120's MVP tier), plus the

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./wgpu-bindings.js` | `DRAW_UNIFORM_WGSL, MAP_BINDING_WGSL` | Import |
| `./webgpu-device.js` | `GpuVertexBufferLayout` | Import (type-only) |

**Exports:**
- Functions: `unlitVertexBufferLayouts`, `unlitShaderSource`, `unlitFragmentStageWgsl`
- Constants: `POSITION_SHADER_LOCATION`, `COLOR_SHADER_LOCATION`, `POSITION_BUFFER_LAYOUT`, `COLOR_BUFFER_LAYOUT`, `UV_SHADER_LOCATION`, `UV_BUFFER_LAYOUT`, `VERTEX_ENTRY_POINT`, `FRAGMENT_ENTRY_POINT`, `CLEAR_VERTEX_COUNT`, `CLEAR_SHADER_SOURCE`

---

<a id="packages-scene-dependencies"></a>

## Packages/scene Dependencies

### `packages/scene/src/authority.ts` - Transform authority (§42).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEV_WARNING_PREFIX` |

**Exports:**
- Interfaces: `AuthorityNode`
- Types: `TransformAuthority`
- Functions: `warnAuthorityConflict`
- Constants: `TRANSFORM_AUTHORITIES`, `DEFAULT_TRANSFORM_AUTHORITY`

---

### `packages/scene/src/camera.ts` - Cameras (§47).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Matrix4, DepthRange` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./layers.js` | `ALL_LAYERS, LayerMask` | Import |
| `./node.js` | `Node` | Import |
| `./world-transforms.js` | `resolveWorldTransform` | Import |

**Exports:**
- Classes: `PerspectiveCamera`, `OrthographicCamera`
- Interfaces: `PerspectiveCameraOptions`, `OrthographicCameraOptions`

---

### `packages/scene/src/group.ts` - `Group` (§6, §104) — a concrete {@link Node} with no behavior of its own.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./node.js` | `Node` | Import |

**Exports:**
- Classes: `Group`

---

### `packages/scene/src/index.ts` - Package entry point for @fourjs/scene (re-exports 86 symbols)

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./authority.js` | `DEFAULT_TRANSFORM_AUTHORITY, TRANSFORM_AUTHORITIES, warnAuthorityConflict` | Re-export |
| `./camera.js` | `Camera, OrthographicCamera, PerspectiveCamera` | Re-export |
| `./screen-camera.js` | `DEFAULT_SCREEN_FAR, DEFAULT_SCREEN_NEAR, DEFAULT_SCREEN_ORIGIN, DEFAULT_SCREEN_UNITS, SCREEN_ORIGINS, SCREEN_UNITS, ScreenCamera` | Re-export |
| `./trackball.js` | `DEFAULT_TRACKBALL_RADIUS, TrackballRig` | Re-export |
| `./group.js` | `Group` | Re-export |
| `./node-space.js` | `NODE_SPACE_SERIALIZER, NodeSpace` | Re-export |
| `./layers.js` | `ALL_LAYERS, DEFAULT_LAYER, DEFAULT_LAYER_MASK, DEFAULT_LAYER_NAME, LAYER_COUNT, NO_LAYERS, applyLayers, assertLayerMask, defineLayer, isLayerMask, layerIndex, layerMask, layerMaskNames, layerName, layerNames, layersMatch, resetLayers` | Re-export |
| `./light.js` | `DirectionalLight, DirectionalLightShadow, HemisphereLight, PointLight, PunctualLight, SpotLight` | Re-export |
| `./interpolation.js` | `POSE_SNAPSHOT_PRIORITY, PoseBuffer, createSnapshotSystem` | Re-export |
| `./node.js` | `Node, restoreNodeId` | Re-export |
| `./pose-target.js` | `PoseTarget` | Re-export |
| `./skeleton.js` | `Bone, MORPH_WEIGHTS_SERIALIZER, MorphWeights, Skeleton` | Re-export |
| `./scene.js` | `Scene` | Re-export |
| `./transform.js` | `Transform` | Re-export |
| `./viewport.js` | `createFullscreenViewport` | Re-export |
| `./world-transforms.js` | `resolveWorldTransform, resolveWorldTransforms` | Re-export |
| `./authority.js` | `AuthorityNode, TransformAuthority` | Re-export (type-only) |
| `./camera.js` | `OrthographicCameraOptions, PerspectiveCameraOptions` | Re-export (type-only) |
| `./screen-camera.js` | `ScreenCameraOptions, ScreenOrigin, ScreenUnits, SurfaceSizedCamera` | Re-export (type-only) |
| `./trackball.js` | `TrackballRigOptions` | Re-export (type-only) |
| `./node-space.js` | `NodeSpaceOptions, NodeSpaceSerializerShape` | Re-export (type-only) |
| `./layers.js` | `LayerMask, LayeredNode` | Re-export (type-only) |
| `./light.js` | `ColorRGB, DirectionalLightOptions, HemisphereLightOptions, LightColorInput, DirectionalLightShadowOptions, PunctualLightOptions, SpotLightOptions` | Re-export (type-only) |
| `./interpolation.js` | `PoseSnapshotSystem, SnapshotSystemOptions` | Re-export (type-only) |
| `./node.js` | `HitTestMode, NodeEventMap, NodeHierarchyEvent, NodeOptions, NodeType` | Re-export (type-only) |
| `./skeleton.js` | `MorphWeightsSerializerShape` | Re-export (type-only) |
| `./viewport.js` | `Viewport` | Re-export (type-only) |
| `./world-transforms.js` | `WorldTransformStats` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `DEFAULT_TRANSFORM_AUTHORITY`, `TRANSFORM_AUTHORITIES`, `warnAuthorityConflict`, `Camera`, `OrthographicCamera`, `PerspectiveCamera`, `DEFAULT_SCREEN_FAR`, `DEFAULT_SCREEN_NEAR`, `DEFAULT_SCREEN_ORIGIN`, `DEFAULT_SCREEN_UNITS`, `SCREEN_ORIGINS`, `SCREEN_UNITS`, `ScreenCamera`, `DEFAULT_TRACKBALL_RADIUS`, `TrackballRig`, `Group`, `NODE_SPACE_SERIALIZER`, `NodeSpace`, `ALL_LAYERS`, `DEFAULT_LAYER`, `DEFAULT_LAYER_MASK`, `DEFAULT_LAYER_NAME`, `LAYER_COUNT`, `NO_LAYERS`, `applyLayers`, `assertLayerMask`, `defineLayer`, `isLayerMask`, `layerIndex`, `layerMask`, `layerMaskNames`, `layerName`, `layerNames`, `layersMatch`, `resetLayers`, `DirectionalLight`, `DirectionalLightShadow`, `HemisphereLight`, `PointLight`, `PunctualLight`, `SpotLight`, `POSE_SNAPSHOT_PRIORITY`, `PoseBuffer`, `createSnapshotSystem`, `Node`, `restoreNodeId`, `PoseTarget`, `Bone`, `MORPH_WEIGHTS_SERIALIZER`, `MorphWeights`, `Skeleton`, `Scene`, `Transform`, `createFullscreenViewport`, `resolveWorldTransform`, `resolveWorldTransforms`, `AuthorityNode`, `TransformAuthority`, `OrthographicCameraOptions`, `PerspectiveCameraOptions`, `ScreenCameraOptions`, `ScreenOrigin`, `ScreenUnits`, `SurfaceSizedCamera`, `TrackballRigOptions`, `NodeSpaceOptions`, `NodeSpaceSerializerShape`, `LayerMask`, `LayeredNode`, `ColorRGB`, `DirectionalLightOptions`, `HemisphereLightOptions`, `LightColorInput`, `DirectionalLightShadowOptions`, `PunctualLightOptions`, `SpotLightOptions`, `PoseSnapshotSystem`, `SnapshotSystemOptions`, `HitTestMode`, `NodeEventMap`, `NodeHierarchyEvent`, `NodeOptions`, `NodeType`, `MorphWeightsSerializerShape`, `Viewport`, `WorldTransformStats`

---

### `packages/scene/src/interpolation.ts` - Previous/current pose storage and render interpolation (§43).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Quaternion, Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./node.js` | `Node` | Import (type-only) |

**Exports:**
- Classes: `PoseBuffer`
- Interfaces: `SnapshotSystemOptions`, `PoseSnapshotSystem`
- Functions: `createSnapshotSystem`
- Constants: `POSE_SNAPSHOT_PRIORITY`

---

### `packages/scene/src/layers.ts` - Symbolic layers and their compiled masks (§46).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Exports:**
- Interfaces: `LayeredNode`
- Types: `LayerMask`
- Functions: `defineLayer`, `layerIndex`, `layerName`, `layerNames`, `layerMask`, `layerMaskNames`, `layersMatch`, `isLayerMask`, `assertLayerMask`, `applyLayers`, `resetLayers`
- Constants: `LAYER_COUNT`, `DEFAULT_LAYER_NAME`, `DEFAULT_LAYER`, `DEFAULT_LAYER_MASK`, `ALL_LAYERS`, `NO_LAYERS`

---

### `packages/scene/src/light.ts` - Lights (§68) — the multi-light tier: directional, point, and spot nodes.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Matrix4, parseColorRGB, srgbToLinearRGB, ColorRGB, Vector3` |
| `@fourjs/math` | `ColorRGB` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./node.js` | `Node` | Import |
| `./world-transforms.js` | `resolveWorldTransform` | Import |

**Exports:**
- Classes: `DirectionalLightShadow`, `DirectionalLight`, `HemisphereLight`, `PointLight`, `SpotLight`
- Interfaces: `DirectionalLightShadowOptions`, `DirectionalLightOptions`, `HemisphereLightOptions`, `PunctualLightOptions`, `SpotLightOptions`
- Types: `LightColorInput`
- Re-exports: `ColorRGB`

---

### `packages/scene/src/node-space.ts` - §8's node-level space declaration — {@link NodeSpace} (PH-12 remainder).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `DEFAULT_SPACE_MODE, SPACE_MODES, Component, ComponentHost, JsonValue, SpaceMode` |
| `@fourjs/math` | `Vector3` |

**Exports:**
- Classes: `NodeSpace`
- Interfaces: `NodeSpaceSerializerShape`, `NodeSpaceOptions`
- Constants: `NODE_SPACE_SERIALIZER`

---

### `packages/scene/src/node.ts` - The unified node model (§6), its component delegation (§6a), and its event

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `ComponentRegistry, DEV_WARNING_PREFIX, EventEmitter, FourError, Component, ComponentHost, ComponentType` |
| `@fourjs/math` | `Quaternion, Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./authority.js` | `DEFAULT_TRANSFORM_AUTHORITY, TransformAuthority` | Import |
| `./layers.js` | `DEFAULT_LAYER_MASK, LayerMask` | Import |
| `./transform.js` | `Transform` | Import |
| `./world-transforms.js` | `resolveWorldTransform` | Import |

**Exports:**
- Interfaces: `NodeHierarchyEvent`, `NodeEventMap`, `NodeOptions`
- Types: `NodeType`, `HitTestMode`
- Functions: `restoreNodeId`

---

### `packages/scene/src/pose-target.ts` - The `PoseTarget` component (§6a, §19, §42) — the pose animation *asks* for,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Component, ComponentHost` |
| `@fourjs/math` | `Quaternion, Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./transform.js` | `Transform` | Import (type-only) |

**Exports:**
- Classes: `PoseTarget`

---

### `packages/scene/src/scene.ts` - `Scene` (§6, §46, §104) — the root node, plus the indexed lookups of §46.

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Component, ComponentType` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./light.js` | `ColorRGB` | Import (type-only) |
| `./node.js` | `Node, NodeType` | Import |

**Exports:**
- Classes: `Scene`

---

### `packages/scene/src/screen-camera.ts` - §47's `ScreenCamera` — the pixel-rectangle camera (R-37, 2026-08-21).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |
| `@fourjs/math` | `DepthRange` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./camera.js` | `Camera` | Import |

**Exports:**
- Classes: `ScreenCamera`
- Interfaces: `SurfaceSizedCamera`, `ScreenCameraOptions`
- Types: `ScreenOrigin`, `ScreenUnits`
- Constants: `SCREEN_ORIGINS`, `SCREEN_UNITS`, `DEFAULT_SCREEN_ORIGIN`, `DEFAULT_SCREEN_UNITS`, `DEFAULT_SCREEN_NEAR`, `DEFAULT_SCREEN_FAR`

---

### `packages/scene/src/skeleton.ts` - Bones, skeletons, and morph weights (§54, §14, §17; RFC 0003 — gaps PH-10 +

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError, Component, ComponentHost, JsonValue` |
| `@fourjs/math` | `Matrix4` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./node.js` | `Node` | Import |
| `./world-transforms.js` | `resolveWorldTransform` | Import |

**Exports:**
- Classes: `Bone`, `Skeleton`, `MorphWeights`
- Interfaces: `MorphWeightsSerializerShape`
- Constants: `MORPH_WEIGHTS_SERIALIZER`

---

### `packages/scene/src/trackball.ts` - §44/§47's **trackball** rig (R-37, 2026-08-21) — the last of the seven camera

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Quaternion, Vector3` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./authority.js` | `warnAuthorityConflict` | Import |
| `./node.js` | `Node` | Import (type-only) |
| `./screen-camera.js` | `DEFAULT_SCREEN_ORIGIN, ScreenOrigin` | Import |

**Exports:**
- Classes: `TrackballRig`
- Interfaces: `TrackballRigOptions`
- Constants: `DEFAULT_TRACKBALL_RADIUS`

---

### `packages/scene/src/transform.ts` - Local/world transform of a scene node (§7).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Matrix4, Quaternion, Vector3` |

**Exports:**
- Classes: `Transform`

---

### `packages/scene/src/viewport.ts` - Viewports (§48).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./camera.js` | `Camera` | Import (type-only) |
| `./layers.js` | `LayerMask` | Import (type-only) |

**Exports:**
- Interfaces: `Viewport`
- Functions: `createFullscreenViewport`

---

### `packages/scene/src/world-transforms.ts` - World-transform resolution (§7) — the single writer of every

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Matrix4` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./node.js` | `Node` | Import (type-only) |
| `./transform.js` | `Transform` | Import (type-only) |

**Exports:**
- Interfaces: `WorldTransformStats`
- Functions: `resolveWorldTransforms`, `resolveWorldTransform`

---

<a id="packages-serialization-dependencies"></a>

## Packages/serialization Dependencies

### `packages/serialization/src/capabilities.ts` - This package's §81 capability tokens (RFC 0002; declared here since

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `defineCapability` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./migration.js` | `SceneMigrationRegistry` | Import (type-only) |
| `./serializer.js` | `ComponentSerializerRegistry` | Import (type-only) |

**Exports:**
- Constants: `COMPONENT_SERIALIZERS`, `SCENE_MIGRATIONS`

---

### `packages/serialization/src/format.ts` - The §79 scene document — its types, its JSON encoding, and its canonical

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError, cloneJsonValue, parseUntrustedJson, JsonValue, UntrustedJsonLimits` |
| `@fourjs/scene` | `DEFAULT_TRANSFORM_AUTHORITY, TRANSFORM_AUTHORITIES, TransformAuthority` |
| `@fourjs/core` | `cloneJsonValue` |
| `@fourjs/core` | `JsonValue` |
| `@fourjs/core` | `UntrustedJsonLimits` |

**Exports:**
- Interfaces: `Vector3Document`, `QuaternionDocument`, `TransformDocument`, `ComponentDocument`, `SceneNodeDocument`, `SceneDocument`
- Types: `JsonObject`
- Functions: `validateVector3Document`, `validateQuaternionDocument`, `isJsonArray`, `isJsonObject`, `asJsonObject`, `validateSceneDocument`, `encodeSceneDocument`, `decodeSceneDocument`
- Constants: `SCENE_FORMAT_VERSION`
- Re-exports: `cloneJsonValue`, `JsonValue`, `UntrustedJsonLimits`

---

=======
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd
### `packages/serialization/src/index.ts` - `@fourjs/serialization` — the §79 scene document and its §80 migrations.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./capabilities.js` | `COMPONENT_SERIALIZERS, SCENE_MIGRATIONS` | Re-export |
| `./format.js` | `SCENE_FORMAT_VERSION, asJsonObject, cloneJsonValue, decodeSceneDocument, encodeSceneDocument, isJsonArray, isJsonObject, validateQuaternionDocument, validateSceneDocument, validateVector3Document` | Re-export |
| `./migration.js` | `SceneMigrationRegistry, migrateSceneDocument, runSceneMigrations` | Re-export |
| `./serializer.js` | `ComponentSerializerRegistry, GROUP_NODE_TYPE, POSE_TARGET_SERIALIZER, SCENE_NODE_TYPE, applyTransformDocument, createDefaultComponentSerializers, instantiateScene, instantiateSceneNodes, serializeScene` | Re-export |
| `./format.js` | `ComponentDocument, JsonObject, JsonValue, QuaternionDocument, SceneDocument, SceneNodeDocument, TransformDocument, UntrustedJsonLimits, Vector3Document` | Re-export (type-only) |
| `./migration.js` | `MigrateSceneDocumentOptions, SceneMigration, SceneMigrationContext, SceneMigrationWarning` | Re-export (type-only) |
| `./serializer.js` | `ComponentSerializer, InstantiateSceneOptions, SerializeSceneOptions, UnknownComponentPolicy` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `COMPONENT_SERIALIZERS`, `SCENE_MIGRATIONS`, `SCENE_FORMAT_VERSION`, `asJsonObject`, `cloneJsonValue`, `decodeSceneDocument`, `encodeSceneDocument`, `isJsonArray`, `isJsonObject`, `validateQuaternionDocument`, `validateSceneDocument`, `validateVector3Document`, `SceneMigrationRegistry`, `migrateSceneDocument`, `runSceneMigrations`, `ComponentSerializerRegistry`, `GROUP_NODE_TYPE`, `POSE_TARGET_SERIALIZER`, `SCENE_NODE_TYPE`, `applyTransformDocument`, `createDefaultComponentSerializers`, `instantiateScene`, `instantiateSceneNodes`, `serializeScene`, `ComponentDocument`, `JsonObject`, `JsonValue`, `QuaternionDocument`, `SceneDocument`, `SceneNodeDocument`, `TransformDocument`, `UntrustedJsonLimits`, `Vector3Document`, `MigrateSceneDocumentOptions`, `SceneMigration`, `SceneMigrationContext`, `SceneMigrationWarning`, `ComponentSerializer`, `InstantiateSceneOptions`, `SerializeSceneOptions`, `UnknownComponentPolicy`

---

<<<<<<< HEAD
### `packages/serialization/src/migration.ts` - Scene migration (§80) — the registry of upgrade steps and the chain runner
=======
### `packages/serialization/src/format.ts` - The §79 scene document — its types, its JSON encoding, and its canonical
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
<<<<<<< HEAD
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./format.js` | `SCENE_FORMAT_VERSION, asJsonObject, validateSceneDocument, JsonObject, SceneDocument` | Import |

**Exports:**
- Classes: `SceneMigrationRegistry`
- Interfaces: `SceneMigrationContext`, `SceneMigrationWarning`, `MigrateSceneDocumentOptions`
- Types: `SceneMigration`
- Functions: `runSceneMigrations`, `migrateSceneDocument`
=======
| `@fourjs/core` | `FourError, cloneJsonValue, parseUntrustedJson, JsonValue, UntrustedJsonLimits` |
| `@fourjs/scene` | `DEFAULT_TRANSFORM_AUTHORITY, TRANSFORM_AUTHORITIES, TransformAuthority` |
| `@fourjs/core` | `cloneJsonValue` |
| `@fourjs/core` | `JsonValue` |
| `@fourjs/core` | `UntrustedJsonLimits` |

**Exports:**
- Interfaces: `Vector3Document`, `QuaternionDocument`, `TransformDocument`, `ComponentDocument`, `SceneNodeDocument`, `SceneDocument`
- Types: `JsonObject`
- Functions: `validateVector3Document`, `validateQuaternionDocument`, `isJsonArray`, `isJsonObject`, `asJsonObject`, `validateSceneDocument`, `encodeSceneDocument`, `decodeSceneDocument`
- Constants: `SCENE_FORMAT_VERSION`
- Re-exports: `cloneJsonValue`, `JsonValue`, `UntrustedJsonLimits`
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

---

### `packages/serialization/src/serializer.ts` - Scene ⇄ document (§79) — the component-serializer registry, the writer, and

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError, Component, ComponentType` |
| `@fourjs/math` | `Quaternion, Vector3` |
| `@fourjs/scene` | `Group, Node, PoseTarget, Scene, restoreNodeId, Transform` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./format.js` | `SCENE_FORMAT_VERSION, asJsonObject, isJsonArray, isJsonObject, validateQuaternionDocument, validateSceneDocument, validateVector3Document, ComponentDocument, JsonObject, JsonValue, SceneDocument, SceneNodeDocument, TransformDocument` | Import |

**Exports:**
- Classes: `ComponentSerializerRegistry`
- Interfaces: `ComponentSerializer`, `SerializeSceneOptions`, `InstantiateSceneOptions`
- Types: `UnknownComponentPolicy`
- Functions: `createDefaultComponentSerializers`, `applyTransformDocument`, `serializeScene`, `instantiateSceneNodes`, `instantiateScene`
- Constants: `SCENE_NODE_TYPE`, `GROUP_NODE_TYPE`, `POSE_TARGET_SERIALIZER`

---

<<<<<<< HEAD
<a id="packages-text-dependencies"></a>

## Packages/text Dependencies

### `packages/text/src/bitmap-font.ts` - A built-in, dependency-free monospace bitmap font (§56 MVP tier).

**Exports:**
- Interfaces: `BitmapGlyph`, `BitmapFont`, `BitmapFontOptions`
- Functions: `createBitmapFont`, `glyphFor`, `glyphPixel`, `glyphToAscii`
- Constants: `BUILTIN_FONT`

---

### `packages/text/src/glyph-atlas.ts` - `buildGlyphAtlas` (§56 MVP tier) — every glyph of a {@link BitmapFont} packed

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./bitmap-font.js` | `BitmapFont, BitmapGlyph` | Import (type-only) |
| `./bitmap-font.js` | `BUILTIN_FONT, glyphPixel` | Import |

**Exports:**
- Interfaces: `GlyphAtlasEntry`, `GlyphAtlas`, `GlyphAtlasOptions`
- Functions: `buildGlyphAtlas`

---

### `packages/text/src/index.ts` - `@fourjs/text` — bitmap text at §56's MVP tier.

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./bitmap-font.js` | `BUILTIN_FONT, createBitmapFont, glyphFor, glyphPixel, glyphToAscii` | Re-export |
| `./glyph-atlas.js` | `buildGlyphAtlas` | Re-export |
| `./text-layout.js` | `layoutText` | Re-export |
| `./shaping.js` | `IdentityShapingEngine, DEFAULT_MAXIMUM_FONT_BYTES, validateFontBytes` | Re-export |
| `./bitmap-font.js` | `BitmapFont, BitmapFontOptions, BitmapGlyph` | Re-export (type-only) |
| `./glyph-atlas.js` | `GlyphAtlas, GlyphAtlasEntry, GlyphAtlasOptions` | Re-export (type-only) |
| `./text-layout.js` | `TextAlign, TextLayout, TextLayoutOptions, TextQuad` | Re-export (type-only) |
| `./shaping.js` | `ShapingDirection, ShapedGlyph, ShapedRun, ShapeQuery, ShapingEngine` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `BUILTIN_FONT`, `createBitmapFont`, `glyphFor`, `glyphPixel`, `glyphToAscii`, `buildGlyphAtlas`, `layoutText`, `IdentityShapingEngine`, `DEFAULT_MAXIMUM_FONT_BYTES`, `validateFontBytes`, `BitmapFont`, `BitmapFontOptions`, `BitmapGlyph`, `GlyphAtlas`, `GlyphAtlasEntry`, `GlyphAtlasOptions`, `TextAlign`, `TextLayout`, `TextLayoutOptions`, `TextQuad`, `ShapingDirection`, `ShapedGlyph`, `ShapedRun`, `ShapeQuery`, `ShapingEngine`

---

### `packages/text/src/shaping.ts` - shaping module

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError, Disposable` |

**Exports:**
- Classes: `IdentityShapingEngine`
- Interfaces: `ShapedGlyph`, `ShapedRun`, `ShapeQuery`, `ShapingEngine`
- Types: `ShapingDirection`
- Functions: `validateFontBytes`, `validateShapingDirection`
- Constants: `DEFAULT_MAXIMUM_FONT_BYTES`

---

### `packages/text/src/text-layout.ts` - `layoutText` (§56 MVP tier) — a string plus a {@link GlyphAtlas} becomes a

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./shaping.js` | `IdentityShapingEngine, ShapingEngine, ShapingDirection` | Import |
| `./glyph-atlas.js` | `GlyphAtlas, GlyphAtlasEntry` | Import (type-only) |

**Exports:**
- Interfaces: `TextQuad`, `TextLayoutOptions`, `TextLayout`
- Types: `TextAlign`
- Functions: `layoutText`

---

<a id="packages-ui-dependencies"></a>

## Packages/ui Dependencies

### `packages/ui/src/accessibility.ts` - §75's hidden DOM accessibility mirror (2026-09-06, A-13 remainder).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Disposable, Unsubscribe` |
| `@fourjs/scene` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./button.js` | `Button` | Import |
| `./checkable.js` | `Checkbox, Toggle` | Import |
| `./progress.js` | `ProgressIndicator` | Import |
| `./radio.js` | `RadioButton` | Import |
| `./slider.js` | `Slider` | Import |
| `./widget.js` | `registerAccessibilitySync, UIWidget, WidgetAccessibility` | Import |

**Exports:**
- Interfaces: `DocumentLike`, `ElementStyleLike`, `ElementLike`, `AccessibilityMirrorOptions`, `AccessibilityMirror`
- Types: `AccessibilityMirrorRoot`
- Functions: `prefersReducedMotion`, `installAccessibilityMirror`, `accessibilityElementId`

---

### `packages/ui/src/button.ts` - `Button` (§73) — the one control in this MVP that *does* something: a §72

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/input` | `ScenePointerEvent, SceneKeyEvent` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./panel.js` | `Panel, PanelOptions` | Import |
| `./widget.js` | `WidgetActivationSource` | Import (type-only) |

**Exports:**
- Classes: `Button`
- Types: `ButtonOptions`

---

### `packages/ui/src/canvas-view.ts` - `CanvasViewWidget` (§73's "canvas view"; RFC 0004, accepted 2026-08-21) — a

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./numbers.js` | `requireFinite` | Import |
| `./widget.js` | `UIWidget, UIWidgetOptions` | Import |

**Exports:**
- Classes: `CanvasViewWidget`
- Interfaces: `CanvasViewWidgetOptions`

---

### `packages/ui/src/capabilities.ts` - This package's §81 capability token (RFC 0002).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `defineCapability` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./control-registry.js` | `UIControlRegistry` | Import (type-only) |

**Exports:**
- Constants: `UI_CONTROLS`

---

### `packages/ui/src/checkable.ts` - `Toggle` and `Checkbox` (§73), over the checkable base they share

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./button.js` | `Button, ButtonOptions` | Import |

**Exports:**
- Classes: `Toggle`, `Checkbox`
- Interfaces: `CheckableWidgetOptions`
- Types: `ToggleOptions`, `CheckboxOptions`

---

### `packages/ui/src/control-registry.ts` - The §81 UI-control registry — a named map of widget constructors a host

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `FourError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./widget.js` | `UIWidget` | Import (type-only) |

**Exports:**
- Classes: `UIControlRegistry`
- Types: `UIControlConstructor`

---

### `packages/ui/src/image.ts` - `ImageWidget` (§73's "image") — a box, a source key, and an intrinsic size

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector2` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./numbers.js` | `requireNonNegative` | Import |
| `./widget.js` | `UIWidget, UIWidgetOptions` | Import |

**Exports:**
- Classes: `ImageWidget`
- Interfaces: `ImageWidgetOptions`

---

### `packages/ui/src/index.ts` - `@fourjs/ui` — retained-mode UI at §113a's MVP tier (§73–§75).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./capabilities.js` | `UI_CONTROLS` | Re-export |
| `./control-registry.js` | `UIControlRegistry` | Re-export |
| `./accessibility.js` | `accessibilityElementId, installAccessibilityMirror, prefersReducedMotion` | Re-export |
| `./button.js` | `Button` | Re-export |
| `./canvas-view.js` | `CanvasViewWidget` | Re-export |
| `./checkable.js` | `CheckableWidget, Checkbox, Toggle` | Re-export |
| `./image.js` | `ImageWidget` | Re-export |
| `./keyboard.js` | `collectFocusOrder, installKeyboardTraversal, keyboardFocusTarget` | Re-export |
| `./label.js` | `Label` | Re-export |
| `./panel.js` | `Panel` | Re-export |
| `./progress.js` | `ProgressIndicator` | Re-export |
| `./radio.js` | `RadioButton, checkedRadio, collectRadioGroup` | Re-export |
| `./slider.js` | `Slider` | Re-export |
| `./widget.js` | `Insets, UIWidget, UI_LAYOUT_AUTHORITY, UI_STAGED, applyInsets, collectPickables, focusedWidget, isUIWidget, registerAccessibilitySync` | Re-export |
| `./control-registry.js` | `UIControlConstructor` | Re-export (type-only) |
| `./accessibility.js` | `AccessibilityMirror, AccessibilityMirrorOptions, AccessibilityMirrorRoot, DocumentLike, ElementLike, ElementStyleLike` | Re-export (type-only) |
| `./button.js` | `ButtonOptions` | Re-export (type-only) |
| `./canvas-view.js` | `CanvasViewWidgetOptions` | Re-export (type-only) |
| `./checkable.js` | `CheckableWidgetOptions, CheckboxOptions, ToggleOptions` | Re-export (type-only) |
| `./image.js` | `ImageWidgetOptions` | Re-export (type-only) |
| `./keyboard.js` | `KeyboardTraversalOptions` | Re-export (type-only) |
| `./label.js` | `LabelOptions` | Re-export (type-only) |
| `./panel.js` | `LayoutAlign, LayoutDirection, LayoutJustify, LayoutType, PanelLayout, PanelOptions` | Re-export (type-only) |
| `./progress.js` | `ProgressIndicatorOptions` | Re-export (type-only) |
| `./radio.js` | `RadioButtonOptions` | Re-export (type-only) |
| `./slider.js` | `SliderOptions, SliderOrientation` | Re-export (type-only) |
| `./widget.js` | `AccessibilitySync, InsetsInit, UIFocusEvent, UIWidgetOptions, WidgetAccessibility, WidgetActivateEvent, WidgetActivationSource, WidgetSkin, WidgetStateChangeEvent, WidgetStateSnapshot, WidgetValueChangeEvent` | Re-export (type-only) |

**Exports:**
- Constants: `PACKAGE_NAME`
- Re-exports: `UI_CONTROLS`, `UIControlRegistry`, `accessibilityElementId`, `installAccessibilityMirror`, `prefersReducedMotion`, `Button`, `CanvasViewWidget`, `CheckableWidget`, `Checkbox`, `Toggle`, `ImageWidget`, `collectFocusOrder`, `installKeyboardTraversal`, `keyboardFocusTarget`, `Label`, `Panel`, `ProgressIndicator`, `RadioButton`, `checkedRadio`, `collectRadioGroup`, `Slider`, `Insets`, `UIWidget`, `UI_LAYOUT_AUTHORITY`, `UI_STAGED`, `applyInsets`, `collectPickables`, `focusedWidget`, `isUIWidget`, `registerAccessibilitySync`, `UIControlConstructor`, `AccessibilityMirror`, `AccessibilityMirrorOptions`, `AccessibilityMirrorRoot`, `DocumentLike`, `ElementLike`, `ElementStyleLike`, `ButtonOptions`, `CanvasViewWidgetOptions`, `CheckableWidgetOptions`, `CheckboxOptions`, `ToggleOptions`, `ImageWidgetOptions`, `KeyboardTraversalOptions`, `LabelOptions`, `LayoutAlign`, `LayoutDirection`, `LayoutJustify`, `LayoutType`, `PanelLayout`, `PanelOptions`, `ProgressIndicatorOptions`, `RadioButtonOptions`, `SliderOptions`, `SliderOrientation`, `AccessibilitySync`, `InsetsInit`, `UIFocusEvent`, `UIWidgetOptions`, `WidgetAccessibility`, `WidgetActivateEvent`, `WidgetActivationSource`, `WidgetSkin`, `WidgetStateChangeEvent`, `WidgetStateSnapshot`, `WidgetValueChangeEvent`

---

### `packages/ui/src/keyboard.ts` - §75's keyboard navigation: Tab traversal over a widget tree (2026-08-07,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Unsubscribe` |
| `@fourjs/input` | `SceneKeyEvent` |
| `@fourjs/scene` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./widget.js` | `UIWidget, focusedWidget` | Import |

**Exports:**
- Interfaces: `KeyboardTraversalOptions`
- Functions: `collectFocusOrder`, `keyboardFocusTarget`, `installKeyboardTraversal`

---

### `packages/ui/src/label.ts` - `Label` (§73) — a widget whose intrinsic size is its text (§74, §56).

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/text` | `TextLayoutOptions` |
| `@fourjs/math` | `Vector2` |
| `@fourjs/text` | `layoutText, GlyphAtlas, TextLayout` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./widget.js` | `UIWidget, UIWidgetOptions` | Import |

**Exports:**
- Classes: `Label`
- Interfaces: `LabelOptions`

---

### `packages/ui/src/numbers.ts` - Numeric guards and range arithmetic shared by the §73 controls that carry a

**Exports:**
- Functions: `requireFinite`, `requireNonNegative`, `resolveValue`, `fractionOf`

---

### `packages/ui/src/panel.ts` - `Panel` (§73) and the layout engine (§74) — the container widget, and the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/math` | `Vector2` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./widget.js` | `UIWidget, applyInsets, InsetsInit, UIWidgetOptions` | Import |

**Exports:**
- Classes: `Panel`
- Interfaces: `PanelLayout`, `PanelOptions`
- Types: `LayoutType`, `LayoutDirection`, `LayoutJustify`, `LayoutAlign`

---

### `packages/ui/src/progress.ts` - `ProgressIndicator` (§73) — a value shown, never edited (2026-08-07, A-12).

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./numbers.js` | `fractionOf, requireFinite` | Import |
| `./panel.js` | `Panel, PanelOptions` | Import |

**Exports:**
- Classes: `ProgressIndicator`
- Interfaces: `ProgressIndicatorOptions`

---

### `packages/ui/src/radio.ts` - `RadioButton` (§73's "radio control") and its group mechanism (2026-08-07,

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/input` | `SceneKeyEvent` |
| `@fourjs/scene` | `Node` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./checkable.js` | `CheckableWidget, CheckableWidgetOptions` | Import |

**Exports:**
- Classes: `RadioButton`
- Interfaces: `RadioButtonOptions`
- Functions: `collectRadioGroup`, `checkedRadio`

---

### `packages/ui/src/slider.ts` - `Slider` (§73) — a value dragged along a track (§72) or stepped with the

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/input` | `ScenePointerEvent, SceneKeyEvent` |
| `@fourjs/math` | `Matrix4, Vector3` |
| `@fourjs/scene` | `resolveWorldTransform` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./numbers.js` | `fractionOf, requireFinite, resolveValue` | Import |
| `./panel.js` | `Panel, PanelOptions` | Import |

**Exports:**
- Classes: `Slider`
- Interfaces: `SliderOptions`
- Types: `SliderOrientation`

---

### `packages/ui/src/widget.ts` - `UIWidget` (§73–§75) — the retained-mode UI layer's base class: a scene node

**Workspace Dependencies:**
| Package | Import |
|---------|--------|
| `@fourjs/core` | `Disposable, Unsubscribe` |
| `@fourjs/input` | `Pickable, ScenePointerEvent` |
| `@fourjs/math` | `Vector2, Vector3` |
| `@fourjs/scene` | `Node, warnAuthorityConflict, NodeOptions` |

**Exports:**
- Classes: `Insets`
- Interfaces: `WidgetStateSnapshot`, `WidgetStateChangeEvent`, `WidgetActivateEvent`, `WidgetValueChangeEvent`, `UIFocusEvent`, `WidgetAccessibility`, `WidgetSkin`, `UIWidgetOptions`
- Types: `InsetsInit`, `WidgetActivationSource`, `AccessibilitySync`
- Functions: `applyInsets`, `registerAccessibilitySync`, `focusedWidget`, `isUIWidget`, `collectPickables`
- Constants: `UI_LAYOUT_AUTHORITY`, `UI_STAGED`

---

=======
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd
<a id="dependency-matrix"></a>
## Dependency Matrix

### File Import/Export Matrix

| File | Imports From | Exports To |
|------|--------------|------------|
<<<<<<< HEAD
| `packages/render/src/index` | 32 files | 0 files |
| `packages/render-webgpu/src/index` | 27 files | 0 files |
| `packages/render-webgpu/src/webgpu-device` | 0 files | 27 files |
| `packages/physics/src/index` | 24 files | 0 files |
| `packages/render-webgpu/src/webgpu-renderer` | 22 files | 2 files |
| `packages/motion/src/index` | 23 files | 0 files |
| `packages/physics/src/world` | 15 files | 6 files |
| `packages/render-webgl/src/gl-program` | 0 files | 18 files |
| `packages/render-webgl/src/index` | 17 files | 0 files |
| `packages/materials/src/index` | 16 files | 0 files |
| `packages/physics/src/types` | 0 files | 16 files |
| `packages/render-webgpu/src/wgpu-unlit` | 2 files | 14 files |
| `packages/scene/src/index` | 16 files | 0 files |
| `packages/render-webgl/src/webgl-renderer` | 13 files | 2 files |
| `packages/render-webgpu/src/wgpu-pipeline-cache` | 9 files | 6 files |
| `packages/physics/src/descriptors` | 4 files | 10 files |
| `packages/ui/src/index` | 14 files | 0 files |
| `packages/animation/src/index` | 13 files | 0 files |
| `packages/core/src/index` | 13 files | 0 files |
| `packages/scene/src/node` | 4 files | 9 files |
| `packages/animation/src/controller` | 9 files | 3 files |
| `packages/render-webgpu/src/wgpu-bindings` | 1 file | 11 files |
| `packages/diagnostics/src/index` | 11 files | 0 files |
| `packages/physics/src/collider` | 8 files | 3 files |
| `packages/physics/src/rigid-body` | 4 files | 7 files |
| `packages/render/src/render-target` | 2 files | 9 files |
| `packages/assets/src/index` | 10 files | 0 files |
| `packages/geometry/src/index` | 10 files | 0 files |
| `packages/math/src/index` | 10 files | 0 files |
| `packages/render/src/render-list` | 6 files | 4 files |
| `packages/render/src/renderer` | 5 files | 5 files |
| `packages/render-webgpu/src/wgpu-lit` | 5 files | 5 files |
| `packages/render-webgpu/src/wgpu-shadow` | 4 files | 6 files |
| `packages/fourjs/src/index` | 9 files | 0 files |
| `packages/motion/src/serializers` | 8 files | 1 file |
| `packages/physics/src/serializers` | 8 files | 1 file |
| `packages/physics/src/shapes` | 1 file | 8 files |
| `packages/render/src/raster` | 6 files | 3 files |
| `packages/render-webgpu/src/wgpu-node-program` | 8 files | 1 file |
| `packages/render-webgpu/src/wgpu-skinning` | 8 files | 1 file |
=======
| `packages/render/src/index` | 29 files | 0 files |
| `packages/render-webgpu/src/webgpu-device` | 0 files | 28 files |
| `packages/render-webgpu/src/index` | 27 files | 0 files |
| `packages/render-webgpu/src/webgpu-renderer` | 23 files | 2 files |
| `packages/physics/src/index` | 24 files | 0 files |
| `packages/render-webgl/src/index` | 21 files | 0 files |
| `packages/physics/src/world` | 15 files | 6 files |
| `packages/motion/src/index` | 21 files | 0 files |
| `packages/render-webgl/src/gl-program` | 0 files | 20 files |
| `packages/scene/src/index` | 16 files | 0 files |
| `packages/render-webgl/src/webgl-renderer` | 14 files | 2 files |
| `packages/physics/src/types` | 0 files | 16 files |
| `packages/render-webgpu/src/wgpu-unlit` | 2 files | 14 files |
| `packages/render-webgpu/src/wgpu-pipeline-cache` | 9 files | 7 files |
| `packages/ui/src/index` | 14 files | 0 files |
| `packages/physics/src/descriptors` | 4 files | 10 files |
| `packages/materials/src/index` | 13 files | 0 files |
| `packages/scene/src/node` | 4 files | 9 files |
| `packages/animation/src/index` | 13 files | 0 files |
| `packages/core/src/index` | 13 files | 0 files |
| `packages/render-webgpu/src/wgpu-bindings` | 1 file | 11 files |
| `packages/animation/src/controller` | 9 files | 3 files |
| `packages/physics/src/rigid-body` | 4 files | 7 files |
| `packages/physics/src/collider` | 8 files | 3 files |
| `packages/diagnostics/src/index` | 11 files | 0 files |
| `packages/math/src/index` | 10 files | 0 files |
| `packages/render/src/render-list` | 6 files | 4 files |
| `packages/render/src/render-target` | 2 files | 8 files |
| `packages/render-webgpu/src/wgpu-shadow` | 4 files | 6 files |
| `packages/render-webgpu/src/wgpu-lit` | 5 files | 5 files |
| `packages/ui/src/widget` | 0 files | 9 files |
| `packages/physics/src/serializers` | 8 files | 1 file |
| `packages/physics/src/shapes` | 1 file | 8 files |
| `packages/geometry/src/index` | 9 files | 0 files |
| `packages/render/src/renderer` | 5 files | 4 files |
| `packages/render-webgpu/src/wgpu-skinning` | 8 files | 1 file |
| `packages/render-webgpu/src/wgpu-node-program` | 8 files | 1 file |
| `packages/motion/src/serializers` | 8 files | 1 file |
| `packages/fourjs/src/index` | 9 files | 0 files |
| `packages/particles/src/index` | 8 files | 0 files |
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

---

<a id="circular-dependency-analysis"></a>
## Circular Dependency Analysis

**7 circular dependencies detected:**

- **Runtime cycles**: 0 (require attention)
- **Type-only cycles**: 7 (safe, no runtime impact)

### Type-Only Circular Dependencies

These cycles only involve type imports and are safe (erased at runtime):

<<<<<<< HEAD
- packages/animation/src/controller.ts -> packages/animation/src/when.ts -> packages/animation/src/controller.ts
- packages/geometry/src/path.ts -> packages/geometry/src/path-boolean.ts -> packages/geometry/src/path.ts
- packages/physics/src/solver-registry.ts -> packages/physics/src/world.ts -> packages/physics/src/solver-registry.ts
- packages/render/src/raster.ts -> packages/render/src/gpu-readback.ts -> packages/render/src/raster.ts
- packages/render/src/render-target.ts -> packages/render/src/render-target-bytes.ts -> packages/render/src/render-target.ts
- packages/render/src/renderer.ts -> packages/render/src/picking.ts -> packages/render/src/renderer.ts
- packages/scene/src/node.ts -> packages/scene/src/world-transforms.ts -> packages/scene/src/node.ts
=======
- packages/scene/src/node.ts -> packages/scene/src/world-transforms.ts -> packages/scene/src/node.ts
- packages/render-webgl/src/gl-particles.ts -> packages/render-webgl/src/gl-particles-registry.ts -> packages/render-webgl/src/gl-particles.ts
- packages/physics/src/solver-registry.ts -> packages/physics/src/world.ts -> packages/physics/src/solver-registry.ts
- packages/geometry/src/path.ts -> packages/geometry/src/path-boolean.ts -> packages/geometry/src/path.ts
- packages/render/src/render-target.ts -> packages/render/src/render-target-bytes.ts -> packages/render/src/render-target.ts
- packages/render/src/renderer.ts -> packages/render/src/picking.ts -> packages/render/src/renderer.ts
- packages/animation/src/controller.ts -> packages/animation/src/when.ts -> packages/animation/src/controller.ts
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd

---

<a id="visual-dependency-graph"></a>
## Visual Dependency Graph

```mermaid
graph TD
<<<<<<< HEAD
    subgraph Packages/animation
        N0[animation-system]
        N1[binding]
        N2[blend-tree]
        N3[clip]
        N4[controller]
        N5[easing]
        N6[index]
        N7[layer-stack]
        N8[mixer]
        N9[timeline]
        N10[...4 more]
    end

    subgraph Packages/assets
        N11[asset-manager]
        N12[bounded-png]
        N13[capabilities]
        N14[content-hash]
        N15[gltf]
        N16[gzip]
        N17[image-memory]
        N18[index]
        N19[loader-registry]
        N20[loaders]
        N21[...3 more]
    end

    subgraph Packages/core
        N22[component]
        N23[conventions]
        N24[dev]
        N25[disposable]
        N26[errors]
        N27[events]
        N28[index]
        N29[json]
        N30[leak-registry]
        N31[plugin]
        N32[...4 more]
    end

    subgraph Packages/diagnostics
        N33[allocation-audit]
        N34[checksum]
        N35[debug-draw]
        N36[index]
        N37[leak-registry]
        N38[recorder]
        N39[replay-format]
        N40[replay-player]
        N41[resource-audit]
        N42[rollback]
        N43[...2 more]
    end

    subgraph Packages/fourjs
        N44[animation]
        N45[application]
        N46[assets]
        N47[capabilities]
        N48[compute-pass]
        N49[core]
        N50[diagnostics]
        N51[editor-tools]
        N52[geometry]
        N53[gltf]
        N54[...25 more]
    end

    subgraph Packages/geometry
        N55[buffer-geometry]
        N56[cpu-skinning]
        N57[geometry]
        N58[index]
        N59[path-boolean]
        N60[path]
        N61[primitive-support]
        N62[primitives-3d]
        N63[primitives]
        N64[resource-memory]
        N65[...3 more]
    end

    subgraph Packages/input
        N66[drag]
        N67[index]
        N68[key-events]
        N69[keyboard-input]
        N70[keyboard-state]
        N71[pick]
        N72[pointer-events]
        N73[pointer-input]
        N74[propagation]
    end

    subgraph Packages/materials
        N75[capabilities]
        N76[index]
        N77[lit-material]
        N78[material]
        N79[node-material-builder]
        N80[node-material]
        N81[resource-memory]
        N82[shader-function]
        N83[shader-graph]
        N84[shader-operators]
        N85[...7 more]
    end

    subgraph Packages/math
        N86[alloc-counter]
        N87[color]
        N88[frustum]
        N89[index]
        N90[matrix3]
        N91[matrix4]
        N92[quaternion]
        N93[rectangle2]
        N94[vector2]
        N95[vector3]
        N96[...1 more]
    end

    subgraph Packages/motion
        N97[camera-rigs]
        N98[camera-shake]
        N99[capabilities]
        N100[character-controller]
        N101[clock]
        N102[constraints]
        N103[ik]
        N104[index]
        N105[integrators]
        N106[kinematic-controller]
        N107[...14 more]
    end

    subgraph Packages/particles
        N108[emitter]
        N109[fields]
        N110[index]
        N111[particle-renderable]
        N112[particle-system]
        N113[pool]
        N114[random]
        N115[trail]
        N116[types]
    end

    subgraph Packages/physics
        N117[adapter]
        N118[body-access]
        N119[capabilities]
        N120[collider]
        N121[descriptors]
        N122[events]
        N123[force-field]
        N124[index]
        N125[joints]
        N126[local-plane]
        N127[...15 more]
    end

    subgraph Packages/physics-box2d
        N128[index]
    end

    subgraph Packages/physics-rapier
        N129[ccd]
        N130[conversions2d]
        N131[conversions3d]
        N132[index]
        N133[init]
        N134[rapier2d-adapter]
        N135[rapier3d-adapter]
        N136[register]
    end

    subgraph Packages/physics-soft
        N137[index]
    end

    subgraph Packages/render
        N138[batch]
        N139[bounds]
        N140[capabilities]
        N141[clip]
        N142[compute-workloads]
        N143[compute]
        N144[effect-pass]
        N145[gpu-readback]
        N146[host-texture]
        N147[index]
        N148[...24 more]
    end

    subgraph Packages/render-canvas
        N149[index]
    end

    subgraph Packages/render-svg
        N150[index]
    end

    subgraph Packages/render-webgl
        N151[gl-batch]
        N152[gl-effect]
        N153[gl-geometry]
        N154[gl-gpu-timer]
        N155[gl-node-program]
        N156[gl-node-uniform-block]
        N157[gl-particles]
        N158[gl-picking-registry]
        N159[gl-picking]
        N160[gl-program]
        N161[...11 more]
    end

    subgraph Packages/render-webgpu
        N162[index]
        N163[register]
        N164[webgpu-device]
        N165[webgpu-renderer]
        N166[wgpu-batch]
        N167[wgpu-bindings]
        N168[wgpu-compute]
        N169[wgpu-effect]
        N170[wgpu-geometry]
        N171[wgpu-gpu-timer]
        N172[...19 more]
    end

    subgraph Packages/scene
        N173[authority]
        N174[camera]
        N175[group]
        N176[index]
        N177[interpolation]
        N178[layers]
        N179[light]
        N180[node-space]
        N181[node]
        N182[pose-target]
        N183[...7 more]
    end

    subgraph Packages/serialization
        N184[capabilities]
        N185[format]
        N186[index]
        N187[migration]
        N188[serializer]
    end

    subgraph Packages/text
        N189[bitmap-font]
        N190[glyph-atlas]
        N191[index]
        N192[shaping]
        N193[text-layout]
    end

    subgraph Packages/ui
        N194[accessibility]
        N195[button]
        N196[canvas-view]
        N197[capabilities]
        N198[checkable]
        N199[control-registry]
        N200[image]
        N201[index]
        N202[keyboard]
        N203[label]
        N204[...6 more]
    end

    N2 --> N3
    N4 --> N0
    N4 --> N2
    N4 --> N1
    N4 --> N3
    N4 --> N8
    N6 --> N0
    N6 --> N1
    N6 --> N3
    N6 --> N2
    N6 --> N4
    N6 --> N7
    N6 --> N5
    N6 --> N8
    N6 --> N9
    N7 --> N0
    N7 --> N1
    N7 --> N4
    N8 --> N1
    N8 --> N3
    N11 --> N14
    N12 --> N17
    N13 --> N19
    N15 --> N17
    N15 --> N11
    N15 --> N14
    N16 --> N11
    N18 --> N13
    N18 --> N19
    N18 --> N11
    N18 --> N14
    N18 --> N15
    N18 --> N20
    N18 --> N16
    N18 --> N12
    N19 --> N11
    N20 --> N11
    N20 --> N17
    N22 --> N24
    N22 --> N26
    N24 --> N26
    N28 --> N23
    N28 --> N29
    N28 --> N22
    N28 --> N25
    N28 --> N30
    N28 --> N24
    N28 --> N26
    N28 --> N27
    N28 --> N31
    N30 --> N24
    N31 --> N26
    N36 --> N34
    N36 --> N38
    N36 --> N42
    N36 --> N39
    N36 --> N40
    N36 --> N35
    N36 --> N41
    N36 --> N37
    N36 --> N33
    N38 --> N39
    N40 --> N38
    N40 --> N39
    N42 --> N38
    N47 --> N51
    N55 --> N57
    N55 --> N64
    N56 --> N55
    N58 --> N55
    N58 --> N57
    N58 --> N62
    N58 --> N60
    N58 --> N63
    N58 --> N64
=======
    subgraph Packages/particles
        N0[particle-renderable]
        N1[emitter]
        N2[index]
        N3[trail]
        N4[particle-system]
        N5[fields]
        N6[random]
        N7[pool]
        N8[types]
    end

    subgraph Packages/materials
        N9[capabilities]
        N10[index]
        N11[texture]
        N12[stencil-state]
        N13[sprite-material]
        N14[standard-material]
        N15[shader-operators]
        N16[unlit-material]
        N17[node-material-builder]
        N18[node-material]
        N19[...4 more]
    end

    subgraph Packages/ui
        N20[label]
        N21[canvas-view]
        N22[slider]
        N23[capabilities]
        N24[radio]
        N25[index]
        N26[accessibility]
        N27[widget]
        N28[image]
        N29[control-registry]
        N30[...6 more]
    end

    subgraph Packages/text
        N31[index]
        N32[glyph-atlas]
        N33[text-layout]
        N34[bitmap-font]
    end

    subgraph Packages/math
        N35[quaternion]
        N36[index]
        N37[matrix3]
        N38[rectangle2]
        N39[color]
        N40[alloc-counter]
        N41[vector2]
        N42[vector3]
        N43[matrix4]
        N44[frustum]
        N45[...1 more]
    end

    subgraph Packages/render-svg
        N46[index]
    end

    subgraph Packages/physics-box2d
        N47[index]
    end

    subgraph Packages/scene
        N48[transform]
        N49[layers]
        N50[node-space]
        N51[index]
        N52[skeleton]
        N53[group]
        N54[screen-camera]
        N55[light]
        N56[trackball]
        N57[world-transforms]
        N58[...7 more]
    end

    subgraph Packages/assets
        N59[gltf]
        N60[capabilities]
        N61[index]
        N62[texture]
        N63[asset-manager]
        N64[loader-registry]
        N65[manifest]
        N66[content-hash]
        N67[loaders]
    end

    subgraph Packages/physics-soft
        N68[index]
    end

    subgraph Packages/physics-rapier
        N69[ccd]
        N70[index]
        N71[conversions2d]
        N72[rapier2d-adapter]
        N73[rapier3d-adapter]
        N74[register]
        N75[conversions3d]
        N76[init]
    end

    subgraph Packages/render-webgl
        N77[gl-render-target]
        N78[gl-picking]
        N79[gl-effect]
        N80[gl-shadow-registry]
        N81[index]
        N82[gl-standard-registry]
        N83[gl-skinning-glsl]
        N84[gl-particles]
        N85[gl-picking-registry]
        N86[gl-geometry]
        N87[...14 more]
    end

    subgraph Packages/physics
        N88[solver-registry]
        N89[capabilities]
        N90[index]
        N91[world]
        N92[rigid-body]
        N93[validation]
        N94[joints]
        N95[descriptors]
        N96[swept-character-controller]
        N97[physics-event-system]
        N98[...15 more]
    end

    subgraph Packages/geometry
        N99[index]
        N100[tessellation]
        N101[path-boolean]
        N102[path]
        N103[svg-document]
        N104[geometry]
        N105[primitives-3d]
        N106[primitive-support]
        N107[resource-memory]
        N108[buffer-geometry]
        N109[...2 more]
    end

    subgraph Packages/render
        N110[read-pixels]
        N111[shape-paint]
        N112[scissor]
        N113[sprite]
        N114[capabilities]
        N115[view-list]
        N116[index]
        N117[compute-workloads]
        N118[texture]
        N119[render-target-bytes]
        N120[...20 more]
    end

    subgraph Packages/input
        N121[pick]
        N122[index]
        N123[keyboard-input]
        N124[key-events]
        N125[pointer-events]
        N126[pointer-input]
        N127[drag]
        N128[keyboard-state]
        N129[propagation]
    end

    subgraph Packages/render-webgpu
        N130[wgpu-geometry]
        N131[webgpu-device]
        N132[wgpu-effect]
        N133[index]
        N134[wgpu-bindings]
        N135[wgpu-skinning]
        N136[wgpu-node-program]
        N137[wgpu-shadow]
        N138[wgpu-gpu-timer]
        N139[wgpu-readback]
        N140[...20 more]
    end

    subgraph Packages/render-canvas
        N141[index]
    end

    subgraph Packages/motion
        N142[systems]
        N143[ik]
        N144[capabilities]
        N145[character-controller]
        N146[clock]
        N147[index]
        N148[kinematic-controller]
        N149[scheduler]
        N150[steering]
        N151[serializers]
        N152[...12 more]
    end

    subgraph Packages/animation
        N153[tween]
        N154[timeline]
        N155[animation-system]
        N156[index]
        N157[when]
        N158[track]
        N159[binding]
        N160[mixer]
        N161[blend-tree]
        N162[values]
        N163[...4 more]
    end

    subgraph Packages/diagnostics
        N164[checksum]
        N165[leak-registry]
        N166[index]
        N167[validation]
        N168[replay-format]
        N169[recorder]
        N170[stats]
        N171[rollback]
        N172[replay-player]
        N173[debug-draw]
        N174[...2 more]
    end

    subgraph Packages/core
        N175[units]
        N176[leak-registry]
        N177[index]
        N178[disposable]
        N179[conventions]
        N180[dev]
        N181[plugin]
        N182[events]
        N183[space]
        N184[random]
        N185[...4 more]
    end

    subgraph Packages/fourjs
        N186[physics-box2d]
        N187[gltf]
        N188[application]
        N189[capabilities]
        N190[plugins]
        N191[physics]
        N192[compute-pass]
        N193[index]
        N194[core]
        N195[render-webgpu]
        N196[...25 more]
    end

    subgraph Packages/serialization
        N197[capabilities]
        N198[migration]
        N199[index]
        N200[format]
        N201[serializer]
    end

    N0 --> N1
    N0 --> N8
    N0 --> N3
    N1 --> N7
    N1 --> N6
    N1 --> N3
    N1 --> N8
    N2 --> N1
    N2 --> N7
    N2 --> N5
    N2 --> N0
    N2 --> N4
    N2 --> N6
    N2 --> N3
    N2 --> N8
    N5 --> N6
    N5 --> N8
    N9 --> N15
    N10 --> N9
    N10 --> N15
    N10 --> N18
    N10 --> N17
    N10 --> N13
    N10 --> N12
    N10 --> N14
    N10 --> N16
    N10 --> N11
    N13 --> N11
    N13 --> N16
    N14 --> N11
    N16 --> N11
    N17 --> N18
    N17 --> N11
    N18 --> N11
    N20 --> N27
    N21 --> N27
    N23 --> N29
    N25 --> N23
    N25 --> N29
    N25 --> N26
    N25 --> N21
    N25 --> N28
    N25 --> N20
    N25 --> N24
    N25 --> N22
    N25 --> N27
    N26 --> N24
    N26 --> N22
    N26 --> N27
    N28 --> N27
    N29 --> N27
    N31 --> N34
    N31 --> N32
    N31 --> N33
    N32 --> N34
    N33 --> N32
    N35 --> N40
    N35 --> N42
    N36 --> N40
    N36 --> N39
    N36 --> N44
    N36 --> N37
    N36 --> N43
    N36 --> N35
    N36 --> N38
    N36 --> N41
    N36 --> N42
    N37 --> N40
    N37 --> N43
    N38 --> N40
    N41 --> N40
    N42 --> N40
    N43 --> N40
    N43 --> N35
    N43 --> N42
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd
```

---

<a id="summary-statistics"></a>
## Summary Statistics

| Category | Count |
|----------|-------|
<<<<<<< HEAD
| Total TypeScript Files | 335 |
| Total Modules | 24 |
| Total Lines of Code | 160359 |
| Total Exports | 3387 |
| Total Re-exports | 2147 |
| Total Classes | 212 |
| Total Interfaces | 624 |
| Total Functions | 551 |
| Total Type Guards | 28 |
| Total Enums | 0 |
| Type-only Imports | 428 |
=======
| Total TypeScript Files | 324 |
| Total Modules | 24 |
| Total Lines of Code | 159003 |
| Total Exports | 3348 |
| Total Re-exports | 2118 |
| Total Classes | 202 |
| Total Interfaces | 617 |
| Total Functions | 553 |
| Total Type Guards | 27 |
| Total Enums | 0 |
| Type-only Imports | 421 |
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd
| Runtime Circular Deps | 0 |
| Type-only Circular Deps | 7 |

---

<<<<<<< HEAD
*Last Updated*: 2026-09-13
=======
*Last Updated*: 2026-09-11
>>>>>>> refs/remotes/origin/claude/rfc-review-planning-s2clzd
*Version*: 0.0.0
