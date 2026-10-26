import { useEffect, useId, useState } from 'react';
import './SplashScreen.css';

const INTRO_DURATION = 2500;
const EXIT_DURATION = 420;

function WatchMark() {
  const id = useId();

  return (
    <svg className="family-splash__mark" viewBox="0 0 144 144" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-tile`} x1="18" y1="8" x2="126" y2="144" gradientUnits="userSpaceOnUse">
          <stop stopColor="#79F4AC" />
          <stop offset=".42" stopColor="#14BC7F" />
          <stop offset="1" stopColor="#006348" />
        </linearGradient>
        <linearGradient id={`${id}-edge`} x1="20" y1="0" x2="120" y2="144" gradientUnits="userSpaceOnUse">
          <stop stopColor="#D3FFE5" />
          <stop offset=".5" stopColor="#8FFFC3" stopOpacity=".65" />
          <stop offset="1" stopColor="#4EDB9C" stopOpacity=".25" />
        </linearGradient>
        <radialGradient id={`${id}-shine`} cx="0" cy="0" r="1" gradientTransform="translate(35 12) rotate(54) scale(118)" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" stopOpacity=".35" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="3" y="3" width="138" height="138" rx="38" fill={`url(#${id}-tile)`} />
      <rect x="3" y="3" width="138" height="138" rx="38" fill={`url(#${id}-shine)`} />
      <rect x="3" y="3" width="138" height="138" rx="38" stroke={`url(#${id}-edge)`} strokeWidth="1.5" />
      <rect x="8" y="8" width="128" height="128" rx="33" stroke="white" strokeOpacity=".1" />
      <g className="family-splash__watch" stroke="#F1FFF7" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        <path className="family-splash__strap" d="M58 35L61 25C61.5 23 63 22 65 22H79C81 22 82.5 23 83 25L86 35M58 109L61 119C61.5 121 63 122 65 122H79C81 122 82.5 121 83 119L86 109" fill="#F1FFF7" fillOpacity=".9" />
        <rect className="family-splash__case" x="44" y="35" width="56" height="74" rx="17" pathLength="1" />
        <path d="M104 58V69" strokeOpacity=".7" />
        <path className="family-splash__pin" d="M72 92S88 78 88 65C88 56.2 80.8 49 72 49S56 56.2 56 65C56 78 72 92 72 92Z" fill="#F1FFF7" strokeWidth="1.5" />
      </g>
      <circle className="family-splash__pin-center" cx="72" cy="64" r="5.5" fill="#089A67" />
      <path className="family-splash__heartbeat" d="M55 82H63L67 75L73 89L78 80H88" stroke="#078C61" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" pathLength="1" />
    </svg>
  );
}

export default function SplashScreen({ ready, onComplete }) {
  const [introFinished, setIntroFinished] = useState(false);
  const [takingLonger, setTakingLonger] = useState(false);
  const [reducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const exiting = introFinished && ready;

  useEffect(() => {
    const introTimer = window.setTimeout(() => setIntroFinished(true), reducedMotion ? 150 : INTRO_DURATION);
    const waitingTimer = window.setTimeout(() => setTakingLonger(true), 6500);
    const themeColor = document.querySelector('meta[name="theme-color"]');
    const previousThemeColor = themeColor?.content;
    if (themeColor) themeColor.content = '#041C16';

    return () => {
      window.clearTimeout(introTimer);
      window.clearTimeout(waitingTimer);
      if (themeColor) themeColor.content = previousThemeColor;
    };
  }, [reducedMotion]);

  useEffect(() => {
    if (!exiting) return;
    const exitTimer = window.setTimeout(() => onComplete(true), reducedMotion ? 100 : EXIT_DURATION);
    return () => window.clearTimeout(exitTimer);
  }, [exiting, onComplete, reducedMotion]);

  return (
    <main className={`family-splash${exiting ? ' family-splash--exiting' : ''}`} aria-label="Welcome to SafeWatch" inert={exiting}>
      <div className="family-splash__atmosphere" aria-hidden="true">
        <div className="family-splash__aurora family-splash__aurora--one" />
        <div className="family-splash__aurora family-splash__aurora--two" />
        <div className="family-splash__grid" />
      </div>

      <p className="family-splash__eyebrow"><span /> A little closer, even from afar <span /></p>

      <div className="family-splash__identity">
        <div className="family-splash__emblem" aria-hidden="true">
          <div className="family-splash__halo" />
          <div className="family-splash__orbit family-splash__orbit--outer"><span /></div>
          <div className="family-splash__orbit family-splash__orbit--inner"><span /></div>
          <span className="family-splash__spark family-splash__spark--one" />
          <span className="family-splash__spark family-splash__spark--two" />
          <div className="family-splash__tile"><WatchMark /></div>
        </div>

        <h1 className="family-splash__name">Safe<span>Watch</span><span className="family-splash__name-dot">.</span></h1>
        <p className="family-splash__descriptor">Family monitoring for seniors</p>
        <p className="family-splash__promise">Care that stays close.</p>
      </div>

      <div className="family-splash__footer">
        <div className="family-splash__status" role="status" aria-live="polite">
          <span className="family-splash__status-dot" aria-hidden="true" />
          {ready ? 'Opening your family space' : takingLonger ? 'Still getting things ready…' : 'Getting things ready…'}
        </div>
        <div className="family-splash__loading" aria-hidden="true"><span /></div>
        <button className="family-splash__skip" type="button" onClick={() => setIntroFinished(true)} disabled={introFinished}>
          {introFinished && !ready ? 'Checking your account…' : 'Skip intro'}
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 10H16M11 5L16 10L11 15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
    </main>
  );
}
