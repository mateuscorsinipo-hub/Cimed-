/**
 * Ilustração técnica (vista superior) de um kart de competição numa curva com zebra.
 * Desenho vetorial próprio — não é fotografia nem representa uma pista real.
 */
export function KartIllustration({ className }: { className?: string }) {
  const kerb = Array.from({ length: 14 }, (_, i) => i);
  return (
    <svg viewBox="0 0 640 360" className={className} role="img" aria-labelledby="kart-ill-title">
      <title id="kart-ill-title">Ilustração técnica de um kart de competição em vista superior, contornando uma curva com zebra</title>
      <defs>
        <linearGradient id="asphalt" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#16191E" />
          <stop offset="1" stopColor="#0E1013" />
        </linearGradient>
        <pattern id="grain" width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.6" fill="#ffffff" opacity="0.035" />
          <circle cx="4" cy="3.5" r="0.5" fill="#ffffff" opacity="0.03" />
        </pattern>
        <linearGradient id="body" x1="0" x2="1">
          <stop offset="0" stopColor="#C6F432" />
          <stop offset="1" stopColor="#9BC21F" />
        </linearGradient>
      </defs>
      <rect width="640" height="360" fill="#0B0C0F" />
      {/* pista */}
      <path d="M-20 300 C 160 300, 300 290, 380 220 S 470 60, 660 40 L 660 170 C 540 180, 500 250, 450 300 S 300 380, -20 400 Z" fill="url(#asphalt)" />
      <path d="M-20 300 C 160 300, 300 290, 380 220 S 470 60, 660 40 L 660 170 C 540 180, 500 250, 450 300 S 300 380, -20 400 Z" fill="url(#grain)" />
      {/* zebra interna */}
      {kerb.map((i) => {
        const t = i / 13;
        const x = 250 + t * 210;
        const y = 296 - Math.sin(t * Math.PI * 0.9) * 40 - t * 150;
        return <rect key={i} x={x} y={y} width="16" height="7" rx="1" fill={i % 2 ? '#F2F4F7' : '#FF4F4F'} transform={`rotate(${-38 + t * 10} ${x} ${y})`} opacity="0.9" />;
      })}
      {/* linha de trajetória */}
      <path d="M0 352 C 170 350, 300 330, 395 255 S 500 118, 660 105" fill="none" stroke="#C6F432" strokeWidth="2" strokeDasharray="6 6" opacity="0.55" />
      {/* kart (vista superior) */}
      <g transform="translate(372 238) rotate(-38)">
        {/* pneus traseiros */}
        <rect x="-62" y="-44" width="30" height="20" rx="4" fill="#07080A" stroke="#323844" />
        <rect x="-62" y="24" width="30" height="20" rx="4" fill="#07080A" stroke="#323844" />
        {/* pneus dianteiros */}
        <rect x="34" y="-38" width="24" height="15" rx="4" fill="#07080A" stroke="#323844" transform="rotate(-8 46 -30)" />
        <rect x="34" y="23" width="24" height="15" rx="4" fill="#07080A" stroke="#323844" transform="rotate(-8 46 30)" />
        {/* chassi tubular */}
        <path d="M-50 -24 L 44 -20 M -50 24 L 44 20 M -50 -24 L -50 24 M 44 -20 L 44 20 M -30 -24 L 20 21 M -47 -30 L -47 -24 M -47 30 L -47 24" stroke="#6B7382" strokeWidth="2.2" fill="none" />
        {/* eixo traseiro */}
        <line x1="-47" y1="-36" x2="-47" y2="36" stroke="#9AA3B2" strokeWidth="3" />
        {/* carenagens laterais */}
        <rect x="-26" y="-34" width="44" height="10" rx="4" fill="url(#body)" opacity="0.92" />
        <rect x="-26" y="24" width="44" height="10" rx="4" fill="url(#body)" opacity="0.92" />
        {/* bico */}
        <path d="M 46 -18 Q 70 -16 72 0 Q 70 16 46 18 Z" fill="url(#body)" />
        {/* banco e piloto */}
        <rect x="-36" y="-13" width="30" height="26" rx="8" fill="#1B1F26" stroke="#323844" />
        <circle cx="-14" cy="0" r="12" fill="#F2F4F7" />
        <path d="M -6 -8 A 12 12 0 0 1 -6 8" stroke="#0B0C0F" strokeWidth="5" fill="none" />
        {/* volante */}
        <circle cx="10" cy="0" r="8" fill="none" stroke="#9AA3B2" strokeWidth="2.4" />
        {/* motor */}
        <rect x="-44" y="12" width="16" height="14" rx="2" fill="#323844" />
      </g>
      {/* cotas técnicas */}
      <g stroke="#4DA3FF" strokeWidth="1" fill="#4DA3FF" fontFamily="JetBrains Mono, monospace" fontSize="10" opacity="0.85">
        <line x1="300" y1="150" x2="356" y2="196" strokeDasharray="3 3" />
        <circle cx="356" cy="196" r="2.5" />
        <text x="232" y="144" stroke="none">ÁPICE · EXEMPLO</text>
        <line x1="520" y1="250" x2="470" y2="212" strokeDasharray="3 3" />
        <text x="480" y="266" stroke="none">SAÍDA</text>
      </g>
    </svg>
  );
}
