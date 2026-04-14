import { useState, useCallback, useRef } from 'react';
import type { ChatMessage, QuickReply } from '../types/chat';
import { sendChatMessage, submitToExternalAPI } from '../lib/api';
import type { LeadData } from '../types/chat';

// Helper: add a ПРОПУСНИ (Skip) button to suggestion arrays
// except for name & phone questions
function withSkip(suggestions: QuickReply[], skipLabel = 'Пропусни'): QuickReply[] {
  return [...suggestions, { label: skipLabel, value: 'Пропусни' }];
}

// Helper to generate context-aware suggestions
// Priority: most specific (latest in conversation flow) checked FIRST
// conversationContext: optional full conversation text for city detection
function generateSuggestions(content: string, conversationContext?: string): QuickReply[] {
  const text = content.toLowerCase();
  // For city/district detection, use the full conversation context if available
  const fullContext = conversationContext ? conversationContext.toLowerCase() : text;

  // Name & phone questions — free text, NO skip button
  const isNameQuestion = text.includes('с кого разговарям') || text.includes('вашето име') || text.includes('как се казвате');
  const isPhoneQuestion = (text.includes('телефон') || text.includes('номер за контакт') || text.includes('номер за връзка')) && !text.includes('град');

  if (isNameQuestion || isPhoneQuestion) {
    return []; // Free text only, no skip
  }

  // 0. Consultation explicit catch
  if (text.includes('с какво мога да ви помогна') || text.includes('нужда от помощ') || text.includes('повече информация за вашия имот')) {
    return [];
  }

  // 0.5 Phone validation confirmation
  if (text.includes('сигурни ли сте') && (text.includes('номер') || text.includes('телефон'))) {
    return [
      { label: 'Да, правилен е', value: 'Да, номерът е правилен.' },
      { label: 'Коригирам', value: 'ACTION_FOCUS' }
    ];
  }

  // --- §7: Unsupported property type in estimation → consultant message, end conversation
  if (text.includes('спецификата на имота') && text.includes('консултант ще се свърже')) {
    return [
      { label: 'Мога ли да бъда полезен с нещо друго?', value: 'END_CONVERSATION_PROMPT' }
    ];
  }

  // --- §6: Last floor question — MUST be checked BEFORE the generic "етаж" free-text check
  if (text.includes('последен етаж')) {
    return [
      { label: 'Да', value: 'Да' },
      { label: 'Не', value: 'Не' }
    ];
  }

  // ── Exclusions: questions that need free-text input → no buttons ──
  // NOTE: This block is intentionally AFTER the "последен етаж" check above,
  // because "етаж" appears in both patterns and the more specific one must win.
  const needsCustomInput = [
    'как се казвате', 'вашето име', 'вашите имена', 'име и фамилия',
    'с кого разговарям',
    'телефон', 'номер за контакт', 'номер за връзка', 'обадим',
    'каква цена', 'колко струва', 'за колко', 'очакваната',
    'адрес', 'точен адрес', 'на кой адрес',
    'стаи', 'колко стаи', 'брой стаи',
    'етаж', 'на кой етаж',
    'кадастрал', 'идентификатор',
    'допълнителна информация', 'допълнително'
  ];

  // For other free-text questions, provide a Skip button
  if (needsCustomInput.some((phrase) => text.includes(phrase))) {
    return [{ label: 'Пропусни', value: 'Пропусни' }];
  }

  // 1. Confirming details at the end
  if (text.includes('правилно') || text.includes('потвърд') || text.includes('коректни') || text.includes('всичко е наред') || text.includes('всичко наред ли') || text.includes('добавите/редактирате')) {
    return [
      { label: 'Всичко изглежда наред', value: 'Да, всичко е наред.' },
      { label: 'Редактиране', value: 'ACTION_FOCUS' }
    ];
  }

  // --- §5 & §10: End of conversation / "Мога ли да бъда полезен с нещо друго?"
  if (text.includes('мога ли да бъда полезен с нещо друго') || text.includes('полезен с нещо друго')) {
    return [
      { label: 'Да', value: 'ACTION_RESTART' },
      { label: 'Не, благодаря', value: 'ACTION_CLOSE' }
    ];
  }

  // 1.5 Final follow-up (legacy catch)
  if (text.includes('още нещо') || text.includes('нужда от нещо друго') || text.includes('мога да съдействам с още нещо') || text.includes('мога ли да помогна с нещо друго')) {
    return [
      { label: 'Да', value: 'ACTION_RESTART' },
      { label: 'Не, благодаря', value: 'ACTION_CLOSE' }
    ];
  }

  // 2.1 Construction type question
  if (text.includes('тип строителство') || text.includes('типът строителство') || text.includes('вид строителство')) {
    return withSkip([
      { label: 'Тухла', value: 'Тухла' },
      { label: 'Панел', value: 'Панел' },
      { label: 'ЕПК', value: 'ЕПК' },
      { label: 'Друго', value: 'ACTION_FOCUS' }
    ]);
  }

  // --- §10: Final CTA — expert consultation question
  if (text.includes('желаете ли да заявите консултация с експерт-оценител') || text.includes('по-точна оценка')) {
    return [
      { label: 'Да', value: 'Да, желая да заявя консултация с експерт-оценител.' },
      { label: 'Не', value: 'ACTION_RESTART' }
    ];
  }

  // Legacy consultant prompt catch
  if (text.includes('да се свържете с наш консултант')) {
    return [
      { label: 'Да', value: 'Да, желая да заявя консултация с експерт-оценител.' },
      { label: 'Не', value: 'ACTION_RESTART' }
    ];
  }

  // --- §10: Expert will contact message → end flow
  if (text.includes('експерт-оценител ще се свърже с вас')) {
    return [
      { label: 'Мога ли да бъда полезен с нещо друго?', value: 'END_CONVERSATION_PROMPT' }
    ];
  }

  // 2.3 Regulation question (for parcels)
  if (text.includes('регулация')) {
    return withSkip([
      { label: 'Да', value: 'Да' },
      { label: 'Не', value: 'Не' },
      { label: 'Друго', value: 'ACTION_FOCUS' }
    ]);
  }

  // 2.4 Pets question (for rent)
  if (text.includes('домашни любимци') || text.includes('любимци')) {
    return withSkip([
      { label: 'Да', value: 'Да' },
      { label: 'Не', value: 'Не' },
      { label: 'Друго', value: 'ACTION_FOCUS' }
    ]);
  }

  // 2. Asking about property type — check if this is a follow-up "друг" expansion
  // If message mentions full list or follow-up types, show expanded list
  if (text.includes('друг тип') || text.includes('други типове') || text.includes('изберете от следните') || text.includes('пълен списък')) {
    return withSkip([
      { label: '4-стаен', value: '4-стаен' },
      { label: 'Многостаен', value: 'Многостаен' },
      { label: 'Мезонет', value: 'Мезонет' },
      { label: 'Ателие / таван', value: 'Ателие / таван' },
      { label: 'Етаж от къща', value: 'Етаж от къща' },
      { label: 'Къща', value: 'Къща' },
      { label: 'Магазин', value: 'Магазин' },
      { label: 'Офис', value: 'Офис' },
      { label: 'Заведение', value: 'Заведение' },
      { label: 'Гараж', value: 'Гараж' },
      { label: 'Склад', value: 'Склад' },
      { label: 'Промишлен обект', value: 'Промишлен обект' },
      { label: 'Промишлен терен', value: 'Промишлен терен' },
      { label: 'Хотел', value: 'Хотел' }
    ]);
  }

  // 2. Asking about property type (top-level: 5 options)
  if (text.includes('какъв тип') || text.includes('вид имот') || text.includes('какъв имот') || text.includes('тип на имот') || text.includes('вид на имот') || text.includes('типът') || text.includes('типа') || text.includes('стаен') || text.includes('мезонет')) {
    return [
      { label: '1-стаен', value: '1-стаен' },
      { label: '2-стаен', value: '2-стаен' },
      { label: '3-стаен', value: '3-стаен' },
      { label: 'Парцел', value: 'Парцел' },
      { label: 'Друг', value: 'Друг' }
    ];
  }

  // 3. Asking about area / neighborhood — use city from the FULL conversation context
  if (text.includes('район') || text.includes('квартал') || text.includes('кой квартал') || text.includes('кой район') || text.includes('част на')) {
    // Use fullContext to detect city from prior conversation messages
    if (fullContext.includes('пловдив')) {
      return withSkip([
        { label: 'Център', value: 'Център' },
        { label: 'Тракия', value: 'Тракия' },
        { label: 'Смирненски', value: 'Смирненски' },
        { label: 'Кючук Париж', value: 'Кючук Париж' },
        { label: 'Кършияка', value: 'Кършияка' },
        { label: 'Друг', value: 'ACTION_FOCUS' }
      ]);
    }

    if (fullContext.includes('бургас')) {
      return withSkip([
        { label: 'Център', value: 'Център' },
        { label: 'Лазур', value: 'Лазур' },
        { label: 'Изгрев', value: 'Изгрев' },
        { label: 'Славейков', value: 'Славейков' },
        { label: 'Меден рудник', value: 'Меден рудник' },
        { label: 'Друг', value: 'ACTION_FOCUS' }
      ]);
    }

    if (fullContext.includes('варна')) {
      return withSkip([
        { label: 'Център', value: 'Център' },
        { label: 'Левски', value: 'Левски' },
        { label: 'Младост', value: 'Младост' },
        { label: 'Владиславово', value: 'Владиславово' },
        { label: 'Бриз', value: 'Бриз' },
        { label: 'Друг', value: 'ACTION_FOCUS' }
      ]);
    }

    // Default: Sofia districts (or if city is explicitly Sofia or no specific city detected)
    if (fullContext.includes('софия') || (!fullContext.includes('пловдив') && !fullContext.includes('бургас') && !fullContext.includes('варна'))) {
      return withSkip([
        { label: 'Център', value: 'Център' },
        { label: 'Лозенец', value: 'Лозенец' },
        { label: 'Младост', value: 'Младост' },
        { label: 'Люлин', value: 'Люлин' },
        { label: 'Витоша', value: 'Витоша' },
        { label: 'Друг', value: 'ACTION_FOCUS' }
      ]);
    }

    // Generic fallback — just free text
    return [{ label: 'Друг', value: 'ACTION_FOCUS' }];
  }

  // 4. Asking about city / location
  if (text.includes('къде') || text.includes('град') || text.includes('местоположение') || text.includes('населено място') || text.includes('кой град') || text.includes('локация')) {
    return withSkip([
      { label: 'София', value: 'София' },
      { label: 'Пловдив', value: 'Пловдив' },
      { label: 'Варна', value: 'Варна' },
      { label: 'Бургас', value: 'Бургас' },
      { label: 'Друг', value: 'ACTION_FOCUS' }
    ]);
  }

  // 5. Asking about photos
  if (text.includes('снимки') || text.includes('снимка') || text.includes('прикач') || text.includes('фото') || text.includes('скица')) {
    return [{ label: 'Пропусни', value: 'Пропусни' }];
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
  if (text.includes('продадете') || text.includes('продажба') || text.includes('наем') || text.includes('отдадете') || text.includes('продавате') || text.includes('отдавате') || text.includes('оценка') || text.includes('консултация') || text.includes('как мога да помогна')) {
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
      { label: 'Начало', value: 'ACTION_RESTART' }
    ];
  }

  return [];
}

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
  ]
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

  // Inject a local bot message without calling the API
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

        // Split message by double newline into separate bubbles
        const botParts = response.message.split('\n\n').filter(p => p.trim() !== '');
        
        // Build full conversation context for city detection in district suggestions
        const fullConversationContext = messagesRef.current.map(m => m.content).join('\n') + '\n' + response.message;

        const assistantMessages: ChatMessage[] = botParts.map((part, idx) => ({
          id: nextId() + (idx > 0 ? `-${idx}` : ''),
          role: 'assistant',
          content: part.trim(),
          timestamp: new Date(),
          // Only the last bubble gets the suggestions
          suggestions: idx === botParts.length - 1 ? generateSuggestions(response.message, fullConversationContext) : []
        }));

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

        if (response.leadSubmitted) {
          setLeadSubmitted(true);
        }

        return response.message;
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
        setIsLoading(false);
        return null;
      }
    },
    [processMessageQueue]
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
    const currentMessages = messagesRef.current;
    
    // Reset immediately — don't wait for async submission
    resetChat();

    // Try to extract gathered data from conversation messages
    const allText = currentMessages.map(m => m.content).join('\n');
    
    // Extract photo URLs from user messages
    const photoRefs: string[] = [];
    currentMessages.forEach(m => {
      if (m.photoUrls) photoRefs.push(...m.photoUrls);
    });

    // Build partial lead data with defaults for missing fields
    const partialData: LeadData = {
      dealType: 'estimation',
      city: 'null',
      contactName: 'null',
      contactPhone: 'null',
      contactEmail: 'null',
      description: 'Чатът беше затворен преди завършване. Събрана информация: ' + allText.substring(0, 500),
      estateType: 'other',
      district: 'null',
      photoRefs,
    };

    // Try to detect dealType from conversation
    const lowerText = allText.toLowerCase();
    if (lowerText.includes('продам') || lowerText.includes('продажба')) partialData.dealType = 'sale';
    else if (lowerText.includes('наем') || lowerText.includes('отдам')) partialData.dealType = 'rent';
    else if (lowerText.includes('оценка')) partialData.dealType = 'estimation';

    // Try to extract name and phone from user messages
    for (let i = 0; i < currentMessages.length - 1; i++) {
      const msg = currentMessages[i];
      const nextMsg = currentMessages[i + 1];
      if (msg.role === 'assistant' && nextMsg?.role === 'user') {
        const aText = msg.content.toLowerCase();
        if (aText.includes('с кого разговарям') || aText.includes('вашето име') || aText.includes('как се казвате')) {
          if (nextMsg.content !== 'Пропусни') {
            partialData.contactName = nextMsg.content;
          }
        }
        if (aText.includes('телефон') || aText.includes('номер за връзка') || aText.includes('номер за контакт')) {
          if (nextMsg.content !== 'Пропусни') {
            partialData.contactPhone = nextMsg.content;
          }
        }
        if (aText.includes('имейл') || aText.includes('email') || aText.includes('e-mail')) {
          if (nextMsg.content !== 'Пропусни') {
            partialData.contactEmail = nextMsg.content;
          }
        }
        if (aText.includes('град') || aText.includes('къде')) {
          if (nextMsg.content !== 'Пропусни') {
            partialData.city = nextMsg.content;
          }
        }
        if (aText.includes('район') || aText.includes('квартал')) {
          if (nextMsg.content !== 'Пропусни') {
            partialData.district = nextMsg.content;
          }
        }
      }
    }

    // Only submit if we have at least a name and phone number
    const hasName = partialData.contactName !== 'null' && partialData.contactName.trim() !== '';
    const hasPhone = partialData.contactPhone !== 'null' && partialData.contactPhone.trim() !== '';

    if (!hasName || !hasPhone) {
      // Not enough data — just reset without sending to DB
      return;
    }

    try {
      await submitToExternalAPI(partialData);
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
