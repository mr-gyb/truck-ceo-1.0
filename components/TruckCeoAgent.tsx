import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  sendAssistantMessage,
  loadLatestThread,
  ThreadMessage,
} from '../services/assistantService';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';

interface Message {
  role: 'user' | 'agent';
  text: string;
  type?: 'text' | 'action' | 'escalation';
}

// Web Speech API (voice INPUT only — transcript is sent as a normal message).
// Chrome/Edge expose it as webkitSpeechRecognition; Firefox/Safari may not.
type SpeechRecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  const w = window as any;
  return (w.SpeechRecognition || w.webkitSpeechRecognition || null) as SpeechRecognitionCtor | null;
}

// --- Audio output (TTS) helpers -------------------------------------------
// Browser speechSynthesis only; no keys, no deps.

// Strip markdown/formatting so the voice speaks clean plain text.
function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [label](url) -> label
    .replace(/[*_~`#>|]/g, '') // bold/ital/code/headers/quotes
    .replace(/^\s*(?:[-•*]|\d+[.)])\s+/gm, '') // list markers at line starts
    .replace(/\s*\n\s*/g, '. ') // line breaks become pauses
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Keep speech reasonable: cap at ~900 chars, cut at a sentence boundary.
function truncateForSpeech(text: string, max = 900): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf('. ', max);
  return (cut > max * 0.4 ? text.slice(0, cut + 1) : text.slice(0, max)).trim();
}

const SPANISH_WORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'en', 'con', 'por', 'para',
  'gracias', 'favor', 'está', 'estan', 'están', 'hola', 'aquí', 'aqui', 'qué',
  'cómo', 'estás', 'bien', 'ruta', 'rutas', 'conductor', 'camión', 'camion',
  'tienda', 'tiendas', 'ventas', 'semana', 'hoy', 'mañana', 'manana', 'ayer',
  'puedo', 'tiene', 'tienen', 'hay', 'muy', 'más', 'pero', 'cuando', 'donde',
  'porque', 'usted', 'ustedes', 'nosotros', 'también', 'tambien', 'hasta',
  'sobre', 'entre', 'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'mi', 'mis',
  'tu', 'tus', 'su', 'sus', 'buenos', 'buenas', 'días', 'dias', 'noches',
  'tardes', 'adiós', 'adios', 'saludos', 'atentamente',
]);

// Detect the reply language: Spanish markers (accents/¿¡ or 2+ Spanish words)
// -> 'es-US', otherwise 'en-US'.
function detectReplyLang(text: string): 'es-US' | 'en-US' {
  const t = text.toLowerCase();
  if (/[áéíóúñü¿¡]/.test(t)) return 'es-US';
  const words = t.match(/[a-záéíóúñü]+/g) ?? [];
  let hits = 0;
  for (const w of words) {
    if (SPANISH_WORDS.has(w) && ++hits >= 2) return 'es-US';
  }
  return 'en-US';
}

export interface TruckCeoAgentProps {
  /**
   * Setup mode: the owner signed in with incomplete setup. The panel
   * auto-opens (via autoOpenKey) and the assistant runs the guided onboarding
   * interview. Every message is sent with the setupMode flag so the backend
   * uses the setup system prompt.
   */
  setupMode?: boolean;
  /** Increment to auto-open the panel (used for setup-mode sign-in). */
  autoOpenKey?: number;
  /** Fired when the user closes the panel while setupMode is active. */
  onSetupDismiss?: () => void;
  /** Fired when the assistant completes onboarding via the complete_onboarding tool. */
  onSetupComplete?: () => void;
}

export const TruckCeoAgent: React.FC<TruckCeoAgentProps> = ({
  setupMode = false,
  autoOpenKey = 0,
  onSetupDismiss,
  onSetupComplete,
}) => {
  const { userProfile } = useAuth();
  const { refetchAll } = useData();
  const role = userProfile?.role;
  const businessId = userProfile?.businessId;

  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>(() => [
    setupMode
      ? { role: 'agent', text: "Getting your setup interview ready — one moment…" }
      : { role: 'agent', text: "Welcome back, Mateo. I'm your TruckCEO Command AI. How can I assist with your routes or team today?" }
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const voiceSupported = getSpeechRecognition() !== null;

  // Audio output (TTS) via speechSynthesis + bilingual voice state.
  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [speakerOn, setSpeakerOnState] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem('truckceo-agent-speaker');
      return v === null ? true : v === '1'; // default ON
    } catch {
      return true;
    }
  });
  const [lang, setLangState] = useState<'en-US' | 'es-US'>(() => {
    try {
      return localStorage.getItem('truckceo-agent-lang') === 'es-US' ? 'es-US' : 'en-US';
    } catch {
      return 'en-US';
    }
  });
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const hasInteractedRef = useRef(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<InstanceType<SpeechRecognitionCtor> | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const mapThreadMessages = useCallback((threadMessages: ThreadMessage[]): Message[] => {
    const out: Message[] = [];
    for (const m of threadMessages) {
      if (m.role === 'user') {
        out.push({ role: 'user', text: m.text });
      } else {
        for (const tc of m.toolCalls ?? []) {
          out.push({ role: 'agent', text: tc.result, type: 'action' });
        }
        if (m.escalated) {
          out.push({
            role: 'agent',
            text: 'Handed to GYBs — the reply will land here.',
            type: 'escalation',
          });
        }
        if (m.text) out.push({ role: 'agent', text: m.text });
      }
    }
    return out;
  }, []);

  const refreshThread = useCallback(async () => {
    if (!businessId) return;
    try {
      const latest = await loadLatestThread(businessId);
      if (latest) {
        setThreadId(latest.threadId);
        const mapped = mapThreadMessages(latest.messages);
        if (mapped.length > 0) setMessages(mapped);
      }
    } catch (err) {
      console.error('Failed to load assistant thread:', err);
    } finally {
      setHistoryLoaded(true);
    }
  }, [businessId, mapThreadMessages]);

  // Load thread history the first time the widget opens (per business).
  useEffect(() => {
    if (isOpen && !historyLoaded) {
      void refreshThread();
    }
  }, [isOpen, historyLoaded, refreshThread]);

  // Reset history when the signed-in business changes.
  useEffect(() => {
    setHistoryLoaded(false);
    setThreadId(undefined);
  }, [businessId]);

  // Setup mode: auto-open the panel once when App bumps autoOpenKey.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenKey > 0 && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setIsOpen(true);
    }
  }, [autoOpenKey]);

  // Setup mode: once the panel is open, send a silent trigger so the
  // assistant greets the owner and starts the interview. The trigger text
  // never appears in the chat UI (backend maps it to a clean instruction).
  const setupGreetedRef = useRef(false);
  useEffect(() => {
    if (setupMode && isOpen && !setupGreetedRef.current) {
      setupGreetedRef.current = true;
      void handleSendText('__setup_start__', { silent: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupMode, isOpen]);

  // Autoplay policy: speechSynthesis needs a prior user gesture on the page.
  useEffect(() => {
    const mark = () => {
      hasInteractedRef.current = true;
    };
    window.addEventListener('pointerdown', mark);
    window.addEventListener('keydown', mark);
    return () => {
      window.removeEventListener('pointerdown', mark);
      window.removeEventListener('keydown', mark);
    };
  }, []);

  // Voices load asynchronously — refresh when the browser announces them.
  useEffect(() => {
    if (!speechSupported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [speechSupported]);

  const stopSpeaking = useCallback(() => {
    if (speechSupported) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* noop */
      }
    }
    setIsSpeaking(false);
  }, [speechSupported]);

  const closePanel = useCallback(() => {
    stopSpeaking();
    setIsOpen(false);
    // Closing during the setup interview dismisses setup for this session —
    // App stops auto-opening and the banner/wizard stay as the fallback path.
    if (setupMode) onSetupDismiss?.();
  }, [stopSpeaking, setupMode, onSetupDismiss]);

  // Pick a voice matching the detected reply language, falling back to the
  // user's language toggle, then the browser default.
  const pickVoice = useCallback(
    (detectedLang: 'es-US' | 'en-US'): SpeechSynthesisVoice | null => {
      for (const l of [detectedLang, lang]) {
        const prefix = l.split('-')[0].toLowerCase();
        const v = voices.find(v => (v.lang || '').toLowerCase().startsWith(prefix));
        if (v) return v;
      }
      return voices.find(v => v.default) ?? voices[0] ?? null;
    },
    [voices, lang]
  );

  const speak = useCallback(
    (rawText: string) => {
      if (!speakerOn || !speechSupported || !hasInteractedRef.current) return;
      const clean = truncateForSpeech(stripMarkdown(rawText));
      if (!clean) return;
      const synth = window.speechSynthesis;
      try {
        synth.cancel(); // never queue — latest reply wins
      } catch {
        /* noop */
      }
      const detected = detectReplyLang(rawText);
      const utter = new SpeechSynthesisUtterance(clean);
      utter.lang = detected;
      const voice = pickVoice(detected);
      if (voice) utter.voice = voice;
      utter.rate = 1;
      utter.pitch = 1;
      utter.onstart = () => setIsSpeaking(true);
      const done = () => setIsSpeaking(false);
      utter.onend = done;
      utter.onerror = done;
      try {
        synth.speak(utter);
      } catch {
        setIsSpeaking(false);
      }
    },
    [speakerOn, speechSupported, pickVoice]
  );

  const toggleSpeaker = () => {
    stopSpeaking(); // tapping while speaking stops it; turning off stops too
    setSpeakerOnState(prev => {
      const next = !prev;
      try {
        localStorage.setItem('truckceo-agent-speaker', next ? '1' : '0');
      } catch {
        /* noop */
      }
      return next;
    });
  };

  // ES/EN toggle: drives both voice-input recognition lang and TTS preference.
  const setLang = (l: 'en-US' | 'es-US') => {
    setLangState(l);
    try {
      localStorage.setItem('truckceo-agent-lang', l);
    } catch {
      /* noop */
    }
  };

  const handleSendText = async (overrideText?: string, opts?: { silent?: boolean }) => {
    const userMsg = (overrideText ?? input).trim();
    if (!userMsg || isTyping) return;
    setInput('');
    stopSpeaking(); // a new message silences any in-flight reply
    if (!opts?.silent) {
      setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    }
    setIsTyping(true);

    try {
      const response = await sendAssistantMessage(userMsg, threadId, { setupMode });

      const next: Message[] = [];
      for (const tc of response.toolCalls) {
        next.push({ role: 'agent', text: tc.result, type: 'action' });
      }
      if (response.escalated) {
        next.push({
          role: 'agent',
          text: 'Handed to GYBs — the reply will land here.',
          type: 'escalation',
        });
      }
      if (response.text) {
        next.push({ role: 'agent', text: response.text });
      }
      setMessages(prev => [...prev, ...next]);

      setThreadId(response.threadId || threadId);

      // Setup interview finished — the backend ran complete_onboarding.
      if (
        setupMode &&
        response.toolCalls.some(tc => tc.name === 'complete_onboarding')
      ) {
        onSetupComplete?.();
      }

      // If the assistant wrote data (routes, trucks, team, business profile,
      // alerts, EOD notes...), refresh the app's data so every list shows it
      // immediately instead of waiting for the next sign-in.
      const WRITE_TOOLS = new Set([
        'update_business_profile', 'create_route', 'create_truck',
        'add_team_member', 'request_data_feed_connection',
        'create_alert', 'update_employee_status', 'log_eod_note',
      ]);
      if (response.toolCalls.some(tc => WRITE_TOOLS.has(tc.name) && tc.ok !== false)) {
        try { await refetchAll(); } catch { /* non-fatal */ }
      }

      // Speak the reply aloud (respects speaker toggle + autoplay policy).
      const speakable = response.text
        ? response.text
        : response.escalated
        ? 'Handed to GYBs — the reply will land here.'
        : '';
      if (speakable) speak(speakable);

      // Re-sync with the server-written thread so confirmations and any
      // backend-added messages stay consistent.
      await refreshThread();
    } catch (err) {
      console.error('Assistant error:', err);
      const fallback = "I couldn't reach the assistant. Check your connection and try again.";
      setMessages(prev => [
        ...prev,
        { role: 'agent', text: fallback },
      ]);
      speak(fallback);
    } finally {
      setIsTyping(false);
    }
  };

  const toggleVoiceInput = () => {
    const SR = getSpeechRecognition();
    if (!SR) return;

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const recognition = new SR();
    recognition.lang = lang; // follows the ES/EN toggle
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onresult = (event: any) => {
      const transcript: string =
        event.results?.[0]?.[0]?.transcript ?? '';
      if (transcript.trim()) {
        void handleSendText(transcript.trim());
      }
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    try {
      recognition.start();
      setIsListening(true);
    } catch {
      setIsListening(false);
    }
  };

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* noop */
      }
      stopSpeaking(); // cancel any in-flight speech on unmount
    };
  }, [stopSpeaking]);

  const placeholder =
    role === 'team_member'
      ? 'Ask about your route, score, or log a note…'
      : 'Ask about routes, team, or fleet…';

  const hintText =
    role === 'team_member'
      ? '"My stale rate this week" • "Log a bakery short" • "My driver score"'
      : '"Update Yonkers Bun Count" • "Is Adrian active?" • "Fleet status report"';

  return (
    <>
      <button
        onClick={() => {
          if (isOpen) closePanel();
          else setIsOpen(true);
        }}
        className="absolute bottom-24 right-6 w-16 h-16 bg-[#FFD700] text-black rounded-full shadow-[0_10px_30px_rgba(255,215,0,0.3)] flex items-center justify-center z-[100] transition-all hover:scale-110 active:scale-95 group border-4 border-black/5"
      >
        <i className={`fas ${isOpen ? 'fa-times' : 'fa-robot'} text-2xl group-hover:rotate-12 transition-transform`}></i>
        {!isOpen && (
          <span className="absolute -top-1 -right-1 bg-black text-[#FFD700] text-[9px] font-black px-2.5 py-1 rounded-full animate-bounce shadow-lg">MATEO AI</span>
        )}
      </button>

      {isOpen && (
        <div className="absolute inset-x-4 bottom-28 top-20 bg-white rounded-[3rem] shadow-[0_40px_120px_rgba(0,0,0,0.3)] border border-gray-100 z-[90] flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-12 duration-500 ease-out">
          <div className="bg-black p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-[#FFD700] rounded-2xl flex items-center justify-center shadow-lg">
                <i className="fas fa-microchip text-black text-xl"></i>
              </div>
              <div>
                <h3 className="text-white font-black text-[11px] uppercase tracking-[0.2em]">Mateo Intel Agent</h3>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-2 h-2 rounded-full bg-gray-600"></div>
                  <span className="text-[9px] text-gray-500 font-black uppercase tracking-widest">System Ready</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {speechSupported && (
                <button
                  onClick={toggleSpeaker}
                  aria-label={speakerOn ? 'Mute assistant voice' : 'Unmute assistant voice'}
                  className={`w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-90 ${
                    speakerOn ? 'bg-[#FFD700] text-black' : 'bg-gray-800 text-gray-500'
                  }`}
                >
                  <i className={`fas ${speakerOn ? 'fa-volume-up' : 'fa-volume-mute'} text-sm ${isSpeaking ? 'animate-pulse' : ''}`}></i>
                </button>
              )}
              <button onClick={closePanel} className="text-gray-500 hover:text-white transition-colors">
                <i className="fas fa-chevron-down"></i>
              </button>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4 no-scrollbar bg-white">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-4 rounded-[1.8rem] text-[13px] ${
                  msg.role === 'user'
                    ? 'bg-black text-[#FFD700] rounded-br-md font-black'
                    : msg.type === 'action'
                    ? 'bg-[#FFD700]/10 border border-[#FFD700]/20 text-black text-[10px] font-black italic rounded-bl-md uppercase'
                    : msg.type === 'escalation'
                    ? 'bg-black text-[#FFD700] border-2 border-[#FFD700] rounded-bl-md font-black text-[11px] uppercase tracking-widest'
                    : 'bg-gray-50 text-gray-800 rounded-bl-md font-bold'
                }`}>
                  {msg.text}
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-gray-50 p-4 rounded-[1.8rem] rounded-bl-md flex gap-1.5 items-center">
                  <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce"></div>
                  <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce delay-150"></div>
                  <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce delay-300"></div>
                </div>
              </div>
            )}
          </div>

          <div className="p-6 border-t border-gray-50 bg-white">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 bg-gray-50 p-2 rounded-[2.5rem] border border-gray-100 focus-within:border-black transition-all">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
                  placeholder={placeholder}
                  className="flex-1 bg-transparent border-none outline-none px-5 py-3 text-sm font-bold text-black placeholder:text-gray-300"
                />
                <button
                  onClick={() => handleSendText()}
                  disabled={!input.trim()}
                  className="w-12 h-12 bg-black text-[#FFD700] rounded-full flex items-center justify-center shadow-lg active:scale-90 disabled:opacity-20 transition-all"
                >
                  <i className="fas fa-paper-plane text-sm"></i>
                </button>
              </div>
              {voiceSupported ? (
                <div className="flex items-center gap-2">
                  <div className="flex bg-gray-100 rounded-full p-1 border border-gray-200 shrink-0" role="group" aria-label="Voice language">
                    {(['en-US', 'es-US'] as const).map(l => (
                      <button
                        key={l}
                        onClick={() => setLang(l)}
                        className={`px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 ${
                          lang === l ? 'bg-black text-[#FFD700] shadow' : 'text-gray-400'
                        }`}
                      >
                        {l === 'en-US' ? 'EN' : 'ES'}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={toggleVoiceInput}
                    className={`flex-1 py-4 rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2 ${
                    isListening
                      ? 'bg-red-500 text-white shadow-red-500/20'
                      : 'bg-[#FFD700] text-black shadow-[#FFD700]/20'
                  }`}
                >
                  <i className={`fas ${isListening ? 'fa-stop' : 'fa-microphone'}`}></i>
                  {isListening ? 'Listening… tap to stop' : 'Voice input — tap & speak'}
                  </button>
                </div>
              ) : (
                <p className="text-[9px] text-center text-gray-400 font-bold uppercase tracking-widest">
                  Voice input not supported in this browser
                </p>
              )}
            </div>
            <p className="text-[8px] text-center text-gray-300 font-black uppercase tracking-widest mt-4">
              {hintText}
            </p>
          </div>
        </div>
      )}
    </>
  );
};
