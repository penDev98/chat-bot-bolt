export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  photoUrls?: string[];
  suggestions?: QuickReply[];
}

export interface LeadData {
  dealType: 'sale' | 'rent' | 'estimation';
  estateType?: 'studio' | 'two_room' | 'three_room' | 'four_room' | 'multi_room' | 'maisonette' | 'atelier' | 'house_floor' | 'house' | 'store' | 'office' | 'restaurant' | 'garage' | 'warehouse' | 'industrial' | 'industrial_land' | 'parcel' | 'hotel' | 'other';
  city: string;
  district?: string;
  contactName: string;
  contactPhone: string;
  contactEmail?: string;
  description: string;
  photoRefs?: string[];
}

export interface ChatResponse {
  message: string;
  leadSubmitted: boolean;
  leadData?: LeadData;
  dbSuccess?: boolean;
  error?: string;
}

export interface QuickReply {
  label: string;
  value: string;
}
