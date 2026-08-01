export const buttonBaseStyle = {
  borderRadius: 10,
  padding: '0.62rem 0.92rem',
  fontSize: '0.95rem',
  fontWeight: 500,
  lineHeight: 1.2,
  cursor: 'pointer',
  transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease'
};

export const secondaryButtonStyle = {
  ...buttonBaseStyle,
  border: '1px solid #c7d2de',
  background: '#ffffff',
  color: '#13304b'
};

export const primaryButtonStyle = {
  ...buttonBaseStyle,
  border: '1px solid #2563eb',
  background: '#2563eb',
  color: '#ffffff',
  fontWeight: 600
};

export const destructiveButtonStyle = {
  ...buttonBaseStyle,
  border: '1px solid #d13f4b',
  background: '#ffffff',
  color: '#b42318'
};

export const destructivePrimaryButtonStyle = {
  ...buttonBaseStyle,
  border: '1px solid #d13f4b',
  background: '#d13f4b',
  color: '#ffffff',
  fontWeight: 600
};

export const textLinkButtonStyle = {
  border: 'none',
  background: 'transparent',
  color: '#2563eb',
  padding: 0,
  cursor: 'pointer',
  fontSize: '0.93rem',
  fontWeight: 500,
  textAlign: 'left'
};

export const menuTriggerButtonStyle = {
  width: 34,
  height: 34,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid #c7d2de',
  borderRadius: 10,
  background: '#ffffff',
  color: '#3b5168',
  cursor: 'pointer',
  fontSize: '1.1rem',
  lineHeight: 1
};

export const formControlStyle = {
  width: '100%',
  minHeight: 40,
  border: '1px solid #c7d2de',
  borderRadius: 10,
  padding: '0.58rem 0.72rem',
  background: '#ffffff',
  color: '#13304b',
  boxSizing: 'border-box',
  font: 'inherit'
};

export const readOnlyControlStyle = {
  ...formControlStyle,
  borderColor: '#d7e0ea',
  background: '#f7faff',
  color: '#4b6278'
};

export const disabledControlStyle = {
  ...formControlStyle,
  borderColor: '#dde4ed',
  background: '#f5f7fa',
  color: '#7a8ea4',
  cursor: 'not-allowed'
};

export const textareaControlStyle = {
  ...formControlStyle,
  minHeight: 96,
  resize: 'vertical'
};

export const helperTextStyle = {
  margin: 0,
  color: '#4a627d',
  fontSize: '0.84rem',
  lineHeight: 1.45
};

export const compactCheckboxStyle = {
  width: 16,
  height: 16,
  margin: '0.1rem 0 0',
  accentColor: '#2563eb',
  flex: '0 0 auto'
};
