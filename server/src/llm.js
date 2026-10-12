// Text-model adapter: the rest of the app asks for "JSON matching this schema" or
// "research this", and this file talks to Claude or Gemini.
//
// Provider: AI_PROVIDER=claude|gemini, otherwise whichever key is set (Claude preferred).
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

export function textProvider() {
  const forced = process.env.AI_PROVIDER?.toLowerCase();
  if (forced === 'claude' || forced === 'gemini') return forced;
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return 'claude';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return 'claude'; // surfaces a clear "missing key" error on first use
}

/* ---------- Claude ---------- */

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const CLAUDE_FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
let anthropic;
const claude = () => (anthropic ??= new Anthropic());

async function claudeJSON({ system, prompt, schema, effort, images }) {
  const content = [
    ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } })),
    { type: 'text', text: prompt },
  ];
  const response = await claude().beta.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    ...CLAUDE_FALLBACK,
    system,
    output_config: { effort, format: betaZodOutputFormat(schema) },
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal') throw new Error('The AI declined this request. Try rephrasing it.');
  if (response.stop_reason === 'max_tokens') throw new Error('The AI response was cut off. Try asking for something shorter.');
  if (!response.parsed_output) throw new Error('The AI returned an unexpected response. Please try again.');
  return response.parsed_output;
}

async function claudeResearch(prompt) {
  let messages = [{ role: 'user', content: prompt }];
  let response;
  // Server tools can pause long turns; continue up to a few times.
  for (let i = 0; i < 4; i++) {
    response = await claude().beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8000,
      ...CLAUDE_FALLBACK,
      output_config: { effort: 'low' },
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
      messages,
    });
    if (response.stop_reason !== 'pause_turn') break;
    messages = [...messages, { role: 'assistant', content: response.content }];
  }
  if (response.stop_reason === 'refusal') return { notes: '', sources: [] };
  const notes = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  const sources = [];
  for (const block of response.content) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content) if (r.url && !sources.some((s) => s.url === r.url)) sources.push({ title: r.title, url: r.url });
    }
  }
  return { notes, sources };
}

/* ---------- Gemini ---------- */

// gemini-3.8-flash is newer but was frequently overloaded when this was written; 3.6 Flash is stable and fast.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
// Flash-Lite has much higher free-tier limits; used automatically when the main model's quota runs out.
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite';
let google;
const gemini = () => {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set in server/.env');
  // Short retries: when a model is overloaded we'd rather switch to the fallback model than wait minutes.
  return (google ??= new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { timeout: 60_000, retryOptions: { attempts: 2, initialDelay: 2, maxDelay: 8 } },
  }));
};

const isQuotaError = (err) => err?.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(String(err?.message));
const isOverloaded = (err) =>
  [503, 504].includes(err?.status) || /UNAVAILABLE|DEADLINE_EXCEEDED|high demand|overloaded|timed? ?out|abort/i.test(String(err?.message) + String(err?.name));

/** Call Gemini; if the main model is out of free quota or overloaded, retry on the Flash-Lite model. */
async function geminiCall(request) {
  try {
    return await gemini().models.generateContent({ model: GEMINI_MODEL, ...request });
  } catch (err) {
    if (!(isQuotaError(err) || isOverloaded(err)) || GEMINI_FALLBACK_MODEL === GEMINI_MODEL) throw friendlyGeminiError(err);
    console.warn(`[gemini] ${GEMINI_MODEL} ${isQuotaError(err) ? 'quota exhausted' : 'overloaded'}, retrying on ${GEMINI_FALLBACK_MODEL}`);
    try {
      return await gemini().models.generateContent({ model: GEMINI_FALLBACK_MODEL, ...request });
    } catch (err2) {
      throw friendlyGeminiError(err2);
    }
  }
}

function friendlyGeminiError(err) {
  if (/API key not valid|API_KEY_INVALID/i.test(String(err?.message))) {
    return Object.assign(new Error('Your GEMINI_API_KEY is invalid. Copy it again from aistudio.google.com/apikey.'), { status: 500 });
  }
  if (isQuotaError(err)) {
    return Object.assign(new Error('Gemini free-tier limit reached. It resets daily, or enable billing in Google AI Studio.'), { status: 429 });
  }
  if (isOverloaded(err)) {
    return Object.assign(new Error('Gemini is overloaded right now. Please try again in a minute.'), { status: 503 });
  }
  return err;
}

function jsonSchemaFor(schema) {
  const { $schema, ...rest } = z.toJSONSchema(schema);
  return rest;
}

async function geminiJSON({ system, prompt, schema, images }) {
  const parts = [
    ...images.map((img) => ({ inlineData: { mimeType: img.mime, data: img.base64 } })),
    { text: prompt },
  ];
  const response = await geminiCall({
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction: system,
      responseMimeType: 'application/json',
      responseJsonSchema: jsonSchemaFor(schema),
      maxOutputTokens: 16000,
    },
  });
  const text = response.text;
  if (!text) {
    const reason = response.candidates?.[0]?.finishReason;
    throw new Error(reason === 'SAFETY' ? 'The AI declined this request. Try rephrasing it.' : 'The AI returned an empty response. Please try again.');
  }
  const parsed = schema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error('The AI returned an unexpected response. Please try again.');
  return parsed.data;
}

async function geminiResearch(prompt) {
  const response = await geminiCall({
    contents: prompt,
    config: { tools: [{ googleSearch: {} }], maxOutputTokens: 8000 },
  });
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const sources = [];
  for (const c of chunks) {
    if (c.web?.uri && !sources.some((s) => s.url === c.web.uri)) sources.push({ title: c.web.title, url: c.web.uri });
  }
  return { notes: (response.text ?? '').trim(), sources };
}

/* ---------- Public API ---------- */

/** Ask the model for JSON matching a zod schema. */
export function generateJSON({ system, prompt, schema, effort = 'medium', images = [] }) {
  return textProvider() === 'gemini'
    ? geminiJSON({ system, prompt, schema, images })
    : claudeJSON({ system, prompt, schema, effort, images });
}

/** Web research. Returns { notes, sources: [{ title, url }] }. */
export async function webResearch(prompt) {
  const r = textProvider() === 'gemini' ? await geminiResearch(prompt) : await claudeResearch(prompt);
  return { notes: r.notes, sources: r.sources.slice(0, 8) };
}

/** Generate an image with Gemini's image model. Returns { buffer, mime }. */
export async function geminiImage(prompt) {
  const response = await gemini().models.generateContent({
    model: process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image',
    contents: prompt,
    config: { responseModalities: ['IMAGE'] },
  });
  const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part) throw new Error('Gemini returned no image');
  return { buffer: Buffer.from(part.inlineData.data, 'base64'), mime: part.inlineData.mimeType || 'image/png' };
}
