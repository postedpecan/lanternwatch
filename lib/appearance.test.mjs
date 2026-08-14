import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  applyPalette,
  contrastRatio,
  getAppearanceInitializerScript,
  loadAppearance,
  normalizeHexColorInput,
  parseAppearance,
  saveAppearance,
  updateAppearance,
} from "./appearance.ts";

test("hex input normalization accepts short and full forms with an optional hash", () => {
  assert.equal(normalizeHexColorInput("#abc"), "#AABBCC");
  assert.equal(normalizeHexColorInput("ABC"), "#AABBCC");
  assert.equal(normalizeHexColorInput("#12aBef"), "#12ABEF");
  assert.equal(normalizeHexColorInput(" 12abef "), "#12ABEF");
});

test("hex input normalization rejects incomplete and malformed colors", () => {
  for (const value of ["", "#", "#12", "#1234", "#12345", "#1234567", "#12GG34", "red"]) {
    assert.equal(normalizeHexColorInput(value), null, `${JSON.stringify(value)} is invalid`);
  }
});

function runInitializer({ theme = "light", storedAppearance = null } = {}) {
  const properties = new Map();
  const meta = { content: null, setAttribute: (_name, value) => { meta.content = value; } };
  const documentElement = {
    dataset: {},
    style: { setProperty: (name, value) => properties.set(name, value) },
  };
  const storage = new Map([
    ["lanternwatch-theme", theme],
    [APPEARANCE_STORAGE_KEY, storedAppearance === null ? null : JSON.stringify(storedAppearance)],
  ]);
  vm.runInNewContext(getAppearanceInitializerScript(), {
    document: {
      documentElement,
      querySelector: (selector) => selector === 'meta[name="theme-color"]' ? meta : null,
    },
    localStorage: { getItem: (key) => storage.get(key) ?? null },
  });
  return { properties, meta, theme: documentElement.dataset.theme };
}

test("appearance parsing rejects unknown versions and repairs invalid categories", () => {
  assert.deepEqual(parseAppearance('{"version":99}'), DEFAULT_APPEARANCE);

  const parsed = parseAppearance(JSON.stringify({
    version: 1,
    palettes: {
      light: { ...DEFAULT_APPEARANCE.palettes.light, accent: "#123456", danger: "red" },
      dark: DEFAULT_APPEARANCE.palettes.dark,
    },
  }));

  assert.equal(parsed.palettes.light.accent, "#123456");
  assert.equal(parsed.palettes.light.danger, DEFAULT_APPEARANCE.palettes.light.danger);
});

test("palette updates preserve readable contrast for text and semantic states", () => {
  const changed = updateAppearance(DEFAULT_APPEARANCE, "light", "surface", "#808080");
  const palette = changed.palettes.light;

  assert.equal(palette.surface, "#808080");
  assert.ok(contrastRatio(palette.text, palette.surface) >= 4.5);
  for (const category of ["accent", "success", "warning", "danger"]) {
    assert.ok(contrastRatio(palette[category], palette.surface) >= 4.5, `${category} remains readable`);
  }
});

test("palette application writes semantic tokens and readable derived text", () => {
  const applied = new Map();
  applyPalette({ setProperty: (name, value) => applied.set(name, value) }, DEFAULT_APPEARANCE.palettes.dark);

  assert.deepEqual([...applied.keys()].slice(0, 6), [
    "--palette-surface",
    "--palette-text",
    "--palette-accent",
    "--palette-success",
    "--palette-warning",
    "--palette-danger",
  ]);
  assert.equal(applied.get("--palette-warning"), "#d29922");
  assert.ok(contrastRatio(applied.get("--muted"), DEFAULT_APPEARANCE.palettes.dark.surface) >= 4.5);
  assert.ok(contrastRatio(applied.get("--faint"), DEFAULT_APPEARANCE.palettes.dark.surface) >= 4.5);
});

test("appearance preferences round-trip through the versioned device key", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const changed = updateAppearance(DEFAULT_APPEARANCE, "dark", "accent", "#80aaff");

  assert.equal(saveAppearance(storage, changed), true);
  assert.ok(values.has(APPEARANCE_STORAGE_KEY));
  assert.deepEqual(loadAppearance(storage), changed);
});

test("blocked device storage falls back without breaking palette controls", () => {
  const blocked = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
  };

  assert.deepEqual(loadAppearance(blocked), DEFAULT_APPEARANCE);
  assert.equal(saveAppearance(blocked, DEFAULT_APPEARANCE), false);
});

test("pre-hydration initializer normalizes unsafe persisted contrast", () => {
  const unsafe = {
    version: 1,
    palettes: {
      light: {
        surface: "#ffffff",
        text: "#ffffff",
        accent: "#ffffff",
        success: "#ffffff",
        warning: "#ffffff",
        danger: "#ffffff",
      },
      dark: DEFAULT_APPEARANCE.palettes.dark,
    },
  };
  const initialized = runInitializer({ storedAppearance: unsafe });
  const expected = parseAppearance(JSON.stringify(unsafe)).palettes.light;

  assert.equal(initialized.theme, "light");
  assert.equal(initialized.meta.content, expected.surface);
  for (const category of ["surface", "text", "accent", "success", "warning", "danger"]) {
    assert.equal(initialized.properties.get(`--palette-${category}`), expected[category]);
  }
  for (const category of ["text", "accent", "success", "warning", "danger"]) {
    assert.ok(contrastRatio(initialized.properties.get(`--palette-${category}`), expected.surface) >= 4.5);
  }
});

test("pre-hydration initializer repairs malformed palette fields with theme defaults", () => {
  const tampered = {
    version: 1,
    palettes: {
      light: { surface: "white", text: "not-a-color", accent: "#123456" },
      dark: DEFAULT_APPEARANCE.palettes.dark,
    },
  };
  const initialized = runInitializer({ storedAppearance: tampered });
  const expected = parseAppearance(JSON.stringify(tampered)).palettes.light;

  for (const category of ["surface", "text", "accent", "success", "warning", "danger"]) {
    assert.equal(initialized.properties.get(`--palette-${category}`), expected[category]);
  }
});
