import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {
  APPEARANCE_VERSION,
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  LEGACY_APPEARANCE_STORAGE_KEY,
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

function runInitializer({
  theme = "dark",
  storedAppearance = null,
  legacyAppearance = null,
  failWrites = false,
} = {}) {
  const properties = new Map();
  const meta = { content: null, setAttribute: (_name, value) => { meta.content = value; } };
  const documentElement = {
    dataset: {},
    style: { setProperty: (name, value) => properties.set(name, value) },
  };
  const storage = new Map([["lanternwatch-theme", theme]]);
  if (storedAppearance !== null) storage.set(APPEARANCE_STORAGE_KEY, JSON.stringify(storedAppearance));
  if (legacyAppearance !== null) storage.set(LEGACY_APPEARANCE_STORAGE_KEY, JSON.stringify(legacyAppearance));
  vm.runInNewContext(getAppearanceInitializerScript(), {
    document: {
      documentElement,
      querySelector: (selector) => selector === 'meta[name="theme-color"]' ? meta : null,
    },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        if (failWrites) throw new Error("blocked");
        storage.set(key, value);
      },
      removeItem: (key) => storage.delete(key),
    },
  });
  return { properties, meta, storage, theme: documentElement.dataset.theme };
}

test("appearance parsing rejects unknown versions and repairs invalid categories", () => {
  assert.deepEqual(parseAppearance('{"version":99}'), DEFAULT_APPEARANCE);

  const parsed = parseAppearance(JSON.stringify({
    version: APPEARANCE_VERSION,
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
  assert.equal(applied.get("--palette-warning"), "#ff9f43");
  assert.ok(contrastRatio(applied.get("--muted"), DEFAULT_APPEARANCE.palettes.dark.surface) >= 4.5);
  assert.ok(contrastRatio(applied.get("--faint"), DEFAULT_APPEARANCE.palettes.dark.surface) >= 4.5);
});

test("appearance preferences round-trip through the versioned device key", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
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
    removeItem: () => { throw new Error("blocked"); },
  };

  assert.deepEqual(loadAppearance(blocked), DEFAULT_APPEARANCE);
  assert.equal(saveAppearance(blocked, DEFAULT_APPEARANCE), false);
});

test("pre-hydration initializer normalizes unsafe persisted contrast", () => {
  const unsafe = {
    version: APPEARANCE_VERSION,
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
  const initialized = runInitializer({ theme: "light", storedAppearance: unsafe });
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
    version: APPEARANCE_VERSION,
    palettes: {
      light: { surface: "white", text: "not-a-color", accent: "#123456" },
      dark: DEFAULT_APPEARANCE.palettes.dark,
    },
  };
  const initialized = runInitializer({ theme: "light", storedAppearance: tampered });
  const expected = parseAppearance(JSON.stringify(tampered)).palettes.light;

  for (const category of ["surface", "text", "accent", "success", "warning", "danger"]) {
    assert.equal(initialized.properties.get(`--palette-${category}`), expected[category]);
  }
});

test("default amber dark palette meets the documented contrast targets", () => {
  const { surface, text, ...semantic } = DEFAULT_APPEARANCE.palettes.dark;

  assert.deepEqual(DEFAULT_APPEARANCE.palettes.dark, {
    surface: "#18130e",
    text: "#f8f2e7",
    accent: "#ffc857",
    success: "#78d39c",
    warning: "#ff9f43",
    danger: "#ff7a6e",
  });
  assert.ok(contrastRatio(text, surface) >= 7);
  for (const [category, color] of Object.entries(semantic)) {
    assert.ok(contrastRatio(color, surface) >= 4.5, `${category} meets 4.5:1`);
  }
});

test("runtime load migrates v1 by preserving light and replacing dark", () => {
  const values = new Map();
  const legacy = {
    version: 1,
    palettes: {
      light: { ...DEFAULT_APPEARANCE.palettes.light, accent: "#123456" },
      dark: {
        surface: "#101010",
        text: "#ffffff",
        accent: "#80aaff",
        success: "#80ffaa",
        warning: "#ffd080",
        danger: "#ff9090",
      },
    },
  };
  values.set(LEGACY_APPEARANCE_STORAGE_KEY, JSON.stringify(legacy));
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };

  const migrated = loadAppearance(storage);

  assert.equal(migrated.version, APPEARANCE_VERSION);
  assert.equal(migrated.palettes.light.accent, "#123456");
  assert.deepEqual(migrated.palettes.dark, DEFAULT_APPEARANCE.palettes.dark);
  assert.deepEqual(JSON.parse(values.get(APPEARANCE_STORAGE_KEY)), migrated);
  assert.equal(values.has(LEGACY_APPEARANCE_STORAGE_KEY), false);
});

test("runtime load keeps a valid v2 preference authoritative", () => {
  const values = new Map();
  const current = updateAppearance(DEFAULT_APPEARANCE, "dark", "accent", "#80aaff");
  values.set(APPEARANCE_STORAGE_KEY, JSON.stringify(current));
  values.set(LEGACY_APPEARANCE_STORAGE_KEY, JSON.stringify({ version: 1, palettes: {} }));
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };

  assert.deepEqual(loadAppearance(storage), current);
  assert.equal(values.has(LEGACY_APPEARANCE_STORAGE_KEY), true);
});

test("runtime migration never removes v1 when v2 persistence fails", () => {
  const legacy = {
    version: 1,
    palettes: { light: DEFAULT_APPEARANCE.palettes.light, dark: DEFAULT_APPEARANCE.palettes.dark },
  };
  let removed = false;
  const migrated = loadAppearance({
    getItem: (key) => key === LEGACY_APPEARANCE_STORAGE_KEY ? JSON.stringify(legacy) : null,
    setItem: () => { throw new Error("blocked"); },
    removeItem: () => { removed = true; },
  });

  assert.deepEqual(migrated.palettes.dark, DEFAULT_APPEARANCE.palettes.dark);
  assert.equal(removed, false);
});

test("pre-hydration initializer migrates v1 before applying the active palette", () => {
  const legacy = {
    version: 1,
    palettes: {
      light: { ...DEFAULT_APPEARANCE.palettes.light, accent: "#123456" },
      dark: { ...DEFAULT_APPEARANCE.palettes.dark, accent: "#80aaff" },
    },
  };
  const initialized = runInitializer({ theme: "dark", legacyAppearance: legacy });

  assert.equal(initialized.properties.get("--palette-accent"), DEFAULT_APPEARANCE.palettes.dark.accent);
  assert.equal(initialized.storage.has(LEGACY_APPEARANCE_STORAGE_KEY), false);
  const stored = JSON.parse(initialized.storage.get(APPEARANCE_STORAGE_KEY));
  assert.equal(stored.palettes.light.accent, "#123456");
  assert.deepEqual(stored.palettes.dark, DEFAULT_APPEARANCE.palettes.dark);
});

test("pre-hydration initializer uses the amber dark palette on a first visit", () => {
  const initialized = runInitializer({ theme: null });

  assert.equal(initialized.theme, "dark");
  assert.equal(initialized.meta.content, DEFAULT_APPEARANCE.palettes.dark.surface);
  assert.equal(initialized.properties.get("--palette-accent"), DEFAULT_APPEARANCE.palettes.dark.accent);
});
