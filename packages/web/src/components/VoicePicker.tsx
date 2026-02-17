import { voiceGroups } from "../lib/voices.ts";

type VoicePickerProps = {
  value: string;
  onChange: (voice: string) => void;
};

export function VoicePicker({ value, onChange }: VoicePickerProps) {
  return (
    <div className="flex-1">
      <label className="block text-sm font-medium text-zinc-700 mb-1">Voice</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {voiceGroups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} ({v.gender}) — {v.grade}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
