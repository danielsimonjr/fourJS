/**
 * §79 round trips of the engine's own node classes and components (A-14,
 * PH-17 — 2026-08-06).
 *
 * The gate: build a widget tree with a laid-out box model, layout configuration,
 * §75 accessibility, and a `MotionComponent`; save it; push it through JSON
 * *text*; reload it — and get the same **classes** back with the same state,
 * not a tree of bare `Group`s. Before this module a widget tree round-tripped
 * as `Node` state only, contradicting §73's "UI objects are scene nodes and
 * therefore share … serialization", and a `MotionComponent` was dropped
 * silently.
 */

import { isFourError } from "@fourjs/core";
import { planeGeometry, type BufferGeometry } from "@fourjs/geometry";
import {
  LitMaterial,
  SpriteMaterial,
  UnlitMaterial,
  type Material,
} from "@fourjs/materials";
import {
  CameraShake,
  FollowRig,
  KinematicController,
  LookAtConstraint,
  MotionComponent,
  OrbitRig,
  SpringDamper,
} from "@fourjs/motion";
import { Vector3 } from "@fourjs/math";
import { Collider, RigidBody, SweptCharacterController } from "@fourjs/physics";
import { Mesh, Renderable, Sprite, Texture } from "@fourjs/render";
import {
  Bone,
  DirectionalLight,
  HemisphereLight,
  MorphWeights,
  NodeSpace,
  PointLight,
  Skeleton,
  SpotLight,
  Group,
  OrthographicCamera,
  ScreenCamera,
  PerspectiveCamera,
  Scene,
} from "@fourjs/scene";
import {
  ComponentSerializerRegistry,
  createDefaultComponentSerializers,
  decodeSceneDocument,
  encodeSceneDocument,
  instantiateScene,
  serializeScene,
} from "@fourjs/serialization";
import { SoftBody } from "@fourjs/physics-soft";
import { buildGlyphAtlas } from "@fourjs/text";
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
} from "@fourjs/ui";
import { describe, expect, it } from "vitest";

import * as four from "../src/index.js";
import {
  BONE_NODE_TYPE,
  BUTTON_NODE_TYPE,
  CHECKBOX_NODE_TYPE,
  DIRECTIONAL_LIGHT_NODE_TYPE,
  HEMISPHERE_LIGHT_NODE_TYPE,
  POINT_LIGHT_NODE_TYPE,
  SPOT_LIGHT_NODE_TYPE,
  IMAGE_NODE_TYPE,
  LABEL_NODE_TYPE,
  ORTHOGRAPHIC_CAMERA_NODE_TYPE,
  SCREEN_CAMERA_NODE_TYPE,
  PANEL_NODE_TYPE,
  PERSPECTIVE_CAMERA_NODE_TYPE,
  PROGRESS_NODE_TYPE,
  RADIO_BUTTON_NODE_TYPE,
  MESH_NODE_TYPE,
  RENDERABLE_NODE_TYPE,
  SLIDER_NODE_TYPE,
  SPRITE_NODE_TYPE,
  TOGGLE_NODE_TYPE,
  composeSceneNodeTypes,
  registerPhysicsSerializers,
  registerRenderSerializers,
  registerSceneNodeTypes,
  registerUISerializers,
  resourceCatalog,
} from "../src/scene-serializers.js";

const atlas = buildGlyphAtlas();

/** A HUD with one label and one button holding its own label. */
function buildTree(): Panel {
  const root = new Panel({
    name: "hud",
    width: 320,
    height: 200,
    minWidth: 100,
    maxHeight: 400,
    padding: 8,
    margin: { top: 1, right: 2, bottom: 3, left: 4 },
    layout: {
      type: "flex",
      direction: "column",
      gap: 6,
      justify: "space-between",
      align: "stretch",
    },
  });

  const caption = new Label({
    name: "caption",
    text: "Score: 0",
    atlas,
    size: 16,
    letterSpacing: 0.5,
    grow: 1,
  });

  const start = new Button({
    name: "start",
    width: 160,
    height: 40,
    focusable: true,
    disabled: true,
    accessibility: {
      role: "button",
      label: "Start simulation",
      description: "Begins the run",
      tabIndex: 3,
    },
  });
  start.anchor.set(0.5, 0.25);
  start.pivot.set(1, 0);
  start.offset.set(12, -4);
  start.add(new Label({ name: "start-text", text: "Start", atlas, size: 12 }));

  root.add(caption, start);
  return root;
}

describe("registerSceneNodeTypes — §73 widgets survive §79", () => {
  it("round-trips classes, box model, layout, and accessibility through text", () => {
    const root = buildTree();
    root.layout();
    const io = registerSceneNodeTypes({ atlas });

    const document = serializeScene(root, io.components, io.write);
    const reloaded = instantiateScene(
      decodeSceneDocument(encodeSceneDocument(document)),
      io.components,
      io.read,
    );

    expect(reloaded).toBeInstanceOf(Panel);
    const panel = reloaded as Panel;
    expect(panel.name).toBe("hud");
    expect(panel.width).toBe(320);
    expect(panel.height).toBe(200);
    expect(panel.minWidth).toBe(100);
    expect(panel.maxHeight).toBe(400);
    expect(panel.padding.top).toBe(8);
    expect({
      top: panel.margin.top,
      right: panel.margin.right,
      bottom: panel.margin.bottom,
      left: panel.margin.left,
    }).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
    expect(panel.layoutType).toBe("flex");
    expect(panel.direction).toBe("column");
    expect(panel.gap).toBe(6);
    expect(panel.justify).toBe("space-between");
    expect(panel.align).toBe("stretch");

    const [caption, start] = panel.children;
    expect(caption).toBeInstanceOf(Label);
    expect((caption as Label).text).toBe("Score: 0");
    expect((caption as Label).size).toBe(16);
    expect((caption as Label).letterSpacing).toBe(0.5);
    expect((caption as Label).grow).toBe(1);
    expect((caption as Label).atlas).toBe(atlas);

    expect(start).toBeInstanceOf(Button);
    const button = start as Button;
    expect(button.width).toBe(160);
    expect(button.focusable).toBe(true);
    expect(button.disabled).toBe(true);
    expect(button.accessibility).toEqual({
      role: "button",
      label: "Start simulation",
      description: "Begins the run",
      tabIndex: 3,
    });
    expect(button.anchor.x).toBe(0.5);
    expect(button.anchor.y).toBe(0.25);
    expect(button.pivot.x).toBe(1);
    expect(button.offset.x).toBe(12);
    expect(button.offset.y).toBe(-4);
    expect(button.children[0]).toBeInstanceOf(Label);
    expect((button.children[0] as Label).text).toBe("Start");
  });

  it("is textually idempotent — the P11-1 round-trip gate", () => {
    const root = buildTree();
    root.layout();
    const io = registerSceneNodeTypes({ atlas });

    const first = encodeSceneDocument(
      serializeScene(root, io.components, io.write),
    );
    const reloaded = instantiateScene(
      decodeSceneDocument(first),
      io.components,
      io.read,
    );
    const second = encodeSceneDocument(
      serializeScene(reloaded, io.components, io.write),
    );

    expect(second).toBe(first);
  });

  it("keeps every node's saved id (§79)", () => {
    const root = buildTree();
    const io = registerSceneNodeTypes({ atlas });
    const ids: string[] = [];
    root.traverse((node) => ids.push(node.id));

    const reloaded = instantiateScene(
      serializeScene(root, io.components, io.write),
      io.components,
      io.read,
    );

    const restored: string[] = [];
    reloaded.traverse((node) => restored.push(node.id));
    expect(restored).toEqual(ids);
    // …and the counter knows about them, so the next node cannot collide.
    expect(ids).not.toContain(new Group().id);
  });

  it("names each widget class with its own document type", () => {
    const io = registerUISerializers();
    expect(io.write.nodeTypeOf(new Panel())).toBe(PANEL_NODE_TYPE);
    expect(io.write.nodeTypeOf(new Label())).toBe(LABEL_NODE_TYPE);
    expect(io.write.nodeTypeOf(new Button())).toBe(BUTTON_NODE_TYPE);
    // The six §73 controls added 2026-08-07 (A-12).
    expect(io.write.nodeTypeOf(new Toggle())).toBe(TOGGLE_NODE_TYPE);
    expect(io.write.nodeTypeOf(new Checkbox())).toBe(CHECKBOX_NODE_TYPE);
    expect(io.write.nodeTypeOf(new RadioButton())).toBe(RADIO_BUTTON_NODE_TYPE);
    expect(io.write.nodeTypeOf(new Slider())).toBe(SLIDER_NODE_TYPE);
    expect(io.write.nodeTypeOf(new ProgressIndicator())).toBe(
      PROGRESS_NODE_TYPE,
    );
    expect(io.write.nodeTypeOf(new ImageWidget())).toBe(IMAGE_NODE_TYPE);
    // Exact class identity: a `Scene` is not this pair's business, and neither
    // is an application's own widget subclass.
    expect(io.write.nodeTypeOf(new Scene())).toBeUndefined();
    expect(
      io.write.nodeTypeOf(new (class extends Button {})()),
    ).toBeUndefined();
    expect(io.write.nodeDataOf(new Group())).toBeUndefined();
    expect(io.read.nodeFactory({ type: "group" })).toBeUndefined();
  });

  it("restores labels with no atlas when none is supplied", () => {
    const root = new Label({ text: "hello", atlas, size: 10 });
    const io = registerSceneNodeTypes();

    const reloaded = instantiateScene(
      serializeScene(root, io.components, io.write),
      io.components,
      io.read,
    ) as Label;

    expect(reloaded.text).toBe("hello");
    expect(reloaded.size).toBe(10);
    // A font is a loaded resource, not scene state (§79) — so this is `null`
    // and the label measures nothing, which is exactly what it says it is.
    expect(reloaded.atlas).toBeNull();
    expect(reloaded.textLayout).toBeNull();
  });

  it("carries an infinite max size across JSON, which cannot hold Infinity", () => {
    const io = registerSceneNodeTypes();
    const panel = new Panel({ minWidth: 10 });

    const reloaded = instantiateScene(
      decodeSceneDocument(
        encodeSceneDocument(serializeScene(panel, io.components, io.write)),
      ),
      io.components,
      io.read,
    ) as Panel;

    expect(reloaded.maxWidth).toBe(Infinity);
    expect(reloaded.maxHeight).toBe(Infinity);
    expect(reloaded.minWidth).toBe(10);
  });

  it("restores an intrinsic (null) width rather than zero", () => {
    const io = registerSceneNodeTypes();
    const reloaded = instantiateScene(
      serializeScene(new Panel(), io.components, io.write),
      io.components,
      io.read,
    ) as Panel;

    expect(reloaded.width).toBeNull();
    expect(reloaded.height).toBeNull();
  });

  it("tolerates a payload from a build that wrote less", () => {
    const io = registerSceneNodeTypes({ atlas });
    const reloaded = io.read.nodeFactory({
      type: BUTTON_NODE_TYPE,
      id: "node-partial",
      data: { width: 40 },
    }) as Button;

    expect(reloaded).toBeInstanceOf(Button);
    expect(reloaded.id).toBe("node-partial");
    expect(reloaded.width).toBe(40);
    expect(reloaded.layoutType).toBe("absolute");
    expect(reloaded.accessibility).toBeNull();
  });
});

/**
 * The six §73 controls that shipped on 2026-08-07 (A-12). Each one adds state
 * the base widget payload does not carry — checkedness, a group name, a range
 * and its value, an image key — and §73's "UI objects … share serialization"
 * only holds if that state survives the trip too.
 */
describe("registerSceneNodeTypes — the A-12 controls survive §79", () => {
  /** One of each control, with every field moved off its default. */
  function buildControls(): Panel {
    const root = new Panel({
      name: "settings",
      layout: { type: "flex", direction: "column", gap: 4 },
    });
    root.add(
      new Toggle({ name: "mute", checked: true, width: 40, height: 20 }),
      new Checkbox({ name: "loop", checked: false, padding: 2 }),
      new RadioButton({ name: "low", group: "quality" }),
      new RadioButton({ name: "high", group: "quality", checked: true }),
      new Slider({
        name: "gravity",
        min: -20,
        max: 0,
        step: 0.5,
        value: -9.5,
        orientation: "vertical",
        width: 24,
        height: 160,
      }),
      new ProgressIndicator({
        name: "loading",
        min: 0,
        max: 200,
        value: 50,
        indeterminate: true,
      }),
      new ImageWidget({
        name: "avatar",
        source: "textures/avatar.png",
        naturalWidth: 64,
        naturalHeight: 48,
      }),
      new CanvasViewWidget({
        name: "minimap",
        width: 120,
        height: 80,
        resolution: 2,
      }),
    );
    return root;
  }

  it("round-trips every control's own state through JSON text", () => {
    const io = registerSceneNodeTypes();
    const root = buildControls();
    root.layout();

    const reloaded = instantiateScene(
      decodeSceneDocument(
        encodeSceneDocument(serializeScene(root, io.components, io.write)),
      ),
      io.components,
      io.read,
    ) as Panel;

    const [mute, loop, low, high, gravity, loading, avatar, minimap] =
      reloaded.children as [
        Toggle,
        Checkbox,
        RadioButton,
        RadioButton,
        Slider,
        ProgressIndicator,
        ImageWidget,
        CanvasViewWidget,
      ];

    expect(mute).toBeInstanceOf(Toggle);
    expect(mute.checked).toBe(true);
    expect(mute.width).toBe(40);

    expect(loop).toBeInstanceOf(Checkbox);
    expect(loop.checked).toBe(false);
    expect(loop.padding.top).toBe(2);

    expect(low).toBeInstanceOf(RadioButton);
    expect([low.group, low.checked]).toEqual(["quality", false]);
    // Both members reload as they were saved — the group is not reconciled on
    // the way in, which is what keeps a document faithful.
    expect([high.group, high.checked]).toEqual(["quality", true]);

    expect(gravity).toBeInstanceOf(Slider);
    expect([gravity.min, gravity.max, gravity.step, gravity.value]).toEqual([
      -20, 0, 0.5, -9.5,
    ]);
    expect(gravity.orientation).toBe("vertical");

    expect(loading).toBeInstanceOf(ProgressIndicator);
    expect([loading.min, loading.max, loading.value]).toEqual([0, 200, 50]);
    expect(loading.indeterminate).toBe(true);

    expect(avatar).toBeInstanceOf(ImageWidget);
    expect(avatar.source).toBe("textures/avatar.png");
    expect([avatar.naturalWidth, avatar.naturalHeight]).toEqual([64, 48]);

    expect(minimap).toBeInstanceOf(CanvasViewWidget);
    expect(minimap.resolution).toBe(2);
    minimap.layout();
    expect([minimap.pixelWidth, minimap.pixelHeight]).toEqual([240, 160]);
  });

  it("writes a canvas view's box and resolution — never pixels or repaint state (§77a)", () => {
    const io = registerSceneNodeTypes();
    const view = new CanvasViewWidget({ width: 32, height: 16, resolution: 2 });
    view.invalidate();
    view.invalidate(); // transient repaint state, about to be proven absent

    const document = serializeScene(view, io.components, io.write);
    expect(document.nodes[0].type).toBe("ui:canvas-view");
    const data = document.nodes[0].data as Record<string, unknown>;
    expect(data.resolution).toBe(2);
    expect(data).not.toHaveProperty("contentVersion");
    expect(data).not.toHaveProperty("pixels");
    expect(data).not.toHaveProperty("data");

    // A reloaded view starts blank at revision 0: painted pixels are display
    // content with no §79 representation, so there is nothing to restore.
    const reloaded = instantiateScene(
      document,
      io.components,
      io.read,
    ) as CanvasViewWidget;
    expect(reloaded.contentVersion).toBe(0);
  });

  it("is textually idempotent, controls included", () => {
    const io = registerSceneNodeTypes();
    const root = buildControls();
    root.layout();

    const first = encodeSceneDocument(
      serializeScene(root, io.components, io.write),
    );
    const second = encodeSceneDocument(
      serializeScene(
        instantiateScene(decodeSceneDocument(first), io.components, io.read),
        io.components,
        io.write,
      ),
    );

    expect(second).toBe(first);
  });

  it("keeps a restored control live — the reload is a widget, not a record", () => {
    const io = registerSceneNodeTypes();
    const source = new Panel();
    source.add(new Toggle({ checked: true }), new Slider({ max: 10, step: 1 }));

    const reloaded = instantiateScene(
      serializeScene(source, io.components, io.write),
      io.components,
      io.read,
    );
    const [toggle, slider] = reloaded.children as [Toggle, Slider];

    toggle.activate();
    slider.value = 4;

    expect(toggle.checked).toBe(false);
    expect(slider.value).toBe(4);
  });
});

/**
 * A §79 payload may come from a build that wrote less, wrote more, or wrote
 * nonsense — and every one of these controls validates its inputs (§85) and
 * throws. The reader therefore has to filter, or a single corrupted number
 * would take down the whole scene instead of one field.
 */
describe("registerUISerializers — the A-12 controls read defensively", () => {
  const io = registerUISerializers();

  it("defaults a checkable payload that says nothing", () => {
    for (const type of [
      TOGGLE_NODE_TYPE,
      CHECKBOX_NODE_TYPE,
      RADIO_BUTTON_NODE_TYPE,
    ]) {
      const control = io.read.nodeFactory({
        type,
        data: { checked: "yes", group: 7 },
      }) as Toggle;
      expect(control.checked).toBe(false);
    }
    expect(
      (io.read.nodeFactory({ type: RADIO_BUTTON_NODE_TYPE }) as RadioButton)
        .group,
    ).toBe("");
  });

  it("defaults a canvas view's corrupted resolution instead of throwing (§85)", () => {
    // The class refuses a non-positive resolution, so the reader filters —
    // each corruption restores the default 1 rather than failing the scene.
    for (const resolution of [0, -2, "2", null]) {
      const view = io.read.nodeFactory({
        type: "ui:canvas-view",
        data: { resolution },
      }) as CanvasViewWidget;
      expect(view).toBeInstanceOf(CanvasViewWidget);
      expect(view.resolution).toBe(1);
    }
  });

  it("drops a range whose bounds contradict each other, keeping both defaults", () => {
    const slider = io.read.nodeFactory({
      type: SLIDER_NODE_TYPE,
      data: { min: 10, max: 0, value: 5 },
    }) as Slider;

    expect([slider.min, slider.max]).toEqual([0, 1]);
    // The value is still applied, resolved against the defaults it landed in.
    expect(slider.value).toBe(1);
  });

  it("fills a half-written range from the class defaults", () => {
    // `{ min: 5 }` alone would throw against the default maximum of 1, so the
    // reader always passes both — and a pair that cannot be reconciled is
    // dropped whole.
    const wide = io.read.nodeFactory({
      type: SLIDER_NODE_TYPE,
      data: { max: 10 },
    }) as Slider;
    expect([wide.min, wide.max]).toEqual([0, 10]);

    const raised = io.read.nodeFactory({
      type: PROGRESS_NODE_TYPE,
      data: { min: 5 },
    }) as ProgressIndicator;
    expect([raised.min, raised.max]).toEqual([0, 1]);
  });

  it("ignores a step, a value, and an orientation it cannot use", () => {
    const slider = io.read.nodeFactory({
      type: SLIDER_NODE_TYPE,
      data: {
        max: 10,
        step: -2,
        value: "half",
        orientation: "diagonal",
      },
    }) as Slider;

    expect(slider.step).toBe(0);
    expect(slider.value).toBe(0);
    expect(slider.orientation).toBe("horizontal");
  });

  it("ignores a non-finite number rather than throwing on the whole scene", () => {
    const slider = io.read.nodeFactory({
      type: SLIDER_NODE_TYPE,
      data: { min: Number.NaN, max: Infinity, step: Number.NaN, value: 0.5 },
    }) as Slider;

    expect([slider.min, slider.max, slider.step, slider.value]).toEqual([
      0, 1, 0, 0.5,
    ]);
  });

  it("defaults a progress payload that says nothing usable", () => {
    const progress = io.read.nodeFactory({
      type: PROGRESS_NODE_TYPE,
      data: { value: [], indeterminate: "maybe" },
    }) as ProgressIndicator;

    expect([progress.min, progress.max, progress.value]).toEqual([0, 1, 0]);
    expect(progress.indeterminate).toBe(false);
  });

  it("ignores an image source and natural size it cannot use", () => {
    const image = io.read.nodeFactory({
      type: IMAGE_NODE_TYPE,
      data: { source: 42, naturalWidth: -8, naturalHeight: "tall" },
    }) as ImageWidget;

    expect(image.source).toBeNull();
    expect([image.naturalWidth, image.naturalHeight]).toEqual([0, 0]);
  });

  it("reads a layout record onto a control, which is a panel too", () => {
    const slider = io.read.nodeFactory({
      type: SLIDER_NODE_TYPE,
      data: { layout: { type: "flex", direction: "column" } },
    }) as Slider;

    expect(slider.layoutType).toBe("flex");
    expect(slider.direction).toBe("column");
  });
});

describe("registerSceneNodeTypes — components (PH-17)", () => {
  it("round-trips a MotionComponent that used to be dropped silently", () => {
    const io = registerSceneNodeTypes();
    const root = new Group();
    root.addComponent(
      new MotionComponent({
        linearVelocity: new Vector3(1, 2, 3),
        damping: 0.5,
        maxSpeed: 9,
      }),
    );

    const reloaded = instantiateScene(
      decodeSceneDocument(
        encodeSceneDocument(serializeScene(root, io.components, io.write)),
      ),
      io.components,
      io.read,
    );

    const motion = reloaded.getComponent(MotionComponent);
    expect(motion).toBeInstanceOf(MotionComponent);
    expect(motion?.linearVelocity.equalsApprox(new Vector3(1, 2, 3), 0)).toBe(
      true,
    );
    expect(motion?.damping).toBe(0.5);
    expect(motion?.maxSpeed).toBe(9);
    expect(motion?.host).toBe(reloaded);
  });

  it("refuses to save a component it has no serializer for (A-15)", () => {
    class Health {
      static readonly typeName = "com.example.health";
      host: unknown = null;
    }
    const io = registerSceneNodeTypes();
    const root = new Group();
    root.addComponent(new Health() as never);

    let thrown: unknown;
    try {
      serializeScene(root, io.components, io.write);
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown) && thrown.code).toBe(
      "INVALID_APPLICATION_STATE",
    );

    // …and dropping it is a deliberate opt-in, not the default.
    expect(() =>
      serializeScene(root, io.components, {
        ...io.write,
        unknownComponents: "skip",
      }),
    ).not.toThrow();
  });

  it("round-trips a RigidBody and a Collider through one call (PH-17)", () => {
    // The physics half of PH-17, closed 2026-08-06: `@fourjs/physics` owns the
    // serializers and this package performs the registration neither it nor
    // `@fourjs/serialization` may perform alone. Before this, a scene carrying
    // physics components needed `{ unknownComponents: "skip" }` to save at all.
    const io = registerSceneNodeTypes();
    const root = new Group();
    root.addComponent(
      new RigidBody({
        type: "dynamic",
        mass: 3,
        linearVelocity: new Vector3(0, -2, 0),
        linearDamping: 0.2,
      }),
    );
    root.addComponent(
      new Collider({
        shape: { type: "sphere", radius: 0.5 },
        restitution: 0.4,
        sensor: true,
      }),
    );

    const reloaded = instantiateScene(
      decodeSceneDocument(
        encodeSceneDocument(serializeScene(root, io.components, io.write)),
      ),
      io.components,
      io.read,
    );

    const body = reloaded.getComponent(RigidBody);
    expect(body).toBeInstanceOf(RigidBody);
    expect(body?.type).toBe("dynamic");
    expect(body?.mass).toBe(3);
    expect(body?.linearDamping).toBe(0.2);
    expect(body?.linearVelocity.equalsApprox(new Vector3(0, -2, 0), 0)).toBe(
      true,
    );

    const collider = reloaded.getComponent(Collider);
    expect(collider).toBeInstanceOf(Collider);
    expect(collider?.shape).toEqual({ type: "sphere", radius: 0.5 });
    expect(collider?.restitution).toBe(0.4);
    expect(collider?.sensor).toBe(true);
    // The §24 association is rebuilt by the hierarchy, not by the document.
    expect(collider?.body).toBe(body);
  });

  it("round-trips a KinematicController, which used to break the save (2026-08-07)", () => {
    // §12's controller was the one shipped component with no serializer, and
    // A-15 had made that a hard error: a scene carrying one could not be saved
    // at all. Its payload is empty by design — the class has no constructor
    // options — so what is asserted here is that the component survives as a
    // live, idle controller rather than disappearing or throwing.
    const io = registerSceneNodeTypes();
    const root = new Group();
    const controller = root.addComponent(new KinematicController());
    controller.moveTo(new Vector3(4, 0, 0), { duration: 1 });

    const reloaded = instantiateScene(
      decodeSceneDocument(
        encodeSceneDocument(serializeScene(root, io.components, io.write)),
      ),
      io.components,
      io.read,
    );

    const restored = reloaded.getComponent(KinematicController);
    expect(restored).toBeInstanceOf(KinematicController);
    expect(restored?.host).toBe(reloaded);
    // The in-flight command is not scene state (§79): the node reloads where
    // its transform says it is, standing still.
    expect(restored?.translationActive).toBe(false);
  });

  it("round-trips CameraShake trauma as scene state", () => {
    const io = registerSceneNodeTypes();
    const root = new Group();
    const shake = root.addComponent(
      new CameraShake({
        amplitude: new Vector3(2, 1, 0.5),
        frequency: 8,
        seed: 17,
        trauma: 0.4,
        traumaDecay: 1.5,
      }),
    );
    shake.rotationAmplitude.set(0.1, 0, 0);

    const reloaded = instantiateScene(
      decodeSceneDocument(
        encodeSceneDocument(serializeScene(root, io.components, io.write)),
      ),
      io.components,
      io.read,
    );

    const restored = reloaded.getComponent(CameraShake);
    expect(restored).toBeInstanceOf(CameraShake);
    expect(restored?.host).toBe(reloaded);
    expect(restored?.frequency).toBe(8);
    expect(restored?.seed).toBe(17);
    expect(restored?.trauma).toBe(0.4);
    expect(restored?.traumaDecay).toBe(1.5);
    expect(restored?.amplitude.x).toBe(2);
    expect(restored?.amplitude.y).toBe(1);
    expect(restored?.amplitude.z).toBe(0.5);
    expect(restored?.rotationAmplitude.x).toBe(0.1);
    expect(restored?.rotationAmplitude.y).toBe(0);
    expect(restored?.rotationAmplitude.z).toBe(0);
  });

  it("round-trips NodeSpace (§8) through registerSceneNodeTypes", () => {
    const io = registerSceneNodeTypes();
    const root = new Group();
    root.addComponent(
      new NodeSpace({
        space: "billboard",
        planeNormal: new Vector3(0, 1, 0),
      }),
    );

    const reloaded = instantiateScene(
      decodeSceneDocument(
        encodeSceneDocument(serializeScene(root, io.components, io.write)),
      ),
      io.components,
      io.read,
    );

    const restored = reloaded.getComponent(NodeSpace);
    expect(restored).toBeInstanceOf(NodeSpace);
    expect(restored?.host).toBe(reloaded);
    expect(restored?.space).toBe("billboard");
    expect(restored?.planeNormal.y).toBe(1);
  });

  it("round-trips the §44 camera rigs and §12's look-at constraint (2026-08-13)", () => {
    // The three components that arrived with `ConstraintSystem`. What a
    // document carries is the authored configuration: a `Vector3` target is
    // written, a live `Node` target is dropped for the application to re-bind,
    // and a spring round-trips as coefficients.
    const io = registerSceneNodeTypes();
    const root = new Group();
    const subject = new Group();
    root.add(subject);

    const orbit = root.addComponent(
      new OrbitRig({
        target: new Vector3(0, 1, 0),
        yaw: 0.5,
        pitch: 0.2,
        distance: 6,
        minPitch: -1,
        maxPitch: 1,
        minDistance: 2,
        maxDistance: 20,
      }),
    );
    orbit.pitchLimitHits = 7;
    const boom = new Group();
    boom.addComponent(
      new FollowRig({
        target: subject,
        offset: new Vector3(0, 2, 5),
        frame: "target",
        spring: new SpringDamper({ frequencyHz: 2, dampingRatio: 1 }),
      }),
    );
    boom.addComponent(
      new LookAtConstraint({ target: subject, maxAngularSpeed: 1.25 }),
    );
    root.add(boom);

    const reloaded = instantiateScene(
      decodeSceneDocument(
        encodeSceneDocument(serializeScene(root, io.components, io.write)),
      ),
      io.components,
      io.read,
    );

    const restoredOrbit = reloaded.getComponent(OrbitRig);
    expect(restoredOrbit).toBeInstanceOf(OrbitRig);
    expect(restoredOrbit?.host).toBe(reloaded);
    expect(restoredOrbit?.yaw).toBe(0.5);
    expect(restoredOrbit?.pitch).toBe(0.2);
    expect(restoredOrbit?.distance).toBe(6);
    expect(restoredOrbit?.minDistance).toBe(2);
    expect(restoredOrbit?.maxDistance).toBe(20);
    expect(restoredOrbit?.target).toBeInstanceOf(Vector3);
    // Counters describe a run, not a scene.
    expect(restoredOrbit?.pitchLimitHits).toBe(0);

    const restoredBoom = reloaded.children[1];
    const restoredFollow = restoredBoom.getComponent(FollowRig);
    expect(restoredFollow).toBeInstanceOf(FollowRig);
    expect(restoredFollow?.frame).toBe("target");
    expect(restoredFollow?.offset.equalsApprox(new Vector3(0, 2, 5), 0)).toBe(
      true,
    );
    expect(restoredFollow?.spring?.stiffness).toBe(
      boom.getComponent(FollowRig)?.spring?.stiffness,
    );
    // A live node target has nowhere to live in a §79 document: it is dropped,
    // and the application re-binds it after the load.
    expect(restoredFollow?.target).toBe(null);

    const restoredAim = restoredBoom.getComponent(LookAtConstraint);
    expect(restoredAim).toBeInstanceOf(LookAtConstraint);
    expect(restoredAim?.maxAngularSpeed).toBe(1.25);
    expect(restoredAim?.up.equalsApprox(new Vector3(0, 1, 0), 0)).toBe(true);
    expect(restoredAim?.target).toBe(null);

    // Re-binding is the one line the application owes, and it is enough to
    // make the reloaded rig live again.
    restoredAim!.target = restoredBoom;
    expect(restoredAim?.target).toBe(restoredBoom);
  });

  it("keeps a rig document readable when a field is corrupt, and refuses an impossible one", () => {
    // The §79-vs-§85 line the rig serializers draw: a field of the wrong shape
    // restores to its default, a well-formed number describing a rig that
    // cannot exist is refused rather than silently substituted.
    const io = registerSceneNodeTypes();
    const root = new Group();
    root.addComponent(new OrbitRig({ yaw: 0.5, distance: 4 }));
    const text = encodeSceneDocument(
      serializeScene(root, io.components, io.write),
    );

    /** The same document with the rig's payload replaced by `data`. */
    const tampered = (data: Record<string, unknown>): string => {
      const document = JSON.parse(text) as {
        nodes: { components?: { type: string; data: unknown }[] }[];
      };
      const components = document.nodes[0].components ?? [];
      for (const entry of components) {
        if (entry.type === OrbitRig.typeName) entry.data = data;
      }
      return JSON.stringify(document);
    };

    const shapeDamaged = instantiateScene(
      decodeSceneDocument(tampered({ yaw: "east", distance: null })),
      io.components,
      io.read,
    ).getComponent(OrbitRig);
    expect(shapeDamaged?.yaw).toBe(0);
    expect(shapeDamaged?.distance).toBe(1);

    expect(() =>
      instantiateScene(
        decodeSceneDocument(tampered({ distance: -2 })),
        io.components,
        io.read,
      ),
    ).toThrow(RangeError);
  });

  it("registers a serializer for every component class the engine ships", () => {
    // The enumerating test the KinematicController gap asked for (2026-08-07).
    // A component with no serializer makes `serializeScene` throw (A-15), and
    // the only symptom of a *new* one being forgotten would be an application
    // that cannot save its scene — so the check is mechanical: walk the
    // umbrella's own barrels, find every exported class carrying a
    // `static typeName` (plan D2's component key), and require each one.
    const shipped = new Map<string, string>();
    for (const [namespace, module_] of Object.entries(
      four as Record<string, unknown>,
    )) {
      if (typeof module_ !== "object" || module_ === null) continue;
      for (const [name, value] of Object.entries(
        module_ as Record<string, unknown>,
      )) {
        if (typeof value !== "function") continue;
        const typeName = (value as { typeName?: unknown }).typeName;
        if (typeof typeName === "string" && typeName !== "") {
          shipped.set(typeName, `${namespace}.${name}`);
        }
      }
    }

    // The list is asserted as well as walked: a component that stops being
    // exported would otherwise make this test pass by finding less.
    expect([...shipped.keys()].sort()).toEqual([
      "CameraShake",
      "NodeSpace",
      "character-controller",
      "collider",
      "first-person-look",
      "follow-rig",
      "kinematic-controller",
      "look-at-constraint",
      "morph-weights",
      "motion",
      "orbit-rig",
      "pose-target",
      "rigid-body",
      "soft-body",
      "swept-character-controller",
    ]);

    const registry = registerSceneNodeTypes().components;
    const missing = [...shipped].filter(
      ([typeName]) => !registry.has(typeName),
    );
    expect(missing).toEqual([]);
  });

  it("hands out a fresh registry per call", () => {
    const first = registerSceneNodeTypes().components;
    const second = registerSceneNodeTypes().components;

    expect(first).not.toBe(second);
    expect(first.has(MotionComponent.typeName)).toBe(true);
    expect(second.has(MotionComponent.typeName)).toBe(true);
    expect(first.has(KinematicController.typeName)).toBe(true);
    expect(first.has(RigidBody.typeName)).toBe(true);
    expect(first.has(Collider.typeName)).toBe(true);
    expect(first.has(SweptCharacterController.typeName)).toBe(true);
  });
});

describe("registerPhysicsSerializers (PH-17)", () => {
  it("registers every @fourjs/physics component without pulling in the UI node types", () => {
    const components = registerPhysicsSerializers(
      createDefaultComponentSerializers(),
    );

    expect(components.has(RigidBody.typeName)).toBe(true);
    expect(components.has(Collider.typeName)).toBe(true);
    // §12's swept character controller registers with the physics family, not
    // the motion one: the split is by package (`PH-11b`, 2026-08-21).
    expect(components.has(SweptCharacterController.typeName)).toBe(true);
    // The registry it was handed, returned for chaining — not a copy.
    // RFC 0011 soft bodies register in the same family (the physics registrar).
    expect(components.has(SoftBody.typeName)).toBe(true);
    expect(
      registerPhysicsSerializers(new ComponentSerializerRegistry()).size,
    ).toBe(4);
  });

  it("refuses to register twice on one registry, rather than overwriting", () => {
    const components = registerPhysicsSerializers(
      createDefaultComponentSerializers(),
    );

    let thrown: unknown;
    try {
      registerPhysicsSerializers(components);
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown) && thrown.code).toBe(
      "INVALID_APPLICATION_STATE",
    );
  });
});

/**
 * The tolerant read paths: a `data` payload from a build that wrote less, wrote
 * more, or wrote nonsense must restore a usable widget rather than throw. §79's
 * extensibility goal is better served by a default than by refusing the scene.
 */
describe("registerUISerializers — defensive reads", () => {
  const io = registerUISerializers();

  it("defaults every inset component the payload omits", () => {
    const panel = io.read.nodeFactory({
      type: PANEL_NODE_TYPE,
      data: { padding: { left: 4 }, margin: "nonsense" },
    }) as Panel;

    expect({
      top: panel.padding.top,
      right: panel.padding.right,
      bottom: panel.padding.bottom,
      left: panel.padding.left,
    }).toEqual({ top: 0, right: 0, bottom: 0, left: 4 });
    expect(panel.margin.left).toBe(0);
  });

  it("ignores an anchor, pivot, or offset that is not a number pair", () => {
    const panel = io.read.nodeFactory({
      type: PANEL_NODE_TYPE,
      data: { anchor: [1], pivot: ["a", "b"], offset: { x: 1, y: 2 } },
    }) as Panel;

    expect([panel.anchor.x, panel.anchor.y]).toEqual([0, 0]);
    expect([panel.pivot.x, panel.pivot.y]).toEqual([0, 0]);
    expect([panel.offset.x, panel.offset.y]).toEqual([0, 0]);
  });

  it("keeps the class defaults for a layout record it cannot read", () => {
    const panel = io.read.nodeFactory({
      type: PANEL_NODE_TYPE,
      data: {
        layout: {
          type: "diagonal",
          direction: "sideways",
          justify: "everywhere",
          align: "nowhere",
        },
      },
    }) as Panel;

    expect(panel.layoutType).toBe("absolute");
    expect(panel.direction).toBe("row");
    expect(panel.justify).toBe("start");
    expect(panel.align).toBe("start");
  });

  it("reads every valid layout value", () => {
    for (const [type, direction, justify, align] of [
      ["stack", "row", "center", "center"],
      ["flex", "column", "end", "end"],
      ["absolute", "row", "space-between", "stretch"],
    ] as const) {
      const panel = io.read.nodeFactory({
        type: PANEL_NODE_TYPE,
        data: { layout: { type, direction, justify, align } },
      }) as Panel;

      expect([
        panel.layoutType,
        panel.direction,
        panel.justify,
        panel.align,
      ]).toEqual([type, direction, justify, align]);
    }
  });

  it("refuses a label size the class would reject, keeping the default", () => {
    const label = io.read.nodeFactory({
      type: LABEL_NODE_TYPE,
      data: { size: 0, letterSpacing: "wide", text: 7 },
    }) as Label;

    expect(label.size).toBe(1);
    expect(label.letterSpacing).toBe(0);
    expect(label.text).toBe("");
  });

  it("reads an accessibility record with only some fields set", () => {
    const button = io.read.nodeFactory({
      type: BUTTON_NODE_TYPE,
      data: { accessibility: { label: "Go" } },
    }) as Button;

    expect(button.accessibility).toEqual({ label: "Go" });
  });

  it("writes only the accessibility fields that are set", () => {
    const button = new Button({ accessibility: { role: "button" } });

    expect(io.write.nodeDataOf(button)).toMatchObject({
      accessibility: { role: "button" },
    });
  });

  it("treats a non-object data payload as empty", () => {
    const panel = io.read.nodeFactory({
      type: PANEL_NODE_TYPE,
      data: ["not", "a", "record"],
    }) as Panel;

    expect(panel).toBeInstanceOf(Panel);
    expect(panel.width).toBeNull();
  });
});

/**
 * The A-16 remainder, closed 2026-08-07: §49's `Renderable`, §55's `Sprite`,
 * §47's two cameras, and §68's `DirectionalLight`.
 *
 * The load-bearing claim is not "the classes come back" but **what a shared
 * resource does across the boundary**: §79 references geometry and materials by
 * logical key, so a reloaded renderable must point at the *same instance* the
 * catalog holds — a copy would silently double every buffer upload and break
 * §83's "whoever created it disposes it".
 */
describe("registerRenderSerializers — the drawing tier survives §79 (A-16)", () => {
  const plane = planeGeometry();
  const box = planeGeometry({ width: 2 });
  const brick = new UnlitMaterial();
  const sun = new LitMaterial();
  const decal = new SpriteMaterial({
    texture: new Texture({ width: 1, height: 1 }),
  });

  const geometries = resourceCatalog<BufferGeometry>([
    ["geometry/plane", plane],
    ["geometry/box", box],
  ]);
  const materials = resourceCatalog<Material>([
    ["material/brick", brick],
    ["material/sun", sun],
    ["material/decal", decal],
  ]);

  /** Everything a drawn scene is made of, every field off its default. */
  function buildDrawnScene(): Scene {
    const scene = new Scene();
    const camera = new PerspectiveCamera({
      fieldOfView: 1.2,
      aspect: 16 / 9,
      near: 0.05,
      far: 400,
    });
    camera.name = "eye";
    const minimap = new OrthographicCamera({
      left: -8,
      right: 8,
      bottom: -4.5,
      top: 4.5,
      near: 0.5,
      far: 50,
    });
    const light = new DirectionalLight({ color: [1, 0.98, 0.9], intensity: 3 });
    const lamp = new PointLight({
      color: [1, 0.85, 0.6],
      intensity: 4,
      range: 12,
    });
    lamp.transform.position.set(2, 3, -1);
    const spot = new SpotLight({
      color: [0.4, 0.7, 1],
      intensity: 9,
      range: 30,
      innerConeAngle: Math.PI / 10,
      outerConeAngle: Math.PI / 6,
    });
    const floor = new Renderable(plane, brick, {
      renderLayer: 2,
      renderOrder: 7,
    });
    floor.transform.position.set(0, -1, 0);
    const badge = new Sprite(decal, {
      width: 3,
      height: 2,
      anchor: { x: 0, y: 1 },
      renderLayer: 1,
      renderOrder: -1,
      castShadow: false,
      receiveShadow: false,
      frustumCulled: false,
    });
    scene.add(camera, minimap, light, lamp, spot, floor, badge);
    return scene;
  }

  it("round-trips classes, parameters, and shared resource identity through text", () => {
    const io = registerSceneNodeTypes({ geometries, materials });
    const scene = buildDrawnScene();

    const reloaded = instantiateScene(
      decodeSceneDocument(
        encodeSceneDocument(serializeScene(scene, io.components, io.write)),
      ),
      io.components,
      io.read,
    );

    const [camera, minimap, light, lamp, spot, floor, badge] =
      reloaded.children as [
        PerspectiveCamera,
        OrthographicCamera,
        DirectionalLight,
        PointLight,
        SpotLight,
        Renderable,
        Sprite,
      ];

    expect(camera).toBeInstanceOf(PerspectiveCamera);
    expect(camera.name).toBe("eye");
    expect([
      camera.fieldOfView,
      camera.aspect,
      camera.near,
      camera.far,
    ]).toEqual([1.2, 16 / 9, 0.05, 400]);
    // The projection is *derived*, not carried: a restored camera projects
    // because its constructor rebuilt the matrix from those four numbers.
    expect(camera.projectionMatrix.elements[0]).toBeCloseTo(
      1 / (Math.tan(1.2 / 2) * (16 / 9)),
      12,
    );

    expect(minimap).toBeInstanceOf(OrthographicCamera);
    expect([
      minimap.left,
      minimap.right,
      minimap.bottom,
      minimap.top,
      minimap.near,
      minimap.far,
    ]).toEqual([-8, 8, -4.5, 4.5, 0.5, 50]);

    expect(light).toBeInstanceOf(DirectionalLight);
    expect([...light.color]).toEqual([1, 0.98, 0.9]);
    expect(light.intensity).toBe(3);

    // §68's two positional lights (R-17). Their *placement* is the node
    // transform §79 already carries, so only the photometry is a payload.
    expect(lamp).toBeInstanceOf(PointLight);
    expect([...lamp.color]).toEqual([1, 0.85, 0.6]);
    expect([lamp.intensity, lamp.range]).toEqual([4, 12]);
    expect([
      lamp.transform.position.x,
      lamp.transform.position.y,
      lamp.transform.position.z,
    ]).toEqual([2, 3, -1]);

    expect(spot).toBeInstanceOf(SpotLight);
    expect([...spot.color]).toEqual([0.4, 0.7, 1]);
    expect([spot.intensity, spot.range]).toEqual([9, 30]);
    expect([spot.innerConeAngle, spot.outerConeAngle]).toEqual([
      Math.PI / 10,
      Math.PI / 6,
    ]);

    expect(floor).toBeInstanceOf(Renderable);
    // The point of the whole seam: the same instances, not copies of them.
    expect(floor.geometry).toBe(plane);
    expect(floor.material).toBe(brick);
    expect([floor.renderLayer, floor.renderOrder]).toEqual([2, 7]);
    expect(floor.transform.position.y).toBe(-1);

    expect(badge).toBeInstanceOf(Sprite);
    expect(badge.material).toBe(decal);
    expect([badge.width, badge.height]).toEqual([3, 2]);
    expect([badge.anchor.x, badge.anchor.y]).toEqual([0, 1]);
    expect([badge.renderLayer, badge.renderOrder]).toEqual([1, -1]);
    expect(badge.castShadow).toBe(false);
    expect(badge.receiveShadow).toBe(false);
    expect(badge.frustumCulled).toBe(false);
    // A sprite owns and derives its quad (§55), so it comes back with its own
    // — never the catalog's, which is why no geometry key is written for one.
    expect(badge.geometry).not.toBe(plane);
    expect(badge.geometry.positions.slice(0, 3)).toEqual(
      new Float32Array([0, -2, 0]),
    );
  });

  it("is textually idempotent — the P11-1 round-trip gate", () => {
    const io = registerSceneNodeTypes({ geometries, materials });
    const scene = buildDrawnScene();

    const first = encodeSceneDocument(
      serializeScene(scene, io.components, io.write),
    );
    const second = encodeSceneDocument(
      serializeScene(
        instantiateScene(decodeSceneDocument(first), io.components, io.read),
        io.components,
        io.write,
      ),
    );

    expect(second).toBe(first);
  });

  it("keeps every node's saved id, which no drawable constructor takes (A-17)", () => {
    const io = registerSceneNodeTypes({ geometries, materials });
    const scene = buildDrawnScene();
    const ids: string[] = [];
    scene.traverse((node) => ids.push(node.id));

    const reloaded = instantiateScene(
      serializeScene(scene, io.components, io.write),
      io.components,
      io.read,
    );

    const restored: string[] = [];
    reloaded.traverse((node) => restored.push(node.id));
    expect(restored).toEqual(ids);
    expect(ids).not.toContain(new Group().id);
  });

  it("names each class with its own document type, by exact identity", () => {
    const io = registerRenderSerializers();
    expect(io.write.nodeTypeOf(new Renderable(plane, brick))).toBe(
      RENDERABLE_NODE_TYPE,
    );
    expect(io.write.nodeTypeOf(new Sprite(decal))).toBe(SPRITE_NODE_TYPE);
    expect(io.write.nodeTypeOf(new PerspectiveCamera())).toBe(
      PERSPECTIVE_CAMERA_NODE_TYPE,
    );
    expect(io.write.nodeTypeOf(new OrthographicCamera())).toBe(
      ORTHOGRAPHIC_CAMERA_NODE_TYPE,
    );
    expect(io.write.nodeTypeOf(new ScreenCamera())).toBe(
      SCREEN_CAMERA_NODE_TYPE,
    );
    expect(io.write.nodeTypeOf(new DirectionalLight())).toBe(
      DIRECTIONAL_LIGHT_NODE_TYPE,
    );
    expect(io.write.nodeTypeOf(new PointLight())).toBe(POINT_LIGHT_NODE_TYPE);
    expect(io.write.nodeTypeOf(new SpotLight())).toBe(SPOT_LIGHT_NODE_TYPE);
    expect(io.write.nodeTypeOf(new HemisphereLight())).toBe(
      HEMISPHERE_LIGHT_NODE_TYPE,
    );
    // A `Sprite` is a `Renderable` to `instanceof` and not to this pair, which
    // is what keeps an application's own subclass from being written out as
    // its base and reloaded as one.
    expect(
      io.write.nodeTypeOf(new (class extends Renderable {})(plane, brick)),
    ).toBeUndefined();
    expect(io.write.nodeTypeOf(new Group())).toBeUndefined();
    expect(io.write.nodeDataOf(new Group())).toBeUndefined();
    expect(io.read.nodeFactory({ type: PANEL_NODE_TYPE })).toBeUndefined();
  });

  it("registers the widgets and the drawing tier from one call", () => {
    const io = registerSceneNodeTypes({ atlas, geometries, materials });

    expect(io.write.nodeTypeOf(new Panel())).toBe(PANEL_NODE_TYPE);
    expect(io.write.nodeTypeOf(new Sprite(decal))).toBe(SPRITE_NODE_TYPE);
    // Neither half claims what the other owns, and neither claims a `Scene` —
    // `serializeScene`'s own built-in name is what that falls through to.
    expect(io.write.nodeTypeOf(new Scene())).toBeUndefined();
    expect(io.write.nodeDataOf(new Scene())).toBeUndefined();
    expect(io.read.nodeFactory({ type: "group" })).toBeUndefined();
  });
});

/**
 * §85, both directions: a resource reference that cannot be named on the way
 * out or resolved on the way in is refused loudly, because the alternative is a
 * document that saves cleanly and cannot be loaded.
 */
describe("registerRenderSerializers — resource references are refused loudly", () => {
  const plane = planeGeometry();
  const brick = new UnlitMaterial();
  const decal = new SpriteMaterial({
    texture: new Texture({ width: 1, height: 1 }),
  });
  const geometries = resourceCatalog<BufferGeometry>([
    ["geometry/plane", plane],
  ]);
  const materials = resourceCatalog<Material>([
    ["material/brick", brick],
    ["material/decal", decal],
  ]);

  function codeOf(run: () => unknown): unknown {
    try {
      run();
    } catch (error) {
      return isFourError(error) ? error.code : error;
    }
    return undefined;
  }

  it("refuses to save a geometry no catalog names", () => {
    const io = registerSceneNodeTypes();
    expect(
      codeOf(() =>
        serializeScene(new Renderable(plane, brick), io.components, io.write),
      ),
    ).toBe("INVALID_APPLICATION_STATE");
  });

  it("refuses to save a material no catalog names", () => {
    const io = registerSceneNodeTypes({ geometries });
    expect(
      codeOf(() =>
        serializeScene(new Renderable(plane, brick), io.components, io.write),
      ),
    ).toBe("INVALID_APPLICATION_STATE");
    expect(
      codeOf(() => serializeScene(new Sprite(decal), io.components, io.write)),
    ).toBe("INVALID_APPLICATION_STATE");
  });

  it('writes a null reference under { unknownResources: "skip" }, and still refuses to load it', () => {
    const io = registerSceneNodeTypes({ unknownResources: "skip" });
    const document = serializeScene(
      new Renderable(plane, brick),
      io.components,
      io.write,
    );

    expect(document.nodes[0].data).toEqual({
      geometry: null,
      material: null,
      renderLayer: 0,
      renderOrder: 0,
      // §49's boolean flags, always written (R-18 and R-8, 2026-08-09) — see
      // `renderableFlagsJson` for why the defaults are stated rather than
      // omitted.
      castShadow: true,
      receiveShadow: true,
      frustumCulled: true,
      // §67's clip joined the always-written flags with R-23 (2026-08-28).
      clip: false,
    });
    // The inspector case: the hierarchy saves. Loading it is still a refusal,
    // because a renderable without a geometry is not a renderable.
    expect(
      codeOf(() => instantiateScene(document, io.components, io.read)),
    ).toBe("INVALID_APPLICATION_STATE");
  });

  it("refuses a key its catalog does not publish", () => {
    const io = registerRenderSerializers({ geometries, materials });
    expect(
      codeOf(() =>
        io.read.nodeFactory({
          type: RENDERABLE_NODE_TYPE,
          id: "node-floor",
          data: { geometry: "geometry/plane", material: "material/missing" },
        }),
      ),
    ).toBe("INVALID_APPLICATION_STATE");
    // …and with no id in the document either, which is a legal §79 node.
    expect(
      codeOf(() =>
        io.read.nodeFactory({
          type: SPRITE_NODE_TYPE,
          data: { material: "material/missing" },
        }),
      ),
    ).toBe("INVALID_APPLICATION_STATE");
  });

  it("refuses a material a sprite cannot sample (§55, §57)", () => {
    const io = registerRenderSerializers({ geometries, materials });
    expect(
      codeOf(() =>
        io.read.nodeFactory({
          type: SPRITE_NODE_TYPE,
          id: "node-badge",
          data: { material: "material/brick" },
        }),
      ),
    ).toBe("INVALID_APPLICATION_STATE");
    // …and with no id in the document, which is a legal §79 node.
    expect(
      codeOf(() =>
        io.read.nodeFactory({
          type: SPRITE_NODE_TYPE,
          data: { material: "material/brick" },
        }),
      ),
    ).toBe("INVALID_APPLICATION_STATE");
  });

  it("accepts on a Renderable every material the class accepts", () => {
    // The counterpart of the refusal above, and the reason it is not
    // symmetric: `Renderable<M extends Material>` is generic, so a kind
    // whitelist here would make a legitimate `Renderable<MyMaterial>` savable
    // and unloadable. The render list dispatches on the material's kind, not
    // on the node's class (§57, §64).
    const io = registerRenderSerializers({ geometries, materials });
    const floor = io.read.nodeFactory({
      type: RENDERABLE_NODE_TYPE,
      id: "node-floor",
      data: { geometry: "geometry/plane", material: "material/decal" },
    }) as Renderable;

    expect(floor).toBeInstanceOf(Renderable);
    expect(floor.material).toBe(decal);
  });

  it("reads through a bare Map and refuses to write through one", () => {
    // The claim the module header makes: `Map.get` *is* the read half.
    const io = registerRenderSerializers({
      geometries: new Map([["geometry/plane", plane]]),
      materials: new Map<string, UnlitMaterial | SpriteMaterial>([
        ["material/brick", brick],
      ]),
    });

    const floor = io.read.nodeFactory({
      type: RENDERABLE_NODE_TYPE,
      data: { geometry: "geometry/plane", material: "material/brick" },
    }) as Renderable;
    expect(floor.geometry).toBe(plane);

    // A map has no `keyOf`, so the write half has nothing to say — loudly.
    expect(
      codeOf(() => io.write.nodeDataOf(new Renderable(plane, brick))),
    ).toBe("INVALID_APPLICATION_STATE");
  });

  it("refuses to read through a write-only catalog", () => {
    const io = registerRenderSerializers({
      geometries: { keyOf: (): string => "geometry/plane" },
      materials: { keyOf: (): string => "material/brick" },
    });

    expect(io.write.nodeDataOf(new Renderable(plane, brick))).toEqual({
      geometry: "geometry/plane",
      material: "material/brick",
      renderLayer: 0,
      renderOrder: 0,
      castShadow: true,
      receiveShadow: true,
      frustumCulled: true,
      clip: false,
    });
    expect(
      codeOf(() =>
        io.read.nodeFactory({
          type: RENDERABLE_NODE_TYPE,
          data: { geometry: "geometry/plane", material: "material/brick" },
        }),
      ),
    ).toBe("INVALID_APPLICATION_STATE");
  });
});

/**
 * A §79 payload may come from a build that wrote less, wrote more, or wrote
 * nonsense. The cameras tolerate it (their classes validate nothing and a
 * non-finite projection parameter poisons a matrix rather than throwing); the
 * sprite and the light validate at construction (§85), so the reader filters
 * ahead of them exactly as it does for the §73 controls.
 */
describe("registerRenderSerializers — defensive reads", () => {
  const plane = planeGeometry();
  const brick = new UnlitMaterial();
  const decal = new SpriteMaterial({
    texture: new Texture({ width: 1, height: 1 }),
  });
  const io = registerRenderSerializers({
    geometries: resourceCatalog<BufferGeometry>([["geometry/plane", plane]]),
    materials: resourceCatalog<Material>([
      ["material/brick", brick],
      ["material/decal", decal],
    ]),
  });

  it("keeps every camera default a payload cannot supply", () => {
    const camera = io.read.nodeFactory({
      type: PERSPECTIVE_CAMERA_NODE_TYPE,
      data: { fieldOfView: Number.NaN, aspect: "wide", near: Infinity },
    }) as PerspectiveCamera;

    expect(camera.fieldOfView).toBeCloseTo(Math.PI / 3, 12);
    expect([camera.aspect, camera.near, camera.far]).toEqual([1, 0.1, 1000]);

    const minimap = io.read.nodeFactory({
      type: ORTHOGRAPHIC_CAMERA_NODE_TYPE,
      data: { left: -3, right: [], top: null },
    }) as OrthographicCamera;
    expect([minimap.left, minimap.right, minimap.bottom, minimap.top]).toEqual([
      -3, 1, -1, 1,
    ]);
  });

  it("round-trips a ScreenCamera's origin, units and rectangle (§47, R-37)", () => {
    const camera = new ScreenCamera({
      origin: "centered",
      units: "physical",
      width: 1024,
      height: 768,
      resolution: 2,
      near: -5,
      far: 5,
    });
    const data = io.write.nodeDataOf(camera) as Record<string, unknown>;
    expect(data.origin).toBe("centered");
    expect(data.units).toBe("physical");

    const restored = io.read.nodeFactory({
      type: SCREEN_CAMERA_NODE_TYPE,
      data: data as never,
    }) as ScreenCamera;
    expect(restored.origin).toBe("centered");
    expect(restored.units).toBe("physical");
    expect(restored.width).toBe(1024);
    expect(restored.height).toBe(768);
    expect(restored.resolution).toBe(2);
    expect(restored.near).toBe(-5);
    expect([...restored.projectionMatrix.elements]).toEqual([
      ...camera.projectionMatrix.elements,
    ]);
  });

  it("restores a ScreenCamera's defaults from a payload the class would refuse", () => {
    const camera = io.read.nodeFactory({
      type: SCREEN_CAMERA_NODE_TYPE,
      data: {
        origin: "north-west",
        units: 7,
        width: 0,
        height: -3,
        resolution: Number.NaN,
      },
    }) as ScreenCamera;

    // §85: a corrupted rectangle restores the default rather than throwing on
    // the way in and taking the whole scene with it.
    expect(camera.origin).toBe("top-left");
    expect(camera.units).toBe("logical");
    expect([camera.width, camera.height, camera.resolution]).toEqual([1, 1, 1]);
  });

  it("restores a camera from a payload that says nothing at all", () => {
    const camera = io.read.nodeFactory({
      type: PERSPECTIVE_CAMERA_NODE_TYPE,
    }) as PerspectiveCamera;

    expect(camera.aspect).toBe(1);
  });

  it("ignores a sprite extent and anchor the class would reject", () => {
    const badge = io.read.nodeFactory({
      type: SPRITE_NODE_TYPE,
      data: {
        material: "material/decal",
        width: 0,
        height: -4,
        anchor: [Number.NaN, 1],
        renderLayer: "front",
      },
    }) as Sprite;

    expect([badge.width, badge.height]).toEqual([1, 1]);
    expect([badge.anchor.x, badge.anchor.y]).toEqual([0.5, 0.5]);
    expect(badge.renderLayer).toBe(0);
  });

  it("ignores an anchor that is not a pair at all", () => {
    const badge = io.read.nodeFactory({
      type: SPRITE_NODE_TYPE,
      data: { material: "material/decal", anchor: { x: 0, y: 0 } },
    }) as Sprite;

    expect([badge.anchor.x, badge.anchor.y]).toEqual([0.5, 0.5]);
  });

  it("ignores a light colour and intensity it cannot use", () => {
    for (const color of [[1, 2], "white", [1, Number.NaN, 1]]) {
      const light = io.read.nodeFactory({
        type: DIRECTIONAL_LIGHT_NODE_TYPE,
        data: { color, intensity: Infinity },
      }) as DirectionalLight;

      expect([...light.color]).toEqual([1, 1, 1]);
      expect(light.intensity).toBe(1);
    }
  });

  it("reads a colour a build wrote in full", () => {
    const light = io.read.nodeFactory({
      type: DIRECTIONAL_LIGHT_NODE_TYPE,
      data: { color: [0.2, 0.4, 0.6], intensity: 2.5 },
    }) as DirectionalLight;

    expect([...light.color]).toEqual([0.2, 0.4, 0.6]);
    expect(light.intensity).toBe(2.5);
  });

  it("restores the punctual lights' defaults from a payload it cannot use", () => {
    // The same rule the directional light follows: an unusable number falls
    // back to the class default rather than failing the whole document.
    const lamp = io.read.nodeFactory({
      type: POINT_LIGHT_NODE_TYPE,
      data: { color: "white", intensity: Infinity, range: Number.NaN },
    }) as PointLight;
    expect([...lamp.color]).toEqual([1, 1, 1]);
    expect([lamp.intensity, lamp.range]).toEqual([1, 0]);

    const spot = io.read.nodeFactory({
      type: SPOT_LIGHT_NODE_TYPE,
      data: { innerConeAngle: Number.NaN, outerConeAngle: null },
    }) as SpotLight;
    expect([spot.innerConeAngle, spot.outerConeAngle]).toEqual([
      0,
      Math.PI / 4,
    ]);
  });

  it("reads punctual payloads a build wrote in full", () => {
    const lamp = io.read.nodeFactory({
      type: POINT_LIGHT_NODE_TYPE,
      data: { color: [0.1, 0.2, 0.3], intensity: 6, range: 9 },
    }) as PointLight;
    expect([...lamp.color]).toEqual([0.1, 0.2, 0.3]);
    expect([lamp.intensity, lamp.range]).toEqual([6, 9]);

    const spot = io.read.nodeFactory({
      type: SPOT_LIGHT_NODE_TYPE,
      data: {
        color: [1, 0, 0],
        intensity: 2,
        range: 5,
        innerConeAngle: 0.25,
        outerConeAngle: 0.5,
      },
    }) as SpotLight;
    expect([...spot.color]).toEqual([1, 0, 0]);
    expect([spot.intensity, spot.range]).toEqual([2, 5]);
    expect([spot.innerConeAngle, spot.outerConeAngle]).toEqual([0.25, 0.5]);
  });

  it("round-trips a hemisphere light's two colours", () => {
    const light = io.read.nodeFactory({
      type: HEMISPHERE_LIGHT_NODE_TYPE,
      data: {
        color: [0.6, 0.7, 1],
        groundColor: [0.2, 0.1, 0.05],
        intensity: 0.4,
      },
    }) as HemisphereLight;
    expect(light).toBeInstanceOf(HemisphereLight);
    expect([...light.color]).toEqual([0.6, 0.7, 1]);
    expect([...light.groundColor]).toEqual([0.2, 0.1, 0.05]);
    expect(light.intensity).toBe(0.4);

    const written = io.write.nodeDataOf(light) as {
      color: number[];
      groundColor: number[];
      intensity: number;
    };
    expect(written.color).toEqual([0.6, 0.7, 1]);
    expect(written.groundColor).toEqual([0.2, 0.1, 0.05]);
    expect(written.intensity).toBe(0.4);
  });
});

describe("resourceCatalog (§79)", () => {
  const plane = planeGeometry();
  const box = planeGeometry({ width: 2 });

  it("resolves both directions, and neither for what it does not hold", () => {
    const catalog = resourceCatalog<BufferGeometry>([
      ["geometry/plane", plane],
    ]);

    expect(catalog.keyOf(plane)).toBe("geometry/plane");
    expect(catalog.get("geometry/plane")).toBe(plane);
    expect(catalog.keyOf(box)).toBeUndefined();
    expect(catalog.get("geometry/box")).toBeUndefined();
  });

  it("keeps the first key of a resource published twice, and resolves both", () => {
    const catalog = resourceCatalog<BufferGeometry>([
      ["geometry/plane", plane],
      ["geometry/floor", plane],
    ]);

    expect(catalog.keyOf(plane)).toBe("geometry/plane");
    expect(catalog.get("geometry/floor")).toBe(plane);
  });

  it("tolerates the same entry twice, which says nothing new", () => {
    const catalog = resourceCatalog<BufferGeometry>([
      ["geometry/plane", plane],
      ["geometry/plane", plane],
    ]);

    expect(catalog.get("geometry/plane")).toBe(plane);
  });

  it("refuses one key naming two resources", () => {
    let thrown: unknown;
    try {
      resourceCatalog<BufferGeometry>([
        ["geometry/plane", plane],
        ["geometry/plane", box],
      ]);
    } catch (error) {
      thrown = error;
    }

    expect(isFourError(thrown) && thrown.code).toBe(
      "INVALID_APPLICATION_STATE",
    );
  });
});

describe("composeSceneNodeTypes", () => {
  const custom = new Group();
  custom.name = "mine";
  const mine = {
    write: {
      nodeTypeOf: (node: { name: string }): string | undefined =>
        node.name === "mine" ? "com.example.thing" : undefined,
      // `null` is a legitimate §79 payload, and must not fall through.
      nodeDataOf: (node: { name: string }): null | undefined =>
        node.name === "mine" ? null : undefined,
    },
    read: {
      nodeFactory: (document: { type: string }): Group | undefined =>
        document.type === "com.example.thing" ? new Group() : undefined,
    },
  };

  it("takes the first answer and falls through on undefined only", () => {
    const io = registerSceneNodeTypes();
    const composed = composeSceneNodeTypes(mine, io);

    expect(composed.write.nodeTypeOf(custom)).toBe("com.example.thing");
    expect(composed.write.nodeDataOf(custom)).toBeNull();
    expect(
      composed.read.nodeFactory({ type: "com.example.thing" }),
    ).toBeInstanceOf(Group);

    const panel = new Panel({ width: 12 });
    expect(composed.write.nodeTypeOf(panel)).toBe(PANEL_NODE_TYPE);
    expect(composed.write.nodeDataOf(panel)).toMatchObject({ width: 12 });
    expect(composed.read.nodeFactory({ type: PANEL_NODE_TYPE })).toBeInstanceOf(
      Panel,
    );
  });

  it("answers nothing when nobody claims the node", () => {
    const composed = composeSceneNodeTypes(registerUISerializers(), mine);

    expect(composed.write.nodeTypeOf(new Group())).toBeUndefined();
    expect(composed.write.nodeDataOf(new Group())).toBeUndefined();
    expect(composed.read.nodeFactory({ type: "group" })).toBeUndefined();
  });
});

/**
 * §54's skinned tier survives §79 (RFC 0003 — gaps PH-10 + R-22): a `Mesh`
 * keeps its class, its shared resources, and its skeleton — written as bone
 * ids plus inverse bind matrices, resolved against the reloaded `scene:bone`
 * nodes on the first read — and `MorphWeights` rounds through the component
 * registry like every other component.
 */
describe("registerSceneNodeTypes — Mesh, Bone, and MorphWeights (RFC 0003)", () => {
  const skinnedPlane = planeGeometry();
  {
    const vertexCount = skinnedPlane.vertexCount;
    skinnedPlane.joints = new Uint16Array(vertexCount * 4);
    const weights = new Float32Array(vertexCount * 4);
    for (let i = 0; i < vertexCount; i += 1) {
      weights[i * 4] = 1;
    }
    skinnedPlane.weights = weights;
  }
  const skin = new UnlitMaterial();
  const geometries = resourceCatalog<BufferGeometry>([
    ["geometry/skinned-plane", skinnedPlane],
  ]);
  const materials = resourceCatalog<Material>([["material/skin", skin]]);

  function buildSkinnedScene(): Scene {
    const scene = new Scene();
    const mesh = new Mesh(skinnedPlane, skin, { renderLayer: 1 });
    const hip = new Bone();
    hip.name = "hip";
    hip.transform.position.set(0, 1, 0);
    const knee = new Bone();
    knee.transform.position.set(0, -0.5, 0);
    hip.add(knee);
    const binds = new Float32Array(32);
    for (const base of [0, 16]) {
      binds[base] = 1;
      binds[base + 5] = 1;
      binds[base + 10] = 1;
      binds[base + 15] = 1;
    }
    binds[13] = -1; // hip's bind at y = 1
    mesh.skeleton = new Skeleton([hip, knee], binds);
    mesh.addComponent(new MorphWeights([0.25, 0.75]));
    scene.add(mesh, hip);
    return scene;
  }

  it("round-trips the mesh, its skeleton, and its morph weights through text", () => {
    const io = registerSceneNodeTypes({ geometries, materials });
    const scene = buildSkinnedScene();

    const reloaded = instantiateScene(
      decodeSceneDocument(
        encodeSceneDocument(serializeScene(scene, io.components, io.write)),
      ),
      io.components,
      io.read,
    );

    const [mesh, hip] = reloaded.children as [Mesh, Bone];
    expect(mesh).toBeInstanceOf(Mesh);
    expect(mesh.geometry).toBe(skinnedPlane);
    expect(mesh.material).toBe(skin);
    expect(mesh.renderLayer).toBe(1);

    expect(hip).toBeInstanceOf(Bone);
    expect(hip.name).toBe("hip");
    const knee = hip.children[0];
    expect(knee).toBeInstanceOf(Bone);

    // The reference resolved against the *reloaded* bones, in joint order.
    const skeleton = mesh.skeleton;
    expect(skeleton).not.toBeNull();
    expect(skeleton?.bones[0]).toBe(hip);
    expect(skeleton?.bones[1]).toBe(knee);
    expect(skeleton?.inverseBindMatrices[13]).toBe(-1);

    const weights = mesh.getComponent(MorphWeights);
    expect(Array.from(weights?.weights ?? [])).toEqual([0.25, 0.75]);
    expect(mesh.morphTargetWeights).toBe(weights?.weights);
  });

  it("round-trips CPU mode using authored geometry instead of generated vertices", () => {
    const io = registerSceneNodeTypes({ geometries, materials });
    const scene = buildSkinnedScene();
    const mesh = scene.children[0] as Mesh;
    mesh.skinningMode = "cpu";
    expect(mesh.geometry).not.toBe(skinnedPlane);
    const document = serializeScene(scene, io.components, io.write);
    const reloaded = instantiateScene(document, io.components, io.read);
    const restored = reloaded.children[0] as Mesh;
    expect(restored.skinningMode).toBe("cpu");
    expect(restored.bindGeometry).toBe(skinnedPlane);
    expect(serializeScene(reloaded, io.components, io.write)).toEqual(document);
  });

  it("is textually idempotent, skeleton included — the P11-1 gate", () => {
    const io = registerSceneNodeTypes({ geometries, materials });
    const scene = buildSkinnedScene();
    const first = encodeSceneDocument(
      serializeScene(scene, io.components, io.write),
    );
    const second = encodeSceneDocument(
      serializeScene(
        instantiateScene(decodeSceneDocument(first), io.components, io.read),
        io.components,
        io.write,
      ),
    );
    expect(second).toBe(first);
  });

  it("names both classes by exact identity, and writes null for no skeleton", () => {
    const io = registerRenderSerializers({ geometries, materials });
    const mesh = new Mesh(skinnedPlane, skin);
    expect(io.write.nodeTypeOf(mesh)).toBe(MESH_NODE_TYPE);
    expect(io.write.nodeTypeOf(new Bone())).toBe(BONE_NODE_TYPE);
    expect(
      io.write.nodeTypeOf(new (class extends Mesh {})(skinnedPlane, skin)),
    ).toBeUndefined();
    expect(io.write.nodeDataOf(mesh)).toMatchObject({ skeleton: null });
    expect(io.write.nodeDataOf(new Bone())).toBeUndefined();
  });

  it("restores a mesh with no skeleton from a shape-corrupt record", () => {
    const io = registerRenderSerializers({ geometries, materials });
    for (const skeleton of [
      undefined,
      null,
      42,
      { bones: [] },
      { bones: ["a"], inverseBindMatrices: "nope" },
      { bones: [7], inverseBindMatrices: [] },
      { bones: ["a"], inverseBindMatrices: [Number.NaN] },
    ]) {
      const mesh = io.read.nodeFactory({
        type: MESH_NODE_TYPE,
        data: {
          geometry: "geometry/skinned-plane",
          material: "material/skin",
          skeleton: skeleton as never,
        },
      }) as Mesh;
      expect(mesh).toBeInstanceOf(Mesh);
      expect(mesh.skeleton).toBeNull();
    }
  });

  it("lets the classes refuse a well-formed record that cannot exist (§85)", () => {
    const io = registerRenderSerializers({ geometries, materials });
    // 16 floats for two bones: the restore seam refuses the mismatch loudly.
    expect(() =>
      io.read.nodeFactory({
        type: MESH_NODE_TYPE,
        data: {
          geometry: "geometry/skinned-plane",
          material: "material/skin",
          skeleton: {
            bones: ["a", "b"],
            inverseBindMatrices: Array.from(new Float32Array(16)),
          },
        },
      }),
    ).toThrowError(/16 per bone/);
  });

  it("restores a bone under its saved id (§79, A-17)", () => {
    const io = registerRenderSerializers({});
    const bone = io.read.nodeFactory({
      type: BONE_NODE_TYPE,
      id: "node-saved-bone",
    }) as Bone;
    expect(bone).toBeInstanceOf(Bone);
    expect(bone.id).toBe("node-saved-bone");
    expect(io.read.nodeFactory({ type: BONE_NODE_TYPE })).toBeInstanceOf(Bone);
  });
});
