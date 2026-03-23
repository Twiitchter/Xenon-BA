import React from 'react';
import { useTheme, THEME_OPTIONS, Theme } from '../contexts/ThemeContext';

interface ThemeSelectorProps {
  /** Renders a compact row of colour swatches for the sidebar */
  compact?: boolean;
}

const ThemeSelector: React.FC<ThemeSelectorProps> = ({ compact = false }) => {
  const { theme, setTheme } = useTheme();

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
              className={`theme-swatch${isActive ? ' theme-swatch-active' : ''}`}
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
    <div className="theme-selector" role="group" aria-label="Select colour theme">
      {THEME_OPTIONS.map((option) => {
        const isActive = theme === option.id;
        return (
          <button
            key={option.id}
            className={`theme-option${isActive ? ' theme-option-active' : ''}`}
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
