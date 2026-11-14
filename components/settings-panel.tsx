import type { ReaderSettings } from "@/lib/ui-types";
import { Dialog } from "./ui/dialog";
import { Icon } from "./ui/icon";

export function SettingsPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: ReaderSettings;
  onChange: (next: ReaderSettings) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      label="Settings"
      className="settings-dialog"
      animateClose
      onClose={onClose}
    >
      <div className="settings-fields">
        <fieldset>
          <legend>Font</legend>
          <div className="segment font-segment">
            {(["OpenDyslexic", "Lexend", "Arial"] as const).map((font) => (
              <button
                type="button"
                key={font}
                aria-pressed={settings.font === font}
                style={{ fontFamily: font }}
                onClick={() => onChange({ ...settings, font })}
              >
                {font}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Size</legend>
          <label className="size-control">
            <span className="small-a" aria-hidden="true">
              A
            </span>
            <input
              aria-label="Text size"
              type="range"
              min="20"
              max="36"
              step="1"
              value={settings.size}
              aria-valuetext={`${settings.size} pixels`}
              onChange={(e) =>
                onChange({ ...settings, size: Number(e.target.value) })
              }
            />
            <span className="large-a" aria-hidden="true">
              A
            </span>
          </label>
        </fieldset>
        <fieldset>
          <legend>Spacing</legend>
          <div className="segment">
            {(["Tight", "Normal", "Wide"] as const).map((spacing) => (
              <button
                type="button"
                key={spacing}
                aria-pressed={settings.spacing === spacing}
                onClick={() => onChange({ ...settings, spacing })}
              >
                {spacing}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Background</legend>
          <div className="background-options">
            {(["cream", "peach", "navy", "dark"] as const).map(
              (background) => (
                <button
                  type="button"
                  key={background}
                  className={`swatch swatch-${background}`}
                  aria-label={`${background} background`}
                  title={`${background[0].toUpperCase()}${background.slice(1)}`}
                  aria-pressed={settings.background === background}
                  onClick={() => onChange({ ...settings, background })}
                >
                  {settings.background === background && <Icon name="check" />}
                </button>
              ),
            )}
          </div>
        </fieldset>
        <fieldset>
          <legend>Motion</legend>
          <label className="motion-setting">
            <span>Reduce animations</span>
            <input
              type="checkbox"
              checked={settings.reduceMotion}
              onChange={(event) =>
                onChange({ ...settings, reduceMotion: event.target.checked })
              }
            />
          </label>
        </fieldset>
      </div>
    </Dialog>
  );
}
