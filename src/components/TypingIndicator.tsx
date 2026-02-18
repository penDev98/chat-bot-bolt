export default function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-4 py-3">
      <span
        className="typing-dot w-2 h-2 bg-slate-400 rounded-full"
        style={{ animationDelay: '0ms' }}
      />
      <span
        className="typing-dot w-2 h-2 bg-slate-400 rounded-full"
        style={{ animationDelay: '150ms' }}
      />
      <span
        className="typing-dot w-2 h-2 bg-slate-400 rounded-full"
        style={{ animationDelay: '300ms' }}
      />
    </div>
  );
}
