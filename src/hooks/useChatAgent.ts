import { useState, useCallback, useRef } from 'react';
import type { ChatMessage, QuickReply } from '../types/chat';
import { sendChatMessage, uploadPhoto } from '../lib/api';

// Helper to generate context-aware suggestions
// Priority: most specific (latest in conversation flow) checked FIRST
function generateSuggestions(content: string): QuickReply[] {
  const text = content.toLowerCase();

  // ── Exclusions: questions that need free-text input → no buttons ──
  const needsCustomInput = [
    'как се казвате', 'вашето име', 'вашите имена', 'име и фамилия',
    'телефон', 'номер за контакт', 'номер за връзка', 'обадим',
    'имейл', 'e-mail', 'email', 'електронна поща',
    'цена', 'каква цена', 'колко струва', 'за колко',
    'адрес', 'точен адрес', 'на кой адрес',
    'опишете', 'разкажете', 'повече информация', 'допълнителна информация',
    'площ', 'квадратур', 'колко квадрат',
    'стаи', 'колко стаи', 'брой стаи',
  ];

  if (needsCustomInput.some((phrase) => text.includes(phrase))) {
    return [];
  }

  // 1. Confirmation questions — check first (most specific)
  if (text.includes('правилно') || text.includes('потвърд') || text.includes('коректн') || text.includes('вярно ли')) {
    return [
      { label: 'Да, правилно е', value: 'Да, данните са коректни.' },
      { label: 'Не, има грешка', value: 'Не, искам да направя корекция.' }
    ];
  }

  // 2. Asking about property type
  if (text.includes('какъв тип') || text.includes('вид имот') || text.includes('какъв имот') || text.includes('тип на имот') || text.includes('вид на имот')) {
    return [
      { label: 'Апартамент', value: 'Апартамент' },
      { label: 'Къща', value: 'Къща' },
      { label: 'Парцел', value: 'Парцел' },
      { label: 'Офис', value: 'Офис' }
    ];
  }

  // 3. Asking about area / neighborhood
  if (text.includes('район') || text.includes('квартал') || text.includes('кой квартал') || text.includes('кой район') || text.includes('част на')) {
    return [
      { label: 'Център', value: 'Център' },
      { label: 'Лозенец', value: 'Лозенец' },
      { label: 'Младост', value: 'Младост' },
      { label: 'Люлин', value: 'Люлин' },
      { label: 'Витоша', value: 'Витоша' }
    ];
  }

  // 4. Asking about city / location
  if (text.includes('къде') || text.includes('град') || text.includes('местоположение') || text.includes('населено място') || text.includes('кой град') || text.includes('локация')) {
    return [
      { label: 'София', value: 'София' },
      { label: 'Пловдив', value: 'Пловдив' },
      { label: 'Варна', value: 'Варна' },
      { label: 'Бургас', value: 'Бургас' }
    ];
  }

  // 5. Asking about sell vs rent — least specific, checked last
  if (text.includes('продадете') || text.includes('продажба') || text.includes('наем') || text.includes('отдадете') || text.includes('продавате') || text.includes('отдавате')) {
    return [
      { label: 'Искам да продам', value: 'Искам да продам имот' },
      { label: 'Искам да отдам под наем', value: 'Искам да отдам имот под наем' }
    ];
  }

  return [];
}

const INITIAL_MESSAGE: ChatMessage = {
  id: 'init-1',
  role: 'assistant',
  content:
    'Здравейте! Аз съм вашият виртуален асистент от Столични имоти.\n\nТук съм, за да ви помогна да продадете или отдадете имота си възможно най-бързо и лесно.',
  timestamp: new Date(),
  suggestions: [
    { label: 'Продажба', value: 'Искам да продам имот.' },
    { label: 'Наем', value: 'Искам да отдам имот под наем.' },
  ]
};

export function useChatAgent() {
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [isLoading, setIsLoading] = useState(false);
  const [leadSubmitted, setLeadSubmitted] = useState(false);

  const messagesRef = useRef<ChatMessage[]>([INITIAL_MESSAGE]);
  const idCounter = useRef(0);

  const nextId = () => {
    idCounter.current += 1;
    return `msg-${idCounter.current}`;
  };

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

      try {
        const apiMessages = updatedMessages.map((m) => ({
          role: m.role,
          content:
            m.photoUrls && m.photoUrls.length > 0
              ? `${m.content}\n\n[Качени снимки: ${m.photoUrls.join(', ')}]`
              : m.content,
        }));

        const response = await sendChatMessage(apiMessages);

        const assistantMsg: ChatMessage = {
          id: nextId(),
          role: 'assistant',
          content: response.message,
          timestamp: new Date(),
          suggestions: generateSuggestions(response.message).slice(0, 5) // Limit to 5
        };

        const withAssistant = [...messagesRef.current, assistantMsg];
        messagesRef.current = withAssistant;
        setMessages(withAssistant);

        if (response.leadSubmitted) {
          setLeadSubmitted(true);
        }

        return assistantMsg.content;
      } catch {
        const errorMsg: ChatMessage = {
          id: nextId(),
          role: 'assistant',
          content: 'Съжалявам, възникна грешка. Моля, опитайте отново.',
          timestamp: new Date(),
        };

        const withError = [...messagesRef.current, errorMsg];
        messagesRef.current = withError;
        setMessages(withError);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const handlePhotoUpload = useCallback(
    async (files: File[]) => {
      setIsLoading(true);
      const urls: string[] = [];

      for (const file of files) {
        try {
          const url = await uploadPhoto(file);
          urls.push(url);
        } catch {
          // skip failed uploads
        }
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

  const resetChat = useCallback(() => {
    messagesRef.current = [INITIAL_MESSAGE];
    setMessages([INITIAL_MESSAGE]);
    setLeadSubmitted(false);
    idCounter.current = 0;
  }, []);

  return {
    messages,
    isLoading,
    leadSubmitted,
    sendUserMessage,
    handlePhotoUpload,
    resetChat,
  };
}
