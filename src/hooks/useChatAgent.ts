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
    'цена', 'каква цена', 'колко струва', 'за колко',
    'адрес', 'точен адрес', 'на кой адрес',
    'площ', 'квадратур', 'колко квадрат',
    'стаи', 'колко стаи', 'брой стаи',
    'етаж', 'на кой етаж',
    'спални', 'колко спални'
  ];

  if (needsCustomInput.some((phrase) => text.includes(phrase))) {
    return [];
  }

  // 0. Consultation explicit catch
  if (text.includes('с какво мога да ви помогна') || text.includes('нужда от помощ') || text.includes('повече информация за вашия имот')) {
    return []; // Auto-focus will trigger natively when suggestions are empty
  }

  // 1. Confirming details at the end
  if (text.includes('правилно') || text.includes('потвърд') || text.includes('коректни') || text.includes('всичко е наред') || text.includes('всичко наред ли') || text.includes('добавите/редактирате')) {
    return [
      { label: 'Всичко изглежда наред', value: 'Да, всичко е наред.' },
      { label: 'Редактиране', value: 'ACTION_FOCUS' }
    ];
  }

  // 1.5 Final follow-up (after completion)
  if (text.includes('още нещо') || text.includes('нужда от нещо друго') || text.includes('мога да съдействам с още нещо') || text.includes('мога ли да помогна с нещо друго')) {
    return [
      { label: 'Да', value: 'ACTION_FOCUS' },
      { label: 'Начало', value: 'ACTION_RELOAD' }
    ];
  }

  // 2. Asking about property type
  if (text.includes('какъв тип') || text.includes('вид имот') || text.includes('какъв имот') || text.includes('тип на имот') || text.includes('вид на имот') || text.includes('типът') || text.includes('типа') || text.includes('стаен') || text.includes('мезонет')) {
    return [
      { label: '1-стаен', value: '1-стаен' },
      { label: '2-стаен', value: '2-стаен' },
      { label: '3-стаен', value: '3-стаен' },
      { label: 'Къща', value: 'Къща' },
      { label: 'Друг', value: 'ACTION_FOCUS' }
    ];
  }

  // 2.2 Asking about furnishing
  if (text.includes('обзаведен') || text.includes('обзавеждане')) {
    return [
      { label: 'Обзаведен', value: 'Обзаведен' },
      { label: 'Необзаведен', value: 'Необзаведен' }
    ];
  }

  // 2.5 Consultant Prompt (High Priority - must beat location phrases like "Лозенец" in the summary)
  if (text.includes('да се свържете с наш консултант') || text.includes('по-точна оценка')) {
    return [
      { label: 'Да, желая', value: 'Да, желая да се свържа с консултант.' },
      { label: 'Не, благодаря', value: 'Не, благодаря, това е всичко.' }
    ];
  }

  // 3. Asking about area / neighborhood
  if (text.includes('район') || text.includes('квартал') || text.includes('кой квартал') || text.includes('кой район') || text.includes('част на')) {
    // If it's a specific city check, we add others
    if (text.includes('софия')) {
      return [
        { label: 'Център', value: 'Център' },
        { label: 'Лозенец', value: 'Лозенец' },
        { label: 'Младост', value: 'Младост' },
        { label: 'Люлин', value: 'Люлин' },
        { label: 'Витоша', value: 'Витоша' },
        { label: 'Друг', value: 'ACTION_FOCUS' }
      ];
    }

    if (text.includes('бургас')) {
      return [
        { label: 'Център', value: 'Център' },
        { label: 'Лазур', value: 'Лазур' },
        { label: 'Изгрев', value: 'Изгрев' },
        { label: 'Славейков', value: 'Славейков' },
        { label: 'Меден рудник', value: 'Меден рудник' },
        { label: 'Друг', value: 'ACTION_FOCUS' }
      ];
    }

    if (text.includes('пловдив')) {
      return [
        { label: 'Център', value: 'Център' },
        { label: 'Тракия', value: 'Тракия' },
        { label: 'Смирненски', value: 'Смирненски' },
        { label: 'Кючук Париж', value: 'Кючук Париж' },
        { label: 'Кършияка', value: 'Кършияка' },
        { label: 'Друг', value: 'ACTION_FOCUS' }
      ];
    }

    if (text.includes('варна')) {
      return [
        { label: 'Център', value: 'Център' },
        { label: 'Левски', value: 'Левски' },
        { label: 'Младост', value: 'Младост' },
        { label: 'Владиславово', value: 'Владиславово' },
        { label: 'Бриз', value: 'Бриз' },
        { label: 'Друг', value: 'ACTION_FOCUS' }
      ];
    }

    return [
      { label: 'Център', value: 'Център' },
      { label: 'Лозенец', value: 'Лозенец' },
      { label: 'Младост', value: 'Младост' },
      { label: 'Люлин', value: 'Люлин' },
      { label: 'Витоша', value: 'Витоша' },
      { label: 'Друг', value: 'ACTION_FOCUS' }
    ];
  }

  // 4. Asking about city / location
  if (text.includes('къде') || text.includes('град') || text.includes('местоположение') || text.includes('населено място') || text.includes('кой град') || text.includes('локация')) {
    return [
      { label: 'София', value: 'София' },
      { label: 'Пловдив', value: 'Пловдив' },
      { label: 'Варна', value: 'Варна' },
      { label: 'Бургас', value: 'Бургас' },
      { label: 'Друг', value: 'ACTION_FOCUS' }
    ];
  }

  // 5. Asking about photos
  if (text.includes('снимки') || text.includes('снимка') || text.includes('прикач') || text.includes('фото')) {
    return [
      { label: 'Прикачване', value: 'Искам да прикача снимки.' },
      { label: 'Нямам снимки', value: 'Нямам снимки за момента.' }
    ];
  }

  // 5.5 Asking about email
  if (text.includes('имейл') || text.includes('e-mail') || text.includes('email') || text.includes('електронна поща')) {
    return [
      { label: 'Въведи имейл', value: 'ACTION_FOCUS' },
      { label: 'Нямам имейл', value: 'Нямам имейл или не желая да предоставя.' }
    ];
  }

  // 6. Final Summary Confirmation
  if (text.includes('всичко ли е наред') || text.includes('всичко наред ли е') || text.includes('добавите/редактирате') || text.includes('добавите/оправите') || text.includes('събрахме дотук') || text.includes('редактирате нещо') || text.includes('оправите нещо')) {
    return [
      { label: 'Всичко изглежда наред', value: 'Всичко е наред, може да изпратите.' },
      { label: 'Редактиране', value: 'ACTION_FOCUS' }
    ];
  }

  // 7. Asking about sell vs rent vs estimation vs consultation — least specific, checked last
  if (text.includes('продадете') || text.includes('продажба') || text.includes('наем') || text.includes('отдадете') || text.includes('продавате') || text.includes('отдавате') || text.includes('оценка') || text.includes('консултация')) {
    return [
      { label: 'Продажба', value: 'Искам да продам имот' },
      { label: 'Наем', value: 'Искам да отдам имот под наем' },
      { label: 'Оценка', value: 'Искам оценка на имот' },
      { label: 'Консултация', value: 'Искам консултация' }
    ];
  }

  // 8. End of conversation reload
  if (text.includes('приятен ден') || text.includes('радвам се, че успях') || text.includes('свържете се с нас')) {
    return [
      { label: 'Начало', value: 'ACTION_RELOAD' }
    ];
  }

  return [];
}

const INITIAL_MESSAGE: ChatMessage = {
  id: 'init-1',
  role: 'assistant',
  content:
    'Здравейте! Аз съм Алекс - вашият виртуален асистент от Столични имоти.\n\nКак мога да помогна във връзка с ваш имот?',
  timestamp: new Date(),
  suggestions: [
    { label: 'Продажба', value: 'Искам да продам имот.' },
    { label: 'Наем', value: 'Искам да отдам имот под наем.' },
    { label: 'Оценка', value: 'Искам оценка на имот.' },
    { label: 'Консултация', value: 'Искам консултация.' },
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
          suggestions: generateSuggestions(response.message).slice(0, 6) // Limit to 6 to include "Друг"
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
