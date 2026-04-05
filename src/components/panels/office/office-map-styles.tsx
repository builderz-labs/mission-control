'use client'

// Keyframe animations for the office map atmospheric effects.
// Isolated here so they don't inflate the main panel shell.

export function OfficeMapStyles(): React.ReactElement {
  return (
    <style jsx>{`
      @keyframes mcSunSweep {
        0%   { transform: translateX(-10%) translateY(-2%); opacity: 0.34; }
        50%  { transform: translateX(8%)   translateY(2%);  opacity: 0.56; }
        100% { transform: translateX(-10%) translateY(-2%); opacity: 0.34; }
      }
      @keyframes mcSunSweepReverse {
        0%   { transform: translateX(8%)  translateY(2%);  opacity: 0.18; }
        50%  { transform: translateX(-8%) translateY(-2%); opacity: 0.32; }
        100% { transform: translateX(8%)  translateY(2%);  opacity: 0.18; }
      }
      @keyframes mcDuskPulse {
        0%   { opacity: 0.28; transform: scale(1);    }
        50%  { opacity: 0.52; transform: scale(1.03); }
        100% { opacity: 0.28; transform: scale(1);    }
      }
      @keyframes mcNightBloom {
        0%   { opacity: 0.25; }
        50%  { opacity: 0.5;  }
        100% { opacity: 0.25; }
      }
      @keyframes mcTwinkle {
        0%   { opacity: 0.25; transform: scale(0.9);  }
        50%  { opacity: 1;    transform: scale(1.15); }
        100% { opacity: 0.25; transform: scale(0.9);  }
      }
    `}</style>
  )
}
