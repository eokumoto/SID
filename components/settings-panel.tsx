import type { ReaderSettings } from "@/lib/ui-types";
import { Dialog } from "./ui/dialog";
import { Icon } from "./ui/icon";
import { FontSelect } from "./font-select";
import { SPEECH_VOICES, VOICE_LANGUAGE, type Voice } from "@/lib/speech";

export function SettingsPanel({
  settings,
  onChange,
  onClose,
  pro,
  onUpgrade,
}: {
  settings: ReaderSettings;
  onChange: (next: ReaderSettings) => void;
  onClose: () => void;
  pro: boolean;
  onUpgrade: () => void;
}) {
  return (
    <Dialog
      label="Settings"
      className="settings-dialog"
      animateClose
      onClose={onClose}
    >
      <div className="settings-fields">
        <div className="reading-settings">
          <h2><Icon name="settings" />Settings</h2>
        <fieldset>
          <legend id="font-label">Font</legend>
          <FontSelect
            value={settings.font}
            onChange={(font) => onChange({ ...settings, font })}
          />
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
              min="14"
              max="30"
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
          <label className="spacing-control">
            <span>Tight</span>
            <input
              aria-label="Text spacing"
              type="range"
              min="0"
              max="4"
              step="1"
              value={[
                "Tight",
                "Slightly tight",
                "Normal",
                "Slightly wide",
                "Wide",
              ].indexOf(settings.spacing)}
              aria-valuetext={settings.spacing}
              onChange={(event) =>
                onChange({
                  ...settings,
                  spacing: (
                    [
                      "Tight",
                      "Slightly tight",
                      "Normal",
                      "Slightly wide",
                      "Wide",
                    ] as const
                  )[Number(event.target.value)],
                })
              }
            />
            <span>Wide</span>
          </label>
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
        </div>
        <section className="listen-settings" aria-label="Listen settings">
          <h2><Icon name="speaker" />Listen{!pro && <span className="pro-tag">Pro</span>}</h2>
          {!pro && <button type="button" className="listen-settings-lock" onClick={onUpgrade}>Explore Pro</button>}
          <fieldset disabled={!pro}>
            <legend>Voice</legend>
            <div className="segment voice-segment">
              {(Object.keys(SPEECH_VOICES) as Voice[]).map(voice => <button type="button" key={voice} aria-pressed={settings.voice === voice} onClick={() => onChange({ ...settings, voice })}>{voice}<span className="voice-language" lang="en">{VOICE_LANGUAGE}</span></button>)}
            </div>
          </fieldset>
          <fieldset disabled={!pro}>
            <legend>Speed <strong>{settings.speed}×</strong></legend>
            <input type="range" aria-label="Reading speed" min="0.25" max="2" step="0.05" value={settings.speed} aria-valuetext={`${settings.speed} times speed`} onChange={event => onChange({ ...settings, speed: Number(event.target.value) })} />
            <div className="speed-labels"><span>0.25×</span><span>2×</span></div>
          </fieldset>
        </section>
      </div>
    </Dialog>
  );
}
