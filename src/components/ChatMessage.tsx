import { useState, useEffect, useRef } from 'react';
import type { ChatMessage as ChatMessageType } from '../types/chat';

interface ChatMessageProps {
  message: ChatMessageType;
  onSend: (text: string) => void;
  showSuggestions?: boolean;
  voiceActive?: boolean;
}

export default function ChatMessage({
  message,
  onSend,
  showSuggestions = false,
  voiceActive = false,
}: ChatMessageProps) {
  const isUser = message.role === 'user';
  const [displayedContent, setDisplayedContent] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const animatedRef = useRef(false);

  // Typewriter effect for assistant messages
  useEffect(() => {
    if (isUser) {
      setDisplayedContent(message.content);
      return;
    }

    // If already animated (e.g. StrictMode re-mount), show full content immediately
    if (animatedRef.current) {
      setDisplayedContent(message.content);
      setIsTyping(false);
      return;
    }

    animatedRef.current = true;
    setIsTyping(true);

    let index = 0;
    const content = message.content;
    // When voice is active, type at speech pace (~65ms/char ≈ natural speaking rate)
    // so the text appears simultaneously as the agent speaks
    const speed = voiceActive
      ? 65
      : Math.max(12, 30 - content.length / 20);

    const timer = setInterval(() => {
      index++;
      setDisplayedContent(content.slice(0, index));
      if (index >= content.length) {
        clearInterval(timer);
        setIsTyping(false);
      }
    }, speed);

    return () => {
      clearInterval(timer);
    };
  }, [message.content, isUser]);

  if (isUser) {
    return (
      <div className="flex justify-end px-4 py-1.5 message-enter">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm px-4 py-3 bg-gradient-to-br from-primary to-primary/90 text-white shadow-sm">
          <p className="text-[15px] leading-relaxed whitespace-pre-wrap">
            {message.content}
          </p>
          {message.photoUrls && message.photoUrls.length > 0 && (
            <div className="flex gap-2 mt-2">
              {message.photoUrls.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt="Uploaded"
                  className="rounded-xl max-w-full max-h-48 object-cover border border-white/20"
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 px-4 py-1.5 message-enter">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white border border-slate-100 flex items-center justify-center shadow-sm overflow-hidden mt-1">
        <img
          src="https://cm4-production-assets.s3.amazonaws.com/1771352656526-logo354x100.png"
          alt="Bot"
          className="w-full h-full object-cover"
        />
      </div>
      <div className="max-w-[85%]">
        <div className="bg-white rounded-2xl rounded-bl-sm shadow-sm border border-slate-100 px-4 py-3">
          <p className="text-[15px] text-slate-700 leading-relaxed whitespace-pre-wrap">
            {displayedContent}
            {isTyping && (
              <span className="animate-pulse inline-block w-1 h-4 ml-1 align-middle bg-slate-400 rounded-full" />
            )}
          </p>
        </div>

        {/* Show suggestions ONLY on latest assistant message and only after typing finishes */}
        {showSuggestions &&
          !isTyping &&
          message.suggestions &&
          message.suggestions.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2 animate-fade-in-up">
              {message.suggestions.map((s) => (
                <button
                  key={s.value}
                  onClick={() => onSend(s.value)}
                  className="px-4 py-2 bg-white border border-secondary/30 text-primary text-sm font-medium rounded-xl shadow-sm hover:bg-secondary/10 hover:border-secondary transition-all active:scale-95"
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
