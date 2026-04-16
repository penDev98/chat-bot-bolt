import { useEffect, useRef, useCallback, useState } from 'react';
import { Volume2, X } from 'lucide-react';
import { useChatAgent } from '../hooks/useChatAgent';
import { useVoiceMode } from '../hooks/useVoiceMode';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import TypingIndicator from './TypingIndicator';

export default function ChatContainer() {
  const {
    messages,
    isLoading,
    leadSubmitted,
    sendUserMessage,
    handlePhotoUpload,
    resetChat,
    submitPartialAndReset,
    injectBotMessage,
  } = useChatAgent();

  const {
    voiceActive,
    isListening,
    isSpeaking,
    pendingTranscript,
    toggleVoice,
    consumeTranscript,
    speak,
    stopSpeaking,
  } = useVoiceMode();

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageCountOnVoiceStart = useRef(0);
  const lastSpokenId = useRef('');
  const [showVoiceBanner, setShowVoiceBanner] = useState(false);

  // §3: Robust scroll-to-bottom function
  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, []);

  // §3: Auto-scroll to bottom — multiple triggers for async rendering
  useEffect(() => {
    // Immediate scroll
    scrollToBottom();
    // After DOM paint
    const t1 = setTimeout(scrollToBottom, 100);
    // After suggestion buttons render
    const t2 = setTimeout(scrollToBottom, 400);
    // After typewriter typing effect
    const t3 = setTimeout(scrollToBottom, 800);
    // After longer messages complete typing
    const t4 = setTimeout(scrollToBottom, 1500);
    // Final catch-all for very long messages
    const t5 = setTimeout(scrollToBottom, 2500);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
    };
  }, [messages, isLoading, scrollToBottom]);

  // §3: Debounced MutationObserver — scroll on DOM changes without thrashing
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let scrollRafId: number | null = null;
    const debouncedScroll = () => {
      if (scrollRafId) cancelAnimationFrame(scrollRafId);
      scrollRafId = requestAnimationFrame(() => {
        scrollToBottom();
        scrollRafId = null;
      });
    };

    const observer = new MutationObserver(debouncedScroll);

    observer.observe(container, {
      childList: true,
      subtree: true,
      // NOTE: characterData intentionally omitted — the typewriter effect sets
      // textContent on every char which would cause scroll thrashing
    });

    return () => {
      observer.disconnect();
      if (scrollRafId) cancelAnimationFrame(scrollRafId);
    };
  }, [scrollToBottom]);

  // §1: Keep input cursor active at all times
  useEffect(() => {
    const focusInput = () => {
      const input = document.getElementById('chat-input-field') as HTMLInputElement | null;
      if (input && document.activeElement !== input) {
        // Don't steal focus from file input or buttons being clicked
        const active = document.activeElement;
        if (active?.tagName === 'BUTTON' || (active?.tagName === 'INPUT' && active !== input)) {
          return;
        }
        input.focus();
      }
    };

    // Focus after each message update
    const timer = setTimeout(focusInput, 200);
    return () => clearTimeout(timer);
  }, [messages, isLoading]);

  // Broadcast dimensions for iframe hosting
  useEffect(() => {
    // Small delay to allow DOM to finish layout paints
    const timer = setTimeout(() => {
      window.parent.postMessage(
        {
          type: 'CHAT_HEIGHT_EVENT',
          height: document.documentElement.scrollHeight,
        },
        '*'
      );
    }, 100);
    return () => clearTimeout(timer);
  }, [messages, isSpeaking, isListening]);

  // Speak ONLY new messages that arrive AFTER voice was toggled on
  useEffect(() => {
    if (!voiceActive) return;
    if (isLoading) return;

    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant') return;
    if (lastMsg.id === lastSpokenId.current) return;
    if (messages.length <= messageCountOnVoiceStart.current) return;

    lastSpokenId.current = lastMsg.id;
    speak(lastMsg.content);
  }, [messages, voiceActive, speak, isLoading]);

  // Auto-send transcript when done listening
  useEffect(() => {
    if (pendingTranscript && !isListening) {
      stopSpeaking();
      sendUserMessage(pendingTranscript);
      consumeTranscript();
    }
  }, [pendingTranscript, isListening, sendUserMessage, consumeTranscript, stopSpeaking]);

  const handleVoiceToggle = useCallback(() => {
    if (voiceActive) {
      stopSpeaking();
    } else {
      messageCountOnVoiceStart.current = messages.length;
      setShowVoiceBanner(true);
      setTimeout(() => setShowVoiceBanner(false), 3000);
    }
    toggleVoice();
  }, [voiceActive, toggleVoice, stopSpeaking, messages.length]);

  const handleSendMessage = useCallback(
    (text: string) => {
      if (text === 'ACTION_FOCUS') {
        setTimeout(() => {
          document.getElementById('chat-input-field')?.focus();
        }, 100);
        return;
      }

      // §5: Restart conversation action
      if (text === 'ACTION_RESTART') {
        resetChat();
        return;
      }

      // §5: Close chat action — reset and minimize
      if (text === 'ACTION_CLOSE') {
        resetChat();
        // Notify parent frame to minimize the chat (if embedded)
        window.parent.postMessage({ type: 'CHAT_CLOSE' }, '*');
        return;
      }

      // Legacy reload action
      if (text === 'ACTION_RELOAD') {
        resetChat();
        return;
      }

      // §10: Expert consultation accepted — deterministic response
      if (text === 'ACTION_EXPERT_YES') {
        injectBotMessage('Наш експерт-оценител ще се свърже с вас за да уточните подробностите.', [
          { label: 'Начало', value: 'ACTION_RESTART' }
        ]);
        return;
      }

      // §5/§10: End conversation prompt — inject a LOCAL bot message
      // (not sent as a user message — that would show the user saying bot text)
      if (text === 'END_CONVERSATION_PROMPT') {
        injectBotMessage('Мога ли да бъда полезен с нещо друго?', [
          { label: 'Да', value: 'ACTION_RESTART' },
          { label: 'Не, благодаря', value: 'ACTION_CLOSE' },
        ]);
        return;
      }

      sendUserMessage(text);
    },
    [sendUserMessage, resetChat, injectBotMessage]
  );

  // §12: Close button handler — full reset and minimize
  const handleCloseChat = useCallback(() => {
    // submitPartialAndReset now resets first synchronously, then submits async
    submitPartialAndReset();
    // Notify parent frame to minimize
    window.parent.postMessage({ type: 'CHAT_CLOSE' }, '*');
  }, [submitPartialAndReset]);

  // Find the ID of the LAST assistant message in the list
  let lastAssistantMessageId: string | null = null;
  let forceSelection = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      lastAssistantMessageId = messages[i].id;
      if (messages[i].suggestions?.length === 20) {
        forceSelection = true;
      }
      break;
    }
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Hidden SVG filter for logo recoloring: black→#2A3075, white→white */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <filter id="recolor-to-brand-blue" colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values="0.8353 0 0 0 0.1647 0 0.8118 0 0 0.1882 0 0 0.5412 0 0.4588 0 0 0 1 0" />
          </filter>
        </defs>
      </svg>
      {/* ─── Header ─── */}
      <div className="bg-white px-4 py-3 border-b border-slate-200 shadow-sm z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-auto">
              <img
                src="/logo.png"
                alt="Столични имоти"
                className="h-full w-auto object-contain logo-brand-blue"
              />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                {/* §11: Logo status dot color matches chat avatar/brand color */}
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="text-xs text-slate-500 font-medium">
                  Имотко - вашият асистент
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {voiceActive && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-50 border border-red-100 animate-fade-in">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                </span>
                <span className="text-xs font-medium text-red-600">
                  {isSpeaking
                    ? 'Говоря...'
                    : isListening
                      ? 'Слушам...'
                      : 'Гласов режим'}
                </span>
              </div>
            )}

            {/* §12: Close (X) button */}
            <button
              onClick={handleCloseChat}
              className="p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
              title="Затвори чат"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* ─── Voice Mode Banner ─── */}
      {showVoiceBanner && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 animate-fade-in">
          <div className="flex items-center gap-2.5 px-5 py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-2xl shadow-lg">
            <Volume2 className="w-5 h-5" />
            <span className="text-sm font-semibold">Гласов режим включен</span>
          </div>
        </div>
      )}

      {/* ─── Messages ─── */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto scroll-smooth"
      >
        <div className="max-w-2xl mx-auto w-full py-6">
          {messages.map((message) => (
            <ChatMessage
              key={message.id}
              message={message}
              onSend={handleSendMessage}
              voiceActive={voiceActive}
              showSuggestions={
                !isLoading &&
                message.role === 'assistant' &&
                message.id === lastAssistantMessageId
              }
              onTypingComplete={scrollToBottom}
            />
          ))}

          {isLoading && (
            <div className="flex gap-3 px-4 py-1.5 message-enter">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white border border-slate-100 flex items-center justify-center shadow-sm overflow-hidden mt-1">
                <img
                  src="/agent.png"
                  alt="Bot"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="bg-white rounded-2xl rounded-bl-sm shadow-sm border border-slate-100 px-4 py-3">
                <TypingIndicator />
              </div>
            </div>
          )}

          {leadSubmitted && (
            <div className="mx-6 my-4 p-6 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100 text-center shadow-sm message-enter">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-100 flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-emerald-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-emerald-900 mb-1">
                Заявката е приета!
              </h3>
              <p className="text-sm text-emerald-700 mb-4">
                Благодарим ви! Наш консултант ще се свърже с вас скоро.
              </p>
              <button
                onClick={resetChat}
                className="px-6 py-2 bg-emerald-600 text-white rounded-full text-sm font-medium hover:bg-emerald-700 transition-colors shadow-sm"
              >
                Започни нов разговор
              </button>
            </div>
          )}

          <div ref={messagesEndRef} className="h-8" />
        </div>
      </div>

      {/* ─── Input Area ─── */}
      <div className="bg-white/40 backdrop-blur-2xl border-t border-slate-200/50 p-4 pb-6 relative overflow-hidden">
        {/* Decorative background flare */}
        <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -top-24 -right-24 w-64 h-64 bg-secondary/5 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-2xl mx-auto relative">
          <ChatInput
            onSend={handleSendMessage}
            onPhotoUpload={handlePhotoUpload}
            onVoiceToggle={handleVoiceToggle}
            voiceActive={voiceActive}
            voiceListening={isListening}
            disabled={isLoading || (leadSubmitted && !voiceActive) || forceSelection}
            forceSelection={forceSelection}
          />
        </div>
      </div>
    </div>
  );
}
