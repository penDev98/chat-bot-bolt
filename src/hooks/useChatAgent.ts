import { useState, useCallback, useRef } from 'react';
import type { ChatMessage, QuickReply } from '../types/chat';
import { submitToExternalAPI, submitConsultationAPI } from '../lib/api';
import type { LeadData } from '../types/chat';
import {
  processMessage,
  createInitialState,
  buildLeadData,
  type EngineState,
} from '../lib/chatEngine';

const INITIAL_MESSAGE: ChatMessage = {
  id: 'init-1',
  role: 'assistant',
  content:
    'Здравейте! Аз съм Имотко - вашият виртуален асистент.\n\nКак мога да помогна във връзка с ваш имот?',
  timestamp: new Date(),
  suggestions: [
    { label: 'Продажба', value: 'Искам да продам имот.' },
    { label: 'Наем', value: 'Искам да отдам имот под наем.' },
    { label: 'Оценка', value: 'Искам оценка на имот.' },
    { label: 'Консултация', value: 'Искам консултация.' },
  ],
};

export function useChatAgent() {
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [isLoading, setIsLoading] = useState(false);
  const [leadSubmitted, setLeadSubmitted] = useState(false);

  const messagesRef = useRef<ChatMessage[]>([INITIAL_MESSAGE]);
  const idCounter = useRef(0);
  // §4: Message queue system — ensures sequential rendering
  const messageQueueRef = useRef<ChatMessage[][]>([]);
  const isProcessingQueueRef = useRef(false);
  // Abort token for cancelling queue processing on reset
  const queueAbortRef = useRef(0);

  // ── Engine state ──
  const engineStateRef = useRef<EngineState>(createInitialState());

  const nextId = () => {
    idCounter.current += 1;
    return `msg-${idCounter.current}`;
  };

  // §4: Process the message queue — renders messages one at a time with delay
  const processMessageQueue = useCallback(async () => {
    if (isProcessingQueueRef.current) return;
    isProcessingQueueRef.current = true;

    const currentAbortToken = queueAbortRef.current;

    while (messageQueueRef.current.length > 0) {
      // Check abort before processing each batch
      if (queueAbortRef.current !== currentAbortToken) break;

      const nextBatch = messageQueueRef.current.shift()!;

      for (const msg of nextBatch) {
        // Check abort before adding each message
        if (queueAbortRef.current !== currentAbortToken) break;

        const updated = [...messagesRef.current, msg];
        messagesRef.current = updated;
        setMessages([...updated]);

        // Wait for typewriter effect to complete before showing next message
        // Only wait between multiple bot messages in the same batch
        if (msg.role === 'assistant' && nextBatch.length > 1) {
          const typingTime = Math.max(600, msg.content.length * 35 + 500);
          await new Promise(resolve => setTimeout(resolve, typingTime));
        }
      }
    }

    isProcessingQueueRef.current = false;
  }, []);

  // Inject a local bot message without calling the engine
  const injectBotMessage = useCallback((content: string, suggestions: QuickReply[] = []) => {
    const botMsg: ChatMessage = {
      id: nextId(),
      role: 'assistant',
      content,
      timestamp: new Date(),
      suggestions,
    };

    const updated = [...messagesRef.current, botMsg];
    messagesRef.current = updated;
    setMessages([...updated]);
  }, []);

  // ── Lead submission helper ──
  const submitLead = useCallback(async (state: EngineState) => {
    const leadData = buildLeadData(state);
    try {
      if (state.dealType === 'consultation') {
        await submitConsultationAPI(leadData);
      } else {
        await submitToExternalAPI(leadData);
      }
      setLeadSubmitted(true);
    } catch (error) {
      console.error('Lead submission failed:', error);
    }
  }, []);

  const sendUserMessage = useCallback(
    async (text: string, photoUrls?: string[]) => {
      const userMsg: ChatMessage = {
        id: nextId(),
        role: 'user',
        content: text,
        timestamp: new Date(),
        photoUrls,
      };

      const updatedMessages = [...messagesRef.current, userMsg];
      messagesRef.current = updatedMessages;
      setMessages(updatedMessages);
      setIsLoading(true);

      // ── Run the deterministic engine ──
      const result = processMessage(engineStateRef.current, text, photoUrls);
      engineStateRef.current = result.state;

      // Build ChatMessage objects from engine response
      const assistantMessages: ChatMessage[] = result.botMessages.map(
        (part, idx) => ({
          id: nextId() + (idx > 0 ? `-${idx}` : ''),
          role: 'assistant',
          content: part.trim(),
          timestamp: new Date(),
          // Only the last bubble gets the suggestions
          suggestions:
            idx === result.botMessages.length - 1
              ? result.suggestions
              : [],
        })
      );

      // §4: Queue messages for sequential rendering
      setIsLoading(false);

      if (assistantMessages.length <= 1) {
        // Single message — add directly, no queue delay needed
        for (const msg of assistantMessages) {
          const updated = [...messagesRef.current, msg];
          messagesRef.current = updated;
          setMessages([...updated]);
        }
      } else {
        // Multiple messages — use queue for sequential rendering
        messageQueueRef.current.push(assistantMessages);
        processMessageQueue();
      }

      // Handle lead submission if the engine says so
      if (result.shouldSubmit) {
        submitLead(result.state);
      }

      return result.botMessages.join('\n\n');
    },
    [processMessageQueue, submitLead]
  );

  const handlePhotoUpload = useCallback(
    async (files: File[]) => {
      setIsLoading(true);
      const urls: string[] = [];

      for (const file of files) {
        // Create a local preview URL instead of uploading to Cloudinary
        const url = URL.createObjectURL(file);
        urls.push(url);

        // Store the file object in a global registry so the API can find it later during submission
        if (!(window as any)._uploadedFiles) (window as any)._uploadedFiles = new Map<string, File>();
        (window as any)._uploadedFiles.set(url, file);
      }

      setIsLoading(false);

      if (urls.length > 0) {
        const photoText = `Качих ${urls.length} ${urls.length === 1 ? 'снимка' : 'снимки'} на имота.`;
        return sendUserMessage(photoText, urls);
      }
      return null;
    },
    [sendUserMessage]
  );

  // §12 & §14: Full reset — clears all state, messages, queue, inputs
  const resetChat = useCallback(() => {
    // Abort any in-progress queue processing
    queueAbortRef.current += 1;

    // Clear message queue
    messageQueueRef.current = [];
    isProcessingQueueRef.current = false;

    messagesRef.current = [INITIAL_MESSAGE];
    setMessages([INITIAL_MESSAGE]);
    setLeadSubmitted(false);
    setIsLoading(false);
    idCounter.current = 0;

    // Reset engine state
    engineStateRef.current = createInitialState();

    // Revoke and clear local photo URLs
    if ((window as any)._uploadedFiles) {
      (window as any)._uploadedFiles.forEach((_: File, url: string) => {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      });
      (window as any)._uploadedFiles.clear();
    }
  }, []);

  // Submit whatever data has been gathered so far and reset the chat
  const submitPartialAndReset = useCallback(async () => {
    // Capture engine state before reset
    const currentEngineState = { ...engineStateRef.current };

    // Reset immediately — don't wait for async submission
    resetChat();

    // Build lead data from engine state (much more reliable than text-scanning)
    const leadData = buildLeadData(currentEngineState);

    // Only submit if we have at least a name and phone number
    const hasName = leadData.contactName !== 'not disclosed' && leadData.contactName.trim() !== '';
    const hasPhone = leadData.contactPhone !== 'not disclosed' && leadData.contactPhone.trim() !== '';

    if (!hasName || !hasPhone) {
      // Not enough data — just reset without sending to DB
      return;
    }

    try {
      // Route consultation submissions to the dedicated contact-form API
      if (leadData.dealType === 'consultation') {
        await submitConsultationAPI(leadData);
      } else {
        await submitToExternalAPI(leadData);
      }
    } catch (error) {
      console.error('Partial submit on close failed:', error);
    }
  }, [resetChat]);

  return {
    messages,
    isLoading,
    leadSubmitted,
    sendUserMessage,
    handlePhotoUpload,
    resetChat,
    submitPartialAndReset,
    injectBotMessage,
  };
}
