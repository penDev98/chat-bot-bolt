import { useState, useRef } from 'react';
import { Send, Mic, ImagePlus, X } from 'lucide-react';

interface ChatInputProps {
  onSend: (text: string) => void;
  onPhotoUpload: (files: File[]) => void;
  onVoiceToggle: () => void;
  voiceActive: boolean;
  voiceListening: boolean;
  disabled?: boolean;
  forceSelection?: boolean;
}

export default function ChatInput({
  onSend,
  onPhotoUpload,
  onVoiceToggle,
  voiceActive,
  voiceListening,
  disabled,
  forceSelection,
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
                className="w-16 h-16 object-cover rounded-xl border-2 border-white shadow-lg"
              />
              <button
                onClick={() => removeFile(i)}
                className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-red-600 transition-all border-2 border-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Listening indicator */}
      {voiceActive && voiceListening && (
        <div className="flex items-center gap-2 mb-3 px-1.5 animate-fade-in bg-red-50/50 w-fit rounded-full pr-4 py-0.5 border border-red-100/50">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
          <span className="text-xs text-red-600 font-bold tracking-wide uppercase">Слушам...</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="relative flex items-end gap-2 min-w-0">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/*"
          multiple
          className="hidden"
        />

        <div className="flex-1 relative group animate-fade-in-up min-w-0">
          {/* External Gradient Border / Glow */}
          <div className="absolute -inset-[1.5px] bg-gradient-to-r from-primary via-secondary to-accent rounded-2xl opacity-40 blur-[0.5px] group-focus-within:opacity-100 group-hover:opacity-70 transition-all duration-500 animate-border-glow" />
          
          {/* Main Input Container */}
          <div className="relative bg-white rounded-2xl flex items-center shadow-[0_12px_40px_-12px_rgba(42,48,117,0.22)] ring-1 ring-white/50 min-w-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              className="p-3 text-slate-400 hover:text-primary hover:bg-primary/5 rounded-l-2xl transition-all flex-shrink-0"
              title="Прикачи снимка"
            >
              <ImagePlus className="w-5 h-5" />
            </button>

            <input
              id="chat-input-field"
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={forceSelection ? "Моля, изберете опция..." : "Напишете съобщение..."}
              disabled={disabled}
              className="flex-1 bg-transparent py-3.5 text-slate-700 placeholder:text-slate-400 font-medium focus:outline-none text-[15px] min-w-0"
            />

            {/* Mic toggle */}
            <button
              type="button"
              onClick={onVoiceToggle}
              disabled={forceSelection}
              className={`p-2.5 mx-0.5 flex-shrink-0 rounded-xl transition-all duration-300 ${forceSelection
                  ? 'text-slate-300 cursor-not-allowed bg-slate-50'
                  : voiceActive
                    ? 'text-white bg-gradient-to-br from-red-500 to-pink-600 shadow-lg voice-pulse scale-105'
                    : 'text-slate-400 hover:text-primary hover:bg-slate-100'
                }`}
              title={voiceActive ? 'Изключи гласов режим' : 'Включи гласов режим'}
            >
              <Mic className={`w-5 h-5 transition-transform ${voiceActive ? 'animate-pulse' : ''}`} />
            </button>

            {/* Send button - Branded Gradient */}
            <button
              type="submit"
              disabled={disabled || (!text.trim() && previewFiles.length === 0)}
              className="p-2.5 mr-1.5 my-1.5 rounded-xl bg-gradient-to-br from-primary to-secondary text-white hover:shadow-xl hover:shadow-primary/30 hover:scale-105 active:scale-95 disabled:opacity-30 disabled:from-slate-300 disabled:to-slate-400 disabled:scale-100 transition-all shadow-lg flex-shrink-0 group/send"
            >
              <Send className={`w-5 h-5 transition-transform group-hover/send:translate-x-0.5 group-hover/send:-translate-y-0.5`} />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
