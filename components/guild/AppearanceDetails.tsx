"use client";

import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { useGuildData } from "@/components/guild/GuildDataContext";
import {
  APPEARANCE_CATEGORIES,
  DEFAULT_APPEARANCE,
  applyPalette,
  loadAppearance,
  normalizeHexColorInput,
  saveAppearance,
  updateAppearance,
  type AppearanceCategory,
  type AppearancePreferences,
} from "@/lib/appearance";

function freshDefaults(): AppearancePreferences {
  return {
    version: DEFAULT_APPEARANCE.version,
    palettes: {
      light: { ...DEFAULT_APPEARANCE.palettes.light },
      dark: { ...DEFAULT_APPEARANCE.palettes.dark },
    },
  };
}

function applyActivePalette(preferences: AppearancePreferences, theme: "light" | "dark") {
  const palette = preferences.palettes[theme];
  applyPalette(document.documentElement.style, palette);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", palette.surface);
}

function loadBrowserAppearance() {
  try {
    return loadAppearance(window.localStorage);
  } catch {
    return freshDefaults();
  }
}

function saveBrowserAppearance(preferences: AppearancePreferences) {
  try {
    return saveAppearance(window.localStorage, preferences);
  } catch {
    return false;
  }
}

function HexColorInput({
  category,
  descriptionId,
  label,
  value,
  onCommit,
}: {
  category: AppearanceCategory;
  descriptionId: string;
  label: string;
  value: string;
  onCommit: (category: AppearanceCategory, color: string) => void;
}) {
  const errorId = `${descriptionId}-error`;
  const appliedValue = normalizeHexColorInput(value) ?? value.toUpperCase();
  const [draft, setDraft] = useState(appliedValue);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(appliedValue);
    setError("");
  }, [appliedValue]);

  function commit() {
    const normalized = normalizeHexColorInput(draft);
    if (!normalized) {
      setError("Use #RGB or #RRGGBB.");
      return;
    }
    setDraft(normalized);
    setError("");
    onCommit(category, normalized);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(appliedValue);
      setError("");
    }
  }

  return (
    <div className="palette-hex-control">
      <input
        className="palette-hex-input"
        type="text"
        value={draft}
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        maxLength={7}
        aria-label={`${label} hex color`}
        aria-describedby={`${descriptionId}${error ? ` ${errorId}` : ""}`}
        aria-invalid={error ? "true" : undefined}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          if (error) setError("");
        }}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
      {error ? <span className="palette-input-error" id={errorId}>{error}</span> : null}
    </div>
  );
}

export function AppearanceDetails() {
  const { theme } = useGuildData();
  const id = useId();
  const [preferences, setPreferences] = useState<AppearancePreferences>(freshDefaults);
  const [saveState, setSaveState] = useState("Saved on this device");

  useEffect(() => {
    const stored = loadBrowserAppearance();
    setPreferences(stored);
    applyActivePalette(stored, theme);
  }, [theme]);

  const palette = preferences.palettes[theme];

  function commitColor(category: AppearanceCategory, color: string) {
    const next = updateAppearance(preferences, theme, category, color);
    const adjusted = APPEARANCE_CATEGORIES.some(({ id: categoryId }) => (
      categoryId === category
        ? next.palettes[theme][categoryId] !== color.toLowerCase()
        : next.palettes[theme][categoryId] !== preferences.palettes[theme][categoryId]
    ));
    setPreferences(next);
    applyActivePalette(next, theme);
    const saved = saveBrowserAppearance(next);
    setSaveState(saved
      ? adjusted ? "Adjusted for contrast; saved" : "Saved on this device"
      : "Applied for this session");
  }

  return (
    <details className="appearance-details">
      <summary aria-label="Appearance settings" title="Appearance settings">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="2.5" />
          <circle cx="16" cy="8" r="2.5" />
          <circle cx="8" cy="16" r="2.5" />
          <path d="M16 13.5a2.5 2.5 0 1 0 2.5 2.5c0-.5-.1-.9-.3-1.3l1.8-1.8" />
        </svg>
        <span className="sr-only">Appearance settings</span>
      </summary>
      <div className="appearance-panel">
        <div className="appearance-heading">
          <div>
            <strong>Appearance</strong>
            <span>Editing the {theme} theme</span>
          </div>
          <span className="appearance-save-state" aria-live="polite">{saveState}</span>
        </div>
        <p>One color per role keeps matching UI and status states consistent.</p>
        <fieldset className="palette-fields">
          <legend className="sr-only">{theme} theme semantic colors</legend>
          {APPEARANCE_CATEGORIES.map((category) => {
            const inputId = `${id}-${theme}-${category.id}`;
            const descriptionId = `${inputId}-description`;
            return (
              <div className="palette-field" key={category.id}>
                <label htmlFor={inputId}>
                  <strong>{category.label}</strong>
                  <span>{category.description}</span>
                </label>
                <HexColorInput
                  category={category.id}
                  descriptionId={descriptionId}
                  label={category.label}
                  value={palette[category.id]}
                  onCommit={commitColor}
                />
                <input
                  id={inputId}
                  type="color"
                  value={palette[category.id]}
                  aria-label={`${category.label} color picker`}
                  aria-describedby={descriptionId}
                  title={`Choose ${category.label.toLowerCase()} color`}
                  onChange={(event) => commitColor(category.id, event.currentTarget.value)}
                />
                <span className="sr-only" id={descriptionId}>{category.description}</span>
              </div>
            );
          })}
        </fieldset>
        <div className="appearance-actions">
          <span>Switch themes to customize each palette.</span>
          <button
            type="button"
            onClick={() => {
              const defaults = freshDefaults();
              setPreferences(defaults);
              applyActivePalette(defaults, theme);
              const saved = saveBrowserAppearance(defaults);
              setSaveState(saved ? "Defaults restored" : "Defaults applied for this session");
            }}
          >
            Reset all
          </button>
        </div>
      </div>
    </details>
  );
}
