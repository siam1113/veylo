const SESSION_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_DURATION_MS = 10 * 60_000;
const DEFAULT_WARNING_BEFORE_MS = 60_000;

export type VoiceSessionStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';
export type VoiceRealtimeEvent = Record<string, unknown> & { type: string };

export type VoiceSessionOptions = {
  apiUrl: string;
  getAccessToken: () => Promise<string | null>;
  onEvent: (event: VoiceRealtimeEvent) => void;
  onStatus: (status: VoiceSessionStatus, detail?: string) => void;
  maxDurationMs?: number;
  warnBeforeMs?: number;
  /** Sent as one-off response instructions the moment the data channel opens, so Vey speaks
   * first (e.g. a personalized greeting) instead of waiting for the user to talk. */
  initialInstructions?: string;
  /** Merged into the POST /voice/session body — e.g. the agent's name/tone/voice, or
   * { voice, preview: true } for a no-mic voice-preview session. */
  sessionRequestBody?: Record<string, unknown>;
  /** Set false to skip requesting the microphone and open the connection receive-only —
   * for a voice preview that only needs to play a sample line back. Defaults to true. */
  useMicrophone?: boolean;
};

export type VoiceSession = {
  connect(): Promise<void>;
  disconnect(): void;
  sendToolResult(callId: string, output: unknown): void;
  setMuted(muted: boolean): void;
};

const timedFetch: typeof fetch = (input, init = {}) => {
  const timeout = AbortSignal.timeout(SESSION_REQUEST_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};

/** Transport + lifecycle only: opens the WebRTC connection to OpenAI's Realtime API and
 * forwards raw server events upward. Event interpretation (transcripts, tool calls) and
 * tool execution live in the caller (VoiceAssistant.tsx / voice-tools.client.ts). */
export function createVoiceSession(options: VoiceSessionOptions): VoiceSession {
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const warnBeforeMs = options.warnBeforeMs ?? DEFAULT_WARNING_BEFORE_MS;

  let peerConnection: RTCPeerConnection | null = null;
  let dataChannel: RTCDataChannel | null = null;
  let micStream: MediaStream | null = null;
  let audioElement: HTMLAudioElement | null = null;
  let warningTimer: ReturnType<typeof setTimeout> | null = null;
  let hardStopTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function clearTimers() {
    if (warningTimer) clearTimeout(warningTimer);
    if (hardStopTimer) clearTimeout(hardStopTimer);
    warningTimer = null;
    hardStopTimer = null;
  }

  function teardown() {
    clearTimers();
    try { dataChannel?.close(); } catch { /* already closed */ }
    try { peerConnection?.close(); } catch { /* already closed */ }
    try { micStream?.getTracks().forEach((track) => track.stop()); } catch { /* already stopped */ }
    if (audioElement) { try { audioElement.srcObject = null; audioElement.remove(); } catch { /* detached */ } }
    dataChannel = null; peerConnection = null; micStream = null; audioElement = null;
  }

  function disconnect() {
    if (disposed) return;
    disposed = true;
    teardown();
    options.onStatus('closed');
  }

  function sendToolResult(callId: string, output: unknown) {
    if (!dataChannel || dataChannel.readyState !== 'open') return;
    dataChannel.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(output) } }));
    dataChannel.send(JSON.stringify({ type: 'response.create' }));
  }

  function setMuted(muted: boolean) {
    micStream?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
  }

  async function connect() {
    disposed = false;
    options.onStatus('connecting');
    try {
      const token = await options.getAccessToken();
      if (!token) throw new Error('Sign in to use voice mode.');
      const sessionResponse = await timedFetch(`${options.apiUrl.replace(/\/$/, '')}/v1/voice/session`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(options.sessionRequestBody ?? {}),
      });
      if (!sessionResponse.ok) throw new Error('Could not start voice mode. Try again in a moment.');
      const { clientSecret, model } = await sessionResponse.json() as { clientSecret: string; model: string };

      const useMicrophone = options.useMicrophone !== false;
      const pc = new RTCPeerConnection();
      peerConnection = pc;
      if (useMicrophone) {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStream.getTracks().forEach((track) => pc.addTrack(track, micStream!));
      } else {
        pc.addTransceiver('audio', { direction: 'recvonly' });
      }

      audioElement = new Audio();
      audioElement.autoplay = true;
      pc.ontrack = (event) => { if (audioElement) audioElement.srcObject = event.streams[0] ?? null; };

      const channel = pc.createDataChannel('oai-events');
      dataChannel = channel;
      channel.addEventListener('message', (event) => {
        try { options.onEvent(JSON.parse(event.data as string) as VoiceRealtimeEvent); }
        catch { /* ignore malformed server events */ }
      });
      channel.addEventListener('open', () => {
        options.onStatus('connected');
        if (options.initialInstructions) {
          channel.send(JSON.stringify({ type: 'response.create', response: { instructions: options.initialInstructions } }));
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpResponse = await timedFetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${clientSecret}`, 'Content-Type': 'application/sdp' },
        body: offer.sdp,
      });
      if (!sdpResponse.ok) throw new Error('Could not connect to voice mode. Try again in a moment.');
      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      warningTimer = setTimeout(() => options.onStatus('connected', 'warning'), Math.max(0, maxDurationMs - warnBeforeMs));
      hardStopTimer = setTimeout(() => disconnect(), maxDurationMs);
    } catch (error) {
      teardown();
      disposed = true;
      const message = error instanceof Error && error.name === 'NotAllowedError'
        ? 'Microphone access was blocked. Allow it in your browser settings and try again.'
        : error instanceof Error ? error.message : 'Could not start voice mode.';
      options.onStatus('error', message);
    }
  }

  return { connect, disconnect, sendToolResult, setMuted };
}
