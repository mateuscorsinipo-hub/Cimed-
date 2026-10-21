/**
 * Sincronização manual entre vídeo onboard e telemetria.
 * O vídeo é reproduzido localmente (URL de objeto); nenhum quadro é enviado a serviços externos.
 */
import type { Lap, MarkerType, Session, VideoSyncPoint } from '../types';
import { interp } from '../telemetry-metrics/signal';

export const MARKER_LABELS: Record<MarkerType, string> = {
  entry: 'Entrada',
  apex: 'Ápice',
  exit: 'Saída',
  brake: 'Frenagem',
  throttle: 'Aceleração',
  note: 'Nota',
};

export const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

/** Limite prático para reprodução fluida em dispositivos móveis. */
export const LARGE_VIDEO_BYTES = 1.5 * 1024 ** 3;

export interface SyncModel {
  rate: number;
  offset: number;
  points: number;
}

/**
 * Ajuste linear telemetria = rate·vídeo + offset.
 * 1 ponto: só deslocamento. 2+ pontos: mínimos quadrados (corrige deriva de relógio da câmera).
 */
export function fitSync(points: VideoSyncPoint[]): SyncModel | null {
  if (!points.length) return null;
  if (points.length === 1) return { rate: 1, offset: points[0].telemetryTime - points[0].videoTime, points: 1 };
  const n = points.length;
  const mx = points.reduce((a, p) => a + p.videoTime, 0) / n;
  const my = points.reduce((a, p) => a + p.telemetryTime, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of points) {
    sxy += (p.videoTime - mx) * (p.telemetryTime - my);
    sxx += (p.videoTime - mx) ** 2;
  }
  if (sxx < 1e-9) return { rate: 1, offset: my - mx, points: n };
  const rate = sxy / sxx;
  // Taxas muito diferentes de 1 indicam pontos inconsistentes; mantém só o deslocamento.
  if (rate < 0.9 || rate > 1.1) return { rate: 1, offset: my - mx, points: n };
  return { rate, offset: my - rate * mx, points: n };
}

export function videoToTelemetry(m: SyncModel, videoTime: number): number {
  return m.rate * videoTime + m.offset;
}

export function telemetryToVideo(m: SyncModel, telemetryTime: number): number {
  return (telemetryTime - m.offset) / m.rate;
}

export interface LapPosition {
  lap: Lap;
  fraction: number;
  lapElapsed: number;
}

/** Volta e fração da distância num instante da telemetria. */
export function positionAtTime(session: Session, t: number): LapPosition | null {
  // Intervalo semiaberto: no instante da passagem a posição pertence à volta que começa.
  const last = session.laps[session.laps.length - 1];
  const lap = session.laps.find((l) => t >= l.startTime && t < l.endTime) ?? (last && t === last.endTime ? last : undefined);
  const d = session.channels.distance;
  if (!lap || !d) return null;
  const time = session.channels.time;
  const d0 = interp(time, d, lap.startTime);
  const d1 = interp(time, d, lap.endTime);
  const f = (interp(time, d, t) - d0) / Math.max(1e-6, d1 - d0);
  return { lap, fraction: Math.min(1, Math.max(0, f)), lapElapsed: t - lap.startTime };
}

/** Instante da telemetria em que uma volta passa por uma fração da distância. */
export function timeAtLapFraction(session: Session, lap: Lap, fraction: number): number {
  const d = session.channels.distance;
  const time = session.channels.time;
  if (!d) return lap.startTime + fraction * lap.lapTime;
  const d0 = interp(time, d, lap.startTime);
  const d1 = interp(time, d, lap.endTime);
  const target = d0 + fraction * (d1 - d0);
  const ts: number[] = [];
  const ds: number[] = [];
  for (let i = lap.startIdx; i <= lap.endIdx; i++) {
    if (ds.length && d[i] <= ds[ds.length - 1]) continue;
    ts.push(time[i]);
    ds.push(d[i]);
  }
  return ds.length > 1 ? interp(ds, ts, target) : lap.startTime + fraction * lap.lapTime;
}

/** Captura o quadro atual do vídeo como PNG, inteiramente no navegador. */
export function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    const ctx = c.getContext('2d');
    if (!ctx || !c.width) return reject(new Error('Vídeo ainda não carregado.'));
    ctx.drawImage(video, 0, 0);
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar a imagem.'))), 'image/png');
  });
}
