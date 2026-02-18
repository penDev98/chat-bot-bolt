interface VoiceWaveProps {
  active: boolean;
  label?: string;
}

export default function VoiceWave({ active, label }: VoiceWaveProps) {
  if (!active) return null;

  return (
    <div className="flex flex-col items-center gap-2 py-3">
      <div className="flex items-end justify-center gap-[3px]">
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            key={i}
            className="voice-bar w-1 rounded-full bg-teal-500"
            style={{
              animationDelay: `${i * 80}ms`,
              height: '20px',
            }}
          />
        ))}
      </div>
      {label && (
        <span className="text-xs text-teal-600 font-medium">{label}</span>
      )}
    </div>
  );
}
