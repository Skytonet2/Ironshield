"use client";

export default function AnimatedMascot({ src = "/mascot.png", size = 360, alt = "IronShield mascot" }) {
  return (
    <div
      style={{
        width: size,
        maxWidth: "100%",
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <style>{`
        @keyframes ix-mascot-float {
          0%, 100% { transform: translateY(0px) rotate(-1.5deg); }
          50% { transform: translateY(-10px) rotate(1.5deg); }
        }
        @keyframes ix-mascot-breathe {
          0%, 100% { filter: drop-shadow(0 10px 18px rgba(15,23,42,0.32)); }
          50% { filter: drop-shadow(0 16px 26px rgba(59,130,246,0.35)); }
        }
        @keyframes ix-mascot-shield-shimmer {
          0%, 100% { opacity: .18; transform: translateX(-16%) skewX(-15deg); }
          50% { opacity: .38; transform: translateX(18%) skewX(-15deg); }
        }
        .ix-mascot-wrap {
          position: relative;
          width: 100%;
          animation: ix-mascot-float 3.4s ease-in-out infinite, ix-mascot-breathe 2.8s ease-in-out infinite;
          transform-origin: 50% 70%;
          transition: transform .2s ease;
        }
        .ix-mascot-wrap:hover {
          transform: translateY(-4px) scale(1.02);
        }
        .ix-mascot-glint {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
          border-radius: 14px;
        }
        .ix-mascot-glint::after {
          content: "";
          position: absolute;
          top: 0;
          left: 22%;
          width: 26%;
          height: 100%;
          background: linear-gradient(110deg, transparent 0%, rgba(255,255,255,.35) 48%, transparent 100%);
          animation: ix-mascot-shield-shimmer 2.4s ease-in-out infinite;
        }
      `}</style>

      <div className="ix-mascot-wrap">
        <img
          src={src}
          alt={alt}
          style={{
            width: "100%",
            height: "auto",
            objectFit: "contain",
            userSelect: "none",
            WebkitUserDrag: "none",
          }}
        />
        <div className="ix-mascot-glint" />
      </div>
    </div>
  );
}

