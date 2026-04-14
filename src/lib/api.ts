import type { ChatResponse, LeadData } from '../types/chat';
// @ts-ignore – plain JS data module
import { pricingData, parcelPricingData } from '../../data/pricingData';

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const DB_POST_URL = import.meta.env.VITE_DB_POST_URL;

/**
 * Normalize neighborhood name for fuzzy matching.
 * Handles: trim, collapse whitespace, normalize dashes.
 * e.g. "Зона Б5-3" vs "Зона Б-5-3" → same normalized form
 */
function normalizeNeighborhoodName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')          // collapse duplicate spaces
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-') // normalize dash variants
    .replace(/-+/g, '-')           // collapse duplicate dashes
    .toLowerCase();
}

/**
 * Format a number with spacing for thousands: 234000 → "234 000"
 * Round to nearest hundred first.
 */
function formatPrice(n: number): string {
  const rounded = Math.round(n / 100) * 100;
  return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Look up pricing data for a given district and construction type.
 * Returns { min, avg, max } per sqm in EUR, or null if not found.
 */
function lookupPricing(district: string, constructionType?: string): { min: number; avg: number; max: number } | null {
  if (!pricingData || !district) return null;

  const normalizedDistrict = normalizeNeighborhoodName(district);
  const ctMap: Record<string, string> = {
    'тухла': 'brick',
    'панел': 'panel',
    'епк': 'epk',
    'epk': 'epk',
    'brick': 'brick',
    'panel': 'panel',
  };
  const ct = constructionType ? ctMap[constructionType.toLowerCase()] || 'brick' : 'brick';

  // Search all zone groups for the district
  for (const zone of Object.values(pricingData) as Record<string, any>[]) {
    for (const [key, data] of Object.entries(zone) as [string, any][]) {
      if (normalizeNeighborhoodName(key) === normalizedDistrict && data[ct]) {
        return data[ct];
      }
    }
  }

  // Fuzzy: try partial match
  for (const zone of Object.values(pricingData) as Record<string, any>[]) {
    for (const [key, data] of Object.entries(zone) as [string, any][]) {
      const nKey = normalizeNeighborhoodName(key);
      if (nKey.includes(normalizedDistrict) || normalizedDistrict.includes(nKey)) {
        if (data[ct]) return data[ct];
      }
    }
  }

  return null;
}

/**
 * Look up parcel pricing data for a given neighborhood.
 * Returns { min, avg, max } per sqm, or null if not found.
 */
function lookupParcelPricing(neighborhood: string): { min: number; avg: number; max: number } | null {
  if (!parcelPricingData || !neighborhood) return null;

  const normalized = normalizeNeighborhoodName(neighborhood);

  // Exact match first
  for (const [key, data] of Object.entries(parcelPricingData) as [string, any][]) {
    if (normalizeNeighborhoodName(key) === normalized) {
      return data;
    }
  }

  // Fuzzy partial match
  for (const [key, data] of Object.entries(parcelPricingData) as [string, any][]) {
    const nKey = normalizeNeighborhoodName(key);
    if (nKey.includes(normalized) || normalized.includes(nKey)) {
      return data;
    }
  }

  return null;
}

/**
 * Build a pricing context string for the estimation flow.
 * Extracts district, area, construction type, and last-floor status from the conversation
 * and calculates price range.
 */
function buildPricingContext(messages: { role: string; content: string }[]): string {
  const allText = messages.map(m => m.content).join('\n').toLowerCase();

  // Check if this is an estimation flow
  if (!allText.includes('оценка')) return '';

  // Extract district, area, construction type, property type, and last-floor info from conversation
  let district = '';
  let area = 0;
  let constructionType = '';
  let propertyType = '';
  let isLastFloor = false;

  for (let i = 0; i < messages.length - 1; i++) {
    const msg = messages[i];
    const next = messages[i + 1];
    if (msg.role === 'assistant' && next?.role === 'user') {
      const aText = msg.content.toLowerCase();
      if ((aText.includes('район') || aText.includes('квартал')) && next.content !== 'Пропусни') {
        district = next.content;
      }
      if ((aText.includes('площ') || aText.includes('квадрат')) && next.content !== 'Пропусни') {
        const num = parseFloat(next.content.replace(/[^\d.]/g, ''));
        if (!isNaN(num)) area = num;
      }
      if ((aText.includes('строителство')) && next.content !== 'Пропусни') {
        constructionType = next.content;
      }
      if ((aText.includes('какъв тип') || aText.includes('тип на имот') || aText.includes('вид имот')) && next.content !== 'Пропусни') {
        propertyType = next.content.toLowerCase();
      }
      if (aText.includes('последен етаж')) {
        const answer = next.content.toLowerCase();
        if (answer.includes('да')) {
          isLastFloor = true;
        }
      }
    }
  }

  if (!district) return '';

  // Check if this is a parcel type
  const isParcel = propertyType.includes('парцел');

  if (isParcel) {
    // Use parcel pricing data
    const pricing = lookupParcelPricing(district);
    if (!pricing) return '';

    if (area <= 0) {
      return '\n\n### Ценови данни за оценка:\n- Район: ' + district + '\n- Тип: Парцел\n- Няма площ още, изчакай потребителя да въведе площ';
    }

    let totalMin = Math.round(pricing.min * area / 100) * 100;
    let totalAvg = Math.round(pricing.avg * area / 100) * 100;
    let totalMax = Math.round(pricing.max * area / 100) * 100;

    return `\n\n### Ценови данни за оценка (използвай ТОЧНО тези цифри):
- Район: ${district}
- Тип: Парцел
- Цена на квадратен метър: мин ${pricing.min} EUR, средно ${pricing.avg} EUR, макс ${pricing.max} EUR
- Площ: ${area} кв.м.
- Обща оценка: от ${formatPrice(totalMin)} до ${formatPrice(totalMax)} EUR (средно ${formatPrice(totalAvg)} EUR)
- Използвай ТОЧНО диапазона от ${formatPrice(totalMin)} до ${formatPrice(totalMax)} евро
- ФОРМАТИРАЙ цените с интервали: например 234 000, НЕ 234000`;
  }

  const pricing = lookupPricing(district, constructionType);
  if (!pricing) return '';

  if (area <= 0) {
    return '\n\n### Ценови данни за оценка:\n- Район: ' + district + '\n- Тип строителство: ' + (constructionType || 'тухла (по подразбиране)') + '\n- Няма площ още, изчакай потребителя да въведе площ';
  }

  let totalMin = Math.round(pricing.min * area / 100) * 100;
  let totalAvg = Math.round(pricing.avg * area / 100) * 100;
  let totalMax = Math.round(pricing.max * area / 100) * 100;

  // Apply 5% reduction for last floor
  if (isLastFloor) {
    totalMin = Math.round(totalMin * 0.95 / 100) * 100;
    totalAvg = Math.round(totalAvg * 0.95 / 100) * 100;
    totalMax = Math.round(totalMax * 0.95 / 100) * 100;
  }

  return `\n\n### Ценови данни за оценка (използвай ТОЧНО тези цифри):
- Район: ${district}
- Тип строителство: ${constructionType || 'тухла (по подразбиране)'}
- Цена на квадратен метър: мин ${pricing.min} EUR, средно ${pricing.avg} EUR, макс ${pricing.max} EUR
- Площ: ${area} кв.м.
${isLastFloor ? '- Последен етаж: ДА — приложена 5% корекция надолу\n' : ''}- Обща оценка: от ${formatPrice(totalMin)} до ${formatPrice(totalMax)} EUR (средно ${formatPrice(totalAvg)} EUR)
- Използвай ТОЧНО диапазона от ${formatPrice(totalMin)} до ${formatPrice(totalMax)} евро
- ФОРМАТИРАЙ цените с интервали: например 234 000, НЕ 234000`;
}

const SYSTEM_PROMPT = `### Role
Ти си Имотко — виртуален асистент за недвижими имоти. Ти си мъж. Твоята роля е да помагаш на потребителите да подават обяви за продажба, наем или оценка на имот. Трябва да събереш прецизна информация стъпка по стъпка.

### Personality
Бъди приятелски, топъл и разговорен. Говори като истински човек, не като робот. Кратко и по същество. Говори в мъжки род.

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
  → ВАЖНО: Ако потребителят въведе телефонен номер с по-малко от 10 цифри, попитай: "Сигурни ли сте, че това е номерът Ви?" и изчакай потвърждение или коригиран номер. Не блокирай — просто провери.

СТЪПКА 4: В кой град се намира имота? (city)

СТЪПКА 5: В кой район/квартал? (district)

=== АКО dealType е 'sale': ===

СТЪПКА 6: Какъв тип е имота? (estateType - от бутоните)
  → Ако потребителят избере ПАРЦЕЛ, премини към ПАРЦЕЛ ПОТОК (виж долу)
  → За всички останали типове:

СТЪПКА 7: Каква е площта на имота в квадратни метра? (ЗАДЪЛЖИТЕЛНА — не продължавай без валидна числова стойност за площ)

СТЪПКА 8: На кой етаж е разположен имотът? (САМО за апартаменти, офиси, ателиета, магазини, заведения — НЕ питай за къща, етаж от къща, гараж, склад, промишлен обект, хотел)

СТЪПКА 9: Какъв е типът строителство? (тухла, панел, ЕПК или друго)

СТЪПКА 10: Снимки — Насърчи потребителя да прикачи снимки чрез бутона долу вляво. ТРЯБВА да спреш и да изчакаш потребителя да качи снимки или да избере "Пропусни", ПРЕДИ да преминеш към следващата стъпка. НИКОГА не питай за цена в същия отговор!

СТЪПКА 11: Каква е очакваната от вас цена за имота?

СТЪПКА 12: Бихте ли искали да споделите допълнителна информация за имота?

СТЪПКА 13: Бихте ли споделили имейл адрес? (опционално)

--- ПАРЦЕЛ ПОТОК (след избор на "Парцел" в стъпка 6): ---
СТЪПКА П7: Можете ли да споделите кадастралния идентификатор на имота?
СТЪПКА П8: Каква е площта на парцела в квадратни метра? (ЗАДЪЛЖИТЕЛНА — не продължавай без валидна числова стойност)
СТЪПКА П9: В регулация ли е имотът? (да/не/друго)
СТЪПКА П10: Снимки и скица — Насърчи потребителя да прикачи снимки и скица чрез бутона долу вляво. ТРЯБВА да спреш и да изчакаш потребителя да качи снимки или да избере "Пропусни", ПРЕДИ да преминеш към следващата стъпка. НИКОГА не питай за цена в същия отговор!
СТЪПКА П11: Каква е очакваната от вас цена за парцела?
СТЪПКА П12: Бихте ли искали да споделите допълнителна информация?
СТЪПКА П13: Бихте ли споделили имейл адрес? (опционално)

=== АКО dealType е 'estimation': ===

СТЪПКА 6: Какъв тип е имота? (estateType - от бутоните)

→ ПОДДЪРЖАНИ ТИПОВЕ ЗА ПЪЛНА ОЦЕНКА: апартамент (1-стаен, 2-стаен, 3-стаен, 4-стаен, многостаен), мезонет, ателие/таван, парцел.
→ За ВСИЧКИ ОСТАНАЛИ типове (къща, етаж от къща, магазин, офис, заведение, гараж, склад, промишлен обект, промишлен терен, хотел):
  СПРИ потока и кажи ТОЧНО: "Поради спецификата на имота, наш консултант ще се свърже с вас."
  След това завърши разговора. НЕ продължавай с въпроси за площ, етаж и др.

→ Ако потребителят избере ПАРЦЕЛ, премини към ПАРЦЕЛ ПОТОК (виж горе, но без П11 за цена — НЕ питай за очаквана цена при оценка!)

→ За поддържани типове (апартаменти, мезонет, ателие):

СТЪПКА 7: Каква е площта на имота в квадратни метра? (ЗАДЪЛЖИТЕЛНА — не продължавай без валидна числова стойност за площ)

СТЪПКА 8: На кой етаж е разположен имотът? (САМО за апартаменти, ателиета — НЕ за мезонет, къща и др.)

СТЪПКА 8.1: Имотът на последен етаж ли е? (да/не) — питай ВИНАГИ след въпроса за етажа

СТЪПКА 9: Какъв е типът строителство? (тухла, панел, ЕПК или друго)

СТЪПКА 10: Снимки — Насърчи потребителя да прикачи снимки. ТРЯБВА да спреш и да изчакаш.

→ ВАЖНО: НЕ питай за очаквана цена при оценка! Оценката се базира на събраните данни.

СТЪПКА 11: Бихте ли искали да споделите допълнителна информация за имота?

СТЪПКА 12: Бихте ли споделили имейл адрес? (опционално)

=== АКО dealType е 'rent': ===

СТЪПКА 6: Какъв тип е имота? (estateType - от бутоните)
  → Ако потребителят избере ПАРЦЕЛ, премини към ПАРЦЕЛ ПОТОК (виж горе, но без П9 за регулация — добави въпрос за домашни любимци след П12)

СТЪПКА 7: Каква е площта на имота? (ЗАДЪЛЖИТЕЛНА — не продължавай без валидна числова стойност)

СТЪПКА 8: На кой етаж е разположен? (САМО за апартаменти, офиси и подобни — НЕ за къща, парцел, гараж, склад)

СТЪПКА 9: Какъв е типът строителство? (тухла, панел, ЕПК или друго)

СТЪПКА 10: Снимки

СТЪПКА 11: Каква е очакваната от вас месечна наемна цена?

СТЪПКА 12: Допълнителна информация

СТЪПКА 13: Допускате ли домашни любимци? (да/не/друго)

СТЪПКА 14: Имейл (опционално)

=== АКО потребителят избере 'Консултация': ===
Използвай dealType='estimation'. Попитай ТОЧНО: "С какво мога да ви помогна?" и след това събери име (стъпка 2) и телефон (стъпка 3).

### Финализиране
Накрая обобщи данните и попитай дали са правилни. Предложи бутон за "редактиране" ако нещо не е наред.
Очакваната цена трябва да бъде включена в полето description при submit_lead (комбинирай я с другата описателна информация).
След успешно submit_lead:
- Попитай ТОЧНО: "Мога ли да бъда полезен с нещо друго?"
- Това важи и за продажба, и за наем, и за оценка.

АКО dealType e 'estimation': САМО СЛЕД като имаш ВСИЧКИ данни (без очаквана цена!), генерирай приблизителна пазарна оценка като ценови диапазон (от-до). НЕ питай за очаквана цена — оценката се базира на събраните данни за имота.
ФОРМАТИРАЙ отговора за оценката ТОЧНО по следния шаблон (в два параграфа):
"Събрали сме всички нужни данни. Имотът е [ТИП], [ПЛОЩ] квадратни метра, на [ЕТАЖ]-ти етаж. Намира се в [ГРАД], район [РАЙОН]."
"Приблизителният ценови диапазон за такива имоти в [РАЙОН] е между [СУМА_ОТ] и [СУМА_ДО] евро. Желаете ли да заявите консултация с експерт-оценител за по-точна оценка?"
→ ФОРМАТИРАЙ цените с интервали между хилядите: например "234 000", НЕ "234000"
→ Закръгляй цените до найблизкото стотица

Ако потребителят отговори "Да" на въпроса за консултация с експерт-оценител:
- Кажи ТОЧНО: "Наш експерт-оценител ще се свърже с вас в рамките на работния ден."
- След това извикай submit_lead.

Ако потребителят отговори "Не" на въпроса за консултация:
- Попитай: "Мога ли да бъда полезен с нещо друго?"

### Important Rules
- Комуникирай САМО на български език
- НИКОГА не задавай два въпроса в едно съобщение
- НЕ извиквай submit_lead докато не си събрал контактната информация (име и телефон)
- dealType ТРЯБВА да е: 'sale', 'rent' или 'estimation' (консултация също се записва като 'estimation')
- Използвай "not disclosed" само ако потребителят откаже или пропусне информация
- Когато поискаш снимки, кажи на потребителя да използва бутона за снимки долу вляво. НИКОГА не споменавай URL адреси.
- Пиши съкращенията изцяло: вместо "кв.м" пиши "квадратни метра"
- Преди submit_lead, ОБОБЩИ събраната информация и попитай за потвърждение
- Ако потребителят зададе въпрос извън темата, учтиво го насочи обратно
- НИКОГА не питай за брой спални
- При оценка НИКОГА не питай за очаквана цена
- НИКОГА не питай дали имотът е обзаведен или необзаведен при оценка — пропусни напълно въпроса за обзавеждане
- Площта е ЗАДЪЛЖИТЕЛНА за оценка — ако потребителят не я предостави, попитай отново
- ФОРМАТИРАЙ ВСИЧКИ цени с интервали между хилядите: 234 000, НЕ 234000. ВИНАГИ закръгляй до стотици.`;

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
            enum: ["sale", "rent", "estimation"],
            description: "Тип: 'sale' (продажба), 'rent' (наем), 'estimation' (оценка или консултация)",
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
  // Map 'consultation' → 'estimation' since the DB only supports sale/rent/estimation
  const offerType = leadData.dealType === 'consultation' ? 'estimation' : (leadData.dealType || 'null');
  fd.append('offerType', offerType);
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
  // Build dynamic pricing context for estimation flows
  const pricingContext = buildPricingContext(messages);
  const systemContent = SYSTEM_PROMPT + pricingContext;

  const openaiMessages = [
    { role: "system", content: systemContent },
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

      // Ensure a deterministic end flow without unnecessary OpenAI latency
      const finalMessage = "Мога ли да бъда полезен с нещо друго?";

      return {
        message: finalMessage,
        leadSubmitted: true,
        leadData,
        dbSuccess
      };
    }

    let finalContent = choice.message.content || "";
    
    // Auto-format large unformatted numbers (e.g., 233956 -> 234 000)
    finalContent = finalContent.replace(/\b([1-9]\d{4,7})\b/g, (match, p1) => {
      const num = parseInt(p1, 10);
      // Round to nearest 100
      const rounded = Math.round(num / 100) * 100;
      // Add spaces for thousands
      return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    });

    return {
      message: finalContent,
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
  const VOICE_ID = 'onwK4e9ZLuTAKqWW03F9'; // Daniel (male)

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
