type SnackbarState = { message: string; type: 'success' | 'error' } | null;

type Props = {
  snackbar: SnackbarState;
};

export function Snackbar({ snackbar }: Props) {
  if (!snackbar) return null;

  return (
    <div className={`snackbar ${snackbar.type}`}>
      <span className="snackbar-icon" aria-hidden="true">
        {snackbar.type === 'success' ? '✓' : '!'}
      </span>
      <span className="snackbar-message">{snackbar.message}</span>
      <span className="snackbar-progress" />

      <style jsx>{`
        .snackbar {
          position: fixed;
          bottom: 24px;
          left: 50%;
          padding: 12px 20px 14px;
          border-radius: 12px;
          color: white;
          font-weight: 600;
          font-size: 13.5px;
          box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5);
          z-index: 1100;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          display: inline-flex;
          align-items: center;
          gap: 10px;
          min-width: 240px;
          max-width: 480px;
          overflow: hidden;
          animation: snackbarIn 0.32s cubic-bezier(0.22, 1, 0.36, 1);
        }

        @keyframes snackbarIn {
          from { opacity: 0; transform: translate(-50%, 16px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }

        .snackbar.success {
          background: linear-gradient(135deg, rgba(5,150,105,0.95), rgba(16,185,129,0.95));
          border: 1px solid rgba(16, 185, 129, 0.4);
        }

        .snackbar.error {
          background: linear-gradient(135deg, rgba(220,38,38,0.95), rgba(239,68,68,0.95));
          border: 1px solid rgba(239, 68, 68, 0.4);
        }

        .snackbar-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.18);
          font-weight: 800;
          font-size: 13px;
          flex-shrink: 0;
        }

        .snackbar-message {
          flex: 1;
        }

        .snackbar-progress {
          position: absolute;
          left: 0;
          bottom: 0;
          height: 3px;
          width: 100%;
          background: rgba(255, 255, 255, 0.4);
          transform-origin: left;
          animation: snackbarProgress 2.8s linear forwards;
        }

        @keyframes snackbarProgress {
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
      `}</style>
    </div>
  );
}
