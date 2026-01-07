
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { runAgentChat, agentTools } from '../services/geminiService';

interface Message {
  role: 'user' | 'agent';
  text: string;
  type?: 'text' | 'action';
}

// Audio Utilities as per instructions
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export const TruckCeoAgent: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    { role: 'agent', text: "Welcome back, Mateo. I'm your TruckCEO Command AI. How can I assist with your routes or team today?" }
  ]);
  const [isTyping, setIsTyping] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping, isLiveMode]);

  const handleSendText = async () => {
    if (!input.trim()) return;
    const userMsg = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsTyping(true);

    const response = await runAgentChat(userMsg, []);
    setIsTyping(false);
    
    if (response.functionCalls) {
      for (const fc of response.functionCalls) {
        setMessages(prev => [...prev, { 
          role: 'agent', 
          text: `SYSTEM: Executing ${fc.name.replace(/_/g, ' ')}...`, 
          type: 'action' 
        }]);
      }
    }
    setMessages(prev => [...prev, { role: 'agent', text: response.text }]);
  };

  const startLiveSession = async () => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = outputCtx;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const l = inputData.length;
              const int16 = new Int16Array(l);
              for (let i = 0; i < l; i++) int16[i] = inputData[i] * 32768;
              const pcmBlob = {
                data: encode(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };
              sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
            setIsLiveMode(true);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              const ctx = audioContextRef.current!;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(ctx.destination);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
              source.onended = () => sourcesRef.current.delete(source);
            }

            // Handle Transcriptions
            if (message.serverContent?.outputTranscription) {
              const txt = message.serverContent.outputTranscription.text;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'agent' && last?.type !== 'action') {
                   return [...prev.slice(0, -1), { ...last, text: last.text + txt }];
                }
                return [...prev, { role: 'agent', text: txt }];
              });
            }
            if (message.serverContent?.inputTranscription) {
               const txt = message.serverContent.inputTranscription.text;
               setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'user') {
                   return [...prev.slice(0, -1), { ...last, text: last.text + txt }];
                }
                return [...prev, { role: 'user', text: txt }];
              });
            }

            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onclose: () => setIsLiveMode(false),
          onerror: () => setIsLiveMode(false),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
          systemInstruction: 'You are the TruckCEO AI. You help manage the Mateo bread route business. Provide sharp, quick business updates via voice.',
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          tools: [{ functionDeclarations: agentTools }]
        },
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error("Live API Error:", err);
      setIsLiveMode(false);
    }
  };

  const stopLiveSession = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    setIsLiveMode(false);
  };

  return (
    <>
      <button 
        onClick={() => setIsOpen(!isOpen)}
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
                <i className={`fas ${isLiveMode ? 'fa-volume-high animate-pulse' : 'fa-microchip'} text-black text-xl`}></i>
              </div>
              <div>
                <h3 className="text-white font-black text-[11px] uppercase tracking-[0.2em]">Mateo Intel Agent</h3>
                <div className="flex items-center gap-2 mt-1">
                  <div className={`w-2 h-2 rounded-full ${isLiveMode ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`}></div>
                  <span className="text-[9px] text-gray-500 font-black uppercase tracking-widest">{isLiveMode ? 'Live Audio Active' : 'System Ready'}</span>
                </div>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-gray-500 hover:text-white transition-colors">
              <i className="fas fa-chevron-down"></i>
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4 no-scrollbar bg-white">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-4 rounded-[1.8rem] text-[13px] ${
                  msg.role === 'user' 
                    ? 'bg-black text-[#FFD700] rounded-br-md font-black' 
                    : msg.type === 'action'
                    ? 'bg-[#FFD700]/10 border border-[#FFD700]/20 text-black text-[10px] font-black italic rounded-bl-md uppercase'
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
            {isLiveMode ? (
              <div className="flex flex-col items-center gap-4 py-2">
                <div className="flex gap-1 items-center h-8">
                  {[...Array(8)].map((_, i) => (
                    <div key={i} className="w-1.5 bg-[#FFD700] rounded-full animate-[bounce_1s_infinite]" style={{ animationDelay: `${i * 0.1}s`, height: `${Math.random() * 100}%` }}></div>
                  ))}
                </div>
                <button 
                  onClick={stopLiveSession}
                  className="w-full py-4 bg-red-500 text-white rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] shadow-xl shadow-red-500/20 active:scale-95 transition-all"
                >
                  <i className="fas fa-microphone-slash mr-2"></i> End Voice Mode
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 bg-gray-50 p-2 rounded-[2.5rem] border border-gray-100 focus-within:border-black transition-all">
                  <input 
                    type="text" 
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
                    placeholder="Ask about orders, team, or fleet..."
                    className="flex-1 bg-transparent border-none outline-none px-5 py-3 text-sm font-bold text-black placeholder:text-gray-300"
                  />
                  <button 
                    onClick={handleSendText}
                    disabled={!input.trim()}
                    className="w-12 h-12 bg-black text-[#FFD700] rounded-full flex items-center justify-center shadow-lg active:scale-90 disabled:opacity-20 transition-all"
                  >
                    <i className="fas fa-paper-plane text-sm"></i>
                  </button>
                </div>
                <button 
                  onClick={startLiveSession}
                  className="w-full py-4 bg-[#FFD700] text-black rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] shadow-xl shadow-[#FFD700]/20 active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  <i className="fas fa-microphone"></i> Start Voice Interaction
                </button>
              </div>
            )}
            <p className="text-[8px] text-center text-gray-300 font-black uppercase tracking-widest mt-4">
              "Update Yonkers Bun Count" • "Is Adrian active?" • "Fleet status report"
            </p>
          </div>
        </div>
      )}
    </>
  );
};
