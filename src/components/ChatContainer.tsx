import { useEffect, useRef, useCallback, useState } from 'react';
import { RotateCcw, Volume2 } from 'lucide-react';
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageCountOnVoiceStart = useRef(0);
  const lastSpokenId = useRef('');
  const [showVoiceBanner, setShowVoiceBanner] = useState(false);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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

      if (text === 'ACTION_RELOAD') {
        window.location.reload();
        return;
      }

      sendUserMessage(text);
    },
    [sendUserMessage]
  );

  // Find the ID of the LAST assistant message in the list
  let lastAssistantMessageId: string | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      lastAssistantMessageId = messages[i].id;
      break;
    }
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* ─── Header ─── */}
      <div className="bg-white px-4 py-3 border-b border-slate-200 shadow-sm z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-auto">
              <img
                src="https://cm4-production-assets.s3.amazonaws.com/1771351056422-logo354x100.png"
                alt="Столични имоти"
                className="h-full w-auto object-contain"
              />
            </div>
            <div>
              <h1 className="text-base font-bold text-primary tracking-tight leading-tight">
                Столични имоти
              </h1>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs text-slate-500 font-medium">
                  Онлайн асистент
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
            {leadSubmitted && (
              <button
                onClick={resetChat}
                className="p-2.5 rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors"
                title="Нов разговор"
              >
                <RotateCcw className="w-5 h-5" />
              </button>
            )}
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
      <div className="flex-1 overflow-y-auto scroll-smooth">
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
            />
          ))}

          {isLoading && (
            <div className="flex gap-3 px-4 py-1.5 message-enter">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white border border-slate-100 flex items-center justify-center shadow-sm overflow-hidden mt-1">
                <img
                  src="https://cm4-production-assets.s3.amazonaws.com/1771352656526-logo354x100.png"
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

          <div ref={messagesEndRef} className="h-4" />
        </div>
      </div>

      {/* ─── Input Area ─── */}
      <div className="bg-white border-t border-slate-200 p-4">
        <div className="max-w-2xl mx-auto">
          <ChatInput
            onSend={handleSendMessage}
            onPhotoUpload={handlePhotoUpload}
            onVoiceToggle={handleVoiceToggle}
            voiceActive={voiceActive}
            voiceListening={isListening}
            disabled={isLoading || (leadSubmitted && !voiceActive)}
          />
        </div>
      </div>
    </div>
  );
}
