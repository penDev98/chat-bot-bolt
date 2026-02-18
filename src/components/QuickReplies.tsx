import type { QuickReply } from '../types/chat';

interface QuickRepliesProps {
  replies: QuickReply[];
  onSelect: (value: string) => void;
  disabled?: boolean;
}

export default function QuickReplies({ replies, onSelect, disabled }: QuickRepliesProps) {
  return (
    <div className="flex flex-wrap gap-2 px-4 pb-3">
      {replies.map((reply) => (
        <button
          key={reply.value}
          onClick={() => onSelect(reply.value)}
          disabled={disabled}
          className="px-4 py-2.5 rounded-full border border-teal-200 text-teal-700 bg-white hover:bg-teal-50 hover:border-teal-300 active:scale-95 transition-all text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          {reply.label}
        </button>
      ))}
    </div>
  );
}
