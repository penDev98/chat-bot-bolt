import type { ChatResponse, LeadData } from '../types/chat';

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const DB_POST_URL = import.meta.env.VITE_DB_POST_URL;

const SYSTEM_PROMPT = `### Role
Ти си Силви — виртуален асистент за недвижими имоти. Твоята роля е да помагаш на потребителите да подават обяви за продажба, наем или оценка на имот. Трябва да събереш прецизна информация стъпка по стъпка.

### Personality
Бъди приятелски, топъл и разговорен. Говори като истински човек, не като робот. Кратко и по същество.

### Response Style
- МАКСИМУМ 1-2 кратки изречения на отговор. Никога повече!
- Задавай само по ЕДИН въпрос наведнъж
- Бъди естествен и разговорен — кратки, живи реплики
- Не правиш списъци, не изброяваш, не обясняваш прекалено
- НИКОГА не казвай вътрешни технически детайли на потребителя — не споменавай "sale", "rent", "not disclosed", имена на полета или какво "отбелязваш". Просто премини към следващия въпрос естествено.
- Не повтаряй какво потребителят вече каза — просто потвърди кратко и продължи напред
- Когато потребителят каже "Пропусни" или "ПРОПУСНИ", просто премини към следващия въпрос без коментар.

### Goals
Събери информация стъпка по стъпка. Ето точният ред:

СТЪПКА 1: Как мога да помогна във връзка с ваш имот? (dealType: продажба/наем/оценка/консултация)

СТЪПКА 2: Чудесно! Мога ли да знам с кого разговарям? (contactName - свободен текст)

СТЪПКА 3: Благодаря! А телефонен номер за връзка? (contactPhone - свободен текст)

СТЪПКА 4: В кой град се намира имота? (city)

СТЪПКА 5: В кой район/квартал? (district)

=== АКО dealType е 'sale' или 'estimation': ===

СТЪПКА 6: Какъв тип е имота? (estateType - от бутоните)
  → Ако потребителят избере ПАРЦЕЛ, премини към ПАРЦЕЛ ПОТОК (виж долу)
  → За всички останали типове:

СТЪПКА 7: Каква е площта на имота в квадратни метра?

СТЪПКА 8: На кой етаж е разположен имотът? (САМО за апартаменти, офиси, ателиета, магазини, заведения — НЕ питай за къща, етаж от къща, гараж, склад, промишлен обект, хотел)

СТЪПКА 9: Какъв е типът строителство? (тухла, панел, ЕПК или друго)

СТЪПКА 10: Снимки — Насърчи потребителя да прикачи снимки чрез бутона долу вляво. ТРЯБВА да спреш и да изчакаш потребителя да качи снимки или да избере "Пропусни", ПРЕДИ да преминеш към следващата стъпка. НИКОГА не питай за цена в същия отговор!

СТЪПКА 11: Каква е очакваната от вас цена за имота?

СТЪПКА 12: Бихте ли искали да споделите допълнителна информация за имота?

СТЪПКА 13: Имотът обзаведен ли е или необзаведен?

СТЪПКА 14: Бихте ли споделили имейл адрес? (опционално)

--- ПАРЦЕЛ ПОТОК (след избор на "Парцел" в стъпка 6): ---
СТЪПКА П7: Можете ли да споделите кадастралния идентификатор на имота?
СТЪПКА П8: Каква е площта на парцела в квадратни метра?
СТЪПКА П9: В регулация ли е имотът? (да/не/друго)
СТЪПКА П10: Снимки и скица — Насърчи потребителя да прикачи снимки и скица чрез бутона долу вляво. ТРЯБВА да спреш и да изчакаш потребителя да качи снимки или да избере "Пропусни", ПРЕДИ да преминеш към следващата стъпка. НИКОГА не питай за цена в същия отговор!
СТЪПКА П11: Каква е очакваната от вас цена за парцела?
СТЪПКА П12: Бихте ли искали да споделите допълнителна информация?
СТЪПКА П13: Бихте ли споделили имейл адрес? (опционално)

=== АКО dealType е 'rent': ===

СТЪПКА 6: Имотът обзаведен ли е или необзаведен?

СТЪПКА 7: Какъв тип е имота? (estateType - от бутоните)
  → Ако потребителят избере ПАРЦЕЛ, премини към ПАРЦЕЛ ПОТОК (виж горе, но без П9 за регулация — добави въпрос за домашни любимци след П12)

СТЪПКА 8: Каква е площта на имота?

СТЪПКА 9: На кой етаж е разположен? (САМО за апартаменти, офиси и подобни — НЕ за къща, парцел, гараж, склад)

СТЪПКА 10: Какъв е типът строителство? (тухла, панел, ЕПК или друго)

СТЪПКА 11: Снимки

СТЪПКА 12: Каква е очакваната от вас месечна наемна цена?

СТЪПКА 13: Допълнителна информация

СТЪПКА 14: Допускате ли домашни любимци? (да/не/друго)

СТЪПКА 15: Имейл (опционално)

=== АКО dealType е 'consultation': ===
Попитай ТОЧНО: "С какво мога да ви помогна?" и след това събери име (стъпка 2) и телефон (стъпка 3).

### Финализиране
Накрая обобщи данните и попитай дали са правилни. Ако потвърди, извикай submit_lead.
Очакваната цена трябва да бъде включена в полето description при submit_lead (комбинирай я с другата описателна информация).
След успешно submit_lead, завърши разговора с въпрос дали има нужда от нещо друго.

АКО dealType e 'estimation': САМО СЛЕД като имаш ВСИЧКИ данни, генерирай приблизителна пазарна оценка като ценови диапазон (от-до). Базирай се на общи познания за имотния пазар в България.
ФОРМАТИРАЙ отговора за оценката ТОЧНО по следния шаблон (в два параграфа):
"Събрали сме всички нужни данни. Имотът е [ТИП], [ПЛОЩ] квадратни метра, на [ЕТАЖ]-ти етаж и е [ОБЗАВЕЖДАНЕ]. Намира се в [ГРАД], район [РАЙОН]."
"Приблизителният ценови диапазон за такива имоти в [РАЙОН] е между [СУМА_ОТ] и [СУМА_ДО] евро. Желаете ли да се свържете с наш консултант за по-точна оценка?"
Ако потребителят отговори "Да", премини към финализация и извикай submit_lead. Ако отговори "Не", приключи любезно.

### Important Rules
- Комуникирай САМО на български език
- НИКОГА не задавай два въпроса в едно съобщение
- НЕ извиквай submit_lead докато не си събрал контактната информация (име и телефон)
- dealType ТРЯБВА да е: 'sale', 'rent', 'estimation' или 'consultation'
- Използвай "not disclosed" само ако потребителят откаже или пропусне информация
- Когато поискаш снимки, кажи на потребителя да използва бутона за снимки долу вляво. НИКОГА не споменавай URL адреси.
- Пиши съкращенията изцяло: вместо "кв.м" пиши "квадратни метра"
- Преди submit_lead, ОБОБЩИ събраната информация и попитай за потвърждение
- Ако потребителят зададе въпрос извън темата, учтиво го насочи обратно
- НИКОГА не питай за брой спални`;

const tools = [
  {
    type: "function" as const,
    function: {
      name: "submit_lead",
      description:
        "Подай квалифицираната заявка за имот към базата данни. Извикай САМО когато си събрал поне contactName, contactPhone, dealType и city, и потребителят е потвърдил данните.",
      parameters: {
        type: "object",
        properties: {
          dealType: {
            type: "string",
            enum: ["sale", "rent", "estimation", "consultation"],
            description: "Тип: 'sale' (продажба), 'rent' (наем), 'estimation' (оценка), 'consultation' (консултация)",
          },
          estateType: {
            type: "string",
            enum: ["studio", "two_room", "three_room", "four_room", "multi_room", "maisonette", "atelier", "house_floor", "house", "store", "office", "restaurant", "garage", "warehouse", "industrial", "industrial_land", "parcel", "hotel", "other"],
            description: "Тип на имота. Трябва да е една от тези английски стойности: studio (1-стаен), two_room (2-стаен), three_room (3-стаен), four_room (4-стаен), multi_room (Многостаен), maisonette (Мезонет), atelier (Ателие / таван), house_floor (Етаж от къща), house (Къща), store (Магазин), office (Офис), restaurant (Заведение), garage (Гараж), warehouse (Склад), industrial (Промишлен обект), industrial_land (Промишлен терен), parcel (Парцел), hotel (Хотел), other (Друг).",
          },
          city: {
            type: "string",
            description: "Град",
          },
          district: {
            type: "string",
            description:
              "Район/квартал. 'not disclosed' ако не е предоставен",
          },
          contactName: {
            type: "string",
            description: "Пълно име за контакт",
          },
          contactPhone: {
            type: "string",
            description: "Телефонен номер за контакт",
          },
          contactEmail: {
            type: "string",
            description:
              "Имейл адрес. 'not disclosed' ако не е предоставен",
          },
          description: {
            type: "string",
            description: "Описание на имота - тип, площ, характеристики, очаквана цена и допълнителна информация",
          },
          photoRefs: {
            type: "array",
            items: { type: "string" },
            description: "Масив с URL адреси на качени снимки",
          },
        },
        required: ["dealType", "city", "contactName", "contactPhone"],
      },
    },
  },
];

export async function submitToExternalAPI(leadData: LeadData) {
  const fd = new FormData();

  // Split contactName into firstName and lastName
  const nameParts = (leadData.contactName || "").trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";

  // Map to the required fields shown in the target system
  fd.append('firstName', firstName || "null");
  fd.append('lastName', lastName || "null");
  fd.append('phone', leadData.contactPhone || "null");
  fd.append('email', leadData.contactEmail && leadData.contactEmail !== 'not disclosed' ? leadData.contactEmail : "null");
  fd.append('offerType', leadData.dealType || "null");
  fd.append('city', leadData.city || "null");
  fd.append('district', leadData.district && leadData.district !== 'not disclosed' ? leadData.district : "null");
  fd.append('estateType', leadData.estateType || "null");
  fd.append('description', leadData.description || "null");

  // Optional: Keep photos if available
  if (Array.isArray(leadData.photoRefs)) {
    leadData.photoRefs.forEach(url => {
      // Find the original File object if available in our global registry
      const originalFile = (window as any)._uploadedFiles?.get(url);
      if (originalFile) {
        fd.append('photos', originalFile, originalFile.name);
      } else {
        // Fallback to sending the URL if file object isn't available
        fd.append('photos', url);
      }
    });
  }

  const response = await fetch(DB_POST_URL, {
    method: "POST",
    body: fd,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`External API error: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

export async function sendChatMessage(
  messages: { role: string; content: string }[]
): Promise<ChatResponse> {
  const openaiMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages,
  ];

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY} `,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: openaiMessages,
        tools,
        tool_choice: "auto",
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `OpenAI API error: ${response.status} `);
    }

    const data = await response.json();
    const choice = data.choices[0];

    // Handle tool calls (Lead Submission)
    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      const toolCall = choice.message.tool_calls[0];
      const leadData = JSON.parse(toolCall.function.arguments);
      let dbSuccess = false;

      try {
        await submitToExternalAPI(leadData);
        dbSuccess = true;
      } catch (error) {
        console.error("External API submission failed:", error);
      }

      // Send tool output back to OpenAI to get final confirmation message
      const followUpMessages = [
        ...openaiMessages,
        choice.message,
        {
          role: "tool",
          tool_call_id: toolCall.id,
          content: dbSuccess
            ? "Заявката е успешно подадена в системата."
            : "Заявката е записана локално.",
        },
      ];

      const followUpResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY} `,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: followUpMessages,
          temperature: 0.7,
        }),
      });

      if (!followUpResponse.ok) {
        throw new Error(`OpenAI Follow - up error: ${followUpResponse.status} `);
      }

      const followUpData = await followUpResponse.json();
      return {
        message: followUpData.choices[0].message.content,
        leadSubmitted: true,
        leadData,
        dbSuccess
      };
    }

    return {
      message: choice.message.content,
      leadSubmitted: false,
    };

  } catch (error: any) {
    console.error("Chat API Error:", error);
    throw new Error(error.message || "Failed to send message");
  }
}

// ── TTS Text Preprocessing for Bulgarian ──

const BG_ONES = ['', 'едно', 'две', 'три', 'четири', 'пет', 'шест', 'седем', 'осем', 'девет'];
const BG_TEENS = ['десет', 'единайсет', 'дванайсет', 'тринайсет', 'четиринайсет', 'петнайсет', 'шестнайсет', 'седемнайсет', 'осемнайсет', 'деветнайсет'];
const BG_TENS = ['', '', 'двайсет', 'трийсет', 'четиридесет', 'петдесет', 'шестдесет', 'седемдесет', 'осемдесет', 'деветдесет'];
const BG_HUNDREDS = ['', 'сто', 'двеста', 'триста', 'четиристотин', 'петстотин', 'шестстотин', 'седемстотин', 'осемстотин', 'деветстотин'];

function numberToWordsBG(n: number): string {
  if (n < 0) return 'минус ' + numberToWordsBG(-n);
  if (n === 0) return 'нула';

  if (n >= 1000000) {
    const millions = Math.floor(n / 1000000);
    const rest = n % 1000000;
    const millionWord = millions === 1 ? 'един милион' : numberToWordsBG(millions) + ' милиона';
    return rest > 0 ? millionWord + ' ' + numberToWordsBG(rest) : millionWord;
  }

  if (n >= 1000) {
    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    let thousandWord: string;
    if (thousands === 1) thousandWord = 'хиляда';
    else if (thousands === 2) thousandWord = 'две хиляди';
    else thousandWord = numberToWordsBG(thousands) + ' хиляди';
    if (rest === 0) return thousandWord;
    if (rest < 100) return thousandWord + ' и ' + numberToWordsBG(rest);
    return thousandWord + ' ' + numberToWordsBG(rest);
  }

  if (n >= 100) {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    if (rest === 0) return BG_HUNDREDS[h];
    if (rest < 10 || (rest >= 10 && rest < 20)) return BG_HUNDREDS[h] + ' и ' + numberToWordsBG(rest);
    return BG_HUNDREDS[h] + ' ' + numberToWordsBG(rest);
  }

  if (n >= 20) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    if (o === 0) return BG_TENS[t];
    return BG_TENS[t] + ' и ' + BG_ONES[o];
  }

  if (n >= 10) return BG_TEENS[n - 10];

  return BG_ONES[n];
}

const BG_DIGITS = ['нула', 'едно', 'две', 'три', 'четири', 'пет', 'шест', 'седем', 'осем', 'девет'];

function phoneToWordsBG(phone: string): string {
  return phone.split('').map(ch => BG_DIGITS[parseInt(ch, 10)] ?? ch).join(' ');
}

function prepareTTSText(text: string): string {
  let result = text;

  // Expand common abbreviations
  result = result.replace(/кв\.?\s?м\.?/gi, 'квадратни метра');
  result = result.replace(/бр\./g, 'броя');
  result = result.replace(/ет\./g, 'етаж');
  result = result.replace(/ул\./g, 'улица');
  result = result.replace(/бул\./g, 'булевард');
  result = result.replace(/гр\./g, 'град');
  result = result.replace(/тел\./g, 'телефон');
  result = result.replace(/лв\./g, 'лева');

  // Phone numbers: read digit-by-digit (e.g. 0888 123 456 → нула осем осем осем ...)
  result = result.replace(/(?<!\d)(0[789]\d[\d\s\-]{6,12})(?!\d)/g, (_match, phone) => {
    const digits = phone.replace(/[\s\-]/g, '');
    return phoneToWordsBG(digits);
  });

  // Convert standalone numbers to Bulgarian words
  // Use lookaround that handles Cyrillic boundaries
  result = result.replace(/(?<=^|[\s,.:;!?()\-"'~…/\u0400-\u04FF])(\d+)(?=$|[\s,.:;!?()\-"'~…/\u0400-\u04FF])/g, (_match, numStr) => {
    const num = parseInt(numStr, 10);
    if (isNaN(num) || num > 9999999) return numStr; // too large, keep as-is
    return numberToWordsBG(num);
  });

  return result;
}

export async function fetchTTSAudio(text: string): Promise<Blob> {
  const ELEVENLABS_API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY;
  const VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel

  const preparedText = prepareTTSText(text);

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?optimize_streaming_latency=2`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: preparedText,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability: 0.7,
          similarity_boost: 0.6,
          style: 0,
          use_speaker_boost: true,
          speed: 1.1,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`ElevenLabs TTS error: ${response.status}`);
  }

  return response.blob();
}
