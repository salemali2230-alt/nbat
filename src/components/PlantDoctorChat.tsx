import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, AlertCircle, Mic, MicOff, Volume2 } from 'lucide-react';
import { PlantData } from '../types/plant';
import { getApiBaseUrl, getLiveWsUrl } from '../utils/apiConfig';

interface PlantDoctorChatProps {
  plant: PlantData;
}

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export const PlantDoctorChat: React.FC<PlantDoctorChatProps> = ({ plant }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'model',
      text: `مرحباً بك! أنا طبيب النباتات. يسعدني الإجابة عن أي استفسار أو مشكلة تواجهك مع نبتة "${plant.iraqiLocalName || plant.commonNameArabic}". يمكنك سؤالي عن أعراض معينة أو جدول الري والتسميد المناسب لمنطقتك.`
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live API Voice Session state
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [isLiveConnecting, setIsLiveConnecting] = useState(false);
  const liveWsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const nextPlayTimeRef = useRef<number>(0);

  const quickQuestions = [
    'كيف أحمي هذا النبات من شمس تموز الحارقة؟',
    'ما سبب اصفرار وتساقط الأوراق؟',
    'ما هو أفضل سماد متوفر في المشاتل العراقية؟',
    'كم مرة أسقيه في الصيف؟'
  ];

  // Helper to convert Float32Array to 16kHz PCM base64 for Live API
  const float32ToPcmBase64 = (float32Array: Float32Array): string => {
    const pcm16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    const bytes = new Uint8Array(pcm16.buffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  // Helper to play back 24kHz PCM chunk
  const playPcmChunk = (ctx: AudioContext, base64Data: string) => {
    try {
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768.0;
      }

      const buffer = ctx.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      const now = ctx.currentTime;
      const startTime = Math.max(now, nextPlayTimeRef.current);
      source.start(startTime);
      nextPlayTimeRef.current = startTime + buffer.duration;
    } catch (e) {
      console.error('Audio playback error:', e);
    }
  };

  const stopLiveSession = () => {
    if (liveWsRef.current) {
      liveWsRef.current.close();
      liveWsRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setIsLiveActive(false);
    setIsLiveConnecting(false);
  };

  const startLiveSession = async () => {
    if (isLiveActive) {
      stopLiveSession();
      return;
    }

    setIsLiveConnecting(true);
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const inputAudioCtx = new AudioContext({ sampleRate: 16000 });
      const outputAudioCtx = new AudioContext({ sampleRate: 24000 });
      audioContextRef.current = outputAudioCtx;

      const wsUrl = getLiveWsUrl();
      const ws = new WebSocket(wsUrl);
      liveWsRef.current = ws;

      ws.onopen = () => {
        setIsLiveConnecting(false);
        setIsLiveActive(true);

        // Send initial context to the live model
        ws.send(JSON.stringify({
          text: `أنا المزارع وأسألك عن نبتة "${plant.iraqiLocalName || plant.commonNameArabic}".`
        }));

        // Set up microphone audio capture
        const source = inputAudioCtx.createMediaStreamSource(stream);
        const processor = inputAudioCtx.createScriptProcessor(4096, 1, 1);
        source.connect(processor);
        processor.connect(inputAudioCtx.destination);

        processor.onaudioprocess = (e) => {
          if (ws.readyState === WebSocket.OPEN) {
            const channelData = e.inputBuffer.getChannelData(0);
            const base64Audio = float32ToPcmBase64(channelData);
            ws.send(JSON.stringify({ audio: base64Audio }));
          }
        };
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.audio && outputAudioCtx) {
            playPcmChunk(outputAudioCtx, data.audio);
          }
          if (data.interrupted) {
            nextPlayTimeRef.current = 0;
          }
        } catch (e) {
          console.error('Error processing live audio message:', e);
        }
      };

      ws.onerror = (err) => {
        console.error('Live WebSocket error:', err);
        setError('تعذر الاتصال بالمحادثة الصوتية المباشرة');
        stopLiveSession();
      };

      ws.onclose = () => {
        stopLiveSession();
      };
    } catch (err: any) {
      console.error('Failed to start Live Audio:', err);
      setError('يرجى السماح بالوصول إلى الميكروفون لبدء المحادثة الصوتية.');
      stopLiveSession();
    }
  };

  useEffect(() => {
    return () => {
      stopLiveSession();
    };
  }, []);

  const handleSend = async (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query || isLoading) return;

    setInput('');
    setError(null);
    const updatedMessages: ChatMessage[] = [
      ...messages,
      { role: 'user', text: query },
      { role: 'model', text: '' }
    ];
    setMessages(updatedMessages);
    setIsLoading(true);

    try {
      // Try streaming endpoint via SSE
      const baseUrl = getApiBaseUrl();
      const response = await fetch(`${baseUrl}/api/chat-plant/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plantContext: plant,
          message: query,
          chatHistory: messages.slice(-6)
        })
      });

      if (!response.ok || !response.body) {
        // Fallback to standard endpoint
        const fallbackRes = await fetch(`${baseUrl}/api/chat-plant`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plantContext: plant,
            message: query,
            chatHistory: messages.slice(-6)
          })
        });
        if (!fallbackRes.ok) throw new Error('فشل الرد من الخادم');
        const data = await fallbackRes.json();
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: 'model', text: data.reply || '' };
          return next;
        });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (dataStr === '[DONE]') break;
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.text) {
                accumulatedText += parsed.text;
                setMessages((prev) => {
                  const next = [...prev];
                  next[next.length - 1] = { role: 'model', text: accumulatedText };
                  return next;
                });
              } else if (parsed.error) {
                throw new Error(parsed.error);
              }
            } catch {}
          }
        }
      }
    } catch (err: any) {
      console.error('Chat error:', err);
      setError(err.message || 'تعذر الاتصال بخبير النباتات حالياً');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-stone-50 rounded-2xl border border-stone-200 p-4 sm:p-5 mt-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-stone-200 gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-sm">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <h4 className="font-bold text-stone-900 text-sm sm:text-base">استشارة طبيب وخبير النباتات</h4>
            <p className="text-xs text-stone-600">اسأل أي سؤال إضافي عن رعاية هذا النبات في العراق</p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          {/* Live Audio Voice consultation button */}
          <button
            type="button"
            onClick={startLiveSession}
            disabled={isLiveConnecting}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition active:scale-95 shadow-xs border ${
              isLiveActive
                ? 'bg-rose-600 text-white border-rose-700 animate-pulse'
                : 'bg-white hover:bg-emerald-50 text-emerald-800 border-emerald-300'
            }`}
            title="محادثة صوتية مباشرة مع طبيب النباتات"
          >
            {isLiveActive ? (
              <>
                <MicOff className="w-3.5 h-3.5" />
                <span>إنهاء المحادثة الصوتية</span>
              </>
            ) : (
              <>
                <Mic className="w-3.5 h-3.5 text-emerald-600" />
                <span>{isLiveConnecting ? 'جاري الاتصال...' : 'محادثة صوتية حية (Live)'}</span>
              </>
            )}
          </button>

          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 bg-emerald-100/80 px-2.5 py-1 rounded-full">
            <Sparkles className="w-3 h-3 text-emerald-600" />
            بث فوري
          </span>
        </div>
      </div>

      {isLiveActive && (
        <div className="mt-3 p-3 bg-emerald-900 text-white rounded-xl flex items-center justify-between text-xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-emerald-400 animate-pulse" />
            <span>جلسة صوتية مباشرة نشطة — تحدث الآن مع طبيب النباتات!</span>
          </div>
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
        </div>
      )}

      {/* Quick suggestions */}
      <div className="flex flex-wrap gap-1.5 my-3">
        {quickQuestions.map((q, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => handleSend(q)}
            disabled={isLoading}
            className="text-xs px-2.5 py-1 rounded-lg bg-white border border-stone-200 text-stone-700 hover:border-emerald-500 hover:text-emerald-700 hover:bg-emerald-50/50 transition active:scale-95 text-right disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Messages list */}
      <div className="space-y-3 max-h-72 overflow-y-auto p-2 bg-white rounded-xl border border-stone-200/80 shadow-inner">
        {messages.map((m, idx) => (
          <div
            key={idx}
            className={`flex gap-2.5 ${m.role === 'user' ? 'justify-start flex-row-reverse' : 'justify-start'}`}
          >
            <div
              className={`w-7 h-7 rounded-lg shrink-0 flex items-center justify-center text-xs ${
                m.role === 'user'
                  ? 'bg-stone-800 text-white'
                  : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
              }`}
            >
              {m.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>

            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-emerald-700 text-white rounded-tr-none shadow-sm'
                  : 'bg-stone-50 border border-stone-200/70 text-stone-800 rounded-tl-none whitespace-pre-line'
              }`}
            >
              {m.text || (isLoading && idx === messages.length - 1 ? (
                <span className="inline-flex items-center gap-1.5 text-stone-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  جاري كتابة الرد...
                </span>
              ) : '')}
            </div>
          </div>
        ))}

        {error && (
          <div className="flex items-center gap-2 text-rose-800 text-xs bg-rose-50 border border-rose-200 p-2.5 rounded-xl">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Input row */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="flex items-center gap-2 mt-3"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="اطرح سؤالك هنا (مثلاً: نباتي في أصيص صغير هل أنقله الآن؟)..."
          disabled={isLoading}
          className="flex-1 px-3.5 py-2.5 rounded-xl border border-stone-300 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 bg-white"
        />
        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          className="px-4 py-2.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white rounded-xl text-xs sm:text-sm font-semibold transition flex items-center gap-1.5 shrink-0 shadow-sm"
        >
          <span>إرسال</span>
          <Send className="w-3.5 h-3.5 rotate-180" />
        </button>
      </form>
    </div>
  );
};
