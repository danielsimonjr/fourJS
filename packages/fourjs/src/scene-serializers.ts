/**
 * §79 node types and component serializers for the classes the engine itself
 * ships (A-14, PH-17 — 2026-08-06).
 *
 * §73 promises that "UI objects are scene nodes and therefore share animation,
 * input, clipping, serialization, and diagnostics", and §6a promises that
 * components "serialize under registered type names (§79)". Neither held.
 * `@fourjs/serialization` may depend on `core`, `math`, and `scene` only (plan
 * §3.1), so its registry ships one component serializer (`PoseTarget`) and its
 * instantiator knows two node classes (`Scene`, `Group`) — every widget tree
 * round-tripped as bare `Node` state, and every `MotionComponent` was dropped
 * from the document with nobody able to notice.
 *
 * This module is where that is fixed, because **the umbrella package is the one
 * place allowed to see everything**. It adds no dependency edge anywhere: it
 * imports `@fourjs/ui` and `@fourjs/motion` the way an application would, and hands
 * `@fourjs/serialization` the two things its documented seams ask for — a
 * `nodeTypeOf` / `nodeFactory` pair and a populated component registry.
 *
 * ```ts
 * import { registerSceneNodeTypes } from "fourJS";
 *
 * const io = registerSceneNodeTypes({ atlas });
 * const text = serialization.encodeSceneDocument(
 *   serialization.serializeScene(app.scene, io.components, io.write),
 * );
 * // … later
 * const scene = serialization.instantiateScene(
 *   serialization.decodeSceneDocument(text),
 *   io.components,
 *   io.read,
 * );
 * ```
 *
 * ## What is covered, and what is deliberately not
 *
 * Covered: the ten §73 widgets — `Panel`, `Label`, `Button`; since
 * 2026-08-07 (A-12), `Toggle`, `Checkbox`, `RadioButton`, `Slider`,
 * `ProgressIndicator`, and `ImageWidget`; and, since 2026-08-29 (RFC 0004),
 * `CanvasViewWidget` — with their §74 box model and layout,
 * their interaction flags, their §75 accessibility record, and whatever state
 * each control adds (checkedness, a group name, a range and its value, an image
 * key, a canvas view's device-pixel resolution — never its painted pixels,
 * §77a); the five drawing-tier node classes A-16 named, added 2026-08-07 —
 * §49's `Renderable`, §55's `Sprite`, §47's `PerspectiveCamera` and
 * `OrthographicCamera`, and §68's `DirectionalLight`
 * ({@link registerRenderSerializers}); `MotionComponent` (§11),
 * `KinematicController` (§12, added 2026-08-07) and the §44/§12 rig components
 * `OrbitRig`, `FollowRig` and `LookAtConstraint` (added 2026-08-13), through the
 * serializers `@fourjs/motion` itself exports; and `RigidBody` and `Collider` (§23–§25),
 * through the pair `@fourjs/physics` exports (`RIGID_BODY_SERIALIZER` /
 * `COLLIDER_SERIALIZER`, 2026-08-06 — the `PH-17` remainder) plus §12's
 * `SweptCharacterController` (`SWEPT_CHARACTER_CONTROLLER_SERIALIZER`,
 * 2026-08-21 — `PH-11b`). All three
 * packages declare their serializers against the same structural
 * `ComponentSerializer` shape, so registering them here adds no §3.1 edge
 * anywhere.
 *
 * That is **every** component class the engine ships — the eight with a
 * `static typeName`, counting `PoseTarget`, which `@fourjs/serialization` seeds
 * itself. `tests/scene-serializers.test.ts` enumerates them off the umbrella's
 * own barrels and fails if one is missing, because an unregistered component
 * makes `serializeScene` throw (A-15) and the only sign of a new one being
 * forgotten would be an application that cannot save its scene.
 *
 * A scene carrying physics components therefore saves and reloads through this
 * one call, with no `{ unknownComponents: "skip" }` opt-out and nothing dropped
 * — see {@link registerPhysicsSerializers} for what a physics document does and
 * does not carry.
 *
 * The §79 **manifest document** (key → URL + content hash) ships in
 * `@fourjs/assets`. `preloadManifestIntoCatalog` (this package) walks the keys
 * a document names, loads each, and returns a {@link SceneResourceCatalog}
 * whose `get` stays synchronous — deserialization cannot wait on a fetch.
 * The §80 `.four` binary package format is still untouched: none of this is
 * a format change (2026-08-07).
 *
 * ## Type names
 *
 * `<owning package>:<the section's own name for the class>`, kebab-cased:
 * `ui:panel` for `@fourjs/ui`'s `Panel`, `render:sprite` for `@fourjs/render`'s
 * `Sprite`, `scene:directional-light` for `@fourjs/scene`'s `DirectionalLight`.
 * The prefix follows the `ui:*` precedent, which named the package rather than
 * the spec section — an application registering its own classes has a package
 * or vendor name (`com.example.thing`) and no section number, and `47:camera`
 * would be nobody's idea of readable.
 *
 * What the prefix does **not** promise is where the class will live forever:
 * spec revision 1.3 assigned cameras and viewports to `@fourjs/scene` after the
 * fact, and a class that moves again keeps its type name regardless — these
 * constants are published API, and a document written by one build has to load
 * in the next. Read the prefix as a namespace, not as an import path.
 *
 * The two **unprefixed** names, `scene` and `group`, are `@fourjs/serialization`'s
 * own built-ins and predate the convention. `scene` is a node type and `scene:`
 * is a namespace; the separator is what keeps them apart, and nothing in this
 * module writes a bare `scene`.
 *
 * ## Why a `Label`'s atlas is an option and not a payload
 *
 * A `GlyphAtlas` is a loaded resource, not scene state — §79 references
 * resources by logical key and stores none of them inline. So a label writes
 * its text, size, and letter spacing, and {@link SceneNodeTypeOptions.atlas}
 * supplies the face on the way back in. A document restored without one holds
 * labels that measure `0 × 0`, which is exactly what a `Label` with no atlas
 * is — not an error, and visible the moment anything lays it out.
 *
 * ## Geometry and material are references, not payloads (A-16, 2026-08-07)
 *
 * The same rule, one size up. §79 states it directly: *"assets are referenced
 * by logical key, resolved through a manifest that maps each key to a URL and
 * content hash (§76)"*. A `Renderable` **points at** a `BufferGeometry` and a
 * `Material` that it does not own and that hundreds of nodes may share (§83),
 * so the document carries **a key, not a copy**, and the application resolves
 * it on the way in exactly as it supplies a label's atlas.
 *
 * {@link SceneResourceCatalog} is that seam: a `keyOf` consulted on the way out
 * and a `get` consulted on the way in, injected through
 * {@link SceneNodeTypeOptions} the way `nodeDataOf` injects a writer. A catalog
 * built from a §76 manifest, from an asset bundle, or from a literal `Map` in a
 * test all satisfy it and none of the node types below can tell which — which
 * is the point: **the manifest sits behind this seam rather than replacing
 * it** — `preloadManifestIntoCatalog` is the walk that fills the map. A
 * `Map<string, Material>` already satisfies the read half on its own, since
 * `Map.get` *is* `get`; {@link resourceCatalog} builds both halves from one
 * map so they cannot disagree.
 *
 * A reference that cannot be **named** on the way out is refused, and so is one
 * that cannot be **resolved** on the way in (§85) — a `FourError` naming the
 * node and the key, never a silent substitution. `unknownResources: "skip"`
 * relaxes the *write* side only, writing `null` where the key would go, for the
 * inspector case `unknownComponents: "skip"` exists for; the resulting document
 * says out loud that it names no material, and loading it still throws.
 *
 * There is deliberately **no read-side `"skip"`**, and the asymmetry with
 * `unknownComponents` is the honest answer rather than an oversight. A node can
 * lose a component and still be that node; a `Renderable` cannot lose its
 * material and still be one — its constructor refuses to default either
 * argument precisely so the mistake is a type error rather than an invisible
 * node. A factory honouring `"skip"` would have to *invent* a geometry and a
 * material, handing the application a resource it never created and now owes a
 * `dispose()` to (§83). Refusing is the smaller lie.
 */

import { FourError, type JsonValue } from "@fourjs/core";
import { Path, type BufferGeometry, type Point2D } from "@fourjs/geometry";
import type {
  Material,
  MaterialTexture,
  SpriteMaterial,
  UnlitMaterial,
} from "@fourjs/materials";
import {
  CAMERA_SHAKE_SERIALIZER,
  CHARACTER_CONTROLLER_SERIALIZER,
  CameraShake,
  CharacterController,
  FIRST_PERSON_LOOK_SERIALIZER,
  FOLLOW_RIG_SERIALIZER,
  FirstPersonLook,
  FollowRig,
  KINEMATIC_CONTROLLER_SERIALIZER,
  KinematicController,
  LOOK_AT_CONSTRAINT_SERIALIZER,
  LookAtConstraint,
  MOTION_COMPONENT_SERIALIZER,
  MotionComponent,
  ORBIT_RIG_SERIALIZER,
  OrbitRig,
} from "@fourjs/motion";
import {
  COLLIDER_SERIALIZER,
  Collider,
  RIGID_BODY_SERIALIZER,
  RigidBody,
  SWEPT_CHARACTER_CONTROLLER_SERIALIZER,
  SweptCharacterController,
} from "@fourjs/physics";
import { SOFT_BODY_SERIALIZER, SoftBody } from "@fourjs/physics-soft";
import {
  Arc,
  Circle,
  Ellipse,
  Line,
  Mesh,
  PathShape,
  Polygon,
  Polyline,
  Rectangle,
  RegularPolygon,
  Renderable,
  Ring,
  Sector,
  Shape2D,
  Sprite,
  Star,
  resolveShapePaintSupport,
  restoreMeshSkeleton,
} from "@fourjs/render";
import type {
  GradientStop,
  Paint,
  ResolvedPaint,
  ResolvedShapeFill,
  ResolvedStrokeStyle,
  ScissorRect,
} from "@fourjs/render";
import {
  Bone,
  DirectionalLight,
  HemisphereLight,
  MORPH_WEIGHTS_SERIALIZER,
  MorphWeights,
  NODE_SPACE_SERIALIZER,
  NodeSpace,
  OrthographicCamera,
  PerspectiveCamera,
  PointLight,
  SCREEN_ORIGINS,
  SCREEN_UNITS,
  ScreenCamera,
  SpotLight,
  restoreNodeId,
  type HitTestMode,
  type Node,
} from "@fourjs/scene";
import {
  ComponentSerializerRegistry,
  createDefaultComponentSerializers,
  type InstantiateSceneOptions,
  type SceneNodeDocument,
  type SerializeSceneOptions,
} from "@fourjs/serialization";
import type { GlyphAtlas, TextAlign } from "@fourjs/text";
import {
  Button,
  CanvasViewWidget,
  Checkbox,
  ImageWidget,
  Label,
  Panel,
  ProgressIndicator,
  RadioButton,
  Slider,
  Toggle,
  UIWidget,
  type CheckableWidget,
  type UIWidgetOptions,
  type WidgetAccessibility,
} from "@fourjs/ui";

import { Text } from "./text-node.js";

/** The document `type` a {@link Panel} serializes as. */
export const PANEL_NODE_TYPE = "ui:panel";

/** The document `type` a {@link Label} serializes as. */
export const LABEL_NODE_TYPE = "ui:label";

/** The document `type` a {@link Button} serializes as. */
export const BUTTON_NODE_TYPE = "ui:button";

/** The document `type` a {@link Toggle} serializes as (2026-08-07, A-12). */
export const TOGGLE_NODE_TYPE = "ui:toggle";

/** The document `type` a {@link Checkbox} serializes as. */
export const CHECKBOX_NODE_TYPE = "ui:checkbox";

/** The document `type` a {@link RadioButton} serializes as. */
export const RADIO_BUTTON_NODE_TYPE = "ui:radio";

/** The document `type` a {@link Slider} serializes as. */
export const SLIDER_NODE_TYPE = "ui:slider";

/** The document `type` a {@link ProgressIndicator} serializes as. */
export const PROGRESS_NODE_TYPE = "ui:progress";

/**
 * The document `type` an {@link ImageWidget} serializes as.
 *
 * `ui:image` — §73's own name for the control. The class carries a `Widget`
 * suffix only because `Image` is a browser global; the document format has no
 * such collision to avoid.
 */
export const IMAGE_NODE_TYPE = "ui:image";

/**
 * The document `type` a {@link CanvasViewWidget} serializes as (§73, §77a;
 * RFC 0004, 2026-08-29).
 *
 * The payload is the widget's box and its `resolution`, and **nothing else**:
 * painted pixels are display content with no §79 representation (§77a's
 * display-only rule — a painted surface has no logical key and its bytes are
 * produced by code), and `contentVersion` is transient repaint state, not
 * authored scene state. A reloaded canvas view is blank until the
 * application's skin paints it, which is what it is.
 */
export const CANVAS_VIEW_NODE_TYPE = "ui:canvas-view";

/** The document `type` a {@link Renderable} serializes as (2026-08-07, A-16). */
export const RENDERABLE_NODE_TYPE = "render:renderable";

/** The document `type` a {@link Sprite} serializes as (§55). */
export const SPRITE_NODE_TYPE = "render:sprite";

/**
 * The document `type` a {@link Mesh} serializes as (§54; RFC 0003,
 * 2026-08-28). Its payload is a `Renderable`'s — geometry and material keys,
 * the ordering pair, the four drawable flags — plus `skeleton`: `null`, or
 * bone **ids** in joint-index order with the inverse bind matrices inline
 * (§79: intra-file references are by id; the ids resolve against the reloaded
 * `scene:bone` nodes on the first `skeleton` read — see `restoreMeshSkeleton`).
 * Morph weights are not here: they are a §6a component (`MorphWeights`) and
 * round-trip through the component registry like every other component.
 */
export const MESH_NODE_TYPE = "render:mesh";

/**
 * The document `type` a {@link Bone} serializes as (§54; RFC 0003).
 *
 * A bone's whole state is its base-node state — transform, id, name — which
 * §79 already carries for every node, so the payload is empty; what the type
 * name preserves is the **class**, which `Mesh.skeleton`'s id resolution
 * requires (a skeleton's joints index bones and only bones) and which a bare
 * `Node` fallback would silently lose (A-15's failure mode).
 */
export const BONE_NODE_TYPE = "scene:bone";

/**
 * The document `type` a {@link Text} serializes as (§49, §56; R-28,
 * 2026-08-13).
 *
 * `render:text`, not `fourJS:text`, and the prefix rule above says why: it is a
 * namespace, not an import path. §49 puts `Text` in the drawing family beside
 * `Sprite`; the class lives in this package only because the frozen §3.1 matrix
 * forbids `@fourjs/render` from importing `@fourjs/text` (see `text-node.ts`), and
 * a document must not record that accident of layering — the class could move
 * the day the matrix allows it, and the name has to survive the move.
 */
export const TEXT_NODE_TYPE = "render:text";

/** The document `type` a {@link PerspectiveCamera} serializes as (§47). */
export const PERSPECTIVE_CAMERA_NODE_TYPE = "scene:perspective-camera";

/** The document `type` an {@link OrthographicCamera} serializes as (§47). */
export const ORTHOGRAPHIC_CAMERA_NODE_TYPE = "scene:orthographic-camera";

/** The document `type` a {@link ScreenCamera} serializes as (§47; R-37). */
export const SCREEN_CAMERA_NODE_TYPE = "scene:screen-camera";

/** The document `type` a {@link DirectionalLight} serializes as (§68). */
export const DIRECTIONAL_LIGHT_NODE_TYPE = "scene:directional-light";

/** The document `type` a {@link PointLight} serializes as (§68, R-17). */
export const POINT_LIGHT_NODE_TYPE = "scene:point-light";

/** The document `type` a {@link SpotLight} serializes as (§68, R-17). */
export const SPOT_LIGHT_NODE_TYPE = "scene:spot-light";

/** The document `type` a {@link HemisphereLight} serializes as (§68). */
export const HEMISPHERE_LIGHT_NODE_TYPE = "scene:hemisphere-light";

/** The document `type` a {@link Circle} serializes as (§50; R-23). */
export const CIRCLE_NODE_TYPE = "render:circle";

/** The document `type` an {@link Ellipse} serializes as (§50; R-23). */
export const ELLIPSE_NODE_TYPE = "render:ellipse";

/**
 * The document `type` a {@link Rectangle} serializes as — square-cornered or
 * rounded, which is one class here (§50; R-23).
 */
export const RECTANGLE_NODE_TYPE = "render:rectangle";

/** The document `type` a {@link RegularPolygon} serializes as (§50; R-23). */
export const REGULAR_POLYGON_NODE_TYPE = "render:regular-polygon";

/** The document `type` a {@link Polygon} serializes as (§50; R-23). */
export const POLYGON_NODE_TYPE = "render:polygon";

/** The document `type` a {@link Star} serializes as (§50; R-23). */
export const STAR_NODE_TYPE = "render:star";

/** The document `type` a {@link Sector} serializes as (§50; R-23). */
export const SECTOR_NODE_TYPE = "render:sector";

/** The document `type` a {@link Ring} serializes as (§50; R-23). */
export const RING_NODE_TYPE = "render:ring";

/**
 * The document `type` a {@link PathShape} serializes as — §50's "path" and
 * "Bézier path" alike (§50, §51; R-23).
 */
export const PATH_SHAPE_NODE_TYPE = "render:path";

/** The document `type` a {@link Line} serializes as (§50, §58; R-16). */
export const LINE_NODE_TYPE = "render:line";

/** The document `type` a {@link Polyline} serializes as (§50, §58; R-16). */
export const POLYLINE_NODE_TYPE = "render:polyline";

/** The document `type` an {@link Arc} serializes as (§50, §58; R-16). */
export const ARC_NODE_TYPE = "render:arc";

/**
 * What to do with a shared resource — a geometry, a material — that no
 * {@link SceneResourceCatalog} names (2026-08-07, A-16).
 *
 * `"throw"` (the default) refuses the save: a renderable whose material cannot
 * be named writes a document that cannot be loaded, and finding that out at
 * save time is the whole value of the check. `"skip"` writes `null` in the
 * key's place — the document then states plainly that it names no resource, and
 * loading it is still refused (see the module header for why the read side has
 * no matching relaxation).
 */
export type UnknownResourcePolicy = "throw" | "skip";

/**
 * How the two directions of a §79 resource reference are resolved
 * (2026-08-07, A-16).
 *
 * §79 references resources "by logical key"; this is the pair of functions that
 * decides what that key *is* and what it comes back as. Both halves are
 * optional so that the two directions can be supplied separately — a build that
 * only ever writes documents needs no `get` — but supplying one without the
 * other is exactly how a document that cannot be loaded gets written, so prefer
 * {@link resourceCatalog}, which derives both from one map.
 *
 * A `ReadonlyMap<string, T>` satisfies the read half as it stands, since
 * `Map.get` has precisely this signature.
 *
 * Both halves are declared with **method syntax**, which makes their parameters
 * bivariant — the same deliberate choice, for the same reason, that
 * `@fourjs/serialization`'s `ComponentSerializer` documents: a catalog of
 * `SpriteMaterial`s has to be usable where a catalog of `Material`s is asked
 * for, and the substitution is sound because a lookup that misses answers
 * `undefined`, which is the case the callers already handle.
 *
 * @typeParam T the resource being referenced — `BufferGeometry`, `Material`
 */
export interface SceneResourceCatalog<T> {
  /**
   * The logical key `resource` is published under, or `undefined` if this
   * catalog does not publish it (which {@link UnknownResourcePolicy} then
   * decides the consequence of).
   */
  keyOf?(resource: T): string | undefined;
  /** The resource a saved key names, or `undefined` if the key is unknown. */
  get?(key: string): T | undefined;
}

/** Options for {@link registerUISerializers} and {@link registerSceneNodeTypes}. */
export interface SceneNodeTypeOptions {
  /**
   * The glyph atlas restored {@link Label}s are given (§56, §79).
   *
   * Omit it and labels reload with no atlas, measuring `0 × 0` — see the module
   * header for why the face is not part of the document.
   */
  readonly atlas?: GlyphAtlas;
  /**
   * Names and resolves the geometries {@link Renderable}s point at (§53, §79).
   *
   * A `Sprite` needs no entry here: it **derives** its quad from its anchor and
   * size and owns it, so the sprite's own payload rebuilds it.
   */
  readonly geometries?: SceneResourceCatalog<BufferGeometry>;
  /** Names and resolves the materials drawables point at (§57, §79). */
  readonly materials?: SceneResourceCatalog<Material>;
  /**
   * Names and resolves the textures §58 **pattern paints** point at (§77,
   * §79; the paint-object tier, 2026-08-29). A pattern's texture is the one
   * piece of a paint that is a *resource* rather than a value, so it travels
   * as a logical key exactly as a material does; gradients need no entry —
   * they are values and the document carries them whole.
   */
  readonly textures?: SceneResourceCatalog<MaterialTexture>;
  /**
   * What a resource that {@link SceneNodeTypeOptions.geometries},
   * {@link SceneNodeTypeOptions.materials} or
   * {@link SceneNodeTypeOptions.textures} does not name does to a save.
   * Defaults to `"throw"`.
   */
  readonly unknownResources?: UnknownResourcePolicy;
}

/**
 * A `nodeTypeOf` / `nodeDataOf` writer paired with the `nodeFactory` that reads
 * it back (§79).
 *
 * The two halves are returned together because they are one decision: a type
 * name written by a build whose reader does not know it is a load failure, and
 * splitting them across two call sites is how that happens.
 */
export interface SceneNodeTypeSupport {
  /** Pass to `serializeScene` as its options. */
  readonly write: Required<
    Pick<SerializeSceneOptions, "nodeTypeOf" | "nodeDataOf">
  >;
  /** Pass to `instantiateScene` / `instantiateSceneNodes` as their options. */
  readonly read: Required<Pick<InstantiateSceneOptions, "nodeFactory">>;
}

/** Everything a §79 round trip of an engine scene needs. */
export interface SceneSerializationSupport extends SceneNodeTypeSupport {
  /**
   * The component serializers, seeded with `PoseTarget` (from
   * `@fourjs/serialization`), `MotionComponent` (§11), `KinematicController`
   * (§12), and the two physics components — `RigidBody` (§23) and `Collider`
   * (§24).
   *
   * A fresh registry per call, never a shared singleton — registries are
   * mutable, and two applications registering their own component types must
   * not see each other's. Register more on it before use.
   */
  readonly components: ComponentSerializerRegistry;
}

// --- payload helpers ---------------------------------------------------------

/** A JSON object, read defensively: anything else is treated as empty. */
function record(value: JsonValue | undefined): {
  readonly [key: string]: JsonValue;
} {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as { readonly [key: string]: JsonValue })
    : {};
}

function readString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function readBoolean(value: JsonValue | undefined): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/**
 * A **finite** number, or `undefined` (2026-08-07, A-12).
 *
 * The controls that carry a value validate their inputs (§85) and throw on
 * anything else, so every number handed to one of their constructors below goes
 * through this first: a hand-built or corrupted payload must restore a usable
 * widget rather than take the whole scene down with it, which is the same
 * tolerance the layout and label reads already apply.
 */
function readFinite(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * One of `members`, or `undefined` — the string-union read (R-37).
 *
 * A payload carrying a name no build of the engine knows restores the class
 * default rather than failing the scene, which is `readFinite`'s tolerance
 * applied to an enumeration instead of a number.
 */
function readMember<T extends string>(
  value: JsonValue | undefined,
  members: readonly T[],
): T | undefined {
  return typeof value === "string" &&
    (members as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/**
 * A finite number as JSON, or `null` for `Infinity` — which is what an unset
 * `maxWidth` / `maxHeight` holds and which JSON cannot carry.
 */
function sizeJson(value: number): JsonValue {
  return Number.isFinite(value) ? value : null;
}

function readSize(value: JsonValue | undefined, fallback: number): number {
  if (value === null) return Infinity;
  return typeof value === "number" ? value : fallback;
}

/** `[x, y]` of a `Vector2`-shaped widget field. */
function pairJson(x: number, y: number): JsonValue {
  return [x, y];
}

function readPair(value: JsonValue | undefined): [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const pair = value as readonly JsonValue[];
  const x = pair[0];
  const y = pair[1];
  return typeof x === "number" && typeof y === "number" ? [x, y] : undefined;
}

/**
 * A pair whose components are both **finite** (2026-08-07, A-16).
 *
 * `Sprite.anchor` is validated (§85) and a `NaN` component throws, so the
 * sprite reader filters where the widget reader — whose anchor is a layout
 * hint nothing validates — does not.
 */
function readFinitePair(
  value: JsonValue | undefined,
): [number, number] | undefined {
  const pair = readPair(value);
  if (pair === undefined) return undefined;
  return Number.isFinite(pair[0]) && Number.isFinite(pair[1])
    ? pair
    : undefined;
}

/** §68's straight-RGB triple, all three components finite (§85). */
function readColor(
  value: JsonValue | undefined,
): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const source = value as readonly JsonValue[];
  const red = readFinite(source[0]);
  const green = readFinite(source[1]);
  const blue = readFinite(source[2]);
  return red !== undefined && green !== undefined && blue !== undefined
    ? [red, green, blue]
    : undefined;
}

/**
 * The finite members of `keys`, as a constructor-options object (2026-08-07).
 *
 * Named fields are omitted rather than defaulted, so a payload that says
 * nothing — or says `"far": "yes"` — restores the class default instead of
 * whatever this module would have guessed. The camera classes take every
 * projection parameter this way.
 */
function finiteOptions(
  data: { readonly [key: string]: JsonValue },
  keys: readonly string[],
): Record<string, number> {
  const options: Record<string, number> = {};
  for (const key of keys) {
    const value = readFinite(data[key]);
    if (value !== undefined) options[key] = value;
  }
  return options;
}

/**
 * A drawable's boolean flags as document fields — §49's two shadow flags (§69;
 * R-18, 2026-08-09) and `frustumCulled` (§87; R-8, 2026-08-09), plus §67's
 * `clip` (R-23, 2026-08-28), which is a `Node` field but is written *here*
 * because it only means something on a node that draws: the mask is the
 * node's own geometry, and a document putting it on a `Group` would restore a
 * warned-inert flag.
 *
 * Written **always**, not only when they differ from the default, for the
 * reason every other field here is: §79 documents state what a node *is*, and a
 * reader that has to know this build's defaults to interpret a document is a
 * reader that breaks the day a default changes. A document written before this
 * build carries none of the keys, `readBoolean` answers `undefined`, and the
 * node restores casting, receiving, being culled, and not clipping — which is
 * exactly how a `Renderable` authored today behaves.
 *
 * One helper for all four because they land in the same place on the same
 * classes and are read back into the same options record; splitting them per
 * feature would put four spreads on every writer for no reader's benefit.
 */
function renderableFlagsJson(node: {
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
  readonly frustumCulled: boolean;
  readonly clip: boolean;
}): Record<string, JsonValue> {
  return {
    castShadow: node.castShadow,
    receiveShadow: node.receiveShadow,
    frustumCulled: node.frustumCulled,
    clip: node.clip,
  };
}

/**
 * The drawable boolean flags as `RenderableOptions` (§69, §87, §67), dropping
 * whatever the payload does not carry as a boolean.
 */
function readRenderableFlags(data: {
  readonly [key: string]: JsonValue;
}): Record<string, boolean> {
  const options: Record<string, boolean> = {};
  const castShadow = readBoolean(data.castShadow);
  if (castShadow !== undefined) options.castShadow = castShadow;
  const receiveShadow = readBoolean(data.receiveShadow);
  if (receiveShadow !== undefined) options.receiveShadow = receiveShadow;
  const frustumCulled = readBoolean(data.frustumCulled);
  if (frustumCulled !== undefined) options.frustumCulled = frustumCulled;
  const clip = readBoolean(data.clip);
  if (clip !== undefined) options.clip = clip;
  return options;
}

/**
 * §67 rectangular scissor through §79. Omitted when `null` so a document
 * written before the field restores the default (inherit the view scissor).
 * A corrupted object is dropped rather than failing the scene — the Sprite
 * precedent, and §96's filter-don't-trust rule.
 */
function scissorJson(node: {
  readonly scissor: ScissorRect | null;
}): Record<string, JsonValue> {
  const rect = node.scissor;
  if (rect == null) {
    return {};
  }
  return {
    scissor: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
  };
}

function readScissor(data: { readonly [key: string]: JsonValue }): {
  scissor?: ScissorRect;
} {
  const value = data.scissor;
  if (value === undefined || value === null || typeof value !== "object") {
    return {};
  }
  const rect = record(value);
  const x = readNumber(rect.x);
  const y = readNumber(rect.y);
  const width = readNumber(rect.width);
  const height = readNumber(rect.height);
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined
  ) {
    return {};
  }
  return { scissor: { x, y, width, height } };
}

/**
 * A `DirectionalLight`'s §69 shadow settings, filtered to the values
 * `DirectionalLightShadow` will actually accept (R-18, 2026-08-09).
 *
 * The class refuses a non-integer `mapSize`, a negative `normalBias`, a
 * non-positive `extent`/`near`/`far`, and planes that do not bound a volume
 * (§85). This is the `Sprite` precedent, one record deeper: **a corrupted
 * payload restores the default for the field it corrupted rather than taking
 * the whole scene down with it**, because a document is data from outside and
 * §96's rule is that outside data is filtered, not trusted.
 *
 * `near` and `far` are admitted **as a pair or not at all**: their check is a
 * relation between them, so accepting one against the *other's default* is how
 * a document with a legal `near` of 200 would throw on a default `far` of 100.
 * Every document this module writes carries both.
 */
function readShadowOptions(value: JsonValue | undefined): {
  readonly [key: string]: number;
} {
  const data = record(value);
  const options: Record<string, number> = {};

  const mapSize = readFinite(data.mapSize);
  if (mapSize !== undefined && Number.isInteger(mapSize) && mapSize >= 1) {
    options.mapSize = mapSize;
  }
  const bias = readFinite(data.bias);
  if (bias !== undefined) options.bias = bias;
  const normalBias = readFinite(data.normalBias);
  if (normalBias !== undefined && normalBias >= 0) {
    options.normalBias = normalBias;
  }
  const extent = readFinite(data.extent);
  if (extent !== undefined && extent > 0) options.extent = extent;

  const near = readFinite(data.near);
  const far = readFinite(data.far);
  if (near !== undefined && far !== undefined && near > 0 && near < far) {
    options.near = near;
    options.far = far;
  }
  return options;
}

/** §74 insets as the four-number record `applyInsets` accepts. */
function insetsJson(insets: {
  top: number;
  right: number;
  bottom: number;
  left: number;
}): JsonValue {
  return {
    top: insets.top,
    right: insets.right,
    bottom: insets.bottom,
    left: insets.left,
  };
}

function readInsets(
  value: JsonValue | undefined,
): { top: number; right: number; bottom: number; left: number } | undefined {
  if (value === undefined) return undefined;
  const source = record(value);
  return {
    top: readNumber(source.top) ?? 0,
    right: readNumber(source.right) ?? 0,
    bottom: readNumber(source.bottom) ?? 0,
    left: readNumber(source.left) ?? 0,
  };
}

/** §75's accessibility record, written only for the fields that are set. */
function accessibilityJson(
  accessibility: WidgetAccessibility | null,
): JsonValue | undefined {
  if (accessibility === null) return undefined;
  const payload: Record<string, JsonValue> = {};
  if (accessibility.role !== undefined) payload.role = accessibility.role;
  if (accessibility.label !== undefined) payload.label = accessibility.label;
  if (accessibility.description !== undefined) {
    payload.description = accessibility.description;
  }
  if (accessibility.tabIndex !== undefined) {
    payload.tabIndex = accessibility.tabIndex;
  }
  return payload;
}

function readAccessibility(
  value: JsonValue | undefined,
): WidgetAccessibility | undefined {
  if (value === undefined) return undefined;
  const source = record(value);
  const accessibility: WidgetAccessibility = {};
  const role = readString(source.role);
  if (role !== undefined) accessibility.role = role;
  const label = readString(source.label);
  if (label !== undefined) accessibility.label = label;
  const description = readString(source.description);
  if (description !== undefined) accessibility.description = description;
  const tabIndex = readNumber(source.tabIndex);
  if (tabIndex !== undefined) accessibility.tabIndex = tabIndex;
  return accessibility;
}

/**
 * The §74 box model, the interaction flags, and the §75 record every widget
 * carries.
 *
 * Written in full rather than default-elided: `nodeDataOf` produces one opaque
 * value that `@fourjs/serialization` does not interpret, so there is nowhere for
 * a "absent means default" rule to live except here, and a payload that spells
 * every field is the one whose meaning does not depend on the reader's version.
 */
function widgetDataJson(widget: UIWidget): Record<string, JsonValue> {
  const payload: Record<string, JsonValue> = {
    width: widget.width,
    height: widget.height,
    minWidth: widget.minWidth,
    maxWidth: sizeJson(widget.maxWidth),
    minHeight: widget.minHeight,
    maxHeight: sizeJson(widget.maxHeight),
    padding: insetsJson(widget.padding),
    margin: insetsJson(widget.margin),
    anchor: pairJson(widget.anchor.x, widget.anchor.y),
    pivot: pairJson(widget.pivot.x, widget.pivot.y),
    offset: pairJson(widget.offset.x, widget.offset.y),
    grow: widget.grow,
    interactive: widget.interactive,
    focusable: widget.focusable,
    disabled: widget.disabled,
  };
  const accessibility = accessibilityJson(widget.accessibility);
  if (accessibility !== undefined) {
    payload.accessibility = accessibility;
  }
  return payload;
}

/** The {@link UIWidgetOptions} a widget payload restores. */
function widgetOptionsFrom(
  document: SceneNodeDocument,
): UIWidgetOptions & { readonly id?: string } {
  const data = record(document.data);
  const options: UIWidgetOptions = {
    width: data.width === null ? null : (readNumber(data.width) ?? null),
    height: data.height === null ? null : (readNumber(data.height) ?? null),
    minWidth: readSize(data.minWidth, 0),
    maxWidth: readSize(data.maxWidth, Infinity),
    minHeight: readSize(data.minHeight, 0),
    maxHeight: readSize(data.maxHeight, Infinity),
    grow: readNumber(data.grow) ?? 0,
  };
  const mutable = options as Record<string, unknown>;
  if (document.id !== undefined) mutable.id = document.id;
  const padding = readInsets(data.padding);
  if (padding !== undefined) mutable.padding = padding;
  const margin = readInsets(data.margin);
  if (margin !== undefined) mutable.margin = margin;
  const anchor = readPair(data.anchor);
  if (anchor !== undefined) mutable.anchor = anchor;
  const pivot = readPair(data.pivot);
  if (pivot !== undefined) mutable.pivot = pivot;
  const offset = readPair(data.offset);
  if (offset !== undefined) mutable.offset = offset;
  const interactive = readBoolean(data.interactive);
  if (interactive !== undefined) mutable.interactive = interactive;
  const focusable = readBoolean(data.focusable);
  if (focusable !== undefined) mutable.focusable = focusable;
  const disabled = readBoolean(data.disabled);
  if (disabled !== undefined) mutable.disabled = disabled;
  const accessibility = readAccessibility(data.accessibility);
  if (accessibility !== undefined) mutable.accessibility = accessibility;
  return options;
}

/** §74 layout configuration, for the two container widgets. */
function panelDataJson(panel: Panel): Record<string, JsonValue> {
  return {
    ...widgetDataJson(panel),
    layout: {
      type: panel.layoutType,
      direction: panel.direction,
      gap: panel.gap,
      justify: panel.justify,
      align: panel.align,
    },
  };
}

/**
 * Applies a restored layout record. Read through `setLayout`, so an absent or
 * misspelled field keeps the class default rather than corrupting the panel.
 */
function applyPanelData(panel: Panel, document: SceneNodeDocument): void {
  const layout = record(record(document.data).layout);
  const type = readString(layout.type);
  if (type === "absolute" || type === "stack" || type === "flex") {
    panel.layoutType = type;
  }
  const direction = readString(layout.direction);
  if (direction === "row" || direction === "column") {
    panel.direction = direction;
  }
  const gap = readNumber(layout.gap);
  if (gap !== undefined) panel.gap = gap;
  const justify = readString(layout.justify);
  if (
    justify === "start" ||
    justify === "center" ||
    justify === "end" ||
    justify === "space-between"
  ) {
    panel.justify = justify;
  }
  const align = readString(layout.align);
  if (
    align === "start" ||
    align === "center" ||
    align === "end" ||
    align === "stretch"
  ) {
    panel.align = align;
  }
}

// --- the §73 controls that carry their own state (2026-08-07, A-12) ----------

/** A checkable control's payload: a panel's, plus the one flag it adds. */
function checkableDataJson(widget: CheckableWidget): Record<string, JsonValue> {
  return { ...panelDataJson(widget), checked: widget.checked };
}

/**
 * The bounds a ranged control (`Slider`, `ProgressIndicator`) restores.
 *
 * Both are always returned — filled in from the class defaults when the payload
 * omits one — because the two are checked against each other at construction
 * and a half-read pair is exactly what makes that check throw. A pair that
 * contradicts itself is dropped **whole**: `{}` keeps both class defaults,
 * which is a usable control, where applying one bound would move the other's
 * meaning in a way the document never stated.
 */
function readBounds(
  data: { readonly [key: string]: JsonValue },
  defaultMin: number,
  defaultMax: number,
): { min: number; max: number } | Record<string, never> {
  const min = readFinite(data.min) ?? defaultMin;
  const max = readFinite(data.max) ?? defaultMax;
  return max < min ? {} : { min, max };
}

// --- §79 resource references (2026-08-07, A-16) ------------------------------

/**
 * Builds both halves of a {@link SceneResourceCatalog} from one map of logical
 * key → resource (§79, 2026-08-07).
 *
 * ```ts
 * const materials = resourceCatalog([
 *   ["materials/brick", brick],
 *   ["materials/glass", glass],
 * ]);
 * const io = registerSceneNodeTypes({ materials, geometries });
 * ```
 *
 * One map rather than two functions because the two directions have to agree:
 * a `keyOf` writing a key its `get` cannot resolve produces a document that
 * saves cleanly and refuses to load, which is the failure this whole seam
 * exists to make impossible.
 *
 * A resource published under **two** keys keeps the first, in iteration order,
 * so the document a scene writes does not depend on which alias the caller
 * happened to look up — both keys still resolve, so nothing is lost.
 *
 * @param entries logical key → resource, in any iterable form a `Map` accepts
 * @returns a catalog with both halves populated
 * @throws FourError `INVALID_APPLICATION_STATE` if one key names two resources
 * — the read side could only pick arbitrarily, and §79 keys resolve to exactly
 * one thing
 */
export function resourceCatalog<T extends object>(
  entries: Iterable<readonly [string, T]>,
): Required<SceneResourceCatalog<T>> {
  const byKey = new Map<string, T>();
  const byResource = new Map<T, string>();
  for (const [key, resource] of entries) {
    const existing = byKey.get(key);
    if (existing !== undefined && existing !== resource) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `Resource catalog gives the key ${JSON.stringify(key)} two different resources; a logical key resolves to exactly one (§79).`,
        { context: { key } },
      );
    }
    byKey.set(key, resource);
    if (!byResource.has(resource)) byResource.set(resource, key);
  }
  return {
    keyOf: (resource: T): string | undefined => byResource.get(resource),
    get: (key: string): T | undefined => byKey.get(key),
  };
}

/**
 * The key a resource is written under, or `null` under
 * {@link UnknownResourcePolicy} `"skip"`.
 *
 * @throws FourError `INVALID_APPLICATION_STATE` under the default policy
 */
function resourceKeyJson<T>(
  node: Node,
  field: "geometry" | "material",
  resource: T,
  catalog: SceneResourceCatalog<T> | undefined,
  policy: UnknownResourcePolicy,
): JsonValue {
  const key = catalog?.keyOf?.(resource);
  if (key !== undefined) return key;
  if (policy === "skip") return null;
  throw new FourError(
    "INVALID_APPLICATION_STATE",
    `Node ${node.id} references a ${field} that no catalog names, so the document could not be loaded back; supply registerSceneNodeTypes's \`${field === "geometry" ? "geometries" : "materials"}\` option, or pass { unknownResources: "skip" } to write a null reference (§79).`,
    { context: { node: node.id, field } },
  );
}

/**
 * The resource a saved key names.
 *
 * Both failures are loud and distinct — a document that wrote no key (the
 * `"skip"` path, or a build that did not know the field) and a key this
 * application's catalog does not publish are different mistakes with different
 * fixes.
 *
 * @throws FourError `INVALID_APPLICATION_STATE` for either
 */
function resolveResource<T>(
  document: SceneNodeDocument,
  field: "geometry" | "material",
  catalog: SceneResourceCatalog<T> | undefined,
): T {
  // One `??` for the whole function: a document node need not carry an id
  // (§79 ids are optional in the format), and `null` is what the context field
  // holds when it does not.
  const node = document.id ?? null;
  const option = field === "geometry" ? "geometries" : "materials";
  const key = readString(record(document.data)[field]);
  if (key === undefined) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      `Scene document node ${JSON.stringify(node)} of type ${JSON.stringify(document.type)} names no ${field}; it was written with { unknownResources: "skip" }, or by a build that wrote no reference, and a drawable without a ${field} cannot be constructed (§79).`,
      { context: { node, type: document.type, field } },
    );
  }
  const resource = catalog?.get?.(key);
  if (resource === undefined) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      `Scene document node ${JSON.stringify(node)} references the ${field} ${JSON.stringify(key)}, which no catalog resolves; supply instantiateScene's matching \`${option}\` option (§79).`,
      { context: { node, key, field } },
    );
  }
  return resource;
}

/**
 * Refuses a material a `Sprite` cannot be built from (§55, §57).
 *
 * Checked on the §57 `kind` discriminant rather than with `instanceof`, which is
 * the rule the render list itself follows — the pipeline is chosen by the
 * material's kind, never by the node's class.
 *
 * A `Sprite` is the one node type here that narrows its material: its
 * constructor takes a `SpriteMaterial` and the sprite pipeline samples that
 * material's texture, so a key resolving to a `"lit"` material produces a node
 * that is a type error made at run time and draws nothing. A plain
 * `Renderable` is deliberately **not** checked: `Renderable<M extends Material>`
 * is generic precisely so a consumer's own material kind can be drawn through
 * it, and refusing anything but `"unlit"`/`"lit"` here would make a legitimate
 * `Renderable<GlowMaterial>` savable and unloadable.
 *
 * @throws FourError `INVALID_APPLICATION_STATE`
 */
function requireSpriteMaterial(
  document: SceneNodeDocument,
  material: Material,
): SpriteMaterial {
  if (material.kind === "sprite") {
    // Sound behind the discriminant, which is §57's own contract for what a
    // material *is* — the same read `buildRenderList` makes.
    return material as SpriteMaterial;
  }
  const node = document.id ?? null;
  throw new FourError(
    "INVALID_APPLICATION_STATE",
    `Scene document node ${JSON.stringify(node)} of type ${JSON.stringify(document.type)} resolves to a ${JSON.stringify(material.kind)} material, but a sprite draws a "sprite" material — it samples that material's texture (§55, §57).`,
    { context: { node, type: document.type, kind: material.kind } },
  );
}

/**
 * §71's mode as a document value, filtered to `HitTestMode`'s four strings —
 * anything else (a missing key, a corrupted value, a `"custom"` written by a
 * build that has the strategy this one does not) restores the class default,
 * `null`, per the `Sprite` corrupt-field policy and §96's filter-don't-trust
 * rule.
 */
function readHitTestMode(
  value: JsonValue | undefined,
): HitTestMode | undefined {
  return value === "bounds" ||
    value === "geometry" ||
    value === "pixel" ||
    value === "gpu"
    ? value
    : undefined;
}

/**
 * Rides §71's `hitTestMode` on every node type of `support` (A-11; the field
 * ships with the analytic tier per the adopted RFC 0005 Q3, 2026-08-29). Each
 * pair below returns through this wrapper, so the field serializes uniformly
 * for **every class the umbrella writes** — widgets included, since §73's
 * pixel-accurate UI hit testing is one of the field's consumers — without a
 * line in any individual writer. It composes transparently: the wrapped
 * writer still answers `undefined` for a foreign node, so
 * {@link composeSceneNodeTypes}'s fall-through is untouched.
 *
 * Written **only when set** — unlike the four drawable flags, which are
 * written always. Their recorded rule exists so a reader never has to know a
 * build's defaults; `null` is not that kind of default. It is the *absence of
 * an author decision* (§71's "the engine should select the cheapest valid
 * method" — resolved per candidate at pick time, from what the candidate
 * carries), its meaning is frozen by the spec rather than by a build, and §79
 * documents state what a node **is** — a node whose mode was never chosen
 * says nothing. Eliding it also keeps every document written before this
 * field byte-identical on a round trip, which is the A-11 packet's
 * behaviour-identity obligation.
 *
 * On the way back in the field is assigned after construction rather than
 * through an option: it is a plain writable `Node` field (like `clip`,
 * whose option lives on `RenderableOptions` — a record this package does not
 * own and has no §71 reason to widen), and one assignment here covers every
 * factory branch of every pair.
 *
 * The write side narrows `data` to a record by assertion rather than by
 * check, because the invariant is this module's own: every `nodeDataOf`
 * below answers a JSON **record** or `undefined`, never a bare value — a
 * guard branch for the impossible shape would be untestable by construction.
 */
function withHitTestMode(support: SceneNodeTypeSupport): SceneNodeTypeSupport {
  return {
    write: {
      nodeTypeOf: support.write.nodeTypeOf,
      nodeDataOf: (node: Node): JsonValue | undefined => {
        const data = support.write.nodeDataOf(node);
        const mode = node.hitTestMode;
        if (data === undefined || mode === null) return data;
        return { ...(data as Record<string, JsonValue>), hitTestMode: mode };
      },
    },
    read: {
      nodeFactory: (document: SceneNodeDocument): Node | undefined => {
        const node = support.read.nodeFactory(document);
        if (node !== undefined) {
          const mode = readHitTestMode(record(document.data).hitTestMode);
          if (mode !== undefined) node.hitTestMode = mode;
        }
        return node;
      },
    },
  };
}

// --- the pairs ---------------------------------------------------------------

/**
 * The §73/§79 node-type pair for every widget class `@fourjs/ui` ships — `Panel`,
 * `Label`, `Button`, `Toggle`, `Checkbox`, `RadioButton`, `Slider`,
 * `ProgressIndicator`, `ImageWidget`, and `CanvasViewWidget` (A-14; the six
 * controls added 2026-08-07, A-12; the canvas view added 2026-08-29,
 * RFC 0004).
 *
 * Matched by **exact class identity**, exactly as `@fourjs/serialization` matches
 * its own two: a subclass of `Button` is not a `Button` for this purpose, and
 * writing it out as one would reload it as a plain button and lose everything
 * that made it a subclass. An application's own widget classes therefore compose
 * with this pair rather than being swallowed by it — see
 * {@link registerSceneNodeTypes} for how the fallbacks chain.
 *
 * @param options the glyph atlas restored labels are given
 * @returns the writer and reader halves; pass both or neither
 */
export function registerUISerializers(
  options: SceneNodeTypeOptions = {},
): SceneNodeTypeSupport {
  const atlas = options.atlas;
  return withHitTestMode({
    write: {
      nodeTypeOf: (node: Node): string | undefined => {
        const constructor = node.constructor;
        if (constructor === Button) return BUTTON_NODE_TYPE;
        if (constructor === Label) return LABEL_NODE_TYPE;
        if (constructor === Panel) return PANEL_NODE_TYPE;
        if (constructor === Toggle) return TOGGLE_NODE_TYPE;
        if (constructor === Checkbox) return CHECKBOX_NODE_TYPE;
        if (constructor === RadioButton) return RADIO_BUTTON_NODE_TYPE;
        if (constructor === Slider) return SLIDER_NODE_TYPE;
        if (constructor === ProgressIndicator) return PROGRESS_NODE_TYPE;
        if (constructor === ImageWidget) return IMAGE_NODE_TYPE;
        if (constructor === CanvasViewWidget) return CANVAS_VIEW_NODE_TYPE;
        return undefined;
      },
      nodeDataOf: (node: Node): JsonValue | undefined => {
        const constructor = node.constructor;
        if (constructor === Button || constructor === Panel) {
          return panelDataJson(node as Panel);
        }
        if (constructor === Label) {
          const label = node as Label;
          return {
            ...widgetDataJson(label),
            text: label.text,
            size: label.size,
            letterSpacing: label.letterSpacing,
          };
        }
        if (constructor === Toggle || constructor === Checkbox) {
          return checkableDataJson(node as CheckableWidget);
        }
        if (constructor === RadioButton) {
          const radio = node as RadioButton;
          return { ...checkableDataJson(radio), group: radio.group };
        }
        if (constructor === Slider) {
          const slider = node as Slider;
          return {
            ...panelDataJson(slider),
            min: slider.min,
            max: slider.max,
            step: slider.step,
            value: slider.value,
            orientation: slider.orientation,
          };
        }
        if (constructor === ProgressIndicator) {
          const progress = node as ProgressIndicator;
          return {
            ...panelDataJson(progress),
            min: progress.min,
            max: progress.max,
            value: progress.value,
            indeterminate: progress.indeterminate,
          };
        }
        if (constructor === ImageWidget) {
          const image = node as ImageWidget;
          return {
            ...widgetDataJson(image),
            source: image.source,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
          };
        }
        if (constructor === CanvasViewWidget) {
          const view = node as CanvasViewWidget;
          // The box and the resolution only — no pixels, no contentVersion
          // (§77a; see CANVAS_VIEW_NODE_TYPE).
          return { ...widgetDataJson(view), resolution: view.resolution };
        }
        return undefined;
      },
    },
    read: {
      nodeFactory: (document: SceneNodeDocument): Node | undefined => {
        const widgetOptions = widgetOptionsFrom(document);
        if (document.type === BUTTON_NODE_TYPE) {
          const button = new Button(widgetOptions);
          applyPanelData(button, document);
          return button;
        }
        if (document.type === PANEL_NODE_TYPE) {
          const panel = new Panel(widgetOptions);
          applyPanelData(panel, document);
          return panel;
        }
        if (
          document.type === TOGGLE_NODE_TYPE ||
          document.type === CHECKBOX_NODE_TYPE ||
          document.type === RADIO_BUTTON_NODE_TYPE
        ) {
          const data = record(document.data);
          const checked = readBoolean(data.checked) ?? false;
          const options = { ...widgetOptions, checked };
          let control: Panel;
          if (document.type === TOGGLE_NODE_TYPE) {
            control = new Toggle(options);
          } else if (document.type === CHECKBOX_NODE_TYPE) {
            control = new Checkbox(options);
          } else {
            // Restored through the constructor, so no group is reconciled on
            // the way in: `RadioButton` enforces exclusivity on the transition
            // to checked, precisely so a document reloads as it was saved.
            control = new RadioButton({
              ...options,
              group: readString(data.group) ?? "",
            });
          }
          applyPanelData(control, document);
          return control;
        }
        if (document.type === SLIDER_NODE_TYPE) {
          const data = record(document.data);
          const step = readFinite(data.step);
          const value = readFinite(data.value);
          const orientation = readString(data.orientation);
          const slider = new Slider({
            ...widgetOptions,
            ...readBounds(data, 0, 1),
            ...(step !== undefined && step >= 0 ? { step } : {}),
            ...(value !== undefined ? { value } : {}),
            ...(orientation === "horizontal" || orientation === "vertical"
              ? { orientation }
              : {}),
          });
          applyPanelData(slider, document);
          return slider;
        }
        if (document.type === PROGRESS_NODE_TYPE) {
          const data = record(document.data);
          const value = readFinite(data.value);
          const progress = new ProgressIndicator({
            ...widgetOptions,
            ...readBounds(data, 0, 1),
            ...(value !== undefined ? { value } : {}),
            indeterminate: readBoolean(data.indeterminate) ?? false,
          });
          applyPanelData(progress, document);
          return progress;
        }
        if (document.type === IMAGE_NODE_TYPE) {
          const data = record(document.data);
          const naturalWidth = readFinite(data.naturalWidth);
          const naturalHeight = readFinite(data.naturalHeight);
          return new ImageWidget({
            ...widgetOptions,
            source: readString(data.source) ?? null,
            ...(naturalWidth !== undefined && naturalWidth >= 0
              ? { naturalWidth }
              : {}),
            ...(naturalHeight !== undefined && naturalHeight >= 0
              ? { naturalHeight }
              : {}),
          });
        }
        if (document.type === CANVAS_VIEW_NODE_TYPE) {
          const data = record(document.data);
          const resolution = readFinite(data.resolution);
          // The class refuses a non-positive resolution (§85), so a corrupted
          // payload restores the default rather than taking the scene down —
          // the same tolerance every control here applies.
          return new CanvasViewWidget({
            ...widgetOptions,
            ...(resolution !== undefined && resolution > 0
              ? { resolution }
              : {}),
          });
        }
        if (document.type === LABEL_NODE_TYPE) {
          const data = record(document.data);
          const label = new Label(widgetOptions);
          if (atlas !== undefined) label.atlas = atlas;
          const text = readString(data.text);
          if (text !== undefined) label.text = text;
          const size = readNumber(data.size);
          if (size !== undefined && Number.isFinite(size) && size > 0) {
            label.size = size;
          }
          const letterSpacing = readNumber(data.letterSpacing);
          if (letterSpacing !== undefined && Number.isFinite(letterSpacing)) {
            label.letterSpacing = letterSpacing;
          }
          return label;
        }
        return undefined;
      },
    },
  });
}

/**
 * The §79 node-type pair for the five classes a *drawn* scene is made of
 * (2026-08-07, the A-16 remainder): §49's `Renderable`, §55's `Sprite`, §47's
 * `PerspectiveCamera` and `OrthographicCamera`, and §68's `DirectionalLight`.
 *
 * ```ts
 * const io = registerSceneNodeTypes({
 *   geometries: resourceCatalog([["geometry/plane", plane]]),
 *   materials: resourceCatalog([["material/brick", brick]]),
 * });
 * ```
 *
 * ## What each one carries
 *
 * - **`Renderable`** — a `geometry` key, a `material` key (see the module
 *   header), `renderLayer`, `renderOrder`, `castShadow`/`receiveShadow` (§69,
 *   R-18), `frustumCulled` (§87, R-8) and `clip` (§67, R-23, 2026-08-28).
 *   §49's `depthMode` is still not
 *   written because the class does not have it yet; it joins the payload with
 *   the feature. (This bullet claimed all four were unwritten until
 *   2026-08-09 — it predated R-18.)
 * - **`Sprite`** — a `material` key, `width`, `height`, `anchor`,
 *   `renderLayer`, `renderOrder`, the same four drawable flags, and **no
 *   geometry key at all**: a sprite
 *   derives its quad from the anchor and the size and owns it (§55), so the
 *   payload above rebuilds it exactly. Its `dispose()` state is not written —
 *   a disposed sprite is a released resource, not authored scene state.
 * - **the cameras** — their projection parameters only. The three matrices are
 *   *derived*: `updateProjectionMatrix` rebuilds the projection from these
 *   numbers, and the view matrix from the node transform §79 already carries.
 *   The `depthRange` that projection was last built with is deliberately absent
 *   — it belongs to the renderer, not the camera (§47), so a document does not
 *   pin a scene to the backend that saved it.
 * - **`DirectionalLight`** — `color` and `intensity`. Its direction is its
 *   node's −Z axis (§68), which is the transform, not a payload.
 * - **`PointLight`** — `color`, `intensity`, and `range`. Its *position* is
 *   the node transform §79 already carries, so it is not a payload either
 *   (R-17, 2026-08-09).
 * - **`SpotLight`** — the point light's three, plus `innerConeAngle` and
 *   `outerConeAngle` in radians (§7a). Its axis is the node's −Z, like a
 *   directional light's: transform, not payload.
 *
 * A restored `Renderable` accepts **whatever material its key resolves to**;
 * only a `Sprite` insists on a `"sprite"` one. The asymmetry is the classes'
 * own: `Renderable<M extends Material>` is generic so that a consumer's own
 * material kind can be drawn through it, and refusing anything but
 * `"unlit"`/`"lit"` on the way in would make a legitimate
 * `Renderable<GlowMaterial>` savable and unloadable — while a `Sprite` takes a
 * `SpriteMaterial` and samples its texture, so any other kind is a run-time
 * type error that draws nothing.
 *
 * ## Why one pair and not three
 *
 * The cameras and the light live in `@fourjs/scene` and the two drawables in
 * `@fourjs/render`, so a package-shaped split is available and is not taken: the
 * split that pays is `@fourjs/physics` versus the drawing tier (a headless
 * simulation saves scenes without bundling any of this — see
 * {@link registerPhysicsSerializers}), and *within* the drawing tier a scene
 * with a camera and a light is a scene that gets drawn. Splitting further would
 * hand callers a choice with no bundle behind it.
 *
 * Neither camera nor the light touches the resource options, so a caller with
 * no catalogs still gets all three; only a `Renderable` or `Sprite` reaching
 * the writer without one is refused (§85).
 *
 * Matched by **exact class identity**, like every other pair here: a subclass of
 * `Renderable` is not a `Renderable` for this purpose, and writing it out as one
 * would silently reload it as a plain renderable.
 *
 * @param options the resource catalogs and the unknown-resource policy
 * @returns the writer and reader halves; pass both or neither
 */
export function registerRenderSerializers(
  options: SceneNodeTypeOptions = {},
): SceneNodeTypeSupport {
  const geometries = options.geometries;
  const materials = options.materials;
  const policy = options.unknownResources ?? "throw";
  return withHitTestMode({
    write: {
      nodeTypeOf: (node: Node): string | undefined => {
        const constructor = node.constructor;
        if (constructor === Renderable) return RENDERABLE_NODE_TYPE;
        if (constructor === Mesh) return MESH_NODE_TYPE;
        if (constructor === Bone) return BONE_NODE_TYPE;
        if (constructor === Sprite) return SPRITE_NODE_TYPE;
        if (constructor === PerspectiveCamera) {
          return PERSPECTIVE_CAMERA_NODE_TYPE;
        }
        if (constructor === OrthographicCamera) {
          return ORTHOGRAPHIC_CAMERA_NODE_TYPE;
        }
        if (constructor === ScreenCamera) {
          return SCREEN_CAMERA_NODE_TYPE;
        }
        if (constructor === DirectionalLight) {
          return DIRECTIONAL_LIGHT_NODE_TYPE;
        }
        if (constructor === PointLight) return POINT_LIGHT_NODE_TYPE;
        if (constructor === SpotLight) return SPOT_LIGHT_NODE_TYPE;
        if (constructor === HemisphereLight) return HEMISPHERE_LIGHT_NODE_TYPE;
        return undefined;
      },
      nodeDataOf: (node: Node): JsonValue | undefined => {
        const constructor = node.constructor;
        if (constructor === Renderable) {
          const renderable = node as Renderable;
          return {
            geometry: resourceKeyJson<BufferGeometry>(
              node,
              "geometry",
              renderable.geometry,
              geometries,
              policy,
            ),
            material: resourceKeyJson<Material>(
              node,
              "material",
              renderable.material,
              materials,
              policy,
            ),
            renderLayer: renderable.renderLayer,
            renderOrder: renderable.renderOrder,
            ...renderableFlagsJson(renderable),
            ...scissorJson(renderable),
          };
        }
        if (constructor === Mesh) {
          const mesh = node as Mesh<Material>;
          // Reading `skeleton` resolves any pending §79 reference first, so a
          // reloaded scene re-serializes the identical record — the textual
          // idempotency the P11-1 gate demands.
          const skeleton = mesh.skeleton;
          return {
            geometry: resourceKeyJson<BufferGeometry>(
              node,
              "geometry",
              mesh.bindGeometry,
              geometries,
              policy,
            ),
            material: resourceKeyJson<Material>(
              node,
              "material",
              mesh.material,
              materials,
              policy,
            ),
            ...(mesh.skinningMode === "cpu" || mesh.skinningMode === "texture"
              ? { skinningMode: mesh.skinningMode }
              : {}),
            renderLayer: mesh.renderLayer,
            renderOrder: mesh.renderOrder,
            ...renderableFlagsJson(mesh),
            ...scissorJson(mesh),
            skeleton:
              skeleton === null
                ? null
                : {
                    bones: skeleton.bones.map((bone) => bone.id),
                    inverseBindMatrices: Array.from(
                      skeleton.inverseBindMatrices,
                    ),
                  },
          };
        }
        if (constructor === Sprite) {
          const sprite = node as Sprite;
          return {
            material: resourceKeyJson<Material>(
              node,
              "material",
              sprite.material,
              materials,
              policy,
            ),
            width: sprite.width,
            height: sprite.height,
            anchor: pairJson(sprite.anchor.x, sprite.anchor.y),
            renderLayer: sprite.renderLayer,
            renderOrder: sprite.renderOrder,
            ...renderableFlagsJson(sprite),
            ...scissorJson(sprite),
          };
        }
        if (constructor === PerspectiveCamera) {
          const camera = node as PerspectiveCamera;
          return {
            fieldOfView: camera.fieldOfView,
            aspect: camera.aspect,
            near: camera.near,
            far: camera.far,
          };
        }
        if (constructor === OrthographicCamera) {
          const camera = node as OrthographicCamera;
          return {
            left: camera.left,
            right: camera.right,
            bottom: camera.bottom,
            top: camera.top,
            near: camera.near,
            far: camera.far,
          };
        }
        if (constructor === ScreenCamera) {
          const camera = node as ScreenCamera;
          return {
            // The origin and the units are the two fields §47 names, and they
            // are written **always**: a document that omitted `"top-left"`
            // because it is the default would reload identically today and
            // differently the day §7a's default were ever revisited.
            origin: camera.origin,
            units: camera.units,
            // The surface size is state, not authoring — the application
            // pushes it on the next resize — but it is written anyway, so a
            // scene loaded and rendered before any resize projects the
            // rectangle it was saved with rather than the 1 × 1 default.
            width: camera.width,
            height: camera.height,
            resolution: camera.resolution,
            near: camera.near,
            far: camera.far,
          };
        }
        if (constructor === DirectionalLight) {
          const light = node as DirectionalLight;
          return {
            color: [light.color[0], light.color[1], light.color[2]],
            intensity: light.intensity,
            // §69 (R-18, 2026-08-09) — additive, exactly as R-17's `range` and
            // cone angles were. A document written before this build carries
            // neither key; `readBoolean` answers `undefined` and the light
            // restores with `castShadow: false` and the default settings, which
            // is what that document meant.
            castShadow: light.castShadow,
            shadow: {
              mapSize: light.shadow.mapSize,
              bias: light.shadow.bias,
              normalBias: light.shadow.normalBias,
              extent: light.shadow.extent,
              near: light.shadow.near,
              far: light.shadow.far,
            },
          };
        }
        if (constructor === PointLight) {
          const light = node as PointLight;
          return {
            color: [light.color[0], light.color[1], light.color[2]],
            intensity: light.intensity,
            range: light.range,
          };
        }
        if (constructor === SpotLight) {
          const light = node as SpotLight;
          return {
            color: [light.color[0], light.color[1], light.color[2]],
            intensity: light.intensity,
            range: light.range,
            innerConeAngle: light.innerConeAngle,
            outerConeAngle: light.outerConeAngle,
          };
        }
        if (constructor === HemisphereLight) {
          const light = node as HemisphereLight;
          return {
            color: [light.color[0], light.color[1], light.color[2]],
            groundColor: [
              light.groundColor[0],
              light.groundColor[1],
              light.groundColor[2],
            ],
            intensity: light.intensity,
          };
        }
        return undefined;
      },
    },
    read: {
      nodeFactory: (document: SceneNodeDocument): Node | undefined => {
        const data = record(document.data);
        if (document.type === RENDERABLE_NODE_TYPE) {
          const geometry = resolveResource<BufferGeometry>(
            document,
            "geometry",
            geometries,
          );
          const material = resolveResource<Material>(
            document,
            "material",
            materials,
          );
          // `Renderable<Material>`, not the default `Renderable<SurfaceMaterial>`
          // and no cast: the class is generic in its material and the render
          // list dispatches on the material's own kind (§57, §64), so a
          // document naming a material this build has never heard of restores
          // a node that draws exactly as it was authored to.
          return new Renderable<Material>(geometry, material, {
            ...finiteOptions(data, ["renderLayer", "renderOrder"]),
            ...readRenderableFlags(data),
            ...readScissor(data),
          });
        }
        if (document.type === MESH_NODE_TYPE) {
          const geometry = resolveResource<BufferGeometry>(
            document,
            "geometry",
            geometries,
          );
          const material = resolveResource<Material>(
            document,
            "material",
            materials,
          );
          const mesh = new Mesh<Material>(geometry, material, {
            ...finiteOptions(data, ["renderLayer", "renderOrder"]),
            ...readRenderableFlags(data),
            ...readScissor(data),
          });
          if (data.skinningMode === "cpu" || data.skinningMode === "texture") {
            mesh.skinningMode = data.skinningMode;
          }
          // The skeleton record: shape-corrupt restores no skeleton (the
          // motion serializers' corrupt-field policy — a mesh without its rig
          // is a usable mesh), while a well-formed record the classes refuse
          // (a duplicate id, a mis-sized matrix array, a rig over the joint
          // limit) is refused loudly at resolution (§85).
          const skeletonRecord = record(data.skeleton);
          const boneIds = skeletonRecord.bones;
          const binds = skeletonRecord.inverseBindMatrices;
          if (
            Array.isArray(boneIds) &&
            boneIds.length > 0 &&
            boneIds.every((id) => typeof id === "string") &&
            Array.isArray(binds) &&
            binds.every(
              (value) => typeof value === "number" && Number.isFinite(value),
            )
          ) {
            restoreMeshSkeleton(
              mesh,
              boneIds,
              new Float32Array(binds as number[]),
            );
          }
          return mesh;
        }
        if (document.type === BONE_NODE_TYPE) {
          // A bone's state is its node state, which the instantiator applies
          // after this factory returns; the id goes through the constructor so
          // it is reserved against the counter (A-17).
          return new Bone(document.id === undefined ? {} : { id: document.id });
        }
        if (document.type === SPRITE_NODE_TYPE) {
          const material = resolveResource<Material>(
            document,
            "material",
            materials,
          );
          const width = readFinite(data.width);
          const height = readFinite(data.height);
          const anchor = readFinitePair(data.anchor);
          return new Sprite(requireSpriteMaterial(document, material), {
            ...finiteOptions(data, ["renderLayer", "renderOrder"]),
            ...readRenderableFlags(data),
            ...readScissor(data),
            // §85: the class refuses a non-positive extent, so a payload that
            // carries one restores the default rather than the whole scene
            // failing on one number.
            ...(width !== undefined && width > 0 ? { width } : {}),
            ...(height !== undefined && height > 0 ? { height } : {}),
            ...(anchor !== undefined
              ? { anchor: { x: anchor[0], y: anchor[1] } }
              : {}),
          });
        }
        if (document.type === PERSPECTIVE_CAMERA_NODE_TYPE) {
          return new PerspectiveCamera(
            finiteOptions(data, ["fieldOfView", "aspect", "near", "far"]),
          );
        }
        if (document.type === ORTHOGRAPHIC_CAMERA_NODE_TYPE) {
          return new OrthographicCamera(
            finiteOptions(data, [
              "left",
              "right",
              "bottom",
              "top",
              "near",
              "far",
            ]),
          );
        }
        if (document.type === SCREEN_CAMERA_NODE_TYPE) {
          const origin = readMember(data.origin, SCREEN_ORIGINS);
          const units = readMember(data.units, SCREEN_UNITS);
          const size = finiteOptions(data, [
            "width",
            "height",
            "resolution",
            "near",
            "far",
          ]);
          // §85: the class refuses a non-positive pixel count, so a corrupted
          // payload restores the 1 × 1 default rather than taking the whole
          // scene down — the `Sprite` extent rule, for the same reason.
          for (const key of ["width", "height", "resolution"]) {
            const value = size[key];
            if (value !== undefined && value <= 0) delete size[key];
          }
          return new ScreenCamera({
            ...size,
            ...(origin !== undefined ? { origin } : {}),
            ...(units !== undefined ? { units } : {}),
          });
        }
        if (document.type === DIRECTIONAL_LIGHT_NODE_TYPE) {
          const color = readColor(data.color);
          const castShadow = readBoolean(data.castShadow);
          return new DirectionalLight({
            ...finiteOptions(data, ["intensity"]),
            ...(color !== undefined ? { color } : {}),
            ...(castShadow !== undefined ? { castShadow } : {}),
            shadow: readShadowOptions(data.shadow),
          });
        }
        if (document.type === POINT_LIGHT_NODE_TYPE) {
          const color = readColor(data.color);
          return new PointLight({
            ...finiteOptions(data, ["intensity", "range"]),
            ...(color !== undefined ? { color } : {}),
          });
        }
        if (document.type === SPOT_LIGHT_NODE_TYPE) {
          const color = readColor(data.color);
          return new SpotLight({
            ...finiteOptions(data, [
              "intensity",
              "range",
              "innerConeAngle",
              "outerConeAngle",
            ]),
            ...(color !== undefined ? { color } : {}),
          });
        }
        if (document.type === HEMISPHERE_LIGHT_NODE_TYPE) {
          const color = readColor(data.color);
          const groundColor = readColor(data.groundColor);
          return new HemisphereLight({
            ...finiteOptions(data, ["intensity"]),
            ...(color !== undefined ? { color } : {}),
            ...(groundColor !== undefined ? { groundColor } : {}),
          });
        }
        return undefined;
      },
    },
  });
}

// --- §50's shape family (2026-08-09, R-23) -----------------------------------

/** The constructors {@link registerShapeSerializers} matches, as a value type. */
type ShapeClass = abstract new (...parameters: never[]) => Shape2D<Material>;

/**
 * Class → document type for every §50 shape (R-23, 2026-08-09).
 *
 * A map rather than the `if` chain the other pairs use: nine classes share one
 * payload shape and one writer, so the chain would test the same constructor
 * twice — once to decide the type name and once to decide the payload — and a
 * tenth shape would have to be added in three places instead of one. It is also
 * the enumeration `tests/integration/shape-serialization.test.ts` walks to prove
 * that every `Shape2D` subclass the umbrella exports is registered, which is the
 * mechanical guard §79 gets nothing else from.
 */
const SHAPE_NODE_TYPES: ReadonlyMap<ShapeClass, string> = new Map<
  ShapeClass,
  string
>([
  [Circle, CIRCLE_NODE_TYPE],
  [Ellipse, ELLIPSE_NODE_TYPE],
  [Rectangle, RECTANGLE_NODE_TYPE],
  [RegularPolygon, REGULAR_POLYGON_NODE_TYPE],
  [Polygon, POLYGON_NODE_TYPE],
  [Star, STAR_NODE_TYPE],
  [Sector, SECTOR_NODE_TYPE],
  [Ring, RING_NODE_TYPE],
  [PathShape, PATH_SHAPE_NODE_TYPE],
  [Line, LINE_NODE_TYPE],
  [Polyline, POLYLINE_NODE_TYPE],
  [Arc, ARC_NODE_TYPE],
]);

/** The same twelve names, for the read half's one-lookup rejection. */
const SHAPE_NODE_TYPE_NAMES: ReadonlySet<string> = new Set(
  SHAPE_NODE_TYPES.values(),
);

/**
 * The three §50 primitives that are only a stroke (`R-16`) — their `fill`
 * defaults to `"none"` where every other shape's defaults to `"inherit"`, and
 * their `stroke` is required where every other shape's is optional.
 */
const STROKE_ONLY_NODE_TYPES: ReadonlySet<string> = new Set([
  LINE_NODE_TYPE,
  POLYLINE_NODE_TYPE,
  ARC_NODE_TYPE,
]);

/** A finite, strictly positive number — every extent a shape carries (§85). */
function isPositive(value: number): boolean {
  return value > 0;
}

/** Any finite number: a sector's angles are unconstrained (§7b). */
function anyFinite(): boolean {
  return true;
}

/** An integer of at least `minimum` — a side or point count (§85). */
function isCountAtLeast(minimum: number): (value: number) => boolean {
  return (value: number): boolean =>
    Number.isInteger(value) && value >= minimum;
}

/**
 * {@link finiteOptions} for the fields a shape refuses at zero or below: a
 * corrupted extent is simply absent, and the class default applies.
 */
function positiveOptions(
  data: { readonly [key: string]: JsonValue },
  keys: readonly string[],
): Record<string, number> {
  const options: Record<string, number> = {};
  for (const key of keys) {
    const value = readFinite(data[key]);
    if (value !== undefined && value > 0) options[key] = value;
  }
  return options;
}

/** One positive number with a stated fallback. */
function positiveOr(value: JsonValue | undefined, fallback: number): number {
  const number_ = readFinite(value);
  return number_ !== undefined && number_ > 0 ? number_ : fallback;
}

/**
 * A parameter the shape's constructor requires, or a loud refusal (§79, §85).
 *
 * See {@link registerShapeSerializers} for why these are refused rather than
 * defaulted: a shape whose defining parameter the document does not carry is a
 * shape the document does not describe.
 *
 * @throws FourError `INVALID_APPLICATION_STATE`
 */
function requireShapeNumber(
  document: SceneNodeDocument,
  field: string,
  value: JsonValue | undefined,
  accepts: (value: number) => boolean,
): number {
  const number_ = readFinite(value);
  if (number_ === undefined || !accepts(number_)) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      `Scene document node ${JSON.stringify(document.id ?? null)} of type ${JSON.stringify(document.type)} carries no usable ${field}; that parameter is what makes the shape the shape, so it is refused rather than invented (§50, §79).`,
      { context: { node: document.id ?? null, type: document.type, field } },
    );
  }
  return number_;
}

/** What the §58 paint writer needs beyond the paint — see {@link paintJson}. */
interface PaintWriteContext {
  /** The node being written, for refusal messages. */
  readonly node: Node;
  /** The texture catalog a pattern's texture keys against (§77, §79). */
  readonly textures: SceneResourceCatalog<MaterialTexture> | undefined;
  /** The unknown-resource policy in force. */
  readonly policy: UnknownResourcePolicy;
}

/** What the §58 paint reader needs beyond the JSON — see {@link readPaint}. */
interface PaintReadContext {
  /** The document node being read, for refusal messages. */
  readonly document: SceneNodeDocument;
  /** The texture catalog a pattern's texture key resolves through. */
  readonly textures: SceneResourceCatalog<MaterialTexture> | undefined;
  /**
   * Whether object paints may be read at all — `false` when the document
   * names a material key, because the two tiers are exclusive
   * (`Shape2DOptions.material`): a hand-assembled document carrying both
   * restores the material tier, which is also what an unregistered build
   * would draw, so the picture does not depend on registration.
   */
  readonly objectPaints: boolean;
}

/**
 * The key a pattern paint's texture is written under, or `null` under
 * {@link UnknownResourcePolicy} `"skip"` — {@link resourceKeyJson}'s rule,
 * restated for the one resource a *paint* carries.
 *
 * @throws FourError `INVALID_APPLICATION_STATE` under the default policy
 */
function patternTextureJson(
  context: PaintWriteContext,
  texture: MaterialTexture,
): JsonValue {
  const key = context.textures?.keyOf?.(texture);
  if (key !== undefined) return key;
  if (context.policy === "skip") return null;
  throw new FourError(
    "INVALID_APPLICATION_STATE",
    `Node ${context.node.id} carries a §58 pattern paint whose texture no catalog names, so the document could not be loaded back; supply registerSceneNodeTypes's \`textures\` option, or pass { unknownResources: "skip" } to write a null reference (§79).`,
    { context: { node: context.node.id, field: "paint.texture" } },
  );
}

/**
 * A §58 paint as JSON — tagged by kind, exactly as the shape stores it. A
 * solid paint writes the byte-identical payload it wrote at R-16; the three
 * object forms (2026-08-29) carry their values whole, except a pattern's
 * texture, which is a *resource* and travels as a logical key
 * ({@link patternTextureJson}).
 */
function paintJson(
  paint: ResolvedPaint,
  context: PaintWriteContext,
): JsonValue {
  switch (paint.kind) {
    case "solid":
      return {
        kind: paint.kind,
        color: [paint.color[0], paint.color[1], paint.color[2], paint.color[3]],
        opacity: paint.opacity,
      };
    case "linear-gradient":
      return {
        kind: paint.kind,
        from: pairJson(paint.from.x, paint.from.y),
        to: pairJson(paint.to.x, paint.to.y),
        stops: stopsJson(paint.stops),
        opacity: paint.opacity,
      };
    case "radial-gradient":
      return {
        kind: paint.kind,
        center: pairJson(paint.center.x, paint.center.y),
        radius: paint.radius,
        stops: stopsJson(paint.stops),
        opacity: paint.opacity,
      };
    default:
      return {
        kind: paint.kind,
        texture: patternTextureJson(context, paint.texture),
        repeat: pairJson(paint.repeat.x, paint.repeat.y),
        offset: pairJson(paint.offset.x, paint.offset.y),
        opacity: paint.opacity,
      };
  }
}

/** A gradient's stops as JSON — offsets and colours, in order. */
function stopsJson(
  stops: readonly { offset: number; color: readonly number[] }[],
): JsonValue {
  return stops.map((stop) => ({
    offset: stop.offset,
    color: [stop.color[0], stop.color[1], stop.color[2], stop.color[3]],
  }));
}

/**
 * A §58 paint from a document, or `undefined` when it carries none this build
 * can draw.
 *
 * The reading rules, tier by tier:
 *
 * - a **solid** paint reads exactly as it has since R-16: every malformed
 *   field restores its default, the A-12/R-18 rule;
 * - an **object** paint (2026-08-29) is validated by the very support that
 *   will draw it — `resolveShapePaintSupport()`, the same slot the shape's
 *   own setters use — so the reader and the constructor can never disagree
 *   about what is legal. A build that has not registered the tier, a
 *   malformed paint, and a paint of an *unknown* kind all read as
 *   `undefined` (dropped): the build genuinely cannot honour them, and where
 *   a material key exists dropping leaves the shape in that material's
 *   colour, visible and recoverable. Where none exists the caller refuses
 *   loudly instead — see `registerShapeSerializers`;
 * - a pattern's **texture key** follows the resource rule, not the drop
 *   rule: a key this application's catalog does not publish is a distinct,
 *   fixable mistake and is refused naming it (`resolveResource`'s stance). A
 *   `null` texture (written under `"skip"`) drops the paint.
 */
function readPaint(
  value: JsonValue | undefined,
  context: PaintReadContext,
): ResolvedPaint | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const source = value as { readonly [key: string]: JsonValue };
  const kind = readString(source.kind);
  if (kind === "solid") {
    const color = readColorRGBA(source.color);
    if (color === undefined) return undefined;
    const opacity = readFinite(source.opacity);
    return {
      kind: "solid",
      color,
      opacity:
        opacity !== undefined && opacity >= 0 && opacity <= 1 ? opacity : 1,
    };
  }
  if (!context.objectPaints) return undefined;
  const support = resolveShapePaintSupport();
  if (support === null) return undefined;
  const candidate = objectPaintCandidate(kind, source, context);
  if (candidate === undefined) return undefined;
  try {
    return support.resolvePaint(
      `Scene document node ${JSON.stringify(context.document.id ?? null)} paint`,
      candidate,
    );
  } catch {
    // Malformed content inside a known kind — unsorted stops, a zero-length
    // axis — drops the paint, the same visible fallback as a malformed solid
    // colour.
    return undefined;
  }
}

/**
 * Assembles the structural candidate {@link readPaint} hands to the paint
 * support — arrays into points and stops, a texture key into the texture it
 * names — or `undefined` where the structure itself is missing.
 *
 * @throws FourError `INVALID_APPLICATION_STATE` for an unresolvable texture
 * key (the resource rule — see {@link readPaint})
 */
function objectPaintCandidate(
  kind: string | undefined,
  source: { readonly [key: string]: JsonValue },
  context: PaintReadContext,
): Paint | undefined {
  if (kind === "linear-gradient") {
    const from = readFinitePair(source.from);
    const to = readFinitePair(source.to);
    const stops = readStops(source.stops);
    if (from === undefined || to === undefined || stops === undefined) {
      return undefined;
    }
    return {
      kind,
      from: { x: from[0], y: from[1] },
      to: { x: to[0], y: to[1] },
      stops,
      ...paintOpacityOption(source.opacity),
    };
  }
  if (kind === "radial-gradient") {
    const center = readFinitePair(source.center);
    const radius = readFinite(source.radius);
    const stops = readStops(source.stops);
    if (center === undefined || radius === undefined || stops === undefined) {
      return undefined;
    }
    return {
      kind,
      center: { x: center[0], y: center[1] },
      radius,
      stops,
      ...paintOpacityOption(source.opacity),
    };
  }
  if (kind === "pattern") {
    const key = readString(source.texture);
    if (key === undefined) return undefined;
    const texture = context.textures?.get?.(key);
    if (texture === undefined) {
      const node = context.document.id ?? null;
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `Scene document node ${JSON.stringify(node)} carries a §58 pattern paint referencing the texture ${JSON.stringify(key)}, which no catalog resolves; supply the matching \`textures\` option (§77, §79).`,
        { context: { node, key, field: "paint.texture" } },
      );
    }
    const repeat = readFinitePair(source.repeat);
    const offset = readFinitePair(source.offset);
    return {
      kind,
      texture,
      ...(repeat === undefined
        ? {}
        : { repeat: { x: repeat[0], y: repeat[1] } }),
      ...(offset === undefined
        ? {}
        : { offset: { x: offset[0], y: offset[1] } }),
      ...paintOpacityOption(source.opacity),
    };
  }
  // An unknown kind — §58 lists paints no build draws yet (conic), and a
  // later build may know more. Dropped, exactly as R-16 decided.
  return undefined;
}

/** An opacity option spread — present only when the document's is usable. */
function paintOpacityOption(value: JsonValue | undefined): {
  opacity?: number;
} {
  const opacity = readFinite(value);
  return opacity !== undefined && opacity >= 0 && opacity <= 1
    ? { opacity }
    : {};
}

/** A gradient's stops from a document, or `undefined` where not an array. */
function readStops(value: JsonValue | undefined): GradientStop[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const stops: GradientStop[] = [];
  for (const entry of value as readonly JsonValue[]) {
    const source = record(entry);
    const offset = readFinite(source.offset);
    const color = readColorRGBA(source.color);
    if (offset === undefined || color === undefined) return undefined;
    stops.push({ offset, color });
  }
  return stops;
}

/** Whether a document value has an object paint's shape — any non-solid kind. */
function looksLikeObjectPaint(value: JsonValue | undefined): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const kind = readString((value as { readonly kind?: JsonValue }).kind);
  return kind !== undefined && kind !== "solid";
}

/** Whether a resolved fill or paint is a §58 object paint. */
function isObjectPaintValue(
  value: ResolvedShapeFill | ResolvedPaint | undefined,
): boolean {
  return (
    value !== undefined &&
    value !== "inherit" &&
    value !== "none" &&
    value.kind !== "solid"
  );
}

/** Four finite numbers, or `undefined` — a §60a linear-light RGBA. */
function readColorRGBA(
  value: JsonValue | undefined,
): [number, number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const channels: number[] = [];
  for (const entry of value as readonly JsonValue[]) {
    const channel = readFinite(entry);
    if (channel === undefined) return undefined;
    channels.push(channel);
  }
  return [channels[0], channels[1], channels[2], channels[3]];
}

/** A shape's fill as JSON: one of §58's two words, or a paint. */
function fillJson(
  fill: ResolvedShapeFill,
  context: PaintWriteContext,
): JsonValue {
  return fill === "inherit" || fill === "none"
    ? fill
    : paintJson(fill, context);
}

/**
 * A shape's fill from a document, defaulting to `fallback` — `"inherit"` for
 * the nine closed primitives, `"none"` for the three stroke-only ones.
 */
function readFill(
  value: JsonValue | undefined,
  fallback: ResolvedShapeFill,
  context: PaintReadContext,
): ResolvedShapeFill {
  const word = readString(value);
  if (word === "inherit" || word === "none") return word;
  return readPaint(value, context) ?? fallback;
}

/** A §58 `StrokeStyle` as JSON — every field, already resolved by the shape. */
function strokeJson(
  stroke: ResolvedStrokeStyle,
  context: PaintWriteContext,
): JsonValue {
  const payload: Record<string, JsonValue> = {
    width: stroke.width,
    alignment: stroke.alignment,
    lineCap: stroke.lineCap,
    lineJoin: stroke.lineJoin,
    miterLimit: stroke.miterLimit,
    dashOffset: stroke.dashOffset,
  };
  if (stroke.paint !== undefined) {
    payload.paint = paintJson(stroke.paint, context);
  }
  if (stroke.dash !== undefined) payload.dash = stroke.dash.slice();
  return payload;
}

/**
 * A §58 `StrokeStyle` from a document, or `null` when it carries none.
 *
 * `width` follows the required half of the reading rule — a stroke *is* its
 * width, and there is no width to invent — so a document that states a stroke
 * without a usable one is refused by name. Everything else follows the
 * defaulted half.
 *
 * @throws FourError `INVALID_APPLICATION_STATE`
 */
function readStroke(
  document: SceneNodeDocument,
  value: JsonValue | undefined,
  context: PaintReadContext,
): ResolvedStrokeStyle | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    if (!STROKE_ONLY_NODE_TYPES.has(document.type)) return null;
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      `Scene document node ${JSON.stringify(document.id ?? null)} of type ${JSON.stringify(document.type)} carries no stroke; that shape is only a stroke, so it is refused rather than invented (§50, §58, §79).`,
      {
        context: {
          node: document.id ?? null,
          type: document.type,
          field: "stroke",
        },
      },
    );
  }
  const source = value as { readonly [key: string]: JsonValue };
  const paint = readPaint(source.paint, context);
  const alignment = readString(source.alignment);
  const lineCap = readString(source.lineCap);
  const lineJoin = readString(source.lineJoin);
  const miterLimit = readFinite(source.miterLimit);
  const dash = readDash(source.dash);
  return {
    width: requireShapeNumber(
      document,
      "stroke.width",
      source.width,
      isPositive,
    ),
    ...(paint === undefined ? {} : { paint }),
    alignment:
      alignment === "inside" ||
      alignment === "outside" ||
      alignment === "center"
        ? alignment
        : "center",
    lineCap:
      lineCap === "round" || lineCap === "square" || lineCap === "butt"
        ? lineCap
        : "butt",
    lineJoin:
      lineJoin === "round" || lineJoin === "bevel" || lineJoin === "miter"
        ? lineJoin
        : "miter",
    miterLimit: miterLimit !== undefined && miterLimit >= 1 ? miterLimit : 4,
    ...(dash === undefined ? {} : { dash }),
    dashOffset: readFinite(source.dashOffset) ?? 0,
  };
}

/** A dash pattern from a document, or `undefined` for a solid stroke. */
function readDash(value: JsonValue | undefined): number[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const dash: number[] = [];
  let total = 0;
  for (const entry of value as readonly JsonValue[]) {
    const length = readFinite(entry);
    if (length === undefined || length < 0) return undefined;
    dash.push(length);
    total += length;
  }
  return total > 0 ? dash : undefined;
}

/** A polyline's chain, or a loud refusal (§79, §85) — at least two vertices. */
function requireChainPoints(
  document: SceneNodeDocument,
  value: JsonValue | undefined,
): Point2D[] {
  const points: Point2D[] = [];
  if (Array.isArray(value)) {
    for (const entry of value as readonly JsonValue[]) {
      const pair = readFinitePair(entry);
      if (pair === undefined) {
        points.length = 0;
        break;
      }
      points.push({ x: pair[0], y: pair[1] });
    }
  }
  if (points.length < 2) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      `Scene document node ${JSON.stringify(document.id ?? null)} of type ${JSON.stringify(document.type)} carries no usable point chain; a polyline is its points, so they are refused rather than invented (§50, §79).`,
      { context: { node: document.id ?? null, type: document.type } },
    );
  }
  return points;
}

/** One point, or a loud refusal (§79, §85) — a line is its two endpoints. */
function requireShapePoint(
  document: SceneNodeDocument,
  field: string,
  value: JsonValue | undefined,
): Point2D {
  const pair = readFinitePair(value);
  if (pair === undefined) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      `Scene document node ${JSON.stringify(document.id ?? null)} of type ${JSON.stringify(document.type)} carries no usable ${field}; that parameter is what makes the shape the shape, so it is refused rather than invented (§50, §79).`,
      { context: { node: document.id ?? null, type: document.type, field } },
    );
  }
  return { x: pair[0], y: pair[1] };
}

/** A polygon's ring as JSON — one `[x, y]` pair per vertex. */
function pointsJson(points: readonly Point2D[]): JsonValue {
  return points.map((point) => pairJson(point.x, point.y));
}

/**
 * A polygon's ring, or a loud refusal (§79, §85) — at least three vertices,
 * every coordinate finite, which is exactly what `Polygon` itself requires.
 *
 * @throws FourError `INVALID_APPLICATION_STATE`
 */
function requireShapePoints(
  document: SceneNodeDocument,
  value: JsonValue | undefined,
): Point2D[] {
  const points: Point2D[] = [];
  if (Array.isArray(value)) {
    for (const entry of value as readonly JsonValue[]) {
      const pair = readFinitePair(entry);
      if (pair === undefined) {
        points.length = 0;
        break;
      }
      points.push({ x: pair[0], y: pair[1] });
    }
  }
  if (points.length < 3) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      `Scene document node ${JSON.stringify(document.id ?? null)} of type ${JSON.stringify(document.type)} carries no usable point ring; a polygon is its points, so they are refused rather than invented (§50, §79).`,
      { context: { node: document.id ?? null, type: document.type } },
    );
  }
  return points;
}

/**
 * A §51 path as JSON: its fill rule and one compact array per command, tagged
 * with the letter SVG uses for it (`M`, `L`, `Q`, `C`, `A`, `Z`).
 *
 * Arrays rather than records because a path is the one payload here whose size
 * scales with the artwork — a glyph outline is hundreds of commands — and the
 * letters rather than the model's own kind names because they are what §50's
 * "SVG import/export compatibility" (`R-26`) will be reading and writing
 * anyway. `A` carries §51's *centre* parameterization plus an **end** angle;
 * see {@link registerShapeSerializers} for why the end angle and not the sweep.
 */
function pathJson(path: Path): JsonValue {
  const commands: JsonValue[] = [];
  for (const command of path.commands) {
    switch (command.kind) {
      case "move":
        commands.push(["M", command.x, command.y]);
        break;
      case "line":
        commands.push(["L", command.x, command.y]);
        break;
      case "quadratic":
        commands.push([
          "Q",
          command.controlX,
          command.controlY,
          command.x,
          command.y,
        ]);
        break;
      case "cubic":
        commands.push([
          "C",
          command.control1X,
          command.control1Y,
          command.control2X,
          command.control2Y,
          command.x,
          command.y,
        ]);
        break;
      case "arc":
        commands.push([
          "A",
          command.centerX,
          command.centerY,
          command.radiusX,
          command.radiusY,
          command.rotation,
          command.startAngle,
          command.startAngle + command.deltaAngle,
        ]);
        break;
      default:
        commands.push(["Z"]);
        break;
    }
  }
  return { fillRule: path.fillRule, commands };
}

/** The finite numbers of one encoded command, or `undefined` if it is not one. */
function commandNumbers(
  parts: readonly JsonValue[],
  count: number,
): readonly number[] | undefined {
  if (parts.length !== count + 1) return undefined;
  const values: number[] = [];
  for (let i = 1; i <= count; i += 1) {
    const value = parts[i];
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    values.push(value);
  }
  return values;
}

/**
 * A §51 path, replayed through the fluent builder (§79's validating parse).
 *
 * Through the builder and not around it: `Path` deliberately has no
 * `fromCommands`, because the builder *is* the well-formedness invariant every
 * reader of a path assumes (R-24's decision), and a document is exactly the
 * untrusted input that invariant exists for. So a malformed command list fails
 * the same way a malformed call sequence does — a `Z` closing nothing, an arc
 * of zero radius — and the refusal is translated into the §89 error the rest of
 * this module raises rather than escaping as a `RangeError` from three packages
 * away.
 *
 * An **absent or empty** command list is not malformed: it is the empty path,
 * which fills nothing and draws nothing, and is what a `PathShape` built from
 * `new Path()` writes.
 *
 * @throws FourError `INVALID_APPLICATION_STATE`
 */
function readPath(
  document: SceneNodeDocument,
  value: JsonValue | undefined,
): Path {
  const data = record(value);
  const path = new Path({
    fillRule: readString(data.fillRule) === "even-odd" ? "even-odd" : "nonzero",
  });
  const commands = Array.isArray(data.commands)
    ? (data.commands as readonly JsonValue[])
    : [];
  let index = 0;
  try {
    for (; index < commands.length; index += 1) {
      const entry = commands[index];
      const parts: readonly JsonValue[] = Array.isArray(entry)
        ? (entry as readonly JsonValue[])
        : [];
      const operation = parts[0];
      let numbers: readonly number[] | undefined;
      if (operation === "M" && (numbers = commandNumbers(parts, 2))) {
        path.moveTo(numbers[0], numbers[1]);
      } else if (operation === "L" && (numbers = commandNumbers(parts, 2))) {
        path.lineTo(numbers[0], numbers[1]);
      } else if (operation === "Q" && (numbers = commandNumbers(parts, 4))) {
        path.quadraticCurveTo(numbers[0], numbers[1], numbers[2], numbers[3]);
      } else if (operation === "C" && (numbers = commandNumbers(parts, 6))) {
        path.cubicCurveTo(
          numbers[0],
          numbers[1],
          numbers[2],
          numbers[3],
          numbers[4],
          numbers[5],
        );
      } else if (operation === "A" && (numbers = commandNumbers(parts, 7))) {
        // `counterclockwise` is the sign of the sweep the writer flattened into
        // the end angle: a clockwise whole turn is `end = start − 2π`, which
        // `arcSweep` recovers exactly through its early exit.
        path.ellipse(
          numbers[0],
          numbers[1],
          numbers[2],
          numbers[3],
          numbers[4],
          numbers[5],
          numbers[6],
          numbers[6] < numbers[5],
        );
      } else if (operation === "Z" && parts.length === 1) {
        path.close();
      } else {
        throw new RangeError(
          `command ${String(index)} is not a valid §51 path command`,
        );
      }
    }
  } catch (error) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      `Scene document node ${JSON.stringify(document.id ?? null)} of type ${JSON.stringify(document.type)} carries a path that is not well formed at command ${String(index)}: ${String(error)} (§51, §79).`,
      {
        context: { node: document.id ?? null, type: document.type, index },
        cause: error,
      },
    );
  }
  return path;
}

/**
 * The §79 node-type pair for §50's shape family — the nine classes `R-23`
 * shipped on 2026-08-09 (`Circle`, `Ellipse`, `Rectangle`, `RegularPolygon`,
 * `Polygon`, `Star`, `Sector`, `Ring`, `PathShape`).
 *
 * ```ts
 * const io = registerSceneNodeTypes({
 *   materials: resourceCatalog([["material/ink", ink]]),
 * });
 * ```
 *
 * Separated from {@link registerRenderSerializers} for
 * {@link registerPhysicsSerializers}'s reason and no other: nine classes and
 * the §51 path parser behind `PathShape` are a real bundle unit, and a 3D or
 * UI application that saves scenes should not carry the 2D vector stack to do
 * it (§91). {@link registerSceneNodeTypes} calls this, so an application that
 * wants everything still makes one call.
 *
 * ## What a shape document carries
 *
 * A **material key** (see the module header — a shape points at a material it
 * does not own), the two ordering fields, §49's two shadow flags, the
 * flattening `tolerance`, §58's `fill` and `stroke`, and the shape's own
 * parameters. There is deliberately **no geometry key**: a shape *derives* its
 * fill and stroke from those parameters and owns the result (§83), exactly as a
 * `Sprite` derives its quad, so the payload rebuilds it exactly and a document
 * that named one would be naming a resource the application never created.
 *
 * A **paint-derived** shape (the §58 object tier, 2026-08-29) writes **no
 * material key**, for the geometry key's exact reason: its material is
 * derived from the paints the payload carries whole, and the reader
 * re-derives it. The one resource inside a paint — a pattern's texture —
 * travels as a logical key against {@link SceneNodeTypeOptions.textures}.
 *
 * ## §58 is additive in both directions (`R-16`, 2026-08-09; object tier 2026-08-29)
 *
 * `fill` and `stroke` are written **only when they differ from the class's own
 * default** — `"inherit"`/`null` for the nine closed primitives, `"none"` for
 * the three stroke-only ones. So a shape that names no paint writes the
 * byte-identical document `R-23` wrote, and a document written before §58
 * existed restores a fill-only shape with no field missing. A paint this
 * build cannot draw — an unknown kind (§58's conic, or a later build's), a
 * malformed object paint, or any object paint in a build that never called
 * `registerShapePaints()` — is **dropped rather than refused** wherever a
 * material key exists to fall back to: the shape reloads in that material's
 * colour, visible and recoverable, where refusing the node would lose the
 * artwork entirely. A paint-derived document has no such fallback, so there
 * the drop becomes a loud `FourError` naming the paint and the registration
 * call — inventing a material the document never named is the substituted
 * triangle again. A paint the material cannot draw at all is a different
 * matter and *is* refused, the way a `Sprite` whose material key resolves to
 * a lit one is.
 *
 * ## Two reading rules, and where the line between them is
 *
 * §96's rule is that data from outside is filtered rather than trusted, and the
 * A-12/R-18 precedent is that a corrupted field restores its default rather than
 * taking the whole scene down. That applies to every field the class itself
 * defaults — `tolerance`, `radius`, `width`, `height`, `rotation`, a
 * rectangle's corner radius, the ordering and shadow fields.
 *
 * The other rule covers the parameters a shape's constructor makes
 * **required**, because they *are* the shape: a regular polygon's side count, a
 * star's two radii, a sector's angles, a ring's hole, a polygon's points, a
 * path's commands. A document that does not carry one of those, carries one the
 * class would refuse, or carries a pair that contradicts itself, is refused
 * loudly with a `FourError` — the same answer {@link registerRenderSerializers}
 * gives a missing material key, and for the same reason: the alternative is to
 * invent a shape the document never described and hand it back as if it had.
 * A substituted triangle looks like a bug in the author's data; a refusal names
 * the node, the type, and the field.
 *
 * ## Arcs, and the one number that is not bit-exact
 *
 * §51's arc command stores a signed **sweep**; §51's builder — the only parse
 * that preserves the well-formedness every reader assumes, which is why `Path`
 * has no `fromCommands` — takes a start angle and an **end** angle. So an arc
 * is written as `[startAngle, endAngle]` and read back through `ellipse(…)`,
 * which recomputes the sweep. The recomputed sweep can differ from the original
 * by a few ulps when the start angle is large beside the sweep (measured: up to
 * 1.8e-15 rad over 200 000 samples), because `fl(fl(s + d) − s)` is not `d` in
 * general and no choice of end angle can make it one.
 *
 * Writing the **end** angle rather than the sweep is what keeps the *document*
 * exact anyway: `fl(s + arcSweep(s, e))` is `e` for every pair measured
 * (0 mismatches in 500 000), so a document round-trips byte for byte even
 * though the path's stored sweep may move in its last bit. Whole turns and zero
 * sweeps are exact in both, since `arcSweep` returns ±2π and 0 by early exit.
 * Nothing else in the family is affected: the eight parametric shapes store
 * their own parameters and restore them bit for bit.
 *
 * Matched by **exact class identity**, like every other pair here.
 *
 * @param options the material catalog and the unknown-resource policy
 * @returns the writer and reader halves; pass both or neither
 */
export function registerShapeSerializers(
  options: SceneNodeTypeOptions = {},
): SceneNodeTypeSupport {
  const materials = options.materials;
  const textures = options.textures;
  const policy = options.unknownResources ?? "throw";
  return withHitTestMode({
    write: {
      nodeTypeOf: (node: Node): string | undefined =>
        SHAPE_NODE_TYPES.get(node.constructor as ShapeClass),
      nodeDataOf: (node: Node): JsonValue | undefined => {
        const constructor = node.constructor as ShapeClass;
        const type = SHAPE_NODE_TYPES.get(constructor);
        if (type === undefined) return undefined;
        const shape = node as Shape2D<Material>;
        const paintContext: PaintWriteContext = { node, textures, policy };
        const payload: Record<string, JsonValue> = {
          // A paint-derived shape (§58's object tier, 2026-08-29) writes no
          // material key, for the geometry key's exact reason: its material
          // is derived from the paints this payload carries whole, and the
          // reader re-derives it. Every other shape writes the key it
          // always has, in the position it always had.
          ...(shape.paintDerived
            ? {}
            : {
                material: resourceKeyJson<Material>(
                  node,
                  "material",
                  shape.material,
                  materials,
                  policy,
                ),
              }),
          tolerance: shape.tolerance,
          renderLayer: shape.renderLayer,
          renderOrder: shape.renderOrder,
          ...renderableFlagsJson(shape),
          ...scissorJson(shape),
        };
        // §58's two fields are written **only when they are not this class's
        // default** (`R-16`, 2026-08-09). That is what keeps the addition
        // additive in both directions: a shape authored before §58 existed
        // writes the byte-identical document it wrote at `R-23`, and a
        // pre-`R-16` document reads back as `fill: "inherit"`, `stroke: null`.
        const defaultFill = STROKE_ONLY_NODE_TYPES.has(type)
          ? "none"
          : "inherit";
        if (shape.fill !== defaultFill) {
          payload.fill = fillJson(shape.fill, paintContext);
        }
        if (shape.stroke !== null) {
          payload.stroke = strokeJson(shape.stroke, paintContext);
        }
        if (constructor === Circle) {
          payload.radius = (node as Circle<Material>).radius;
        } else if (constructor === Ellipse) {
          const ellipse = node as Ellipse<Material>;
          payload.radiusX = ellipse.radiusX;
          payload.radiusY = ellipse.radiusY;
          payload.startAngle = ellipse.startAngle;
        } else if (constructor === Rectangle) {
          const rectangle = node as Rectangle<Material>;
          payload.width = rectangle.width;
          payload.height = rectangle.height;
          payload.radius = rectangle.radius;
        } else if (constructor === RegularPolygon) {
          const polygon = node as RegularPolygon<Material>;
          payload.sides = polygon.sides;
          payload.radius = polygon.radius;
          payload.startAngle = polygon.startAngle;
        } else if (constructor === Polygon) {
          payload.points = pointsJson((node as Polygon<Material>).points);
        } else if (constructor === Star) {
          const star = node as Star<Material>;
          payload.points = star.points;
          payload.innerRadius = star.innerRadius;
          payload.outerRadius = star.outerRadius;
          payload.startAngle = star.startAngle;
        } else if (constructor === Sector) {
          const sector = node as Sector<Material>;
          payload.radius = sector.radius;
          payload.startAngle = sector.startAngle;
          payload.endAngle = sector.endAngle;
        } else if (constructor === Ring) {
          const ring = node as Ring<Material>;
          payload.innerRadius = ring.innerRadius;
          payload.outerRadius = ring.outerRadius;
        } else if (constructor === Line) {
          const line = node as Line<Material>;
          payload.start = pairJson(line.start.x, line.start.y);
          payload.end = pairJson(line.end.x, line.end.y);
        } else if (constructor === Polyline) {
          payload.points = pointsJson((node as Polyline<Material>).points);
        } else if (constructor === Arc) {
          const arc = node as Arc<Material>;
          payload.radius = arc.radius;
          payload.startAngle = arc.startAngle;
          payload.endAngle = arc.endAngle;
        } else {
          payload.path = pathJson((node as PathShape<Material>).path);
        }
        return payload;
      },
    },
    read: {
      nodeFactory: (document: SceneNodeDocument): Node | undefined => {
        if (!SHAPE_NODE_TYPE_NAMES.has(document.type)) return undefined;
        const data = record(document.data);
        // The two tiers are exclusive (`Shape2DOptions.material`): a material
        // key selects the material tier and object paints are not read at
        // all — the same picture an unregistered build draws, so what a
        // document restores never depends on registration. Without a key the
        // paints must carry the shape, or the refusal below names why not.
        const materialKey = readString(data.material);
        const paintContext: PaintReadContext = {
          document,
          textures,
          objectPaints: materialKey === undefined,
        };
        const stroke = readStroke(document, data.stroke, paintContext);
        const fill = readFill(
          data.fill,
          STROKE_ONLY_NODE_TYPES.has(document.type) ? "none" : "inherit",
          paintContext,
        );
        const painted =
          isObjectPaintValue(fill) || isObjectPaintValue(stroke?.paint);
        if (materialKey === undefined && !painted) {
          const strokeData = record(data.stroke);
          if (
            looksLikeObjectPaint(data.fill) ||
            looksLikeObjectPaint(strokeData.paint)
          ) {
            // A paint-derived document whose paint this build cannot restore
            // has no material to fall back to — dropping would invent a
            // material the document never named (the substituted triangle),
            // so the refusal names the paint and the fix instead.
            const node = document.id ?? null;
            throw new FourError(
              "INVALID_APPLICATION_STATE",
              `Scene document node ${JSON.stringify(node)} of type ${JSON.stringify(document.type)} derives its material from a §58 paint this build cannot restore, and names no material to fall back to; call registerShapePaints() at startup, or re-save from a build that could draw it (§58, §79).`,
              { context: { node, type: document.type, field: "fill" } },
            );
          }
        }
        const shared = {
          ...(painted
            ? {}
            : {
                material: resolveResource<Material>(
                  document,
                  "material",
                  materials,
                ),
              }),
          ...positiveOptions(data, ["tolerance"]),
          ...finiteOptions(data, ["renderLayer", "renderOrder"]),
          ...readRenderableFlags(data),
          ...readScissor(data),
          fill,
          stroke,
        };
        const strokeOnly = { ...shared, stroke: stroke as ResolvedStrokeStyle };
        switch (document.type) {
          case CIRCLE_NODE_TYPE:
            return new Circle({
              ...shared,
              ...positiveOptions(data, ["radius"]),
            });
          case ELLIPSE_NODE_TYPE:
            return new Ellipse({
              ...shared,
              ...positiveOptions(data, ["radiusX", "radiusY"]),
              ...finiteOptions(data, ["startAngle"]),
            });
          case RECTANGLE_NODE_TYPE: {
            const width = positiveOr(data.width, 1);
            const height = positiveOr(data.height, 1);
            const radius = readFinite(data.radius) ?? 0;
            return new Rectangle({
              ...shared,
              width,
              height,
              // The one cross-checked field with a default: a corner radius the
              // extents cannot hold restores square corners, which every
              // rectangle can be, rather than refusing the node.
              radius:
                radius >= 0 && radius <= Math.min(width, height) / 2
                  ? radius
                  : 0,
            });
          }
          case REGULAR_POLYGON_NODE_TYPE:
            return new RegularPolygon({
              ...shared,
              sides: requireShapeNumber(
                document,
                "sides",
                data.sides,
                isCountAtLeast(3),
              ),
              ...positiveOptions(data, ["radius"]),
              ...finiteOptions(data, ["startAngle"]),
            });
          case POLYGON_NODE_TYPE:
            return new Polygon({
              ...shared,
              points: requireShapePoints(document, data.points),
            });
          case STAR_NODE_TYPE: {
            const innerRadius = requireShapeNumber(
              document,
              "innerRadius",
              data.innerRadius,
              isPositive,
            );
            return new Star({
              ...shared,
              points: requireShapeNumber(
                document,
                "points",
                data.points,
                isCountAtLeast(2),
              ),
              innerRadius,
              outerRadius: requireShapeNumber(
                document,
                "outerRadius",
                data.outerRadius,
                (value) => value > innerRadius,
              ),
              ...finiteOptions(data, ["startAngle"]),
            });
          }
          case SECTOR_NODE_TYPE:
            return new Sector({
              ...shared,
              ...positiveOptions(data, ["radius"]),
              startAngle: requireShapeNumber(
                document,
                "startAngle",
                data.startAngle,
                anyFinite,
              ),
              endAngle: requireShapeNumber(
                document,
                "endAngle",
                data.endAngle,
                anyFinite,
              ),
            });
          case RING_NODE_TYPE: {
            const innerRadius = requireShapeNumber(
              document,
              "innerRadius",
              data.innerRadius,
              isPositive,
            );
            return new Ring({
              ...shared,
              innerRadius,
              outerRadius: requireShapeNumber(
                document,
                "outerRadius",
                data.outerRadius,
                (value) => value > innerRadius,
              ),
            });
          }
          case LINE_NODE_TYPE:
            return new Line({
              ...strokeOnly,
              start: requireShapePoint(document, "start", data.start),
              end: requireShapePoint(document, "end", data.end),
            });
          case POLYLINE_NODE_TYPE:
            return new Polyline({
              ...strokeOnly,
              points: requireChainPoints(document, data.points),
            });
          case ARC_NODE_TYPE:
            return new Arc({
              ...strokeOnly,
              ...positiveOptions(data, ["radius"]),
              startAngle: requireShapeNumber(
                document,
                "startAngle",
                data.startAngle,
                anyFinite,
              ),
              endAngle: requireShapeNumber(
                document,
                "endAngle",
                data.endAngle,
                anyFinite,
              ),
            });
          default:
            return new PathShape({
              ...shared,
              path: readPath(document, data.path),
            });
        }
      },
    },
  });
}

/**
 * Refuses a material a {@link Text} cannot be built from (§56, §57).
 *
 * Checked on §57's `kind` discriminant rather than with `instanceof`, exactly as
 * {@link requireSpriteMaterial} is and for the same reason: the pipeline is
 * chosen by the material's kind, never by the node's class. A label draws
 * through the **unlit** pipeline with the atlas as §57's `map` and the ink
 * colour as §57's `color` (see `text-node.ts`), so a key resolving to a
 * `"sprite"` or `"standard"` material is a run-time type error that would draw
 * nothing.
 *
 * @throws FourError `INVALID_APPLICATION_STATE`
 */
function requireUnlitMaterial(
  document: SceneNodeDocument,
  material: Material,
): UnlitMaterial {
  if (material.kind === "unlit") {
    // Sound behind the discriminant, which is §57's own contract for what a
    // material *is* — the same read `buildRenderList` makes.
    return material as UnlitMaterial;
  }
  const node = document.id ?? null;
  throw new FourError(
    "INVALID_APPLICATION_STATE",
    `Scene document node ${JSON.stringify(node)} of type ${JSON.stringify(document.type)} resolves to a ${JSON.stringify(material.kind)} material, but a text node draws an "unlit" material — it samples that material's glyph atlas as \`map\` (§56, §57).`,
    { context: { node, type: document.type, kind: material.kind } },
  );
}

/**
 * The §79 node-type pair for §49/§56's `Text` (R-28, 2026-08-13).
 *
 * ```ts
 * const io = registerSceneNodeTypes({
 *   atlas: buildGlyphAtlas(),
 *   materials: resourceCatalog([["material/ink", ink]]),
 * });
 * ```
 *
 * ## What a text document carries
 *
 * A `material` key, `text`, `size`, `letterSpacing`, `align`, `renderLayer`,
 * `renderOrder`, and the four drawable boolean flags — and **no geometry key**, for
 * `Sprite`'s reason: a `Text` derives its glyph quads from the four fields above
 * and owns them, so that payload rebuilds the geometry exactly.
 *
 * The **font is not in the document**, for the reason a `Label`'s is not
 * (module header): a `GlyphAtlas` is a loaded resource, and §79 references
 * resources rather than inlining them. It arrives through
 * {@link SceneNodeTypeOptions.atlas} — the option that already exists for
 * labels, reused rather than duplicated, so an application that draws both
 * passes one atlas and gets both back.
 *
 * ## Why a missing atlas is refused rather than defaulted
 *
 * A `Label` restored without an atlas measures `0 × 0`, which is what a label
 * with no atlas *is*. A `Text` has no such state: its constructor requires a
 * font, because there is no layout without one and no honest empty face to
 * substitute. So a document naming a text node loaded with no `atlas` option
 * throws, in the same voice and with the same fix-naming shape `resolveResource`
 * uses for an unresolvable material key. Inventing a
 * built-in face here would be worse than either: it would reload someone's
 * scene in a font they never chose and never asked about.
 *
 * ## Separated from the other pairs, and what that buys
 *
 * A pair of its own for {@link registerShapeSerializers}'s reason: registering
 * it is what pulls `Text` — and with it `@fourjs/text`'s `layoutText` — into a
 * bundle, and an application whose scenes carry no text should not pay for the
 * layout engine to save one. {@link registerSceneNodeTypes} calls it, so an
 * application that wants everything still makes one call.
 *
 * Matched by **exact class identity**, like every other pair here.
 *
 * @param options the glyph atlas restored text nodes are given, and the §79
 * material catalog they resolve through
 * @returns the writer and reader halves; pass both or neither
 */
export function registerTextSerializers(
  options: SceneNodeTypeOptions = {},
): SceneNodeTypeSupport {
  const atlas = options.atlas;
  const materials = options.materials;
  const policy = options.unknownResources ?? "throw";
  return withHitTestMode({
    write: {
      nodeTypeOf: (node: Node): string | undefined =>
        node.constructor === Text ? TEXT_NODE_TYPE : undefined,
      nodeDataOf: (node: Node): JsonValue | undefined => {
        if (node.constructor !== Text) return undefined;
        const text = node as Text;
        return {
          material: resourceKeyJson<Material>(
            node,
            "material",
            text.material,
            materials,
            policy,
          ),
          text: text.text,
          size: text.size,
          letterSpacing: text.letterSpacing,
          align: text.align,
          renderLayer: text.renderLayer,
          renderOrder: text.renderOrder,
          ...renderableFlagsJson(text),
          ...scissorJson(text),
        };
      },
    },
    read: {
      nodeFactory: (document: SceneNodeDocument): Node | undefined => {
        if (document.type !== TEXT_NODE_TYPE) return undefined;
        if (atlas === undefined) {
          throw new FourError(
            "INVALID_APPLICATION_STATE",
            `Scene document node ${JSON.stringify(document.id ?? null)} is a text node, but no glyph atlas was supplied to restore it with; pass registerSceneNodeTypes's \`atlas\` option (§56, §79).`,
            { context: { node: document.id ?? null, type: document.type } },
          );
        }
        const data = record(document.data);
        const material = requireUnlitMaterial(
          document,
          resolveResource<Material>(document, "material", materials),
        );
        // §85, the `Sprite` precedent: the class refuses a non-positive size
        // and an unknown alignment, so a payload carrying one restores the
        // class default rather than taking the whole scene down over one field.
        const size = readFinite(data.size);
        const align = readString(data.align);
        return new Text(atlas, material, {
          ...finiteOptions(data, [
            "letterSpacing",
            "renderLayer",
            "renderOrder",
          ]),
          ...readRenderableFlags(data),
          ...readScissor(data),
          text: readString(data.text) ?? "",
          ...(size !== undefined && size > 0 ? { size } : {}),
          ...(align === "left" || align === "center" || align === "right"
            ? { align: align satisfies TextAlign }
            : {}),
        });
      },
    },
  });
}

/**
 * Chains node-type pairs into one, first answer winning (2026-08-07).
 *
 * The composition {@link registerSceneNodeTypes} performs on the pairs above,
 * exported because an application adding its own classes performs exactly the
 * same one:
 *
 * ```ts
 * const io = registerSceneNodeTypes();
 * const write = composeSceneNodeTypes(myOwnPair, io).write;
 * ```
 *
 * The two write halves fall through on **different tests**, and the difference
 * matters: a node type is a string or nothing, but §79 node *data* is one opaque
 * JSON value and `null` is a legitimate one — so `nodeDataOf` falls through on
 * `undefined` only, never on a falsy answer. That is the same rule
 * `serializeScene` applies to a writer's answer.
 *
 * @param supports the pairs to try, in order
 * @returns one pair delegating to them
 */
export function composeSceneNodeTypes(
  ...supports: readonly SceneNodeTypeSupport[]
): SceneNodeTypeSupport {
  return {
    write: {
      nodeTypeOf: (node: Node): string | undefined => {
        for (const support of supports) {
          const type = support.write.nodeTypeOf(node);
          if (type !== undefined) return type;
        }
        return undefined;
      },
      nodeDataOf: (node: Node): JsonValue | undefined => {
        for (const support of supports) {
          const data = support.write.nodeDataOf(node);
          if (data !== undefined) return data;
        }
        return undefined;
      },
    },
    read: {
      nodeFactory: (document: SceneNodeDocument): Node | undefined => {
        for (const support of supports) {
          const node = support.read.nodeFactory(document);
          if (node !== undefined) return node;
        }
        return undefined;
      },
    },
  };
}

/**
 * Registers the §6a physics components on `components` and returns it
 * (§23–§25, §79, PH-17 — 2026-08-06; joined by §12's swept character
 * controller, `PH-11b`, 2026-08-21).
 *
 * ```ts
 * import { registerPhysicsSerializers } from "fourJS";
 * import { createDefaultComponentSerializers } from "@fourjs/serialization";
 *
 * const components = registerPhysicsSerializers(createDefaultComponentSerializers());
 * ```
 *
 * Separated from {@link registerSceneNodeTypes} because a headless simulation
 * has physics and no widgets, and pulling `@fourjs/ui` and `@fourjs/text` into its
 * bundle to save a scene would be a real cost for nothing (§91's tree-shaking
 * requirement on the umbrella). {@link registerSceneNodeTypes} calls this, so an
 * application that wants everything still makes one call.
 *
 * The serializers themselves live in `@fourjs/physics` — this function only
 * performs the registration, which is the one act neither that package nor
 * `@fourjs/serialization` may perform alone. What a physics document carries (the
 * authored state, never the solve) is documented there; the boundary worth
 * repeating here is that **reloading a scene is not restoring a simulation**.
 * Registering a reloaded node with a world is a separate, explicit step:
 *
 * ```ts
 * const root = instantiateScene(decodeSceneDocument(text), io.components, io.read);
 * for (const node of bodyNodes(root)) world.addBody(node);
 * ```
 *
 * and a save taken while the solver held contacts reloads to the same *scene*,
 * not to the same *solve* — the §79/§34 line `tests/integration` measures.
 *
 * @param components the registry to register on; returned for chaining
 * @throws FourError `INVALID_APPLICATION_STATE` if either type name is already
 * registered — `ComponentSerializerRegistry.register` refuses duplicates, so
 * calling this twice on one registry is an error rather than a silent overwrite.
 */
export function registerPhysicsSerializers(
  components: ComponentSerializerRegistry,
): ComponentSerializerRegistry {
  return (
    components
      .register(RigidBody, RIGID_BODY_SERIALIZER)
      .register(Collider, COLLIDER_SERIALIZER)
      // §12's solver-backed character controller (`PH-11b`, 2026-08-21). It
      // registers **here** rather than beside `@fourjs/motion`'s plain
      // `CharacterController` in `registerSceneNodeTypes`, because the split
      // this function exists to make is by *package*, not by section: the
      // component lives in `@fourjs/physics` and its serializer with it, so a
      // headless simulation that saves a scene carries its characters and a
      // widget-only application still pulls in neither.
      .register(SweptCharacterController, SWEPT_CHARACTER_CONTROLLER_SERIALIZER)
      // RFC 0011 soft bodies: descriptor and tuning only, never the solve.
      .register(SoftBody, SOFT_BODY_SERIALIZER)
  );
}

/**
 * Everything a §79 round trip of an engine-authored scene needs: the component
 * serializers, the node-type writer, and the node factory (A-14, PH-17).
 *
 * The one call an application makes: the §73 widgets
 * ({@link registerUISerializers}) and the drawing tier
 * ({@link registerRenderSerializers}), chained by
 * {@link composeSceneNodeTypes}. Chaining an application's own classes on top is
 * the same call:
 *
 * ```ts
 * const io = registerSceneNodeTypes({ atlas, geometries, materials });
 * const document = serializeScene(
 *   root,
 *   io.components,
 *   composeSceneNodeTypes(myOwnPair, io).write,
 * );
 * ```
 *
 * `restoreNodeId` is not needed by any of the widgets: each takes its id through
 * {@link UIWidgetOptions} (which extends `NodeOptions`), so a restored widget is
 * constructed with the id it was saved under (A-17). The drawing-tier classes do
 * **not** take an id — a `Renderable` is constructed from its geometry and
 * material — so those restore through the `restoreNodeId` path
 * `instantiateScene` already applies to any factory-built node whose id differs
 * from the document's.
 *
 * @param options the glyph atlas restored labels are given, and the §79
 * resource catalogs the drawables resolve through
 * @returns a fresh registry and the matching writer/reader halves
 */
export function registerSceneNodeTypes(
  options: SceneNodeTypeOptions = {},
): SceneSerializationSupport {
  const components = createDefaultComponentSerializers();
  components.register(MotionComponent, MOTION_COMPONENT_SERIALIZER);
  // §12's controller, added 2026-08-07: without it a scene carrying one could
  // not be saved at all, because an unregistered component throws (A-15). Its
  // payload is empty by design — see `KINEMATIC_CONTROLLER_SERIALIZER`.
  components.register(KinematicController, KINEMATIC_CONTROLLER_SERIALIZER);
  // §44's camera rigs and §12's look-at constraint, added 2026-08-13 with the
  // system that drives them. Their live `Node` targets are dropped on write and
  // re-bound by the application — see the serializers in `@fourjs/motion`.
  components.register(OrbitRig, ORBIT_RIG_SERIALIZER);
  components.register(FollowRig, FOLLOW_RIG_SERIALIZER);
  components.register(LookAtConstraint, LOOK_AT_CONSTRAINT_SERIALIZER);
  // §12's character controller and §44's first-person look, added 2026-08-21
  // in the same batch as the components themselves (the one-packet rule). The
  // character carries its vertical motion state and drops its per-frame move
  // intent — see the serializers in `@fourjs/motion`.
  components.register(CharacterController, CHARACTER_CONTROLLER_SERIALIZER);
  components.register(FirstPersonLook, FIRST_PERSON_LOOK_SERIALIZER);
  // §44's camera shake (R-36/R-37 residue): trauma is scene state and must
  // survive a save, the way `CHARACTER_CONTROLLER_SERIALIZER` keeps
  // `verticalVelocity`. The serializer lives in `@fourjs/motion` beside the
  // class.
  components.register(CameraShake, CAMERA_SHAKE_SERIALIZER);
  // §54's morph weights (RFC 0003, 2026-08-28), registered in the same packet
  // that shipped the component — the one-packet rule the enumerating test
  // below this module enforces. The serializer lives in `@fourjs/scene` beside
  // the class, declared against the same structural shape the motion
  // serializers use.
  components.register(MorphWeights, MORPH_WEIGHTS_SERIALIZER);
  // §8's node-level space declaration (PH-12 remainder). Class and
  // serializer land together so a scene carrying one can be saved (A-15).
  components.register(NodeSpace, NODE_SPACE_SERIALIZER);
  registerPhysicsSerializers(components);
  return {
    components,
    ...composeSceneNodeTypes(
      registerUISerializers(options),
      registerRenderSerializers(options),
      registerShapeSerializers(options),
      // §49/§56's `Text`, added 2026-08-13 with the node (R-28). Last in the
      // chain because it is the newest and the order is only a fall-through
      // order — every pair matches on exact class identity, so no two of them
      // can claim the same node.
      registerTextSerializers(options),
    ),
  };
}

/**
 * Re-exported so an application that builds its own factory can still restore
 * ids the way this module's does not have to (§79, A-17).
 *
 * A `nodeFactory` that constructs a class taking no `id` option writes the
 * saved id afterwards with this; `@fourjs/serialization` calls it for exactly
 * that case.
 */
export { restoreNodeId };
