import { useState, useRef, useCallback, useEffect } from 'react';
import { fetchTTSAudio } from '../lib/api';

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

export function useVoiceMode() {
  const [voiceActive, setVoiceActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [pendingTranscript, setPendingTranscript] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptRef = useRef('');

  const supported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  // Initialize speech recognition
  useEffect(() => {
    if (!supported) return;

    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'bg-BG';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const last = event.results[event.results.length - 1];
      if (last.isFinal) {
        const text = last[0].transcript.trim();
        if (text) {
          transcriptRef.current = text;
          setPendingTranscript(text);
        }
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.abort();
    };
  }, [supported]);

  // Stop any currently playing audio immediately
  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setIsSpeaking(false);
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
    }
  }, []);

  // When user starts speaking (interruption), stop the agent immediately
  useEffect(() => {
    if (isListening && isSpeaking) {
      stopSpeaking();
    }
  }, [isListening, isSpeaking, stopSpeaking]);

  const toggleVoice = useCallback(() => {
    setVoiceActive((prev) => {
      if (prev) {
        // Turning OFF: stop everything immediately
        recognitionRef.current?.abort();
        setIsListening(false);
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
          audioRef.current = null;
        }
        setIsSpeaking(false);
        if ('speechSynthesis' in window) {
          speechSynthesis.cancel();
        }
      }
      return !prev;
    });
  }, []);

  const consumeTranscript = useCallback(() => {
    setPendingTranscript(null);
    transcriptRef.current = '';
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!voiceActive) return;

      try {
        setIsSpeaking(true);
        const audioBlob = await fetchTTSAudio(text);

        // Check if voice was turned off while fetching
        if (!audioRef.current && !voiceActive) {
          setIsSpeaking(false);
          return;
        }

        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audioRef.current = audio;

        audio.onended = () => {
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
          audioRef.current = null;
        };

        audio.onerror = () => {
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
          audioRef.current = null;
        };

        await audio.play();
      } catch {
        setIsSpeaking(false);
        // Fallback to Web Speech API
        if ('speechSynthesis' in window) {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = 'bg-BG';
          utterance.rate = 1.15;
          utterance.onend = () => setIsSpeaking(false);
          utterance.onerror = () => setIsSpeaking(false);
          speechSynthesis.speak(utterance);
        }
      }
    },
    [voiceActive]
  );

  // Continuous listening loop: auto-restart after speaking finishes
  useEffect(() => {
    if (voiceActive && !isSpeaking && !isListening && recognitionRef.current) {
      const timer = setTimeout(() => {
        try {
          recognitionRef.current?.start();
          setIsListening(true);
        } catch {
          // ignore
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [voiceActive, isSpeaking, isListening]);

  return {
    voiceActive,
    isListening,
    isSpeaking,
    pendingTranscript,
    supported,
    toggleVoice,
    consumeTranscript,
    speak,
    stopSpeaking,
  };
}
