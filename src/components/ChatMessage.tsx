import { useState, useEffect, useRef, useCallback } from 'react';
import { CornerRightDown } from 'lucide-react';
import type { ChatMessage as ChatMessageType } from '../types/chat';

interface ChatMessageProps {
  message: ChatMessageType;
  onSend: (text: string) => void;
  showSuggestions?: boolean;
  voiceActive?: boolean;
  onTypingComplete?: () => void;
}

export default function ChatMessage({
  message,
  onSend,
  showSuggestions = false,
  voiceActive = false,
  onTypingComplete,
}: ChatMessageProps) {
  const isUser = message.role === 'user';
  const [displayedContent, setDisplayedContent] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showSubTypes, setShowSubTypes] = useState(false);
  const animatedRef = useRef(false);
  // Stable ref for onTypingComplete to avoid re-triggering the typewriter effect
  const onTypingCompleteRef = useRef(onTypingComplete);
  onTypingCompleteRef.current = onTypingComplete;

  // Debounced scroll — prevents thrashing when typing fast
  const lastScrollTime = useRef(0);
  const scrollRafRef = useRef<number | null>(null);

  const debouncedScroll = useCallback(() => {
    const now = Date.now();
    // Throttle: at most once every 150ms during typing
    if (now - lastScrollTime.current < 150) return;
    lastScrollTime.current = now;

    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      onTypingCompleteRef.current?.();
      scrollRafRef.current = null;
    });
  }, []);

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

      // §3: Throttled scroll during typing (every 10 chars)
      if (index % 10 === 0) {
        debouncedScroll();
      }

      if (index >= content.length) {
        clearInterval(timer);
        setIsTyping(false);
        // §3: Final scroll when typing finishes — always fire
        onTypingCompleteRef.current?.();
      }
    }, speed);

    return () => {
      clearInterval(timer);
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
    // NOTE: onTypingComplete omitted from deps intentionally — using ref instead
    // to avoid restarting the typewriter effect when the callback identity changes.
    // voiceActive IS included because it affects typing speed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.content, isUser, voiceActive, debouncedScroll]);

  // §1: Auto-focus logic when the message finishes typing and has no suggestions
  useEffect(() => {
    if (!isUser && showSuggestions && !isTyping) {
      // §3: Scroll to bottom when suggestions appear — cascade for reliability
      onTypingCompleteRef.current?.();
      // Scroll again after buttons render (staggered for different render timings)
      setTimeout(() => onTypingCompleteRef.current?.(), 100);
      setTimeout(() => onTypingCompleteRef.current?.(), 300);
      setTimeout(() => onTypingCompleteRef.current?.(), 600);

      if (!message.suggestions || message.suggestions.length === 0) {
        // §1: Automatically focus the input field for free text entry
        setTimeout(() => {
          document.getElementById('chat-input-field')?.focus();
        }, 50);
      }
    }
  }, [isUser, showSuggestions, isTyping, message.suggestions]);

  // Reset sub-type expansion when new suggestions arrive
  useEffect(() => {
    setShowSubTypes(false);
  }, [message.suggestions]);

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

  // Detect if this is the property-type question with "Друг" as a top-level option
  const hasDrugTopLevel = message.suggestions?.some((s) => s.value === 'Друг') ?? false;

  // Secondary property type options revealed when "Друг" is clicked
  const SUB_TYPES = [
    '4-стаен', 'Многостаен', 'Мезонет', 'Ателие / таван',
    'Етаж от къща', 'Къща', 'Магазин', 'Офис', 'Заведение',
    'Гараж', 'Склад', 'Промишлен обект', 'Промишлен терен', 'Хотел', 'Пропусни',
  ];

  return (
    <div className="flex gap-3 px-4 py-1.5 message-enter">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white border border-slate-100 flex items-center justify-center shadow-sm overflow-hidden mt-1">
        <img
          src="/agent.png"
          alt="Bot"
          className="w-full h-full object-cover border-0"
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

        {/* Suggestions — shown only on the latest assistant message after typing finishes */}
        {showSuggestions && !isTyping && message.suggestions && message.suggestions.length > 0 && (
          <>
            {/* Top-level buttons (hidden while sub-type panel is open) */}
            {!showSubTypes && (
              <div className="flex flex-wrap gap-2 mt-2 animate-fade-in-up">
                {message.suggestions.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => {
                      if (s.value === 'Друг' && hasDrugTopLevel) {
                        // Expand the secondary list — do NOT send to agent yet
                        setShowSubTypes(true);
                        // §3: Scroll after sub-types expand
                        setTimeout(() => onTypingCompleteRef.current?.(), 100);
                      } else {
                        onSend(s.value);
                      }
                    }}
                    className="px-4 py-2 bg-white border border-secondary/30 text-primary text-sm font-medium rounded-xl shadow-sm hover:bg-secondary/10 hover:border-secondary transition-all active:scale-95"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}

            {/* Secondary sub-type selector — shown after "Друг" is clicked */}
            {showSubTypes && (
              <div className="mt-2 animate-fade-in-up">
                <p className="text-xs text-slate-500 mb-2 px-1">Изберете конкретен тип:</p>
                <div className="flex flex-wrap gap-2">
                  {SUB_TYPES.map((label) => (
                    <button
                      key={label}
                      onClick={() => {
                        setShowSubTypes(false);
                        onSend(label);
                      }}
                      className={`px-4 py-2 text-sm font-medium rounded-xl shadow-sm border transition-all active:scale-95 ${
                        label === 'Пропусни'
                          ? 'bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100'
                          : 'bg-white border-secondary/30 text-primary hover:bg-secondary/10 hover:border-secondary'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  {/* Back button — returns to top-level without sending anything */}
                  <button
                    onClick={() => setShowSubTypes(false)}
                    className="px-3 py-2 text-xs font-medium rounded-xl bg-slate-50 border border-slate-200 text-slate-500 hover:bg-slate-100 transition-all active:scale-95"
                  >
                    ← Назад
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Inline Focus Guide for free-text input */}
        {showSuggestions &&
          !isTyping &&
          (!message.suggestions || message.suggestions.length === 0) && (
            <div
              className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-primary/5 text-primary rounded-xl border border-primary/10 animate-bounce cursor-pointer hover:bg-primary/10 transition-colors shadow-sm"
              onClick={() => document.getElementById('chat-input-field')?.focus()}
            >
              <CornerRightDown className="w-4 h-4" />
              <span className="text-[13px] font-medium tracking-tight">Напишете вашия отговор долу</span>
            </div>
          )}
      </div>
    </div>
  );
}
