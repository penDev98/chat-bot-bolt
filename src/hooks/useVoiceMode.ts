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

    // Synchronous flag — checked immediately in onresult, no React batching delay
    const speakingRef = useRef(false);

    // Debounce timer for finalizing user speech
    const speechDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event: SpeechRecognitionEvent) => {
            // GUARD: if agent is speaking, ignore the result
            if (speakingRef.current) return;

            // Build up the full transcript from all results
            let fullTranscript = '';
            for (let i = 0; i < event.results.length; i++) {
                fullTranscript += event.results[i][0].transcript;
            }
            fullTranscript = fullTranscript.trim();

            if (!fullTranscript) return;

            // Store current transcript but don't submit yet
            transcriptRef.current = fullTranscript;

            // Clear previous debounce timer
            if (speechDebounceRef.current) {
                clearTimeout(speechDebounceRef.current);
            }

            // Wait 1 second of silence before finalizing
            speechDebounceRef.current = setTimeout(() => {
                const text = transcriptRef.current;
                if (text) {
                    setPendingTranscript(text);
                    transcriptRef.current = '';
                    // Stop recognition after submitting — it will auto-restart
                    try { recognition.abort(); } catch { /* ignore */ }
                }
            }, 1000);
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
        speakingRef.current = false;
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
                speakingRef.current = false;
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

    // Bulgarian digits map
    const bgDigits: Record<string, string> = {
        '0': 'нула',
        '1': 'едно',
        '2': 'две',
        '3': 'три',
        '4': 'четири',
        '5': 'пет',
        '6': 'шест',
        '7': 'седем',
        '8': 'осем',
        '9': 'девет'
    };

    const formatTextForSpeech = (rawText: string): string => {
        // Regex logic:
        // Match numbers that are likely phone numbers or long digits
        // Look for 5 or more consecutive digits, possibly with spaces or dashes inside
        // Or numbers starting with '0' or '+359'
        return rawText.replace(/(?:\+359|0)(?:[\s-]*\d){5,}/g, (match) => {
            // Strip out everything except the literal digits
            const digitsOnly = match.replace(/\D/g, '');
            // Convert each digit to its Bulgarian word
            const spelledOut = digitsOnly.split('').map(d => bgDigits[d] || d).join(', ');
            return spelledOut;
        });
    };

    const speak = useCallback(
        async (rawText: string) => {
            if (!voiceActive) return;

            // Format text before speech synthesis
            const text = formatTextForSpeech(rawText);

            // Set the synchronous guard IMMEDIATELY — before anything else
            speakingRef.current = true;

            // Stop any currently playing audio
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
                audioRef.current = null;
            }
            if ('speechSynthesis' in window) {
                speechSynthesis.cancel();
            }

            // Stop the microphone to prevent echo
            if (recognitionRef.current) {
                try { recognitionRef.current.abort(); } catch { /* ignore */ }
                setIsListening(false);
            }

            try {
                setIsSpeaking(true);
                const audioBlob = await fetchTTSAudio(text);

                // Check if voice was turned off while fetching
                if (!speakingRef.current) {
                    setIsSpeaking(false);
                    return;
                }

                const audioUrl = URL.createObjectURL(audioBlob);
                const audio = new Audio(audioUrl);
                audioRef.current = audio;

                audio.onended = () => {
                    speakingRef.current = false;
                    setIsSpeaking(false);
                    URL.revokeObjectURL(audioUrl);
                    audioRef.current = null;
                };

                audio.onerror = () => {
                    speakingRef.current = false;
                    setIsSpeaking(false);
                    URL.revokeObjectURL(audioUrl);
                    audioRef.current = null;
                };

                await audio.play();
            } catch {
                speakingRef.current = false;
                setIsSpeaking(false);
                // Fallback to Web Speech API
                if ('speechSynthesis' in window) {
                    const utterance = new SpeechSynthesisUtterance(text);
                    utterance.lang = 'bg-BG';
                    utterance.rate = 1.15;
                    utterance.onend = () => {
                        speakingRef.current = false;
                        setIsSpeaking(false);
                    };
                    utterance.onerror = () => {
                        speakingRef.current = false;
                        setIsSpeaking(false);
                    };
                    speechSynthesis.speak(utterance);
                }
            }
        },
        [voiceActive]
    );

    // Continuous listening loop: auto-restart immediately after agent stops speaking
    useEffect(() => {
        if (voiceActive && !isSpeaking && !isListening && !speakingRef.current && recognitionRef.current) {
            const timer = setTimeout(() => {
                if (speakingRef.current) return;
                try {
                    recognitionRef.current?.start();
                    setIsListening(true);
                } catch {
                    // ignore
                }
            }, 100); // minimal delay — speakingRef guard handles echo
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
