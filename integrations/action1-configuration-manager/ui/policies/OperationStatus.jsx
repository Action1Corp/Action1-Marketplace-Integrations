import { policyUiTokens, pageSurfaceStyle } from './policyUiStyles.js';

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'grid',
    placeItems: 'center',
    padding: '1rem',
    background: 'rgba(15, 23, 42, 0.22)'
  },
  panel: {
    ...pageSurfaceStyle,
    display: 'flex',
    alignItems: 'center',
    gap: '0.55rem',
    minWidth: 220,
    padding: '0.9rem 1rem',
    color: policyUiTokens.textPrimary,
    boxShadow: policyUiTokens.shadowOverlay
  },
  spinner: {
    width: 14,
    height: 14,
    border: `2px solid ${policyUiTokens.borderColor}`,
    borderTopColor: policyUiTokens.accent,
    borderRadius: '50%',
    animation: 'a1cm-operation-spin 0.8s linear infinite'
  }
};

export default function OperationStatus({ label }) {
  if (!label) return null;
  return (
    <div role="status" aria-live="polite" aria-busy="true" style={styles.overlay}>
      <style>{`
        @keyframes a1cm-operation-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .a1cm-operation-spinner { animation-duration: 1.6s; }
        }
      `}</style>
      <div role="presentation" style={styles.panel}>
        <span className="a1cm-operation-spinner" aria-hidden="true" style={styles.spinner} />
        <span>{label}</span>
      </div>
    </div>
  );
}
