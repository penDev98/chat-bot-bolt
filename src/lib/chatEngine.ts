/**
 * chatEngine.ts — Deterministic state-machine chatbot engine.
 *
 * Replaces the OpenAI-based conversation flow with a pure
 * if-else / switch-case state machine.  Every question, every
 * button suggestion, and every transition is hard-coded so the
 * behaviour is 100 % predictable, zero-latency, and zero-cost.
 *
 * The only external services kept are:
 *   • ElevenLabs TTS (voice read-aloud)
 *   • The lead-submission APIs (property-offer / contact-form)
 */

import type { QuickReply, LeadData } from '../types/chat';
import { lookupPricing, lookupParcelPricing, formatPrice } from './api';

// ════════════════════════════════════════════
//  Types
// ════════════════════════════════════════════

export interface EngineState {
  step: string;
  dealType: 'sale' | 'rent' | 'estimation' | 'consultation' | null;
  estateType: string;        // Bulgarian label shown to user
  estateTypeEnum: string;    // English API enum value
  isParcel: boolean;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  city: string;
  district: string;
  area: number;
  floor: string;
  isLastFloor: boolean;
  constructionType: string;  // Bulgarian label: Тухла / Панел / ЕПК
  price: string;
  additionalInfo: string;
  cadastralId: string;
  regulation: string;
  pets: string;
  consultationMessage: string;
  photoRefs: string[];
}

export interface EngineResult {
  state: EngineState;
  botMessages: string[];
  suggestions: QuickReply[];
  shouldSubmit: boolean;
}

// ════════════════════════════════════════════
//  Constants
// ════════════════════════════════════════════

const ESTATE_TYPE_MAP: Record<string, string> = {
  '1-стаен': 'studio',
  '2-стаен': 'two_room',
  '3-стаен': 'three_room',
  '4-стаен': 'four_room',
  'многостаен': 'multi_room',
  'мезонет': 'maisonette',
  'ателие / таван': 'atelier',
  'ателие': 'atelier',
  'таван': 'atelier',
  'етаж от къща': 'house_floor',
  'къща': 'house',
  'магазин': 'store',
  'офис': 'office',
  'заведение': 'restaurant',
  'гараж': 'garage',
  'склад': 'warehouse',
  'промишлен обект': 'industrial',
  'промишлен терен': 'industrial_land',
  'парцел': 'parcel',
  'хотел': 'hotel',
};

/** Property types that warrant a "which floor?" question, per deal type. */
const FLOOR_TYPES: Record<string, string[]> = {
  sale: ['studio', 'two_room', 'three_room', 'four_room', 'multi_room', 'office', 'atelier', 'store', 'restaurant'],
  rent: ['studio', 'two_room', 'three_room', 'four_room', 'multi_room', 'office', 'atelier'],
  estimation: ['studio', 'two_room', 'three_room', 'four_room', 'multi_room', 'atelier'],
};

/** Estimation: only these types support an automated price estimate. */
const SUPPORTED_EST_TYPES = new Set([
  'studio', 'two_room', 'three_room', 'four_room', 'multi_room',
  'maisonette', 'atelier', 'parcel',
]);

// ════════════════════════════════════════════
//  Contact persistence (localStorage)
// ════════════════════════════════════════════

const CONTACT_STORAGE_KEY = 'imotko_contact';

interface SavedContact {
  name: string;
  phone: string;
  email?: string;
}

export function getSavedContact(): SavedContact | null {
  try {
    const raw = localStorage.getItem(CONTACT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.name && parsed.phone) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function saveContact(name: string, phone: string, email?: string): void {
  try {
    const data: SavedContact = { name, phone };
    if (email) data.email = email;
    localStorage.setItem(CONTACT_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage unavailable — silently ignore
  }
}

// ════════════════════════════════════════════
//  Small helpers
// ════════════════════════════════════════════

function withSkip(suggestions: QuickReply[]): QuickReply[] {
  return [...suggestions, { label: 'Пропусни', value: 'Пропусни' }];
}

function countDigits(str: string): number {
  return (str.match(/\d/g) || []).length;
}

function parseDealType(input: string): EngineState['dealType'] {
  const t = input.toLowerCase();
  if (t.includes('продам') || t.includes('продажба') || t.includes('продавам')) return 'sale';
  if (t.includes('наем') || t.includes('отдам') || t.includes('отдавам')) return 'rent';
  if (t.includes('оценка') || t.includes('оценя')) return 'estimation';
  if (t.includes('консултация') || t.includes('съвет') || t.includes('помощ')) return 'consultation';
  return 'sale';
}

function parseEstateType(input: string): { label: string; enum: string } {
  const lower = input.toLowerCase().trim();

  // Exact map lookup
  for (const [bgLabel, enEnum] of Object.entries(ESTATE_TYPE_MAP)) {
    if (lower === bgLabel.toLowerCase()) return { label: bgLabel, enum: enEnum };
  }

  // Fuzzy fallbacks
  if (lower.includes('1-стаен') || lower.includes('едностаен') || lower.includes('студио'))
    return { label: '1-стаен', enum: 'studio' };
  if (lower.includes('2-стаен') || lower.includes('двустаен'))
    return { label: '2-стаен', enum: 'two_room' };
  if (lower.includes('3-стаен') || lower.includes('тристаен'))
    return { label: '3-стаен', enum: 'three_room' };
  if (lower.includes('4-стаен') || lower.includes('четиристаен'))
    return { label: '4-стаен', enum: 'four_room' };
  if (lower.includes('многостаен'))
    return { label: 'Многостаен', enum: 'multi_room' };
  if (lower.includes('мезонет'))
    return { label: 'Мезонет', enum: 'maisonette' };
  if (lower.includes('ателие') || lower.includes('таван'))
    return { label: 'Ателие / таван', enum: 'atelier' };
  if (lower.includes('етаж от къща'))
    return { label: 'Етаж от къща', enum: 'house_floor' };
  if (lower.includes('къща'))
    return { label: 'Къща', enum: 'house' };
  if (lower.includes('магазин'))
    return { label: 'Магазин', enum: 'store' };
  if (lower.includes('офис'))
    return { label: 'Офис', enum: 'office' };
  if (lower.includes('заведение'))
    return { label: 'Заведение', enum: 'restaurant' };
  if (lower.includes('гараж'))
    return { label: 'Гараж', enum: 'garage' };
  if (lower.includes('склад'))
    return { label: 'Склад', enum: 'warehouse' };
  if (lower.includes('промишлен обект'))
    return { label: 'Промишлен обект', enum: 'industrial' };
  if (lower.includes('промишлен терен'))
    return { label: 'Промишлен терен', enum: 'industrial_land' };
  if (lower.includes('парцел'))
    return { label: 'Парцел', enum: 'parcel' };
  if (lower.includes('хотел'))
    return { label: 'Хотел', enum: 'hotel' };

  return { label: input, enum: 'other' };
}

function needsFloor(dealType: string, estateTypeEnum: string): boolean {
  return (FLOOR_TYPES[dealType] || []).includes(estateTypeEnum);
}

// ════════════════════════════════════════════
//  Suggestion generators
// ════════════════════════════════════════════

function citySuggestions(): QuickReply[] {
  return withSkip([
    { label: 'София', value: 'София' },
    { label: 'Пловдив', value: 'Пловдив' },
    { label: 'Варна', value: 'Варна' },
    { label: 'Бургас', value: 'Бургас' },
    { label: 'Друг', value: 'ACTION_FOCUS' },
  ]);
}

function districtSuggestions(city: string): QuickReply[] {
  const c = city.toLowerCase();

  if (c.includes('пловдив')) {
    return withSkip([
      { label: 'Център', value: 'Център' },
      { label: 'Тракия', value: 'Тракия' },
      { label: 'Смирненски', value: 'Смирненски' },
      { label: 'Кючук Париж', value: 'Кючук Париж' },
      { label: 'Кършияка', value: 'Кършияка' },
      { label: 'Друг', value: 'ACTION_FOCUS' },
    ]);
  }
  if (c.includes('бургас')) {
    return withSkip([
      { label: 'Център', value: 'Център' },
      { label: 'Лазур', value: 'Лазур' },
      { label: 'Изгрев', value: 'Изгрев' },
      { label: 'Славейков', value: 'Славейков' },
      { label: 'Меден рудник', value: 'Меден рудник' },
      { label: 'Друг', value: 'ACTION_FOCUS' },
    ]);
  }
  if (c.includes('варна')) {
    return withSkip([
      { label: 'Център', value: 'Център' },
      { label: 'Левски', value: 'Левски' },
      { label: 'Младост', value: 'Младост' },
      { label: 'Владиславово', value: 'Владиславово' },
      { label: 'Бриз', value: 'Бриз' },
      { label: 'Друг', value: 'ACTION_FOCUS' },
    ]);
  }

  // Default — Sofia
  return withSkip([
    { label: 'Център', value: 'Център' },
    { label: 'Лозенец', value: 'Лозенец' },
    { label: 'Младост', value: 'Младост' },
    { label: 'Люлин', value: 'Люлин' },
    { label: 'Витоша', value: 'Витоша' },
    { label: 'Друг', value: 'ACTION_FOCUS' },
  ]);
}

function estateTypeSuggestions(): QuickReply[] {
  return [
    { label: '1-стаен', value: '1-стаен' },
    { label: '2-стаен', value: '2-стаен' },
    { label: '3-стаен', value: '3-стаен' },
    { label: 'Парцел', value: 'Парцел' },
    { label: 'Друг', value: 'Друг' },
  ];
}

function expandedEstateTypeSuggestions(): QuickReply[] {
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
    { label: 'Хотел', value: 'Хотел' },
  ]);
}

function constructionSuggestions(): QuickReply[] {
  return withSkip([
    { label: 'Тухла', value: 'Тухла' },
    { label: 'Панел', value: 'Панел' },
    { label: 'ЕПК', value: 'ЕПК' },
    { label: 'Друго', value: 'ACTION_FOCUS' },
  ]);
}

function confirmSuggestions(): QuickReply[] {
  return [
    { label: 'Всичко изглежда наред', value: 'Потвърждавам' },
    { label: 'Редактиране', value: 'ACTION_FOCUS' },
  ];
}

function emailSuggestions(): QuickReply[] {
  return [{ label: 'Пропусни', value: 'Пропусни' }];
}


function yesNoSuggestions(): QuickReply[] {
  return [
    { label: 'Да', value: 'Да' },
    { label: 'Не', value: 'Не' },
  ];
}

function anythingElseSuggestions(): QuickReply[] {
  return [
    { label: 'Да', value: 'ACTION_RESTART' },
    { label: 'Не, благодаря', value: 'ACTION_CLOSE' },
  ];
}

function phoneValidationSuggestions(): QuickReply[] {
  return [
    { label: 'Да, правилен е', value: 'Да, номерът е правилен.' },
    { label: 'Коригирам', value: 'ACTION_FOCUS' },
  ];
}

function skipOnly(): QuickReply[] {
  return [{ label: 'Пропусни', value: 'Пропусни' }];
}

// ════════════════════════════════════════════
//  Summary / Estimate text builders
// ════════════════════════════════════════════

function buildSummaryText(s: EngineState): string {
  const dealLabels: Record<string, string> = {
    sale: 'Продажба', rent: 'Наем', estimation: 'Оценка', consultation: 'Консултация',
  };
  const lines: string[] = [];
  lines.push(`• Тип: ${dealLabels[s.dealType!] || s.dealType}`);
  if (s.estateType) lines.push(`• Имот: ${s.estateType}`);
  lines.push(`• Град: ${s.city}`);
  if (s.district && s.district !== 'not disclosed') lines.push(`• Район: ${s.district}`);
  if (s.area > 0) lines.push(`• Площ: ${s.area} квадратни метра`);
  if (s.floor) lines.push(`• Етаж: ${s.floor}`);
  if (s.constructionType) lines.push(`• Строителство: ${s.constructionType}`);
  if (s.cadastralId) lines.push(`• Кадастрален идентификатор: ${s.cadastralId}`);
  if (s.regulation) lines.push(`• Регулация: ${s.regulation}`);
  if (s.price) lines.push(`• Цена: ${s.price}`);
  if (s.additionalInfo) lines.push(`• Допълнително: ${s.additionalInfo}`);
  if (s.pets) lines.push(`• Домашни любимци: ${s.pets}`);
  if (s.contactEmail && s.contactEmail !== 'not disclosed') lines.push(`• Имейл: ${s.contactEmail}`);
  if (s.photoRefs.length > 0) lines.push(`• Снимки: ${s.photoRefs.length} бр.`);
  return `Ето обобщение:\n${lines.join('\n')}\n\nВсичко правилно ли е?`;
}

function buildConsultSummary(s: EngineState): string {
  const lines: string[] = [];
  lines.push(`• Име: ${s.contactName}`);
  lines.push(`• Телефон: ${s.contactPhone}`);
  if (s.contactEmail && s.contactEmail !== 'not disclosed') lines.push(`• Имейл: ${s.contactEmail}`);
  lines.push(`• Съобщение: ${s.consultationMessage}`);
  return `Ето обобщение на вашата заявка:\n${lines.join('\n')}\n\nВсичко правилно ли е?`;
}

function generateEstimateMessages(s: EngineState): { messages: string[]; found: boolean } {
  if (s.isParcel) {
    const pricing = lookupParcelPricing(s.district);
    if (!pricing || s.area <= 0) {
      return {
        messages: [
          'За съжаление нямаме достатъчно данни за автоматична оценка на вашия парцел в този район.',
          'Поради спецификата на имота, наш консултант ще се свърже с вас.',
        ],
        found: false,
      };
    }
    const totalMin = Math.round(pricing.min * s.area / 100) * 100;
    const totalMax = Math.round(pricing.max * s.area / 100) * 100;
    return {
      messages: [
        `Събрали сме всички нужни данни. Имотът е парцел, ${s.area} квадратни метра. Намира се в ${s.city}, район ${s.district}.`,
        `Приблизителният ценови диапазон е между ${formatPrice(totalMin)} и ${formatPrice(totalMax)} евро. Желаете ли да заявите консултация с експерт-оценител за по-точна оценка?`,
      ],
      found: true,
    };
  }

  // Non-parcel estimation
  const pricing = lookupPricing(s.district, s.constructionType);
  if (!pricing || s.area <= 0) {
    return {
      messages: [
        'За съжаление нямаме достатъчно данни за автоматична оценка в този район.',
        'Поради спецификата на имота, наш консултант ще се свърже с вас.',
      ],
      found: false,
    };
  }

  let totalMin = Math.round(pricing.min * s.area / 100) * 100;
  let totalMax = Math.round(pricing.max * s.area / 100) * 100;

  if (s.isLastFloor) {
    totalMin = Math.round(totalMin * 0.95 / 100) * 100;
    totalMax = Math.round(totalMax * 0.95 / 100) * 100;
  }

  const floorText = s.floor ? `, на ${s.floor}-ти етаж` : '';

  return {
    messages: [
      `Събрали сме всички нужни данни. Имотът е ${s.estateType.toLowerCase()}, ${s.area} квадратни метра${floorText}. Намира се в ${s.city}, район ${s.district}.`,
      `Приблизителният ценови диапазон за такива имоти в ${s.district} е между ${formatPrice(totalMin)} и ${formatPrice(totalMax)} евро. Желаете ли да заявите консултация с експерт-оценител за по-точна оценка?`,
    ],
    found: true,
  };
}

// ════════════════════════════════════════════
//  Lead data builder (for API submission)
// ════════════════════════════════════════════

export function buildLeadData(state: EngineState): LeadData {
  const parts: string[] = [];
  if (state.consultationMessage) parts.push(state.consultationMessage);
  if (state.estateType) parts.push(`Тип имот: ${state.estateType}`);
  if (state.area > 0) parts.push(`Площ: ${state.area} кв.м.`);
  if (state.floor) parts.push(`Етаж: ${state.floor}`);
  if (state.isLastFloor) parts.push('Последен етаж: Да');
  if (state.constructionType) parts.push(`Строителство: ${state.constructionType}`);
  if (state.cadastralId) parts.push(`Кадастрален ID: ${state.cadastralId}`);
  if (state.regulation) parts.push(`Регулация: ${state.regulation}`);
  if (state.price) parts.push(`Очаквана цена: ${state.price}`);
  if (state.pets) parts.push(`Домашни любимци: ${state.pets}`);
  if (state.additionalInfo) parts.push(state.additionalInfo);

  return {
    dealType: state.dealType || 'estimation',
    estateType: (state.estateTypeEnum || 'other') as LeadData['estateType'],
    city: state.city || 'not disclosed',
    district: state.district || 'not disclosed',
    contactName: state.contactName || 'not disclosed',
    contactPhone: state.contactPhone || 'not disclosed',
    contactEmail: state.contactEmail || 'not disclosed',
    description: parts.join('. ') || 'not disclosed',
    photoRefs: state.photoRefs,
  };
}

// ════════════════════════════════════════════
//  State factory
// ════════════════════════════════════════════

export function createInitialState(): EngineState {
  return {
    step: 'greeting',
    dealType: null,
    estateType: '',
    estateTypeEnum: '',
    isParcel: false,
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    city: '',
    district: '',
    area: 0,
    floor: '',
    isLastFloor: false,
    constructionType: '',
    price: '',
    additionalInfo: '',
    cadastralId: '',
    regulation: '',
    pets: '',
    consultationMessage: '',
    photoRefs: [],
  };
}

// ════════════════════════════════════════════
//  Result constructors
// ════════════════════════════════════════════

function mk(state: EngineState, botMessages: string[], suggestions: QuickReply[]): EngineResult {
  return { state, botMessages, suggestions, shouldSubmit: false };
}

function mkSubmit(state: EngineState, botMessages: string[], suggestions: QuickReply[]): EngineResult {
  return { state, botMessages, suggestions, shouldSubmit: true };
}

// ════════════════════════════════════════════
//  Transition helpers (called from multiple steps)
// ════════════════════════════════════════════

/** After the user picks / types an estate type, route to the correct next step. */
function handleEstateTypeSelection(s: EngineState, input: string): EngineResult {
  const isSkip = input === 'Пропусни';

  if (isSkip) {
    s.estateType = 'Друг';
    s.estateTypeEnum = 'other';
  } else {
    const parsed = parseEstateType(input);
    s.estateType = parsed.label;
    s.estateTypeEnum = parsed.enum;
  }
  s.isParcel = s.estateTypeEnum === 'parcel';

  // Estimation — unsupported property type ➜ consultant redirect + submit partial
  if (s.dealType === 'estimation' && !SUPPORTED_EST_TYPES.has(s.estateTypeEnum)) {
    s.step = 'anything_else';
    return mkSubmit(s, [
      'Поради спецификата на имота, наш консултант ще се свърже с вас.',
      'Мога ли да бъда полезен с нещо друго?',
    ], anythingElseSuggestions());
  }

  // Parcel ➜ cadastral first
  if (s.isParcel) {
    s.step = 'ask_cadastral';
    return mk(s, ['Можете ли да споделите кадастралния идентификатор на имота?'], skipOnly());
  }

  // Normal ➜ area
  s.step = 'ask_area';
  return mk(s, ['Каква е площта на имота в квадратни метра?'], []);
}

/** After area is collected, route to regulation / floor / construction. */
function transitionAfterArea(s: EngineState): EngineResult {
  if (s.isParcel) {
    // Sale / estimation parcels ➜ regulation; rent parcels ➜ photos
    if (s.dealType === 'sale' || s.dealType === 'estimation') {
      s.step = 'ask_regulation';
      return mk(s, ['В регулация ли е имотът?'], withSkip([
        { label: 'Да', value: 'Да' },
        { label: 'Не', value: 'Не' },
        { label: 'Друго', value: 'ACTION_FOCUS' },
      ]));
    }
    s.step = 'ask_photos';
    return mk(s, ['Моля, прикачете снимки на парцела чрез бутона долу вляво.'], skipOnly());
  }

  // Non-parcel: floor or skip to construction
  if (needsFloor(s.dealType!, s.estateTypeEnum)) {
    s.step = 'ask_floor';
    return mk(s, ['На кой етаж е разположен имотът?'], skipOnly());
  }

  s.step = 'ask_construction';
  return mk(s, ['Какъв е типът строителство?'], constructionSuggestions());
}

/** After photos (uploaded or skipped), route to price or additional info. */
function transitionAfterPhotos(s: EngineState): EngineResult {
  const ack = s.photoRefs.length > 0 ? 'Благодаря за снимките! ' : '';

  if (s.dealType === 'sale' || s.dealType === 'rent') {
    s.step = 'ask_price';
    const label = s.dealType === 'rent' ? 'месечна наемна цена' : 'цена за имота';
    return mk(s, [`${ack}Каква е очакваната от вас ${label}?`], skipOnly());
  }

  // Estimation ➜ no price, go straight to additional info
  s.step = 'ask_additional';
  return mk(s, [`${ack}Бихте ли искали да споделите допълнителна информация за имота?`], skipOnly());
}

// ════════════════════════════════════════════
//  Main state machine
// ════════════════════════════════════════════

export function processMessage(
  currentState: EngineState,
  userInput: string,
  photoUrls?: string[],
): EngineResult {
  // Deep-clone to keep the function pure
  const s: EngineState = JSON.parse(JSON.stringify(currentState));
  const isSkip = userInput === 'Пропусни' || userInput === 'ПРОПУСНИ';

  // ── Photo upload handling ──────────────────────────────
  if (photoUrls && photoUrls.length > 0) {
    s.photoRefs = [...s.photoRefs, ...photoUrls];
    if (s.step === 'ask_photos') return transitionAfterPhotos(s);
    // Photos at a non-photo step — just acknowledge
    return mk(s, ['Снимките са записани!'], []);
  }

  // ── Step handlers ──────────────────────────────────────
  switch (s.step) {

    // ═══════ GREETING ═══════════════════════════════════
    case 'greeting': {
      s.dealType = parseDealType(userInput);
      if (s.dealType === 'consultation') {
        // Check for saved contact — skip name/phone if we already have them
        const saved = getSavedContact();
        if (saved) {
          s.contactName = saved.name;
          s.contactPhone = saved.phone;
          if (saved.email) s.contactEmail = saved.email;
          s.step = 'consult_message';
          return mk(s, [`Здравейте отново, ${saved.name}! С какво мога да ви помогна?`], []);
        }
        s.step = 'consult_message';
        return mk(s, ['С какво мога да ви помогна?'], []);
      }
      const labels: Record<string, string> = { sale: 'продажба', rent: 'наем', estimation: 'оценка' };
      // Check for saved contact — skip name/phone if we already have them
      const saved = getSavedContact();
      if (saved) {
        s.contactName = saved.name;
        s.contactPhone = saved.phone;
        if (saved.email) s.contactEmail = saved.email;
        s.step = 'ask_city';
        return mk(s, [
          `Здравейте отново, ${saved.name}! Ще ви помогна с ${labels[s.dealType!] || 'вашия имот'}. В кой град се намира имотът?`
        ], citySuggestions());
      }
      s.step = 'ask_name';
      return mk(s, [`Чудесно! Ще ви помогна с ${labels[s.dealType!] || 'вашия имот'}. Мога ли да знам с кого разговарям?`], []);
    }

    // ═══════ CONSULTATION FLOW ══════════════════════════
    case 'consult_message': {
      s.consultationMessage = userInput;
      // If contact info was already loaded from localStorage, skip name/phone/email
      if (s.contactName && s.contactPhone) {
        s.step = 'consult_confirm';
        return mk(s, [buildConsultSummary(s)], confirmSuggestions());
      }
      s.step = 'consult_name';
      return mk(s, ['Благодаря! Мога ли да знам с кого разговарям?'], []);
    }

    case 'consult_name': {
      s.contactName = userInput;
      // Check if we already have a saved phone from a previous session
      const savedForPhone = getSavedContact();
      if (savedForPhone && savedForPhone.phone) {
        s.contactPhone = savedForPhone.phone;
        if (savedForPhone.email) s.contactEmail = savedForPhone.email;
        s.step = 'consult_email';
        return mk(s, [`Благодаря, ${userInput}! Бихте ли споделили имейл адрес?`], emailSuggestions());
      }
      s.step = 'consult_phone';
      return mk(s, [`Благодаря, ${userInput}! А телефонен номер за връзка?`], []);
    }

    case 'consult_phone': {
      const digitsOnly = userInput.replace(/[^\d]/g, '');
      if (digitsOnly.length === 0) {
        return mk(s, ['Моля, въведете валиден телефонен номер (само цифри).'], []);
      }
      s.contactPhone = digitsOnly;
      if (digitsOnly.length > 0 && digitsOnly.length < 10) {
        s.step = 'consult_validate_phone';
        return mk(s, [`Въведеният номер е ${digitsOnly}. Сигурни ли сте, че е правилен?`], phoneValidationSuggestions());
      }
      // Persist contact info for future sessions
      saveContact(s.contactName, s.contactPhone);
      s.step = 'consult_email';
      return mk(s, ['Записано! Бихте ли споделили имейл адрес?'], emailSuggestions());
    }

    case 'consult_validate_phone': {
      if (!userInput.includes('правилен') && !userInput.toLowerCase().includes('да')) {
        const digitsOnly = userInput.replace(/[^\d]/g, '');
        if (digitsOnly.length === 0) {
          return mk(s, ['Моля, въведете валиден телефонен номер (само цифри).'], []);
        }
        s.contactPhone = digitsOnly;
        if (digitsOnly.length > 0 && digitsOnly.length < 10) {
          return mk(s, [`Въведеният номер е ${digitsOnly}. Сигурни ли сте, че е правилен?`], phoneValidationSuggestions());
        }
      }
      // Persist contact info for future sessions
      saveContact(s.contactName, s.contactPhone);
      s.step = 'consult_email';
      return mk(s, ['Записано! Бихте ли споделили имейл адрес?'], emailSuggestions());
    }

    case 'consult_email': {
      if (!isSkip && !userInput.toLowerCase().includes('нямам')) {
        if (!userInput.includes('@')) {
          return mk(s, ['Моля, въведете валиден имейл адрес (трябва да съдържа "@").'], emailSuggestions());
        }
        s.contactEmail = userInput;
      }
      // Persist contact info for future sessions
      saveContact(s.contactName, s.contactPhone, s.contactEmail || undefined);
      s.step = 'consult_confirm';
      return mk(s, [buildConsultSummary(s)], confirmSuggestions());
    }

    case 'consult_confirm': {
      if (userInput === 'Потвърждавам' || userInput.toLowerCase().includes('наред') || userInput.toLowerCase().includes('да')) {
        s.step = 'anything_else';
        return mkSubmit(s, [
          'Благодаря! Заявката ви е изпратена. Наш консултант ще се свърже с вас скоро.',
          'Мога ли да бъда полезен с нещо друго?',
        ], anythingElseSuggestions());
      }
      // Treat anything else as a correction — append and re-show summary
      s.consultationMessage += ' | Допълнение: ' + userInput;
      return mk(s, [buildConsultSummary(s)], confirmSuggestions());
    }

    // ═══════ COMMON: NAME / PHONE / CITY / DISTRICT ═════
    case 'ask_name': {
      s.contactName = userInput;
      // Check if we already have a saved phone from a previous session
      const savedPhone = getSavedContact();
      if (savedPhone && savedPhone.phone) {
        s.contactPhone = savedPhone.phone;
        if (savedPhone.email) s.contactEmail = savedPhone.email;
        // Persist updated name + existing phone
        saveContact(s.contactName, s.contactPhone, s.contactEmail || undefined);
        s.step = 'ask_city';
        return mk(s, [`Благодаря, ${userInput}! В кой град се намира имотът?`], citySuggestions());
      }
      s.step = 'ask_phone';
      return mk(s, [`Благодаря, ${userInput}! А телефонен номер за връзка?`], []);
    }

    case 'ask_phone': {
      const digitsOnly = userInput.replace(/[^\d]/g, '');
      if (digitsOnly.length === 0) {
        return mk(s, ['Моля, въведете валиден телефонен номер (само цифри).'], []);
      }
      s.contactPhone = digitsOnly;
      if (digitsOnly.length > 0 && digitsOnly.length < 10) {
        s.step = 'validate_phone';
        return mk(s, [`Въведеният номер е ${digitsOnly}. Сигурни ли сте, че е правилен?`], phoneValidationSuggestions());
      }
      // Persist contact info for future sessions
      saveContact(s.contactName, s.contactPhone);
      s.step = 'ask_city';
      return mk(s, ['Записано! В кой град се намира имотът?'], citySuggestions());
    }

    case 'validate_phone': {
      if (!userInput.includes('правилен') && !userInput.toLowerCase().includes('да')) {
        const digitsOnly = userInput.replace(/[^\d]/g, '');
        if (digitsOnly.length === 0) {
          return mk(s, ['Моля, въведете валиден телефонен номер (само цифри).'], []);
        }
        s.contactPhone = digitsOnly;
        if (digitsOnly.length > 0 && digitsOnly.length < 10) {
          return mk(s, [`Въведеният номер е ${digitsOnly}. Сигурни ли сте, че е правилен?`], phoneValidationSuggestions());
        }
      }
      // Persist contact info for future sessions
      saveContact(s.contactName, s.contactPhone);
      s.step = 'ask_city';
      return mk(s, ['Записано! В кой град се намира имотът?'], citySuggestions());
    }

    case 'ask_city': {
      if (!isSkip) s.city = userInput;
      s.step = 'ask_district';
      return mk(s, ['А в кой район или квартал?'], districtSuggestions(s.city));
    }

    case 'ask_district': {
      s.district = isSkip ? 'not disclosed' : userInput;
      s.step = 'ask_estate_type';
      return mk(s, ['Какъв тип е имотът?'], estateTypeSuggestions());
    }

    // ═══════ ESTATE TYPE ═════════════════════════════════
    case 'ask_estate_type': {
      if (userInput === 'Друг') {
        s.step = 'ask_estate_type_expanded';
        return mk(s, ['Изберете от следните типове:'], expandedEstateTypeSuggestions());
      }
      return handleEstateTypeSelection(s, userInput);
    }

    case 'ask_estate_type_expanded':
      return handleEstateTypeSelection(s, userInput);

    // ═══════ PARCEL: CADASTRAL ═══════════════════════════
    case 'ask_cadastral': {
      if (!isSkip) s.cadastralId = userInput;
      s.step = 'ask_area';
      return mk(s, ['Каква е площта в квадратни метра?'], []);
    }

    // ═══════ AREA ════════════════════════════════════════
    case 'ask_area': {
      if (!isSkip) {
        const num = parseFloat(userInput.replace(/[^\d.,]/g, '').replace(',', '.'));
        if (!isNaN(num) && num > 0) s.area = num;
      }
      if (s.area <= 0) {
        return mk(s, ['Площта е задължителна. Моля, въведете площта в квадратни метра.'], []);
      }
      return transitionAfterArea(s);
    }

    // ═══════ REGULATION (parcel) ═════════════════════════
    case 'ask_regulation': {
      if (!isSkip) s.regulation = userInput;
      s.step = 'ask_photos';
      const msg = s.isParcel
        ? 'Моля, прикачете снимки и скица на парцела чрез бутона долу вляво.'
        : 'Моля, прикачете снимки на имота чрез бутона долу вляво.';
      return mk(s, [msg], skipOnly());
    }

    // ═══════ FLOOR ═══════════════════════════════════════
    case 'ask_floor': {
      if (!isSkip) s.floor = userInput;
      if (s.dealType === 'estimation') {
        s.step = 'ask_last_floor';
        return mk(s, ['Имотът на последен етаж ли е?'], yesNoSuggestions());
      }
      s.step = 'ask_construction';
      return mk(s, ['Какъв е типът строителство?'], constructionSuggestions());
    }

    // ═══════ LAST FLOOR (estimation only) ════════════════
    case 'ask_last_floor': {
      s.isLastFloor = userInput.toLowerCase().includes('да');
      s.step = 'ask_construction';
      return mk(s, ['Какъв е типът строителство?'], constructionSuggestions());
    }

    // ═══════ CONSTRUCTION TYPE ═══════════════════════════
    case 'ask_construction': {
      if (!isSkip) s.constructionType = userInput;
      s.step = 'ask_photos';
      return mk(s, ['Моля, прикачете снимки на имота чрез бутона долу вляво.'], skipOnly());
    }

    // ═══════ PHOTOS ══════════════════════════════════════
    case 'ask_photos':
      // User typed "Пропусни" or other text at the photo step
      return transitionAfterPhotos(s);

    // ═══════ PRICE (sale / rent only) ════════════════════
    case 'ask_price': {
      if (!isSkip) s.price = userInput;
      s.step = 'ask_additional';
      return mk(s, ['Бихте ли искали да споделите допълнителна информация за имота?'], skipOnly());
    }

    // ═══════ ADDITIONAL INFO ═════════════════════════════
    case 'ask_additional': {
      if (!isSkip) s.additionalInfo = userInput;
      if (s.dealType === 'rent') {
        s.step = 'ask_pets';
        return mk(s, ['Допускате ли домашни любимци?'], withSkip([
          { label: 'Да', value: 'Да' },
          { label: 'Не', value: 'Не' },
          { label: 'Друго', value: 'ACTION_FOCUS' },
        ]));
      }
      s.step = 'ask_email';
      return mk(s, ['Бихте ли споделили имейл адрес?'], emailSuggestions());
    }

    // ═══════ PETS (rent only) ════════════════════════════
    case 'ask_pets': {
      if (!isSkip) s.pets = userInput;
      s.step = 'ask_email';
      return mk(s, ['Бихте ли споделили имейл адрес?'], emailSuggestions());
    }

    // ═══════ EMAIL ═══════════════════════════════════════
    case 'ask_email': {
      if (!isSkip && !userInput.toLowerCase().includes('нямам')) {
        if (!userInput.includes('@')) {
          return mk(s, ['Моля, въведете валиден имейл адрес (трябва да съдържа "@").'], emailSuggestions());
        }
        s.contactEmail = userInput;
      }
      // Persist contact info (update with email if provided)
      saveContact(s.contactName, s.contactPhone, s.contactEmail || undefined);

      if (s.dealType === 'estimation') {
        const estimate = generateEstimateMessages(s);
        if (!estimate.found) {
          // No data ➜ consultant redirect
          s.step = 'anything_else';
          return mkSubmit(s, [
            ...estimate.messages,
            'Мога ли да бъда полезен с нещо друго?',
          ], anythingElseSuggestions());
        }
        s.step = 'show_estimate';
        return mk(s, estimate.messages, [
          { label: 'Да', value: 'Да' },
          { label: 'Не, край на разговора', value: 'Не' },
        ]);
      }

      // Sale / rent ➜ confirmation
      s.step = 'confirm';
      return mk(s, [buildSummaryText(s)], confirmSuggestions());
    }

    // ═══════ ESTIMATION RESULT ═══════════════════════════
    case 'show_estimate': {
      const lower = userInput.toLowerCase();
      if (lower.includes('да') || lower.includes('искам') || lower.includes('заяв')) {
        s.step = 'anything_else';
        return mkSubmit(s, [
          'Наш експерт-оценител ще се свърже с вас за да уточните подробностите.',
          'Мога ли да бъда полезен с нещо друго?',
        ], anythingElseSuggestions());
      }
      s.step = 'anything_else';
      return mk(s, [], anythingElseSuggestions());
    }

    // ═══════ CONFIRMATION (sale / rent) ══════════════════
    case 'confirm': {
      if (userInput === 'Потвърждавам' || userInput.toLowerCase().includes('наред') || userInput.toLowerCase().includes('правилно') || userInput.toLowerCase().includes('да')) {
        s.step = 'anything_else';
        return mkSubmit(s, [
          'Благодаря! Заявката ви е изпратена успешно.',
          'Мога ли да бъда полезен с нещо друго?',
        ], anythingElseSuggestions());
      }
      // Correction / addition
      s.additionalInfo = s.additionalInfo
        ? s.additionalInfo + ' | ' + userInput
        : userInput;
      return mk(s, [buildSummaryText(s)], confirmSuggestions());
    }

    // ═══════ TERMINAL — anything else? ═══════════════════
    case 'anything_else':
      return mk(s, ['Мога ли да бъда полезен с нещо друго?'], anythingElseSuggestions());

    // ═══════ FALLBACK ════════════════════════════════════
    default:
      return mk(s, ['Съжалявам, нещо се обърка. Моля, започнете отново.'], [
        { label: 'Начало', value: 'ACTION_RESTART' },
      ]);
  }
}
