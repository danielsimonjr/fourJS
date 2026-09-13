/**
 * §96's *"safe shader/plugin boundaries"*, stated exactly and then enforced
 * (A-3 / RFC 0002 §6, 2026-08-28).
 *
 * ## The posture, in one paragraph
 *
 * A plugin is JavaScript the application imported. It runs with the
 * application's authority, and **nothing in this repository sandboxes it**. A
 * sandbox would mean Workers or realms plus a serialisable message boundary for
 * every registry a capability hands over, which is a project in itself and
 * would change the shape of all six tokens. So the boundary §96 asks for is not
 * "a plugin is contained"; it is:
 *
 * > **Untrusted content can never become a plugin.** A plugin is a *value* the
 * > application passes to `PluginHost.add` or `ApplicationOptions.plugins` —
 * > never a URL, never a module specifier, never a name resolved out of a
 * > document. No deserialization path may reach the plugin host.
 *
 * That claim is mechanically enforceable, so it is enforced here rather than
 * asserted in prose — the discipline `A-23` established for the CSP claim and
 * `A-2` for the §40 units allowlist. Two checks, matching RFC 0002 §6's own
 * list:
 *
 * 1. **No deserializing package can reach the host.** Nothing under
 *    `@fourjs/serialization` or `@fourjs/assets` — the two packages that turn
 *    external bytes into engine objects — names the plugin host at all. The
 *    allowlist is visible below and editing it is deliberately a visible act.
 * 2. **`add` admits no string.** The parameter type is `FourPlugin`, so a
 *    module specifier is a compile error, not a runtime check somebody can
 *    forget. `@ts-expect-error` is the assertion, and `bun run typecheck:tests`
 *    is what runs it.
 *
 * The second half of §96's phrase — safe **shader** boundaries — is answered by
 * RFC 0001, not here: shading is a graph of closed operators, so a plugin
 * supplying shading supplies data, and supplying a new *operator* is explicitly
 * out of scope in both RFCs.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { PluginHost, installPlugins, type FourPlugin } from "@fourjs/core";
import { describe, expect, it } from "vitest";

const repositoryRoot = join(import.meta.dirname, "..", "..");
const packagesRoot = join(repositoryRoot, "packages");

/**
 * The names that only the plugin host and its declarers may mention.
 *
 * A package appearing here has been confirmed *not* to be on a deserialization
 * path: `core` declares the machinery, `fourjs` (the directory; package name `fourJS`) re-exports the capability tokens
 * and installs from §45's option. Adding a third entry means someone has
 * decided that package may host plugins — write the reason and the date.
 */
const ALLOWED = new Set(["core", "fourjs"]);

/**
 * The packages that may additionally *declare* capability tokens
 * ({@link TOKEN_NAMES}): the registry owners RFC 0002 §2 names, joined
 * 2026-08-29 when the tokens moved home from `four/plugins.ts` and extended
 * 2026-09-06 for the five remaining §81 points (assets, materials, ui,
 * plus `four` for host-side editor tools and `render` for compute).
 * Declaring a token is naming a
 * `{ name, revocable }` key — it confers no ability to install a plugin or
 * to acquire a capability, so `serialization` declaring
 * `COMPONENT_SERIALIZERS` does not weaken the §96 claim: the *host* names
 * ({@link HOST_NAMES}) stay banned there, and nothing a document names can
 * become a plugin, exactly as before.
 */
const TOKEN_DECLARERS = new Set([
  "core",
  "fourjs",
  "motion",
  "physics",
  "render",
  "serialization",
  // The five remaining §81 points (2026-09-06): each token lives in the
  // package that owns its (new, minimal) registry. Declaring a token is
  // still not hosting a plugin — HOST_NAMES stay banned here.
  "assets",
  "materials",
  "ui",
]);

/**
 * The packages §96's sentence is about: everything that turns external content
 * into engine objects. These may never name the host, allowlist or no.
 */
const DESERIALIZING = ["serialization", "assets"];

/**
 * Identifiers that only exist because a module is talking to the plugin
 * host — the machinery that accepts and installs plugins and hands
 * capabilities over.
 */
const HOST_NAMES = [
  "PluginHost",
  "installPlugins",
  "FourPlugin",
  "PluginContext",
];

/**
 * Identifiers that only exist because a module *declares* a capability token
 * (RFC 0002 §2). Split from {@link HOST_NAMES} 2026-08-29: a token is a key,
 * not authority — see {@link TOKEN_DECLARERS}.
 */
const TOKEN_NAMES = ["defineCapability", "PluginCapability"];

/** Every `.ts` file under `packages/<name>/src`, recursively. */
function sourceFiles(packageName: string): string[] {
  const root = join(packagesRoot, packageName, "src");
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (entry.endsWith(".ts")) {
        found.push(path);
      }
    }
  };
  walk(root);
  return found;
}

/** Every workspace package directory name. */
function packageNames(): string[] {
  return readdirSync(packagesRoot).filter((name) =>
    statSync(join(packagesRoot, name)).isDirectory(),
  );
}

/** Repo-relative source files under `packageName` mentioning one of `names`. */
function mentionsOf(packageName: string, names: readonly string[]): string[] {
  return sourceFiles(packageName)
    .filter((path) => {
      const text = readFileSync(path, "utf8");
      return names.some((name) => text.includes(name));
    })
    .map((path) => relative(repositoryRoot, path).split(sep).join("/"));
}

describe("§96: untrusted content can never become a plugin", () => {
  it("keeps the plugin host out of every deserializing package", () => {
    for (const packageName of DESERIALIZING) {
      expect(
        mentionsOf(packageName, HOST_NAMES),
        `${packageName} must not reach the §81 plugin host: a document names a registered type name, never a module (§79, §96)`,
      ).toEqual([]);
    }
  });

  it("keeps it out of every package but the two that declare it", () => {
    const offenders = packageNames()
      .filter((name) => !ALLOWED.has(name))
      .flatMap((name) => mentionsOf(name, HOST_NAMES));
    expect(offenders).toEqual([]);
  });

  it("keeps token declaration to the registry owners", () => {
    const offenders = packageNames()
      .filter((name) => !TOKEN_DECLARERS.has(name))
      .flatMap((name) => mentionsOf(name, TOKEN_NAMES));
    expect(offenders).toEqual([]);
  });

  it("admits no string where a plugin is expected", async () => {
    const host = new PluginHost();
    // @ts-expect-error §96: a module specifier is not a plugin, and the type
    // system is where that is enforced — never a runtime check somebody forgets.
    host.add("@vendor/thing");
    // A URL is a string with a parser in front of it, and so is anything a JSON
    // document could carry.
    // @ts-expect-error A URL is not a plugin either — the host resolves nothing.
    host.add(new URL("https://example.invalid/plugin.js"));
    // Belt and braces: even with the compiler silenced, neither value survives
    // installation — a "plugin" with no `X.Y.Z` version is refused (§85).
    await expect(host.install()).rejects.toThrow(/exactly `X\.Y\.Z`/);
    await expect(
      // @ts-expect-error Same rule at the front door `Application` uses.
      installPlugins(["@vendor/thing"]),
    ).rejects.toThrow(/exactly `X\.Y\.Z`/);
  });

  it("accepts only a value carrying an install function", () => {
    const host = new PluginHost();
    const plugin: FourPlugin = {
      name: "@vendor/value",
      version: "1.0.0",
      install() {
        // A value, constructed by the application, in the application's own
        // module graph. That is the whole boundary.
      },
    };
    expect(host.add(plugin)).toBe(host);
    expect(host.added).toEqual([plugin]);
  });
});
