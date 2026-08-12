export const policyUiTokens = {
  accent: '#2563eb',
  accentHover: '#1d4ed8',
  accentBackground: '#eff6ff',
  accentBorder: '#bfdbfe',
  success: '#4d7c0f',
  successBackground: '#ecfccb',
  danger: '#b91c1c',
  dangerSoftBorder: '#f1c0c4',
  dangerSoftBackground: '#fff4f5',
  textPrimary: '#1f2328',
  textSecondary: '#57606a',
  textMuted: '#8b949e',
  pageBackground: '#f6f8fa',
  surfaceBackground: '#ffffff',
  mutedBackground: '#f6f8fa',
  lockedBackground: '#f6f8fa',
  borderColor: '#e4e8ec',
  inputBorderColor: '#cfd6dd',
  controlHeight: 34,
  radius: 4,
  surfaceRadius: 8,
  shadowOverlay: '0 18px 48px rgba(15, 23, 42, 0.12)',
  fontSizes: {
    title: 18,
    section: 15,
    body: 14,
    label: 13,
    hint: 12
  }
};

export const pageSurfaceStyle = {
  background: policyUiTokens.surfaceBackground,
  border: `1px solid ${policyUiTokens.borderColor}`,
  borderRadius: policyUiTokens.surfaceRadius
};

export const sectionDividerStyle = {
  border: 'none',
  borderTop: `1px solid ${policyUiTokens.borderColor}`,
  margin: 0
};

export const buttonBaseStyle = {
  minHeight: policyUiTokens.controlHeight,
  borderRadius: 4,
  padding: '0.5rem 0.85rem',
  fontSize: policyUiTokens.fontSizes.label,
  fontWeight: 600,
  lineHeight: 1.2,
  cursor: 'pointer',
  transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease',
  fontFamily: 'inherit'
};

export const secondaryButtonStyle = {
  ...buttonBaseStyle,
  border: `1px solid ${policyUiTokens.inputBorderColor}`,
  background: policyUiTokens.surfaceBackground,
  color: policyUiTokens.textPrimary
};

export const primaryButtonStyle = {
  ...buttonBaseStyle,
  border: `1px solid ${policyUiTokens.accent}`,
  background: policyUiTokens.accent,
  color: '#ffffff'
};

export const destructiveButtonStyle = {
  ...buttonBaseStyle,
  border: `1px solid ${policyUiTokens.inputBorderColor}`,
  background: policyUiTokens.surfaceBackground,
  color: policyUiTokens.danger
};

export const destructivePrimaryButtonStyle = {
  ...buttonBaseStyle,
  border: `1px solid ${policyUiTokens.danger}`,
  background: policyUiTokens.danger,
  color: '#ffffff'
};

export const textLinkButtonStyle = {
  border: 'none',
  background: 'transparent',
  color: policyUiTokens.accent,
  padding: 0,
  cursor: 'pointer',
  fontSize: policyUiTokens.fontSizes.label,
  fontWeight: 500,
  textAlign: 'left'
};

export const menuTriggerButtonStyle = {
  width: policyUiTokens.controlHeight,
  height: policyUiTokens.controlHeight,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: `1px solid ${policyUiTokens.inputBorderColor}`,
  borderRadius: 4,
  background: policyUiTokens.surfaceBackground,
  color: policyUiTokens.textSecondary,
  cursor: 'pointer',
  fontSize: 18,
  lineHeight: 1
};

export const formControlStyle = {
  width: '100%',
  minHeight: policyUiTokens.controlHeight,
  border: `1px solid ${policyUiTokens.inputBorderColor}`,
  borderRadius: 4,
  padding: '0.5rem 0.65rem',
  background: policyUiTokens.surfaceBackground,
  color: policyUiTokens.textPrimary,
  boxSizing: 'border-box',
  font: 'inherit',
  fontSize: policyUiTokens.fontSizes.body
};

export const readOnlyControlStyle = {
  ...formControlStyle,
  background: policyUiTokens.lockedBackground,
  color: policyUiTokens.textSecondary
};

export const disabledControlStyle = {
  ...formControlStyle,
  background: policyUiTokens.mutedBackground,
  color: policyUiTokens.textMuted,
  cursor: 'not-allowed'
};

export const textareaControlStyle = {
  ...formControlStyle,
  minHeight: 88,
  resize: 'vertical'
};

export const helperTextStyle = {
  margin: 0,
  color: policyUiTokens.textMuted,
  fontSize: policyUiTokens.fontSizes.hint,
  lineHeight: 1.45
};

export const compactCheckboxStyle = {
  width: 15,
  height: 15,
  margin: '0.05rem 0 0',
  accentColor: policyUiTokens.accent,
  flex: '0 0 auto'
};

export const statusBadgeBaseStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '0.2rem 0.45rem',
  borderRadius: 999,
  fontSize: policyUiTokens.fontSizes.hint,
  fontWeight: 600,
  lineHeight: 1
};

export const scheduleChipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0.2rem 0.45rem',
  border: `1px solid ${policyUiTokens.borderColor}`,
  borderRadius: 4,
  background: policyUiTokens.mutedBackground,
  color: policyUiTokens.textSecondary,
  fontSize: policyUiTokens.fontSizes.hint,
  lineHeight: 1.2,
  fontFamily: 'ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace',
  whiteSpace: 'nowrap'
};

export const parameterChipStyle = {
  ...scheduleChipStyle,
  color: policyUiTokens.textPrimary
};

export function getStatusBadgeStyle(enabled) {
  if (enabled) {
    return {
      ...statusBadgeBaseStyle,
      background: policyUiTokens.successBackground,
      color: policyUiTokens.success
    };
  }

  return {
    ...statusBadgeBaseStyle,
    background: policyUiTokens.mutedBackground,
    color: policyUiTokens.textSecondary
  };
}

export const modeBadgeStyle = {
  ...statusBadgeBaseStyle,
  background: policyUiTokens.accentBackground,
  color: policyUiTokens.accent
};
