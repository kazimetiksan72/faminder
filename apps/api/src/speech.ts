import type { Version, Reminder } from '@faminder/shared';
import { HttpError, hash } from './auth.js';

export const model = () => process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-lite-tts';
export const speechKey = (familyId: string, v: Pick<Version, 'text' | 'voice' | 'style'>) =>
  hash(JSON.stringify([familyId, model(), v.text.trim(), v.voice, v.style]));
const styles = {
  warm: 'Warm, clear and friendly. Speak Turkish naturally, as a gentle family reminder.',
  calm: 'Calm, soft and unhurried. Speak Turkish clearly.',
  cheerful: 'Cheerful and encouraging, without shouting. Speak Turkish clearly.',
};
export async function synthesize(v: Version, signal?: AbortSignal): Promise<Buffer> {
  if (!process.env.GEMINI_API_KEY)
    throw new HttpError(503, 'Ses üretimi için Vercel ortamına GEMINI_API_KEY ekleyin.');
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(90000)])
      : AbortSignal.timeout(90000),
    body: JSON.stringify({
      model: model(),
      input: [
        {
          type: 'user_input',
          content: [
            {
              type: 'text',
              text: v.text,
              annotations: [{ type: 'speech_metadata', style: styles[v.style] }],
            },
          ],
        },
      ],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: v.voice }] },
    }),
  });
  if (!response.ok)
    throw new HttpError(
      response.status === 429 ? 429 : 502,
      response.status === 429
        ? 'Ses hizmetinin kotası dolu. Daha sonra tekrar deneyin.'
        : `Ses hizmeti yanıt vermedi (${response.status}). API anahtarını ve model erişimini kontrol edin.`,
    );
  const data = (await response.json()) as {
    steps?: { type: string; content?: { type: string; data?: string; mime_type?: string }[] }[];
    output_audio?: { data: string };
  };
  const block = data.steps
    ?.flatMap((s) => (s.type === 'model_output' ? (s.content ?? []) : []))
    .filter((c) => c.type === 'audio')
    .at(-1);
  const base64 = block?.data ?? data.output_audio?.data;
  if (!base64) throw new HttpError(502, 'Ses hizmeti bir ses dosyası döndürmedi.');
  const wav = Buffer.from(base64, 'base64');
  if (wav.length > 3 * 1024 * 1024)
    throw new HttpError(502, 'Ses kaydı çok uzun. Hatırlatıcı metnini kısaltın.');
  if (
    wav.length < 44 ||
    wav.subarray(0, 4).toString() !== 'RIFF' ||
    wav.subarray(8, 12).toString() !== 'WAVE'
  )
    throw new HttpError(502, 'Ses biçimi desteklenmiyor; WAV yanıtı bekleniyor.');
  return wav;
}

// Read older deployments without rewriting or deleting existing family data.
export function textReminder(row: Record<string, any>): Reminder {
  const { audioId: _legacyFile, ...source } = row.content ?? row.desired;
  const content: Version = {
    ...source,
    enabled: row.enabled,
    audioKey: speechKey(row.familyId, source),
  };
  return {
    id: row.id,
    familyId: row.familyId,
    enabled: row.enabled,
    content,
    updatedAt: row.updatedAt,
  };
}
