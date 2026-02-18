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

1. offerType: 'sale' (продажба) или 'rent' (наем)
2. city & district: Град, после район/квартал
3. contactName & phone: Име и телефон за обратна връзка
4. email: Поискай имейл за контакт
5. description: Тип имот и кратко описание
6. photoRefs: Активно насърчи потребителя да прикачи снимки на имота чрез бутона за снимки долу вляво в чата. Снимките са важни за по-бърза продажба/наем.

Финализиране: Обобщи данните и попитай дали са правилни. Ако потвърди, извикай submit_lead.

### Important Rules
- Комуникирай САМО на български език
- НЕ извиквай submit_lead докато не си събрал поне: contactName, phone, offerType и city
- offerType ТРЯБВА да е точно 'sale' или 'rent' (малки букви на английски)
- НИКОГА не предлагай на потребителя да пропусне информация. Не казвай "може да оставим като неразкрит" или подобни. Винаги насърчавай да предостави данните.
- Ако потребителят категорично откаже да предостави нещо, приеми го мълчаливо и продължи напред. Вътрешно задай "not disclosed" без да споменаваш това на потребителя.
- Ако потребителят не предостави описание, създай кратко описание от наличната информация
- photoRefs трябва да е масив от URL адреси. Ако няма снимки, задай празен масив []
- Когато поискаш снимки, кажи на потребителя да използва бутона за снимки долу вляво в чата. НИКОГА не споменавай URL адреси и не използвай емоджита.
- Насърчавай снимките активно — не казвай "ако нямате, няма проблем". Снимките помагат за по-бързо намиране на купувач/наемател.
- Пиши съкращенията изцяло: вместо "кв.м" пиши "квадратни метра", вместо "бр." пиши "броя", вместо "ет." пиши "етаж" и т.н.
- Пиши числата с думи когато са малки (до 20). За по-големи числа можеш да използваш цифри.
- Преди да извикаш submit_lead, обобщи събраната информация и попитай потребителя дали е правилна
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
            enum: ["sale", "rent"],
            description: "Тип оферта: 'sale' за продажба, 'rent' за наем",
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

  // Convert standalone numbers to Bulgarian words
  result = result.replace(/\b(\d+)\b/g, (_match, numStr) => {
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
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: preparedText,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
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
