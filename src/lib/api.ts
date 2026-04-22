import type { LeadData } from '../types/chat';
// @ts-ignore – plain JS data module
import { pricingData, parcelPricingData } from '../../data/pricingData';


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
export function formatPrice(n: number): string {
  const rounded = Math.round(n / 100) * 100;
  return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Look up pricing data for a given district and construction type.
 * Returns { min, avg, max } per sqm in EUR, or null if not found.
 */
export function lookupPricing(district: string, constructionType?: string): { min: number; avg: number; max: number } | null {
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
export function lookupParcelPricing(neighborhood: string): { min: number; avg: number; max: number } | null {
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
  fd.append('offerType', leadData.dealType || 'null');
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

/**
 * Submit consultation data to the stoimoti.com contact-form API.
 * Simple JSON POST — fields: username, mobile, email, message.
 */
export async function submitConsultationAPI(leadData: LeadData) {
  const CONSULTATION_URL = 'https://www.stoimoti.com/api/contact-form';

  const body = {
    username: leadData.contactName || '',
    mobile: leadData.contactPhone || '',
    email: leadData.contactEmail && leadData.contactEmail !== 'not disclosed' ? leadData.contactEmail : '',
    message: leadData.description || 'Искам консултация',
  };

  const response = await fetch(CONSULTATION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Consultation API error: ${response.status} - ${errorText}`);
  }

  return await response.json();
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
