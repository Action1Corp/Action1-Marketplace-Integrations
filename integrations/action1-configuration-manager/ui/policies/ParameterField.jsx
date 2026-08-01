import {
  compactCheckboxStyle,
  formControlStyle,
  helperTextStyle,
  textareaControlStyle
} from './policyUiStyles.js';

const styles = {
  fieldStack: {
    display: 'grid',
    gap: '0.35rem'
  },
  label: {
    color: '#1f3448',
    fontSize: '0.9rem',
    fontWeight: 500
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.55rem'
  },
  helpText: {
    ...helperTextStyle
  },
  errorText: {
    margin: 0,
    color: '#b42318',
    fontSize: '0.84rem'
  }
};

function renderCheckbox(parameter, value, onChange, disabled) {
  return (
    <label style={{ ...styles.fieldStack, ...styles.checkboxLabel }}>
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        style={compactCheckboxStyle}
      />
      <span style={styles.label}>{parameter.label}</span>
    </label>
  );
}

function renderIntegerInput(parameter, value, onChange, disabled) {
  return (
    <label style={styles.fieldStack}>
      <span style={styles.label}>{parameter.label}</span>
      <input
        type="number"
        value={value}
        min={parameter.minimum}
        max={parameter.maximum}
        step={parameter.step || 1}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        style={formControlStyle}
      />
    </label>
  );
}

function renderEnumInput(parameter, value, onChange, disabled) {
  return (
    <label style={styles.fieldStack}>
      <span style={styles.label}>{parameter.label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} style={formControlStyle}>
        {(parameter.options || []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function renderStringInput(parameter, value, onChange, disabled) {
  return (
    <label style={styles.fieldStack}>
      <span style={styles.label}>{parameter.label}</span>
      <input
        type="text"
        value={value}
        minLength={parameter.minimumLength}
        maxLength={parameter.maximumLength}
        placeholder={parameter.placeholder}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        style={formControlStyle}
      />
    </label>
  );
}

function renderMultilineStringInput(parameter, value, onChange, disabled) {
  return (
    <label style={styles.fieldStack}>
      <span style={styles.label}>{parameter.label}</span>
      <textarea
        value={value}
        rows={parameter.rows || 4}
        minLength={parameter.minimumLength}
        maxLength={parameter.maximumLength}
        placeholder={parameter.placeholder}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        style={textareaControlStyle}
      />
    </label>
  );
}

function renderTimeInput(parameter, value, onChange, disabled) {
  return (
    <label style={styles.fieldStack}>
      <span style={styles.label}>{parameter.label}</span>
      <input type="time" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} style={formControlStyle} />
    </label>
  );
}

function ParameterField({ parameter, value, onChange, disabled = false, errorMessage = '' }) {
  let input = null;

  switch (parameter.type) {
    case 'boolean':
      input = renderCheckbox(parameter, value, onChange, disabled);
      break;
    case 'integer':
      input = renderIntegerInput(parameter, value, onChange, disabled);
      break;
    case 'enum':
      input = renderEnumInput(parameter, value, onChange, disabled);
      break;
    case 'string':
      input = renderStringInput(parameter, value, onChange, disabled);
      break;
    case 'multiline-string':
      input = renderMultilineStringInput(parameter, value, onChange, disabled);
      break;
    case 'time':
      input = renderTimeInput(parameter, value, onChange, disabled);
      break;
    default:
      return (
        <div className="policy-parameter-field policy-parameter-field-error" role="alert">
          Unsupported parameter type: {parameter.type}
        </div>
      );
  }

  return (
    <div className="policy-parameter-field" style={styles.fieldStack}>
      {input}
      {parameter.description ? <p className="policy-help-text" style={styles.helpText}>{parameter.description}</p> : null}
      {errorMessage ? (
        <p className="policy-error-text" role="alert" style={styles.errorText}>
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

export default ParameterField;
