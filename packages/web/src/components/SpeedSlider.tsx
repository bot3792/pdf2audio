type SpeedSliderProps = {
  value: number;
  onChange: (speed: number) => void;
};

export function SpeedSlider({ value, onChange }: SpeedSliderProps) {
  return (
    <div className="w-48">
      <label className="block text-sm font-medium text-zinc-700 mb-1">
        Speed: {value.toFixed(1)}x
      </label>
      <input
        type="range"
        min="0.5"
        max="2.0"
        step="0.1"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-blue-600"
      />
    </div>
  );
}
