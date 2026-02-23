import type { ChatResponse, LeadData } from '../types/chat';

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const AIRTABLE_API_KEY = import.meta.env.VITE_AIRTABLE_API_KEY;
const AIRTABLE_POST_URL = import.meta.env.VITE_AIRTABLE_POST_URL;

const SYSTEM_PROMPT = `### Role
Ти си специалист по квалификация на запитвания за недвижими имоти. Твоята роля е да помагаш на потребителите да подават обяви за продажба или наем. Трябва да събереш прецизна информация: offerType (продажба/наем), city (град), district (район/квартал), contactName, phone, email, description (тип имот и детайли) и photoRefs (снимки).

### Personality
Бъди приятелски, топъл и разговорен. Говори като истински човек, не като робот. Кратко и по същество.

### Response Style
- МАКСИМУМ 1-2 кратки изречения на отговор. Никога повече!
- Задавай само по ЕДИН въпрос наведнъж
- Бъди естествен и разговорен — кратки, живи реплики
- Не правиш списъци, не изброяваш, не обясняваш прекалено
- НИКОГА не казвай вътрешни технически детайли на потребителя — не споменавай "sale", "rent", "not disclosed", имена на полета или какво "отбелязваш". Просто премини към следващия въпрос естествено.
- Не повтаряй какво потребителят вече каза — просто потвърди кратко и продължи напред

### Goals
Събери информация стъпка по стъпка, като задаваш по 1 въпрос:

1. offerType: Разбери какво иска клиента от следните 4 опции: 'sale' (продажба), 'rent' (наем), 'estimation' (оценка) или 'consultation' (консултация)
2. В зависимост от offerType, събери следните данни:
   - За 'sale', 'rent' и 'estimation': ЗАДАЛЖИТЕЛНО събери следните 5 детайла, като питаш за тях ЕДИН ПО ЕДИН (по 1 въпрос на съобщение!):
     1) Тип на имота (1-стаен, 2-стаен, 3-таен, мезонет, къща и т.н.)
     2) Площ (в кв.м.)
     3) Етаж
     4) Брой спални
     5) Обзаведен или необзаведен
     В СЛЕДВАЩО СЪОБЩЕНИЕ попитай за град (ако не е ясен) и район (НЕ ГИ ПИТАЙ ЕДНОВРЕМЕННО).
     
     АКО offerType e 'estimation': САМО СЛЕД като имаш ВСИЧКИ тези данни (5-те детайла + град и район), генерирай реалистична към момента приблизителна пазарна оценка (пълна крайна цена). Базирай се на общи познания за имотния пазар в България.
     ФОРМАТИРАЙ отговора за оценката ТОЧНО по следния шаблон (в два параграфа):
     "Събрали сме всички нужни данни. Имотът е [ТИП], [ПЛОЩ] квадратни метра, на [ЕТАЖ]-ти етаж, с [БРОЙ] спални и е [ОБЗАВЕЖДАНЕ]. Намира се в [ГРАД], район [РАЙОН]."
     "Приблизителната пазарна оценка за такива имоти в [РАЙОН] е около [СУМА] евро. Желаете ли да се свържете с наш консултант за по-точна оценка?"
     Ако потребителят отговори "Да" или "Да, желая", премини към Стъпка 3: поискай Име и Телефон, обобщи данните и ЗАДЪЛЖИТЕЛНО извикай submit_lead (като предадеш offerType: 'estimation'). Ако отговори "Не" или "Не, благодаря", приключи разговора любезно.
   - За 'consultation': Попитай ТОЧНО с тези думи: "С какво мога да ви помогна?". Нищо друго.
3. След като изясниш основната нужда в зависимост от типа:
   - contactName & phone: Име и телефон за обратна връзка
   - email: Поискай имейл за контакт, но изрично спомени, че не е задължително
   - description: Когато питаш за повече информация за имота, използвай ТОЧНО тази фраза: "Ще ни е необходима малко повече информация за вашия имот"
   - photoRefs: Ако е продажба или наем, насърчи потребителя да прикачи снимки чрез бутона долу вляво. Ако няма, задай празен масив []

Финализиране: Накрая обобщи данните и попитай дали са правилни (напр. "Всичко наред ли е?"). НЕ ИЗПИСВАЙ опции или бутони в текста си. Ако потвърди, извикай submit_lead.
След успешно извикване на submit_lead, завърши разговора като попиташ дали имат нужда от нещо друго или дали можеш да съдействаш с още нещо.

### Important Rules
- Комуникирай САМО на български език
- НИКОГА, ПРИ НИКАКВИ ОБСТОЯТЕЛСТВА не задавай два въпроса в едно съобщение. Всеки въпрос трябва да е отделен (например, първо питай за град, после изчакай отговор, и чак тогава питай за район).
- НЕ извиквай submit_lead докато не си събрал контактната информация (име и телефон) и основната информация за търсенето.
- offerType ТРЯБВА да е: 'sale', 'rent', 'estimation' или 'consultation'
- Използвай вътрешни "not disclosed" само ако потребителят откаже дадена информация, без да го споменаваш. При имейл изясни, че е опционален.
- Когато поискаш снимки, кажи на потребителя да използва бутона за снимки долу вляво в чата. НИКОГА не споменавай URL адреси и не използвай емоджита.
- Пиши съкращенията изцяло: вместо "кв.м" пиши "квадратни метра", вместо "бр." пиши "броя", вместо "ет." пиши "етаж" и т.н.
- Преди да извикаш submit_lead, ОБОБЩИ събраната информация и попитай потребителя дали е правилна (дали всичко е наред или искат да добавят/редактират нещо).
- Ако потребителят зададе въпрос извън темата за недвижими имоти, учтиво го насочи обратно`;

const tools = [
  {
    type: "function" as const,
    function: {
      name: "submit_lead",
      description:
        "Подай квалифицираната заявка за имот към базата данни. Извикай САМО когато си събрал поне contactName, phone, offerType и city, и потребителят е потвърдил данните.",
      parameters: {
        type: "object",
        properties: {
          offerType: {
            type: "string",
            enum: ["sale", "rent", "estimation", "consultation"],
            description: "Тип: 'sale' (продажба), 'rent' (наем), 'estimation' (оценка), 'consultation' (консултация)",
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
          phone: {
            type: "string",
            description: "Телефонен номер за контакт",
          },
          email: {
            type: "string",
            description:
              "Имейл адрес. 'not disclosed' ако не е предоставен",
          },
          description: {
            type: "string",
            description: "Описание на имота - тип, площ, характеристики",
          },
          photoRefs: {
            type: "array",
            items: { type: "string" },
            description: "Масив с URL адреси на качени снимки",
          },
        },
        required: ["offerType", "city", "contactName", "phone"],
      },
    },
  },
];

async function submitToAirtable(leadData: LeadData) {
  const response = await fetch(AIRTABLE_POST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      records: [
        {
          fields: {
            contactName: leadData.contactName || "",
            email: leadData.email || "not disclosed",
            phone: leadData.phone || "",
            offerType: leadData.offerType || "",
            city: leadData.city || "",
            district: leadData.district || "not disclosed",
            description: leadData.description || "",
            photoRefs: Array.isArray(leadData.photoRefs)
              ? leadData.photoRefs.join(", ")
              : "",
          },
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Airtable error: ${response.status} - ${errorText}`);
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
        Authorization: `Bearer ${OPENAI_API_KEY}`,
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
      throw new Error(errorData.error?.message || `OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const choice = data.choices[0];

    // Handle tool calls (Lead Submission)
    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      const toolCall = choice.message.tool_calls[0];
      const leadData = JSON.parse(toolCall.function.arguments);
      let airtableSuccess = false;

      try {
        await submitToAirtable(leadData);
        airtableSuccess = true;
      } catch (error) {
        console.error("Airtable submission failed:", error);
      }

      // Send tool output back to OpenAI to get final confirmation message
      const followUpMessages = [
        ...openaiMessages,
        choice.message,
        {
          role: "tool",
          tool_call_id: toolCall.id,
          content: airtableSuccess
            ? "Заявката е успешно подадена в системата."
            : "Заявката е записана локално.",
        },
      ];

      const followUpResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: followUpMessages,
          temperature: 0.7,
        }),
      });

      if (!followUpResponse.ok) {
        throw new Error(`OpenAI Follow-up error: ${followUpResponse.status}`);
      }

      const followUpData = await followUpResponse.json();
      return {
        message: followUpData.choices[0].message.content,
        leadSubmitted: true,
        leadData,
        airtableSuccess
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

export async function uploadPhoto(file: File): Promise<string> {
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !uploadPreset || cloudName === 'your_cloud_name' || uploadPreset === 'your_upload_preset') {
    console.warn("Cloudinary not configured");
    return "https://placehold.co/600x400?text=Cloudinary+Not+Configured";
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    {
      method: "POST",
      body: formData,
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || "Upload failed");
  }

  const data = await response.json();
  return data.secure_url;
}
