import React, { useRef, useState, useEffect } from "react";
import { useTheme, THEME_OPTIONS, Theme } from "../contexts/ThemeContext";

interface ThemeSelectorProps {
  /** Renders a compact row of colour swatches for the sidebar */
  compact?: boolean;
  /** Renders a dropdown select for the sidebar */
  dropdown?: boolean;
}

const ThemeSelector: React.FC<ThemeSelectorProps> = ({
  compact = false,
  dropdown = false,
}) => {
  const { theme, setTheme } = useTheme();

  if (dropdown) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const current =
      THEME_OPTIONS.find((o) => o.id === theme) ?? THEME_OPTIONS[0];

    // Close on outside click
    useEffect(() => {
      const handler = (e: MouseEvent) => {
        if (ref.current && !ref.current.contains(e.target as Node)) {
          setOpen(false);
        }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, []);

    return (
      <div
        ref={ref}
        className="theme-dropdown"
        role="combobox"
        aria-expanded={open}
        aria-label="Select colour theme"
      >
        <button
          type="button"
          className="theme-dropdown-trigger"
          onClick={() => setOpen((o) => !o)}
        >
          <span
            className="theme-dropdown-swatch"
            style={{ backgroundColor: current.colors.accent }}
          />
          <span className="theme-dropdown-label">{current.label}</span>
          <svg
            className={`theme-dropdown-chevron${open ? " open" : ""}`}
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {open && (
          <ul className="theme-dropdown-menu" role="listbox">
            {THEME_OPTIONS.map((option) => (
              <li
                key={option.id}
                role="option"
                aria-selected={theme === option.id}
                className={`theme-dropdown-item${theme === option.id ? " active" : ""}`}
                onClick={() => {
                  setTheme(option.id as Theme);
                  setOpen(false);
                }}
              >
                <span
                  className="theme-dropdown-swatch"
                  style={{ backgroundColor: option.colors.accent }}
                />
                {option.label}
                {theme === option.id && (
                  <svg
                    className="theme-dropdown-check"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (compact) {
    return (
      <div
        className="theme-selector-compact"
        role="group"
        aria-label="Select colour theme"
      >
        {THEME_OPTIONS.map((option) => {
          const isActive = theme === option.id;
          return (
            <button
              key={option.id}
              className={`theme-swatch${isActive ? " theme-swatch-active" : ""}`}
              onClick={() => setTheme(option.id as Theme)}
              title={option.label}
              aria-label={option.label}
              aria-pressed={isActive}
              style={{
                backgroundColor: option.colors.bg,
                borderColor: isActive
                  ? option.colors.accent
                  : option.colors.swatchBorder,
              }}
            >
              <span
                className="theme-swatch-dot"
                style={{ backgroundColor: option.colors.accent }}
              />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className="theme-selector"
      role="group"
      aria-label="Select colour theme"
    >
      {THEME_OPTIONS.map((option) => {
        const isActive = theme === option.id;
        return (
          <button
            key={option.id}
            className={`theme-option${isActive ? " theme-option-active" : ""}`}
            onClick={() => setTheme(option.id as Theme)}
            aria-pressed={isActive}
          >
            <div
              className="theme-preview"
              style={{
                backgroundColor: option.colors.bg,
                borderColor: option.colors.accent,
              }}
            >
              <span
                className="theme-preview-accent"
                style={{ backgroundColor: option.colors.accent }}
              />
            </div>
            <div className="theme-option-info">
              <span className="theme-option-label">{option.label}</span>
              <span className="theme-option-description">
                {option.description}
              </span>
            </div>
            {isActive && (
              <span className="theme-option-check" aria-hidden="true">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default ThemeSelector;
