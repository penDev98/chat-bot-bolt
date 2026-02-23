import { useState, useRef } from 'react';
import { Send, Mic, MicOff, ImagePlus, X } from 'lucide-react';

interface ChatInputProps {
  onSend: (text: string) => void;
  onPhotoUpload: (files: File[]) => void;
  onVoiceToggle: () => void;
  voiceActive: boolean;
  voiceListening: boolean;
  disabled?: boolean;
}

export default function ChatInput({
  onSend,
  onPhotoUpload,
  onVoiceToggle,
  voiceActive,
  voiceListening,
  disabled,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const [previewFiles, setPreviewFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;

    if (previewFiles.length > 0) {
      onPhotoUpload(previewFiles);
      setPreviewFiles([]);
    }

    if (text.trim()) {
      onSend(text.trim());
      setText('');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setPreviewFiles((prev) => [...prev, ...files]);
    e.target.value = '';
  };

  const removeFile = (index: number) => {
    setPreviewFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="w-full">
      {/* Photo preview strip */}
      {previewFiles.length > 0 && (
        <div className="flex gap-2 mb-3 overflow-x-auto py-1">
          {previewFiles.map((file, i) => (
            <div key={i} className="relative flex-shrink-0 group">
              <img
                src={URL.createObjectURL(file)}
                alt={file.name}
                className="w-16 h-16 object-cover rounded-xl border border-slate-200 shadow-sm"
              />
              <button
                onClick={() => removeFile(i)}
                className="absolute -top-2 -right-2 w-6 h-6 bg-white text-red-500 rounded-full flex items-center justify-center shadow-md border border-slate-100 hover:bg-red-50 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Listening indicator */}
      {voiceActive && voiceListening && (
        <div className="flex items-center gap-2 mb-2 px-1 animate-fade-in">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
          <span className="text-xs text-red-500 font-medium">Слушам...</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="relative flex items-end gap-2">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/*"
          multiple
          className="hidden"
        />

        <div className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl flex items-center focus-within:ring-4 focus-within:ring-primary/40 focus-within:border-primary/50 focus-within:bg-primary/5 transition-all duration-300 shadow-sm">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="p-3 text-slate-400 hover:text-primary transition-colors flex-shrink-0"
            title="Прикачи снимка"
          >
            <ImagePlus className="w-5 h-5" />
          </button>

          <input
            id="chat-input-field"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Напишете съобщение..."
            disabled={disabled}
            className="flex-1 bg-transparent py-3 text-slate-700 placeholder:text-slate-400 focus:outline-none text-[15px] min-w-0"
          />

          {/* Mic toggle — left of send */}
          <button
            type="button"
            onClick={onVoiceToggle}
            className={`p-2.5 flex-shrink-0 rounded-xl transition-all ${voiceActive
              ? 'text-white bg-gradient-to-br from-red-500 to-pink-600 shadow-sm voice-pulse'
              : 'text-slate-400 hover:text-primary hover:bg-slate-100'
              }`}
            title={voiceActive ? 'Изключи гласов режим' : 'Включи гласов режим'}
          >
            {voiceActive ? (
              <MicOff className="w-5 h-5" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
          </button>

          {/* Send button */}
          <button
            type="submit"
            disabled={disabled || (!text.trim() && previewFiles.length === 0)}
            className="p-2 mr-1 my-1 rounded-xl bg-primary text-white hover:bg-primary/90 disabled:opacity-40 disabled:bg-slate-300 transition-all shadow-sm flex-shrink-0"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </form>
    </div>
  );
}
