import { useCallback, useEffect, useRef, useState } from "react";

const MIN_MS = 300, ROLLOVER_MS = 90_000, SILENCE_MS = 60_000;

function supportedMime() {
  const candidates = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
  return candidates.find((value) => MediaRecorder.isTypeSupported(value)) ?? "";
}

function isTextTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return !!element && (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT" || element.isContentEditable);
}

export function useRecorder(onSegment: (blob: Blob, durationMs: number) => void, onError: (message: string) => void, disabled: boolean) {
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null), recorderRef = useRef<MediaRecorder | null>(null);
  const wantedRef = useRef(false), startedRef = useRef(0), chunksRef = useRef<Blob[]>([]);
  const rolloverRef = useRef<number | undefined>(undefined), monitorRef = useRef<number | undefined>(undefined), lastSoundRef = useRef(0);
  const audioContextRef = useRef<AudioContext | undefined>(undefined), analyserRef = useRef<AnalyserNode | undefined>(undefined);
  const callbackRef = useRef(onSegment); callbackRef.current = onSegment;

  const clearMonitoring = useCallback(() => {
    if (rolloverRef.current) window.clearTimeout(rolloverRef.current);
    if (monitorRef.current) window.clearInterval(monitorRef.current);
    rolloverRef.current = monitorRef.current = undefined; setLevel(0);
    void audioContextRef.current?.close(); audioContextRef.current = undefined; analyserRef.current = undefined;
  }, []);

  const beginSegment = useCallback((stream: MediaStream) => {
    const mimeType = supportedMime();
    const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64_000 });
    recorderRef.current = recorder; chunksRef.current = []; startedRef.current = performance.now();
    recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
    recorder.onstop = () => {
      const duration = performance.now() - startedRef.current;
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
      if (duration >= MIN_MS && blob.size) callbackRef.current(blob, duration);
      chunksRef.current = [];
      if (wantedRef.current && stream.active) beginSegment(stream);
      else { stream.getTracks().forEach((track) => track.stop()); streamRef.current = null; clearMonitoring(); }
    };
    recorder.start(1000);
    rolloverRef.current = window.setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, ROLLOVER_MS);
  }, [clearMonitoring]);

  const stop = useCallback(() => {
    wantedRef.current = false; setRecording(false); clearMonitoring();
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
    else { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; }
  }, [clearMonitoring]);

  const start = useCallback(async () => {
    if (disabled || wantedRef.current) return;
    wantedRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      if (disabled || !wantedRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream; setRecording(true); lastSoundRef.current = performance.now();
      stream.getAudioTracks().forEach((track) => track.addEventListener("ended", stop, { once: true }));
      beginSegment(stream);
      const context = new AudioContext(), analyser = context.createAnalyser(); analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser); audioContextRef.current = context; analyserRef.current = analyser;
      const data = new Uint8Array(analyser.fftSize);
      monitorRef.current = window.setInterval(() => {
        analyser.getByteTimeDomainData(data); let sum = 0;
        for (const sample of data) { const value = (sample - 128) / 128; sum += value * value; }
        const rms = Math.sqrt(sum / data.length); setLevel(rms);
        if (rms > 0.015) lastSoundRef.current = performance.now();
        if (performance.now() - lastSoundRef.current >= SILENCE_MS) stop();
      }, 125);
    } catch (error) { wantedRef.current = false; onError(error instanceof Error ? error.message : "Mikrofonzugriff fehlgeschlagen"); }
  }, [beginSegment, disabled, onError, stop]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === "Escape" && wantedRef.current) { event.preventDefault(); stop(); }
      if (event.code === "Space" && !event.repeat && !isTextTarget(event.target) && !disabled) { event.preventDefault(); void start(); }
    };
    const up = (event: KeyboardEvent) => { if (event.code === "Space" && wantedRef.current && !isTextTarget(event.target)) { event.preventDefault(); stop(); } };
    const leave = () => { if (wantedRef.current) stop(); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("pagehide", leave);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("pagehide", leave); leave(); };
  }, [disabled, start, stop]);

  return { recording, level, start, stop, toggle: recording ? stop : start };
}
