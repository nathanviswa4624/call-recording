'use client';
/**
 * Recording player. Audio is fetched from the authenticated stream endpoint via
 * a short-lived signed URL (POST /recordings/:id/media-token) — the browser
 * issues normal HTTP Range requests for seeking and the session token never
 * appears in a URL. Recording files are never served from a static path.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Gauge, Loader2, Pause, Play, Rewind, FastForward, Volume2, VolumeX } from 'lucide-react';
import { recordingApi, type Channel } from '@/lib/api/recordings';
import { errorMessage } from '@/lib/api/client';
import { fmtDuration } from '@/lib/format';
import { Button, Select, cn } from '@/components/ui/primitives';
import { InlineAlert } from '@/components/ui/feedback';

export const SPEEDS = [0.5, 1, 1.25, 1.5, 2] as const;

export interface AudioPlayerProps {
  recordingId: string;
  channels: { mixed: boolean; caller: boolean; callee: boolean };
  canDownload: boolean;
  /** Pre-computed peaks (0..1), shown as a waveform when the backend provides them. */
  waveform?: number[] | null;
  autoPlay?: boolean;
}

export function AudioPlayer({ recordingId, channels, canDownload, waveform, autoPlay }: AudioPlayerProps) {
  const audio = useRef<HTMLAudioElement>(null);
  const [channel, setChannel] = useState<Channel>('mixed');
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async (ch: Channel, resumeAt = 0) => {
    setLoading(true); setError(null);
    try {
      const { url } = await recordingApi.streamUrl(recordingId, ch);
      setSrc(url);
      requestAnimationFrame(() => { if (audio.current && resumeAt) audio.current.currentTime = resumeAt; });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [recordingId]);

  useEffect(() => { setChannel('mixed'); void load('mixed'); }, [load]);
  useEffect(() => { if (audio.current) audio.current.playbackRate = speed; }, [speed, src]);
  useEffect(() => { if (audio.current) { audio.current.volume = volume; audio.current.muted = muted; } }, [volume, muted, src]);

  const toggle = async () => {
    const a = audio.current;
    if (!a) return;
    try { if (a.paused) await a.play(); else a.pause(); } catch (e) {
      // Signed URLs expire after 5 minutes; refresh once on failure.
      await load(channel, a.currentTime);
      setError(errorMessage(e));
    }
  };
  const seek = (t: number) => { if (audio.current) audio.current.currentTime = Math.max(0, Math.min(t, duration || t)); };
  const switchChannel = (ch: Channel) => { const at = audio.current?.currentTime ?? 0; setChannel(ch); void load(ch, at); };

  const download = async () => {
    setDownloading(true);
    try {
      const { url } = await recordingApi.downloadUrl(recordingId);
      const a = document.createElement('a');
      a.href = url; a.rel = 'noopener'; a.click();
    } catch (e) { setError(errorMessage(e)); } finally { setDownloading(false); }
  };

  const pct = duration ? (time / duration) * 100 : 0;
  const peaks = waveform?.length ? waveform : null;

  return (
    <div className="space-y-2" aria-label="Recording player">
      {error && <InlineAlert tone="crit" title="Playback problem">{error}</InlineAlert>}
      {src && (
        <audio ref={audio} src={src} preload="metadata" autoPlay={autoPlay}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
          onError={() => setError('The recording could not be loaded (it may be missing from storage or the link expired).')} />
      )}
      <div className="relative h-12 cursor-pointer rounded-md bg-surface-2" role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)} tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'ArrowRight') seek(time + 5); if (e.key === 'ArrowLeft') seek(time - 5); }}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * duration); }}>
        {peaks ? (
          <div className="absolute inset-0 flex items-center gap-px px-1">
            {peaks.map((p, i) => <span key={i} className={cn('flex-1 rounded-sm', (i / peaks.length) * 100 <= pct ? 'bg-[var(--series-1)]' : 'bg-border-strong')} style={{ height: `${Math.max(6, p * 100)}%` }} />)}
          </div>
        ) : (
          <>
            <div className="absolute inset-y-0 left-0 rounded-md bg-primary-soft" style={{ width: `${pct}%` }} />
            <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 px-2"><div className="h-1 rounded bg-border-strong"><div className="h-1 rounded bg-primary" style={{ width: `${pct}%` }} /></div></div>
          </>
        )}
        <span className="absolute top-1 right-2 text-[10.5px] text-muted">{peaks ? '' : 'Waveform not available'}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={toggle} disabled={!src || loading} aria-label={playing ? 'Pause' : 'Play'} icon={loading ? <Loader2 className="size-3.5 animate-spin" /> : playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}>{playing ? 'Pause' : 'Play'}</Button>
        <Button size="sm" variant="ghost" aria-label="Back 10 seconds" icon={<Rewind className="size-3.5" />} onClick={() => seek(time - 10)} />
        <Button size="sm" variant="ghost" aria-label="Forward 10 seconds" icon={<FastForward className="size-3.5" />} onClick={() => seek(time + 10)} />
        <span className="font-mono text-[12.5px] tabular text-text-2">{fmtDuration(time)} / {fmtDuration(duration)}</span>
        <div className="flex-1" />
        <button type="button" aria-label={muted ? 'Unmute' : 'Mute'} className="rounded p-1 text-muted hover:text-text" onClick={() => setMuted((m) => !m)}>{muted || volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}</button>
        <input type="range" aria-label="Volume" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(e) => { setVolume(Number(e.target.value)); setMuted(false); }} className="w-24 accent-[var(--primary)]" />
        <label className="flex items-center gap-1 text-[12.5px] text-text-2"><Gauge className="size-3.5" aria-hidden /><span className="sr-only">Playback speed</span>
          <Select aria-label="Playback speed" className="h-7 w-20" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>{SPEEDS.map((s) => <option key={s} value={s}>{s}x</option>)}</Select>
        </label>
        {(channels.caller || channels.callee) && (
          <Select aria-label="Channel" className="h-7 w-32" value={channel} onChange={(e) => switchChannel(e.target.value as Channel)}>
            <option value="mixed">Both sides</option>
            {channels.caller && <option value="caller">Caller channel</option>}
            {channels.callee && <option value="callee">Callee channel</option>}
          </Select>
        )}
        {canDownload && <Button size="sm" icon={<Download className="size-3.5" />} loading={downloading} onClick={download}>Download</Button>}
      </div>
    </div>
  );
}
