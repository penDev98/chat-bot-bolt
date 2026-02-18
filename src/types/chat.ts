export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  photoUrls?: string[];
  suggestions?: QuickReply[];
}

export interface LeadData {
  offerType: 'sale' | 'rent';
  city: string;
  district: string;
  contactName: string;
  phone: string;
  email: string;
  description: string;
  photoRefs: string[];
}

export interface ChatResponse {
  message: string;
  leadSubmitted: boolean;
  leadData?: LeadData;
  airtableSuccess?: boolean;
  error?: string;
}

export interface QuickReply {
  label: string;
  value: string;
}
