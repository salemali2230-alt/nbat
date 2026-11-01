import express from 'express';
import type { Request, Response } from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { GoogleGenAI, Type, Modality } from '@google/genai';
import type { LiveServerMessage } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// Cloud Run nginx proxies to DEFAULT_APP_PORT (3000). Never use PORT directly as PORT=8080 belongs to nginx.
const PORT = Number(process.env.DEFAULT_APP_PORT) || 3000;

// Body parser with support for base64 plant image uploads
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));

// CORS middleware for static deployments (e.g. GitHub Pages)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Server-side Google GenAI initialization with required User-Agent header for telemetry
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Plant Analysis Schema
const plantSchema = {
  type: Type.OBJECT,
  properties: {
    isPlant: {
      type: Type.BOOLEAN,
      description: "True if the image contains a plant, leaf, flower, tree, fruit, or botanical element.",
    },
    commonNameArabic: {
      type: Type.STRING,
      description: "Standard Arabic name of the plant (e.g. الياسمين الهندي، الكاردينيا، السدر).",
    },
    iraqiLocalName: {
      type: Type.STRING,
      description: "Common colloquial Iraqi name if known (e.g. رازقي عراقي، نبق / سدر، ورد جوري عراقي، ياس، عين البزون، نازناز، ديدونيا، قلمطوز، نخلة برحي/زهدي). If not specific to Iraq, mention the nursery name in Iraq or state: لا يوجد اسم محلي خاص - معروف باسمه العربي.",
    },
    iraqiNameExplanation: {
      type: Type.STRING,
      description: "Brief background or story of why it is called this in Iraq or its popularity in Iraqi gardens and courtyards (الشناشيل والحدائق العراقية).",
    },
    scientificName: {
      type: Type.STRING,
      description: "Botanical Latin scientific name (e.g. Jasminum sambac, Ziziphus spina-christi).",
    },
    family: {
      type: Type.STRING,
      description: "Plant botanical family in Arabic and Latin (e.g. الزيتونية - Oleaceae).",
    },
    category: {
      type: Type.STRING,
      description: "Category: نبات زينة خارجي, نبات زينة داخلي, شجرة ظل, شجرة فاكهة ومثمرة, نبات عطري وطبي, صبار وعصاريات, نبات متسلق, شجيرة سياجية.",
    },
    description: {
      type: Type.STRING,
      description: "Comprehensive botanical description and visual features (leaves, flowers, scent, growth habit).",
    },
    confidenceScore: {
      type: Type.NUMBER,
      description: "Confidence percentage (e.g. 95).",
    },
    partIdentified: {
      type: Type.STRING,
      description: "Part of the plant identified (أوراق، أزهار، ثمار، لحاء، شكل الشجرة العام).",
    },
    careTable: {
      type: Type.OBJECT,
      properties: {
        plantingSeason: {
          type: Type.STRING,
          description: "Best planting/sowing season (e.g. الخريف (تشرين) وبداية الربيع (شباط وآذار)).",
        },
        fertilization: {
          type: Type.STRING,
          description: "Fertilizer schedule, type (e.g. NPK متعادل 20-20-20، سماد حيواني معالج شتاءً، سماد هيوميك أسيد).",
        },
        watering: {
          type: Type.STRING,
          description: "Watering schedule and method: صيفاً (يومياً أو مرتين باليوم بالحر الشديد) وشتاءً (عند جفاف التربة).",
        },
        sunlight: {
          type: Type.STRING,
          description: "Sunlight & light requirements: شمس مباشرة كاملة، شمس مفلترة، ظل جزئي (نصف ظل).",
        },
        soilType: {
          type: Type.STRING,
          description: "Soil preference: طينية خصبة جيدة الصرف، بتموس وبيرلايت، تحمل لملوحة المياه.",
        },
        temperatureAndClimate: {
          type: Type.STRING,
          description: "Temperature tolerance and performance in hot Middle Eastern / Iraqi climate (حرارة الصيف فوق 45 مئوية وصقيع الشتاء).",
        },
        propagation: {
          type: Type.STRING,
          description: "Propagation methods (العُقل الساقية، البذور، الترقيد الهوائي، الفسائل والتفصيص).",
        },
        pruning: {
          type: Type.STRING,
          description: "Pruning time and guidelines (تقليم جائر في نهاية الشتاء، تنظيف الأزهار الذابلة).",
        },
        toxicity: {
          type: Type.STRING,
          description: "Toxicity status for pets (cats/dogs) and children: آمن تماماً، سام إذا تم تناوله، قد يسبب تهيج جلدي.",
        },
      },
      required: [
        "plantingSeason",
        "fertilization",
        "watering",
        "sunlight",
        "soilType",
        "temperatureAndClimate",
        "propagation",
        "pruning",
        "toxicity"
      ],
    },
    dailyCareTips: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "5 to 6 practical, specific daily & weekly care tips.",
    },
    iraqiClimateAdvice: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "3 to 4 specialized tips for growing this plant in the harsh Iraqi climate (تحديات موجات الحر الشديدة في تموز وآب، العواصف الترابية، ملوحة المياه، شمس الظهيرة الحارقة).",
    },
    commonPestsAndDiseases: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          issue: { type: Type.STRING, description: "Name of the pest or problem (e.g. المن، صانعات الأنفاق، اصفرار الأوراق، تعفن الجذور)." },
          symptoms: { type: Type.STRING, description: "Symptoms observed on the plant." },
          treatment: { type: Type.STRING, description: "Organic or chemical solution and prevention." }
        },
        required: ["issue", "symptoms", "treatment"]
      },
      description: "2 to 3 common plant issues and how to treat them.",
    },
    gardenUses: {
      type: Type.STRING,
      description: "Best landscape / home uses (أحواض وسنادين، حديقة منزلية، سياج نباتي، بلكونة، مدخل المنزل).",
    }
  },
  required: [
    "isPlant",
    "commonNameArabic",
    "iraqiLocalName",
    "scientificName",
    "family",
    "category",
    "description",
    "confidenceScore",
    "partIdentified",
    "careTable",
    "dailyCareTips",
    "iraqiClimateAdvice",
    "commonPestsAndDiseases",
    "gardenUses"
  ]
};

// Robust retry & model fallback for 503 / high demand spikes
async function generateContentWithRetry(params: any): Promise<any> {
  const models = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
  let lastError: any = null;

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          ...params,
          model,
        });
        return response;
      } catch (err: any) {
        lastError = err;
        const msg = String(err?.message || err || '');
        const isUnavailable =
          msg.includes('503') ||
          msg.includes('high demand') ||
          msg.includes('UNAVAILABLE') ||
          msg.includes('RESOURCE_EXHAUSTED') ||
          err?.status === 503 ||
          err?.code === 503;

        if (isUnavailable) {
          console.warn(`[Gemini API] Model ${model} (attempt ${attempt}) busy: ${msg}. Retrying...`);
          await new Promise((r) => setTimeout(r, 1000 * attempt));
          continue;
        }
        throw err;
      }
    }
  }

  throw lastError;
}

// API Endpoint: Identify Plant from Image
app.post('/api/identify-plant', async (req: Request, res: Response) => {
  try {
    const { imageBase64, imageMimeType, userNote } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'لم يتم إرسال صورة النبات' });
    }

    // Strip prefix if user passed full data URI (e.g. data:image/jpeg;base64,...)
    const cleanBase64 = imageBase64.includes(';base64,')
      ? imageBase64.split(';base64,')[1]
      : imageBase64;
    const mime = imageMimeType || (imageBase64.includes('data:image/png') ? 'image/png' : 'image/jpeg');

    const systemPrompt = `أنت خبير نباتي وبستاني عربي متخصص في النباتات العراقية والعربية والعالمية (Iraqi & Arab Horticultural Expert).
مهمتك: فحص صورة النبات بدقة شديدة وتحديد نوعه، مع التركيز على إعطاء التسمية المحلية بالعراقي (الاسم العراقي الدارج والمستخدم في المشاتل والحدائق العراقية مثل رازقي، نبق، ورد جوري، ياس، قلمطوز، دفلة، عين البزون، نازناز، ديدونيا، شب الليل، نخلة برحي، خبازي، فلفل كاذب، كاردينيا، الخ)، وإذا لم يتوفر اسم عراقي مخصص، اذكر التسمية الدارجة في مشاتل العراق أو اكتب بوضوح أنه معروف باسمه العربي الشائع.
املأ جميع تفاصيل جدول الرعاية ومواعيد الزراعة والتسميد والري وظروف المناخ العراقي (الحرارة الشديدة صيفاً، ملوحة التربة/المياه) مع نصائح العناية اليومية والوقاية من الآفات.
يجب أن تكون جميع النصوص باللغة العربية الفصحى الجميلة والواضحة مع المصطلحات العراقية المحببة والمعروفة.`;

    const userPrompt = `يرجى تحليل صورة النبات هذه وتحديد تفاصيله بالكامل وفق الصيغة المحددة بدقة.
${userNote ? `ملاحظة إضافية من المستخدم: "${userNote}"` : ''}`;

    const response = await generateContentWithRetry({
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: mime,
                data: cleanBase64,
              },
            },
            {
              text: userPrompt,
            },
          ],
        },
      ],
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        responseSchema: plantSchema,
      },
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error('لم يتم استلام رد من نموذج الذكاء الاصطناعي');
    }

    const parsedData = JSON.parse(responseText);
    return res.json(parsedData);
  } catch (error: any) {
    console.error('Plant identification error:', error);
    let userMsg = 'حدث خطأ أثناء فحص النبات، يرجى المحاولة مرة أخرى بصورة أوضح';
    const errText = String(error?.message || error || '');
    if (errText.includes('503') || errText.includes('high demand') || errText.includes('UNAVAILABLE')) {
      userMsg = 'تشهد خوادم الذكاء الاصطناعي ضغطاً مؤقتاً، يرجى الانتظار بضع ثوانٍ وإعادة الضغط على زر الفحص مرة أخرى.';
    }
    return res.status(500).json({
      error: userMsg,
    });
  }
});

// Helper for chat prompt
function buildChatSystemPrompt(plantContext: any): string {
  return `أنت طبيب وخبير نباتات ذكي (دليل نباتاتي العراقي).
أنت تتحدث مع المستخدم حول نبات محدد تم التعرف عليه:
- الاسم العربي: ${plantContext?.commonNameArabic || 'نبات'}
- الاسم العراقي: ${plantContext?.iraqiLocalName || 'غير محدد'}
- الاسم العلمي: ${plantContext?.scientificName || 'غير محدد'}
- متطلبات الري: ${plantContext?.careTable?.watering || ''}
- التسميد: ${plantContext?.careTable?.fertilization || ''}
- الشمس والمناخ: ${plantContext?.careTable?.sunlight || ''}

أجب على أسئلة المستخدم باحترافية، ودقة، ولهجة لطيفة ومبسطة باللغة العربية، مع تقديم حلول عملية تناسب المناخ العراقي والشرق أوسطي. اجعل إجابتك منسقة بنقاط واضحة.`;
}

// API Endpoint: Interactive Plant Doctor Chat (standard response)
app.post('/api/chat-plant', async (req: Request, res: Response) => {
  try {
    const { plantContext, message, chatHistory } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'الرسالة مطلوبة' });
    }

    const systemPrompt = buildChatSystemPrompt(plantContext);

    const contents: any[] = [];
    if (chatHistory && Array.isArray(chatHistory)) {
      for (const item of chatHistory) {
        contents.push({
          role: item.role === 'user' ? 'user' : 'model',
          parts: [{ text: item.text }],
        });
      }
    }
    contents.push({
      role: 'user',
      parts: [{ text: message }],
    });

    const response = await generateContentWithRetry({
      contents: contents,
      config: {
        systemInstruction: systemPrompt,
      },
    });

    return res.json({ reply: response.text });
  } catch (error: any) {
    console.error('Chat plant error:', error);
    let userMsg = 'حدث خطأ في محادثة خبير النباتات، يرجى المحاولة لاحقاً';
    const errText = String(error?.message || error || '');
    if (errText.includes('503') || errText.includes('high demand') || errText.includes('UNAVAILABLE')) {
      userMsg = 'تشهد الخدمة ضغطاً مؤقتاً، يرجى الانتظار بضع ثوانٍ وإعادة إرسال السؤال.';
    }
    return res.status(500).json({
      error: userMsg,
    });
  }
});

// API Endpoint: Streaming Plant Doctor Chat (Server-Sent Events)
app.post('/api/chat-plant/stream', async (req: Request, res: Response) => {
  try {
    const { plantContext, message, chatHistory } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'الرسالة مطلوبة' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const systemPrompt = buildChatSystemPrompt(plantContext);

    const contents: any[] = [];
    if (chatHistory && Array.isArray(chatHistory)) {
      for (const item of chatHistory) {
        contents.push({
          role: item.role === 'user' ? 'user' : 'model',
          parts: [{ text: item.text }],
        });
      }
    }
    contents.push({
      role: 'user',
      parts: [{ text: message }],
    });

    const streamResponse = await ai.models.generateContentStream({
      model: 'gemini-3.8-flash',
      contents,
      config: {
        systemInstruction: systemPrompt,
      },
    });

    for await (const chunk of streamResponse) {
      const text = chunk.text;
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error: any) {
    console.error('Chat stream error:', error);
    res.write(`data: ${JSON.stringify({ error: error.message || 'حدث خطأ أثناء البث' })}\n\n`);
    res.end();
  }
});

// HTTP & WebSocket Server Setup
const server = http.createServer(app);

// WebSocket Server for Gemini Live API on /live
const wss = new WebSocketServer({ server, path: '/live' });

wss.on('connection', async (clientWs) => {
  console.log('[Live API] Client connected to WebSocket /live');

  try {
    const session = await ai.live.connect({
      model: 'gemini-3.8-live',
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
        },
        systemInstruction: 'أنت طبيب وخبير نباتات عراقي متخصص في تشخيص ورعاية النباتات والأشجار العراقية والمناخ الحار. أجب بصوت ودود وباللغة العربية الفصحى المبسطة مع المصطلحات الزراعية العراقية.',
      },
      callbacks: {
        onmessage: (message: LiveServerMessage) => {
          for (const part of message.serverContent?.modelTurn?.parts ?? []) {
            if (part.inlineData?.data) {
              clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
            }
          }
          if (message.serverContent?.interrupted) {
            clientWs.send(JSON.stringify({ interrupted: true }));
          }
        },
      },
    });

    clientWs.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.audio) {
          session.sendRealtimeInput({
            audio: { data: parsed.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (parsed.text) {
          session.sendRealtimeInput({
            text: parsed.text,
          });
        }
      } catch (e) {
        console.error('[Live API] Failed to parse client message:', e);
      }
    });

    clientWs.on('close', () => {
      console.log('[Live API] Client disconnected from /live');
      try {
        session.close();
      } catch {}
    });

    clientWs.on('error', (err) => {
      console.error('[Live API] WebSocket client error:', err);
    });
  } catch (err: any) {
    console.error('[Live API] Failed to connect to Gemini Live session:', err);
    clientWs.send(JSON.stringify({ error: err.message || 'فشل الاتصال بجلسة الصوت المباشرة' }));
  }
});

// Production or Vite middleware integration
async function startServer() {
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    (Boolean(process.env.K_SERVICE) && !process.env.K_SERVICE?.startsWith('ais-dev')) ||
    process.env.npm_lifecycle_event === 'start';

  const distHtmlPath = path.join(__dirname, 'dist', 'index.html');
  const distExists = fs.existsSync(distHtmlPath);

  if (isProduction && distExists) {
    console.log(`[Production] Serving static files from dist/... on port ${PORT}`);
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(distHtmlPath);
    });
  } else {
    console.log(`[Development] Mounting Vite middleware on port ${PORT}...`);
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        // In local development, swap production bundle reference for live Vite TypeScript entry
        template = template
          .replace(/<script type="module" crossorigin src="\.\/assets\/.*?"><\/script>/, '<script type="module" src="/src/main.tsx"></script>')
          .replace(/<link rel="stylesheet" crossorigin href="\.\/assets\/.*?">/, '');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e: any) {
        if (vite.ssrFixStacktrace) {
          vite.ssrFixStacktrace(e);
        }
        next(e);
      }
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server successfully listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
