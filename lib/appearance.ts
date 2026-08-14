export const APPEARANCE_VERSION = 1;
export const APPEARANCE_STORAGE_KEY = `lanternwatch-appearance-v${APPEARANCE_VERSION}`;

export type AppearanceTheme = "light" | "dark";
export type AppearanceCategory = "surface" | "text" | "accent" | "success" | "warning" | "danger";
export type SemanticPalette = Record<AppearanceCategory, string>;
export type AppearancePreferences = {
  version: typeof APPEARANCE_VERSION;
  palettes: Record<AppearanceTheme, SemanticPalette>;
};

export const APPEARANCE_CATEGORIES: ReadonlyArray<{
  id: AppearanceCategory;
  label: string;
  description: string;
}> = [
  { id: "surface", label: "Surfaces", description: "Page, panels, controls, and derived borders" },
  { id: "text", label: "Text", description: "Headings, body copy, labels, and muted text" },
  { id: "accent", label: "Accent", description: "Links, focus rings, estimates, and selections" },
  { id: "success", label: "Success", description: "Complete, connected, and live states" },
  { id: "warning", label: "Warning", description: "Working and queued states" },
  { id: "danger", label: "Danger", description: "Interrupted, stalled, offline, and error states" },
];

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  version: APPEARANCE_VERSION,
  palettes: {
    light: {
      surface: "#ffffff",
      text: "#1f2328",
      accent: "#0969da",
      success: "#1a7f37",
      warning: "#9a6700",
      danger: "#cf222e",
    },
    dark: {
      surface: "#0d1117",
      text: "#e6edf3",
      accent: "#4493f8",
      success: "#3fb950",
      warning: "#d29922",
      danger: "#f85149",
    },
  },
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const HEX_COLOR_INPUT = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const PALETTE_VARIABLES: Record<AppearanceCategory, string> = {
  surface: "--palette-surface",
  text: "--palette-text",
  accent: "--palette-accent",
  success: "--palette-success",
  warning: "--palette-warning",
  danger: "--palette-danger",
};

function cloneDefaults(): AppearancePreferences {
  return {
    version: APPEARANCE_VERSION,
    palettes: {
      light: { ...DEFAULT_APPEARANCE.palettes.light },
      dark: { ...DEFAULT_APPEARANCE.palettes.dark },
    },
  };
}

export function normalizeHexColorInput(value: string): string | null {
  const match = value.trim().match(HEX_COLOR_INPUT);
  if (!match) return null;

  const digits = match[1].length === 3
    ? [...match[1]].map((digit) => `${digit}${digit}`).join("")
    : match[1];
  return `#${digits.toUpperCase()}`;
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function rgbToHex([red, green, blue]: [number, number, number]) {
  return `#${[red, green, blue].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function luminance(hex: string) {
  const channels = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(first: string, second: string) {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function mix(first: string, second: string, secondWeight: number) {
  const firstRgb = hexToRgb(first);
  const secondRgb = hexToRgb(second);
  return rgbToHex(firstRgb.map((channel, index) => (
    channel + (secondRgb[index] - channel) * secondWeight
  )) as [number, number, number]);
}

function ensureContrast(color: string, surface: string, minimum: number) {
  const normalized = color.toLowerCase();
  if (contrastRatio(normalized, surface) >= minimum) return normalized;

  const blackContrast = contrastRatio("#000000", surface);
  const whiteContrast = contrastRatio("#ffffff", surface);
  const target = blackContrast >= whiteContrast ? "#000000" : "#ffffff";
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const midpoint = (low + high) / 2;
    if (contrastRatio(mix(normalized, target, midpoint), surface) >= minimum) high = midpoint;
    else low = midpoint;
  }
  return mix(normalized, target, high);
}

export function normalizePalette(palette: SemanticPalette): SemanticPalette {
  const surface = HEX_COLOR.test(palette.surface) ? palette.surface.toLowerCase() : "#ffffff";
  return {
    surface,
    text: ensureContrast(palette.text, surface, 7),
    accent: ensureContrast(palette.accent, surface, 4.5),
    success: ensureContrast(palette.success, surface, 4.5),
    warning: ensureContrast(palette.warning, surface, 4.5),
    danger: ensureContrast(palette.danger, surface, 4.5),
  };
}

function parsePalette(candidate: unknown, fallback: SemanticPalette): SemanticPalette {
  if (!candidate || typeof candidate !== "object") return { ...fallback };
  const source = candidate as Partial<Record<AppearanceCategory, unknown>>;
  const merged = Object.fromEntries(
    APPEARANCE_CATEGORIES.map(({ id }) => [
      id,
      typeof source[id] === "string" && HEX_COLOR.test(source[id])
        ? source[id].toLowerCase()
        : fallback[id],
    ]),
  ) as SemanticPalette;
  return normalizePalette(merged);
}

export function parseAppearance(raw: string | null): AppearancePreferences {
  if (!raw) return cloneDefaults();
  try {
    const candidate = JSON.parse(raw) as Partial<AppearancePreferences>;
    if (candidate.version !== APPEARANCE_VERSION || !candidate.palettes) return cloneDefaults();
    return {
      version: APPEARANCE_VERSION,
      palettes: {
        light: parsePalette(candidate.palettes.light, DEFAULT_APPEARANCE.palettes.light),
        dark: parsePalette(candidate.palettes.dark, DEFAULT_APPEARANCE.palettes.dark),
      },
    };
  } catch {
    return cloneDefaults();
  }
}

export function loadAppearance(storage: Pick<Storage, "getItem">): AppearancePreferences {
  try {
    return parseAppearance(storage.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return cloneDefaults();
  }
}

export function saveAppearance(
  storage: Pick<Storage, "setItem">,
  preferences: AppearancePreferences,
) {
  try {
    storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

export function updateAppearance(
  preferences: AppearancePreferences,
  theme: AppearanceTheme,
  category: AppearanceCategory,
  color: string,
): AppearancePreferences {
  if (!HEX_COLOR.test(color)) return preferences;
  const palette = normalizePalette({ ...preferences.palettes[theme], [category]: color });
  return {
    version: APPEARANCE_VERSION,
    palettes: {
      light: { ...preferences.palettes.light },
      dark: { ...preferences.palettes.dark },
      [theme]: palette,
    },
  };
}

type StyleTarget = { setProperty: (name: string, value: string) => void };

export function applyPalette(style: StyleTarget, palette: SemanticPalette) {
  for (const { id } of APPEARANCE_CATEGORIES) {
    style.setProperty(PALETTE_VARIABLES[id], palette[id]);
  }
  style.setProperty("--muted", ensureContrast(mix(palette.text, palette.surface, 0.28), palette.surface, 4.5));
  style.setProperty("--faint", ensureContrast(mix(palette.text, palette.surface, 0.38), palette.surface, 4.5));
}

export function getAppearanceInitializerScript() {
  const key = JSON.stringify(APPEARANCE_STORAGE_KEY);
  const defaults = JSON.stringify(DEFAULT_APPEARANCE.palettes);
  const variables = JSON.stringify(PALETTE_VARIABLES);
  return `
  (function () {
    var theme = "light";
    var defaults = ${defaults};
    var variables = ${variables};
    var savedPalette = null;
    var validHex = /^#[0-9a-f]{6}$/i;
    function rgb(hex) {
      return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16)
      ];
    }
    function toHex(channels) {
      return "#" + channels.map(function (channel) {
        return Math.round(channel).toString(16).padStart(2, "0");
      }).join("");
    }
    function luminance(hex) {
      var channels = rgb(hex).map(function (channel) {
        var value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    }
    function contrast(first, second) {
      var firstLuminance = luminance(first);
      var secondLuminance = luminance(second);
      var lighter = Math.max(firstLuminance, secondLuminance);
      var darker = Math.min(firstLuminance, secondLuminance);
      return (lighter + 0.05) / (darker + 0.05);
    }
    function mixColor(first, second, secondWeight) {
      var firstRgb = rgb(first);
      var secondRgb = rgb(second);
      return toHex(firstRgb.map(function (channel, index) {
        return channel + (secondRgb[index] - channel) * secondWeight;
      }));
    }
    function ensureReadable(color, surface, minimum) {
      var normalized = color.toLowerCase();
      if (contrast(normalized, surface) >= minimum) return normalized;
      var target = contrast("#000000", surface) >= contrast("#ffffff", surface)
        ? "#000000"
        : "#ffffff";
      var low = 0;
      var high = 1;
      for (var iteration = 0; iteration < 16; iteration += 1) {
        var midpoint = (low + high) / 2;
        if (contrast(mixColor(normalized, target, midpoint), surface) >= minimum) high = midpoint;
        else low = midpoint;
      }
      return mixColor(normalized, target, high);
    }
    function normalize(source, fallback) {
      var surface = validHex.test(source.surface || "")
        ? source.surface.toLowerCase()
        : fallback.surface;
      function candidate(category) {
        var value = source[category];
        return validHex.test(value || "") ? value.toLowerCase() : fallback[category];
      }
      return {
        surface: surface,
        text: ensureReadable(candidate("text"), surface, 7),
        accent: ensureReadable(candidate("accent"), surface, 4.5),
        success: ensureReadable(candidate("success"), surface, 4.5),
        warning: ensureReadable(candidate("warning"), surface, 4.5),
        danger: ensureReadable(candidate("danger"), surface, 4.5)
      };
    }
    try {
      theme = localStorage.getItem("lanternwatch-theme") === "dark" ? "dark" : "light";
      var saved = JSON.parse(localStorage.getItem(${key}) || "null");
      if (saved && saved.version === ${APPEARANCE_VERSION} && saved.palettes &&
          saved.palettes[theme] && typeof saved.palettes[theme] === "object") {
        savedPalette = saved.palettes[theme];
      }
    } catch (_) {}
    document.documentElement.dataset.theme = theme;
    var palette = normalize(Object.assign({}, defaults[theme], savedPalette || {}), defaults[theme]);
    Object.keys(variables).forEach(function (category) {
      var value = palette[category];
      document.documentElement.style.setProperty(variables[category], value);
    });
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", palette.surface);
  })();`;
}
