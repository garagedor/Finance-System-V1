'use client';

interface LoadingOverlayProps {
  message?: string;
  fullPage?: boolean;
}

export function LoadingOverlay({ message, fullPage = false }: LoadingOverlayProps) {
  return (
    <div className={`loading-overlay ${fullPage ? 'loading-overlay--fullpage' : ''}`}>
      <div className="loading-content">
        <div className="dots-loader">
          <span className="dot"></span>
          <span className="dot"></span>
          <span className="dot"></span>
        </div>
        {message && <p className="loading-text">{message}</p>}
      </div>

      <style jsx>{`
        .loading-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(10, 15, 28, 0.82);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          z-index: 100;
          border-radius: inherit;
        }

        .loading-overlay--fullpage {
          position: fixed;
          border-radius: 0;
        }

        .loading-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
        }

        .dots-loader {
          display: flex;
          gap: 7px;
        }

        .dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          animation: bounce 1.3s ease-in-out infinite;
          box-shadow: 0 0 12px rgba(99, 102, 241, 0.5);
        }

        .dot:nth-child(1) { animation-delay: 0s; }
        .dot:nth-child(2) { animation-delay: 0.15s; }
        .dot:nth-child(3) { animation-delay: 0.30s; }

        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0) scale(1); }
          40% {
            transform: translateY(-12px) scale(1.1);
            box-shadow: 0 0 20px rgba(99, 102, 241, 0.6);
          }
        }

        .loading-text {
          margin: 0;
          font-size: 13px;
          font-weight: 500;
          color: #64748b;
          letter-spacing: 0.3px;
        }
      `}</style>
    </div>
  );
}

export default LoadingOverlay;
