import { useEffect, useRef, useState } from 'react';
import { voiceAgentVoices, type VoiceAgentVoice } from '@veylo/domain';
import { createVoiceSession, type VoiceSession } from '../lib/voice-session.client';
import { UiIcon } from './UiIcon';

const voiceLabels: Record<VoiceAgentVoice, string> = {
  marin: 'Marin', cedar: 'Cedar', alloy: 'Alloy', ash: 'Ash', ballad: 'Ballad',
  coral: 'Coral', echo: 'Echo', sage: 'Sage', shimmer: 'Shimmer', verse: 'Verse',
};
const PREVIEW_MAX_DURATION_MS = 15_000;

/** A no-mic, mic-permission-free sample of each Realtime API voice: mints a preview-only
 * session (server skips tools/full instructions), opens the WebRTC connection recvonly, and
 * asks it to speak one sample line. Auto-stops itself once that response finishes. */
export function VoicePicker({ value, onChange, agentName, apiUrl, getAccessToken }: {
  value: VoiceAgentVoice; onChange(voice: VoiceAgentVoice): void; agentName: string;
  apiUrl: string; getAccessToken: () => Promise<string | null>;
}) {
  const [playing, setPlaying] = useState<VoiceAgentVoice | null>(null);
  const [error, setError] = useState('');
  const sessionRef = useRef<VoiceSession | null>(null);

  function stopPreview() {
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    setPlaying(null);
  }

  useEffect(() => () => { sessionRef.current?.disconnect(); }, []);

  function playPreview(voice: VoiceAgentVoice) {
    if (playing === voice) { stopPreview(); return; }
    stopPreview();
    setError('');
    setPlaying(voice);
    const session = createVoiceSession({
      apiUrl, getAccessToken,
      useMicrophone: false,
      maxDurationMs: PREVIEW_MAX_DURATION_MS,
      sessionRequestBody: { voice, preview: true },
      initialInstructions: `Say exactly this once, in a natural and friendly tone, then stop talking: "Hi, I'm ${agentName}. This is what I sound like."`,
      onEvent: (event) => {
        if (event.type.includes('response.done') || event.type.includes('output_audio_buffer.stopped')) stopPreview();
        else if (event.type === 'error') {
          setError((event.error as { message?: string } | undefined)?.message ?? 'Could not play that voice.');
          stopPreview();
        }
      },
      onStatus: (status, detail) => {
        if (status === 'error') { setError(detail ?? 'Could not play that voice.'); setPlaying(null); }
      },
    });
    sessionRef.current = session;
    void session.connect();
  }

  return <div className="voice-picker">
    <div className="voice-picker-grid" role="radiogroup" aria-label="Assistant voice">
      {voiceAgentVoices.map((voice) => (
        <div key={voice} className={`voice-picker-row ${value === voice ? 'selected' : ''}`}>
          <button type="button" className="voice-picker-option" role="radio" aria-checked={value === voice} onClick={() => onChange(voice)}>
            <span className="voice-picker-dot" aria-hidden="true" />{voiceLabels[voice]}
          </button>
          <button type="button" className={`voice-picker-test ${playing === voice ? 'active' : ''}`} aria-label={`${playing === voice ? 'Stop' : 'Test'} ${voiceLabels[voice]} voice`} onClick={() => playPreview(voice)}>
            <UiIcon name={playing === voice ? 'close' : 'play'} />
          </button>
        </div>
      ))}
    </div>
    {error && <p className="voice-picker-error">{error}</p>}
  </div>;
}
