import { describe, expect, it } from 'vitest';
import { haversine, projectLatLon, cumulativeDistance } from '../track-map/geometry';
import { integrateSpeed, resampleLap, consistency, speedStats, segmentTime, type TelemetrySource } from '../telemetry-metrics';
import { flagLaps, gateCrossings, lapsFromColumn, lapsFromTrackLength } from '../lap-detector';
import { compareLaps } from '../lap-comparator';
import { fitSync, videoToTelemetry } from '../onboard-player';
import { matchIntent } from '../engineer-assistant';
import type { Lap, Segment } from '../types';

describe('distância', () => {
  it('haversine: 1 grau de latitude ≈ 111,2 km', () => {
    expect(haversine(0, 0, 1, 0)).toBeCloseTo(111195, -1);
  });
  it('projeção local preserva distâncias curtas', () => {
    const lat = [-23.5, -23.5009];
    const lon = [-46.6, -46.6];
    const p = projectLatLon(lat, lon);
    const d = cumulativeDistance(p.x, p.y);
    expect(d[1]).toBeCloseTo(haversine(lat[0], lon[0], lat[1], lon[1]), 0);
  });
  it('integração da velocidade (trapézio)', () => {
    const d = integrateSpeed([10, 10, 20], [0, 1, 2]);
    expect(d).toEqual([0, 10, 25]);
  });
});

/** Volta sintética simples: velocidade constante por trechos, 10 Hz. */
function source(speeds: number[][], dt = 0.1): TelemetrySource {
  const time: number[] = [];
  const speed: number[] = [];
  const lap: number[] = [];
  let t = 0;
  speeds.forEach((profile, li) => {
    for (const v of profile) {
      time.push(t);
      speed.push(v);
      lap.push(li + 1);
      t += dt;
    }
  });
  const distance = integrateSpeed(speed, time);
  const laps = lapsFromColumn(lap, time, distance);
  return { channels: { time, speed, distance, lap }, origins: { speed: 'measured' }, laps };
}

describe('voltas e tempos', () => {
  it('tempo de volta pela coluna de volta', () => {
    const src = source([Array(100).fill(20), Array(110).fill(20), Array(100).fill(20)]);
    expect(src.laps).toHaveLength(3);
    expect(src.laps[0].lapTime).toBeCloseTo(9.95, 2);
    expect(src.laps[1].lapTime).toBeCloseTo(11, 2);
  });

  it('linha de chegada com interpolação do instante de cruzamento', () => {
    // círculo de raio 50 m a 10 m/s, 3 voltas
    const x: number[] = [];
    const y: number[] = [];
    const t: number[] = [];
    const period = (2 * Math.PI * 50) / 10;
    for (let i = 0; i <= 3 * period * 10; i++) {
      const tt = i / 10;
      const a = (tt / period) * 2 * Math.PI;
      x.push(50 * Math.cos(a));
      y.push(50 * Math.sin(a));
      t.push(tt);
    }
    const c = gateCrossings(x, y, t, { x: 0, y: 50, hx: -1, hy: 0, width: 10 });
    expect(c.length).toBe(3);
    expect(c[1] - c[0]).toBeCloseTo(period, 2);
  });

  it('divisão pelo comprimento da pista', () => {
    const time = Array.from({ length: 301 }, (_, i) => i);
    const dist = time.map((s) => s * 10);
    const laps = lapsFromTrackLength(dist, time, 1000);
    expect(laps).toHaveLength(3);
    expect(laps[0].lapTime).toBeCloseTo(100);
  });

  it('marca volta de saída como suspeita', () => {
    const base = (n: number, time: number): Lap => ({ number: n, startIdx: 0, endIdx: 1, startTime: 0, endTime: time, lapTime: time, distance: 1000, flagged: false, included: true });
    const laps = flagLaps([base(1, 60), base(2, 45), base(3, 45.3), base(4, 45.1)]);
    expect(laps[0].flagged).toBe(true);
    expect(laps[0].included).toBe(false);
    expect(laps.slice(1).every((l) => l.included)).toBe(true);
  });

  it('consistência: desvio-padrão amostral', () => {
    const c = consistency([45, 46, 47]);
    expect(c.std).toBeCloseTo(1);
    expect(c.range).toBe(2);
  });
});

describe('comparação de voltas', () => {
  it('delta acumulado termina na diferença de tempo de volta e localiza a perda', () => {
    // Volta 2 é mais lenta apenas na segunda metade.
    const v1 = Array(200).fill(20);
    const v2 = [...Array(100).fill(20), ...Array(110).fill(18.18)];
    const src = source([v1, v2]);
    const r = resampleLap(src, src.laps[0], 400)!;
    const c = resampleLap(src, src.laps[1], 400)!;
    const half: Segment[] = [
      { id: 'a', name: 'A', kind: 'straight', start: 0, end: 0.5, source: 'manual' },
      { id: 'b', name: 'B', kind: 'straight', start: 0.5, end: 1, source: 'manual' },
    ];
    const cmp = compareLaps(r, c, half);
    expect(cmp.delta[cmp.delta.length - 1]).toBeCloseTo(cmp.totalDelta, 6);
    expect(Math.abs(cmp.segments[0].timeDelta)).toBeLessThan(0.06);
    expect(cmp.segments[1].timeDelta).toBeGreaterThan(0.8);
    expect(segmentTime(r, half[0]) + segmentTime(r, half[1])).toBeCloseTo(r.lapTime, 6);
    const st = speedStats(r);
    expect(st.avg).toBeCloseTo(r.distance / r.lapTime);
  });
});

describe('sincronização de vídeo', () => {
  it('um ponto: deslocamento; dois pontos: corrige deriva', () => {
    expect(videoToTelemetry(fitSync([{ videoTime: 5, telemetryTime: 15 }])!, 7)).toBe(17);
    const m = fitSync([{ videoTime: 0, telemetryTime: 10 }, { videoTime: 100, telemetryTime: 110.1 }])!;
    expect(m.rate).toBeCloseTo(1.001);
    expect(videoToTelemetry(m, 50)).toBeCloseTo(60.05);
  });
});

describe('engenheiro: intenção', () => {
  it('classifica perguntas sugeridas', () => {
    expect(matchIntent('Onde perdi mais tempo?')).toBe('time-loss');
    expect(matchIntent('Qual foi minha melhor volta?')).toBe('best-lap');
    expect(matchIntent('Compare minhas duas melhores voltas.')).toBe('compare-top-two');
    expect(matchIntent('Em qual segmento fui mais consistente?')).toBe('consistency');
    expect(matchIntent('O que devo testar na próxima sessão?')).toBe('next-session');
    expect(matchIntent('Como evoluiu minha performance?')).toBe('evolution');
    expect(matchIntent('Qual curva merece atenção primeiro?')).toBe('priority');
    expect(matchIntent('Onde perdi velocidade?')).toBe('speed-loss');
  });
});
