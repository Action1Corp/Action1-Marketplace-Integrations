import { useEffect, useMemo, useState } from 'react';
import {
  countExpectedAutomations,
  findBaselineById,
  getRecommendedParametersForBaselineControl
} from '../catalog/controlPackCatalog.js';
import {
  applyBaselineSelection,
  applyControlSelection,
  clearAllSelectedControls,
  createInitialWizardState,
  updateCompletionDeadline,
  updateRunEveryHours,
  updateControlParameter
} from './policyEditorState.js';
import {
  buildControlsTreeViewModel,
  buildReviewViewModel,
  getInitialOpenCategories
} from './policyWizardViewModel.js';
import { validatePolicyDraft } from './policyValidation.js';
import { deriveDisplayName, formatParameterValue } from './policyViewModel.js';
import CompactControlSummaryGroups from './CompactControlSummaryGroups.jsx';

const WIZARD_STEPS = [
  { number: 1, label: 'Details & Target' },
  { number: 2, label: 'Mode' },
  { number: 3, label: 'Controls' },
  { number: 4, label: 'Review' }
];

const WIZARD_CSS = `
.a1-policy-wizard {
  --accent: #2563eb;
  --accent-hover: #1d4ed8;
  --accent-bg: #eff6ff;
  --accent-border: #bfdbfe;
  --danger: #b91c1c;
  --danger-bg: #fee2e2;
  --text: #1f2328;
  --text-2: #57606a;
  --text-3: #8b949e;
  --bg-card: #ffffff;
  --bg-muted: #f6f8fa;
  --border: #e4e8ec;
  --border-input: #cfd6dd;
  --radius: 4px;
  --radius-card: 8px;
  --fs-title: 18px;
  --fs-section: 15px;
  --fs-body: 14px;
  --fs-label: 13px;
  --fs-hint: 12px;
  --font: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace;
  font-family: var(--font);
  font-size: var(--fs-body);
  color: var(--text);
  line-height: 1.45;
}
.a1-policy-wizard, .a1-policy-wizard * { box-sizing: border-box; }
.a1-policy-wizard .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-card); padding: 24px 28px; }
.a1-policy-wizard .card-title { font-size: var(--fs-title); font-weight: 600; margin: 0; }
.a1-policy-wizard .card-sub { font-size: var(--fs-hint); color: var(--text-3); margin: 4px 0 0; }
.a1-policy-wizard .stepper { display: flex; align-items: center; gap: 8px; margin: 20px 0 24px; border-bottom: 1px solid var(--border); padding-bottom: 20px; }
.a1-policy-wizard .step { display: flex; align-items: center; gap: 8px; font-size: var(--fs-label); color: var(--text-3); cursor: default; background: none; border: none; padding: 0; font-family: inherit; }
.a1-policy-wizard .step .num { width: 24px; height: 24px; flex: none; border-radius: 50%; border: 1px solid var(--border-input); display: inline-flex; align-items: center; justify-content: center; font-size: var(--fs-hint); font-weight: 600; background: var(--bg-card); }
.a1-policy-wizard .step.active { color: var(--text); font-weight: 600; }
.a1-policy-wizard .step.active .num { background: var(--accent); border-color: var(--accent); color: #fff; }
.a1-policy-wizard .step.done { color: var(--text-2); cursor: pointer; }
.a1-policy-wizard .step.done .num { background: var(--accent-bg); border-color: var(--accent-border); color: var(--accent); }
.a1-policy-wizard .step.done:hover { color: var(--text); }
.a1-policy-wizard .step-sep { flex: 1; height: 1px; background: var(--border); min-width: 16px; }
.a1-policy-wizard .pane { display: none; }
.a1-policy-wizard .pane.active { display: block; }
.a1-policy-wizard .section { border-top: 1px solid var(--border); margin-top: 24px; padding-top: 18px; }
.a1-policy-wizard .section:first-of-type { border-top: none; margin-top: 0; padding-top: 0; }
.a1-policy-wizard .section-title { font-size: var(--fs-section); font-weight: 600; margin: 0 0 4px; }
.a1-policy-wizard .section-sub { font-size: var(--fs-hint); color: var(--text-3); margin: 0 0 14px; }
.a1-policy-wizard .field { margin-bottom: 14px; }
.a1-policy-wizard .field:last-child { margin-bottom: 0; }
.a1-policy-wizard label { display: block; font-size: var(--fs-label); font-weight: 600; margin-bottom: 6px; }
.a1-policy-wizard .req { color: var(--danger); }
.a1-policy-wizard input[type="text"],
.a1-policy-wizard input[type="number"],
.a1-policy-wizard select,
.a1-policy-wizard textarea {
  width: 100%;
  height: 34px;
  border: 1px solid var(--border-input);
  border-radius: var(--radius);
  padding: 0 10px;
  font-size: var(--fs-body);
  font-family: inherit;
  background: var(--bg-card);
  color: var(--text);
}
.a1-policy-wizard textarea { height: 64px; padding: 8px 10px; resize: vertical; }
.a1-policy-wizard input:focus,
.a1-policy-wizard select:focus,
.a1-policy-wizard textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); }
.a1-policy-wizard .locked,
.a1-policy-wizard input:disabled,
.a1-policy-wizard select:disabled { background: var(--bg-muted); color: var(--text-2); }
.a1-policy-wizard .label-locked { color: var(--text-3); }
.a1-policy-wizard .hint { font-size: var(--fs-hint); color: var(--text-3); margin: 4px 0 0; }
.a1-policy-wizard .hint.error { color: var(--danger); }
.a1-policy-wizard input.invalid { border-color: var(--danger); box-shadow: 0 0 0 3px var(--danger-bg); }
.a1-policy-wizard .grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.a1-policy-wizard .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.a1-policy-wizard .span-2 { grid-column: span 2; }
.a1-policy-wizard input[type="radio"], .a1-policy-wizard input[type="checkbox"] { accent-color: var(--accent); width: 15px; height: 15px; margin: 0; flex: none; }
.a1-policy-wizard .radio-row { display: flex; gap: 16px; align-items: center; height: 34px; }
.a1-policy-wizard .radio-item { display: flex; align-items: center; gap: 6px; font-size: var(--fs-label); cursor: pointer; font-weight: 400; margin: 0; }
.a1-policy-wizard .mode-card { border: 1px solid var(--border-input); border-radius: var(--radius); padding: 10px 14px; cursor: pointer; }
.a1-policy-wizard .mode-card .mode-head { display: flex; align-items: center; gap: 8px; font-size: var(--fs-body); font-weight: 600; }
.a1-policy-wizard .mode-card .mode-desc { font-size: var(--fs-hint); color: var(--text-2); margin: 3px 0 0 23px; }
.a1-policy-wizard .mode-card.selected { background: var(--accent-bg); border-color: var(--accent-border); }
.a1-policy-wizard .mode-card:not(.selected) .mode-head { font-weight: 400; color: var(--text-2); }
.a1-policy-wizard .adv-head { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: none; padding: 0; font-family: inherit; font-size: var(--fs-section); font-weight: 600; color: var(--text); cursor: pointer; text-align: left; }
.a1-policy-wizard .adv-head .chev { font-size: 10px; color: var(--text-3); width: 12px; transition: transform .15s; }
.a1-policy-wizard .adv.open .adv-head .chev { transform: rotate(90deg); }
.a1-policy-wizard .adv-body { display: none; margin-top: 16px; }
.a1-policy-wizard .adv.open .adv-body { display: block; }
.a1-policy-wizard .validation-notice { margin: 0 0 12px; padding: 10px 12px; border: 1px solid var(--danger-bg); background: #fff7f7; color: var(--danger); border-radius: var(--radius); font-size: var(--fs-label); }
.a1-policy-wizard .baseline-bar { display: flex; align-items: center; gap: 10px; background: var(--bg-muted); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 12px; margin-bottom: 12px; flex-wrap: wrap; }
.a1-policy-wizard .baseline-bar .b-label { font-size: var(--fs-label); font-weight: 600; }
.a1-policy-wizard .baseline-bar select { width: auto; min-width: 260px; height: 30px; font-size: var(--fs-label); background: var(--bg-card); }
.a1-policy-wizard .baseline-bar .btn { height: 30px; padding: 0 12px; }
.a1-policy-wizard .baseline-bar .b-note { font-size: var(--fs-hint); color: var(--text-3); flex-basis: 100%; margin: 0; }
.a1-policy-wizard .controls-layout { display: grid; grid-template-columns: 264px 1fr; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; height: 560px; }
.a1-policy-wizard .tree { background: var(--bg-muted); border-right: 1px solid var(--border); padding: 12px; overflow-y: auto; }
.a1-policy-wizard .tree-search { margin-bottom: 10px; }
.a1-policy-wizard .tree-search input { background: var(--bg-card); height: 30px; font-size: var(--fs-label); }
.a1-policy-wizard .tree-toolbar { font-size: var(--fs-hint); color: var(--text-2); margin-bottom: 10px; }
.a1-policy-wizard .tree-toolbar .count { font-weight: 600; color: var(--text); }
.a1-policy-wizard .tree-filters { display: flex; gap: 12px; margin-top: 6px; }
.a1-policy-wizard .tree-filter { display: flex; align-items: center; gap: 5px; cursor: pointer; font-weight: 400; font-size: var(--fs-hint); color: var(--text-2); margin: 0; }
.a1-policy-wizard .tree-filter.disabled { opacity: .45; cursor: not-allowed; }
.a1-policy-wizard .tree-filter input { width: 13px; height: 13px; }
.a1-policy-wizard .tree-cat { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 6px; font-size: var(--fs-hint); font-weight: 600; color: var(--text-2); background: none; border: none; font-family: inherit; border-radius: var(--radius); cursor: pointer; text-align: left; }
.a1-policy-wizard .tree-cat:hover { color: var(--text); background: rgba(0,0,0,.04); }
.a1-policy-wizard .tree-cat .chev { font-size: 9px; color: var(--text-3); width: 10px; transition: transform .12s; }
.a1-policy-wizard .tree-cat.open .chev { transform: rotate(90deg); }
.a1-policy-wizard .tree-cat .c-name { flex: 1; }
.a1-policy-wizard .tree-cat .c-count { font-size: 10px; font-weight: 600; background: var(--accent); color: #fff; border-radius: 8px; min-width: 16px; height: 16px; display: none; align-items: center; justify-content: center; padding: 0 4px; }
.a1-policy-wizard .tree-cat .c-count.visible { display: inline-flex; }
.a1-policy-wizard .tree-cat-body { display: none; padding-left: 6px; }
.a1-policy-wizard .tree-cat.open + .tree-cat-body { display: block; }
.a1-policy-wizard .tree-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 10px; font-size: var(--fs-label); color: var(--text-2); border: none; background: none; font-family: inherit; border-radius: var(--radius); cursor: pointer; text-align: left; }
.a1-policy-wizard .tree-item:hover { background: rgba(0,0,0,.04); color: var(--text); }
.a1-policy-wizard .tree-item.active { background: var(--accent-bg); color: var(--accent); font-weight: 600; }
.a1-policy-wizard .tree-item .t-name { flex: 1; }
.a1-policy-wizard .tree-item .t-count { font-size: 10px; font-weight: 600; background: var(--accent); color: #fff; border-radius: 8px; min-width: 16px; height: 16px; display: none; align-items: center; justify-content: center; padding: 0 4px; }
.a1-policy-wizard .tree-item .t-count.visible { display: inline-flex; }
.a1-policy-wizard .detail-pane { padding: 16px 20px; background: var(--bg-card); overflow-y: auto; }
.a1-policy-wizard .detail-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 2px; }
.a1-policy-wizard .detail-head h4 { font-size: var(--fs-section); font-weight: 600; margin: 0; flex: 1; }
.a1-policy-wizard .detail-actions { font-size: var(--fs-hint); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.a1-policy-wizard .detail-actions button,
.a1-policy-wizard .summary-grid .s-edit { background: none; border: none; padding: 0; font-family: inherit; font-size: var(--fs-hint); color: var(--accent); cursor: pointer; }
.a1-policy-wizard .detail-actions button:hover,
.a1-policy-wizard .summary-grid .s-edit:hover { text-decoration: underline; }
.a1-policy-wizard .detail-actions .sep { color: var(--border-input); margin: 0 2px; }
.a1-policy-wizard .detail-sub { font-size: var(--fs-hint); color: var(--text-3); margin: 0 0 12px; }
.a1-policy-wizard .control-row { display: flex; gap: 10px; padding: 9px 12px; border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 6px; cursor: pointer; }
.a1-policy-wizard .control-row:hover { border-color: var(--border-input); }
.a1-policy-wizard .control-row.selected { background: var(--accent-bg); border-color: var(--accent-border); }
.a1-policy-wizard .control-name { font-size: var(--fs-label); font-weight: 600; }
.a1-policy-wizard .control-desc { font-size: var(--fs-hint); color: var(--text-3); margin-top: 2px; }
.a1-policy-wizard .control-meta { display: flex; align-items: center; gap: 8px; margin-top: 5px; flex-wrap: wrap; }
.a1-policy-wizard .meta-src { font-size: 10px; font-weight: 600; color: var(--text-3); background: var(--bg-muted); border: 1px solid var(--border); border-radius: 3px; padding: 1px 5px; }
.a1-policy-wizard .control-row.selected .meta-src { background: #fff; }
.a1-policy-wizard .control-config { margin-top: 8px; max-width: 420px; }
.a1-policy-wizard .control-config label { font-size: var(--fs-hint); }
.a1-policy-wizard .control-config input, .a1-policy-wizard .control-config select, .a1-policy-wizard .control-config textarea { background: var(--bg-card); min-height: 30px; height: auto; font-size: var(--fs-label); }
.a1-policy-wizard .baseline-recs { margin-top: 6px; font-size: 11px; color: var(--text-3); font-family: var(--font-mono); }
.a1-policy-wizard .baseline-recs b { color: var(--text-2); font-weight: 600; }
.a1-policy-wizard .empty-detail { padding: 40px 20px; text-align: center; font-size: var(--fs-label); color: var(--text-3); }
.a1-policy-wizard .review-family { font-size: var(--fs-label); font-weight: 600; margin: 10px 0 4px; }
.a1-policy-wizard .summary-grid { display: grid; grid-template-columns: 180px 1fr; gap: 8px 20px; font-size: var(--fs-body); }
.a1-policy-wizard .summary-grid .s-label { font-size: var(--fs-label); color: var(--text-3); padding-top: 1px; }
.a1-policy-wizard .summary-grid .s-value { display: inline-flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.a1-policy-wizard .summary-grid .s-value.strong { font-weight: 600; }
.a1-policy-wizard .review-controls { margin-top: 18px; border-top: 1px solid var(--border); padding-top: 4px; }
.a1-policy-wizard .review-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.a1-policy-wizard .review-groups { display: grid; gap: 12px; }
.a1-policy-wizard .chip { display: inline-flex; align-items: baseline; gap: 6px; font-size: var(--fs-hint); color: var(--text-2); background: var(--bg-muted); border: 1px solid var(--border); border-radius: var(--radius); padding: 2px 8px; margin: 0; }
.a1-policy-wizard .chip .c-v { font-family: var(--font-mono); font-weight: 600; color: var(--text); }
.a1-policy-wizard .btn { height: 34px; padding: 0 16px; font-size: var(--fs-label); font-weight: 600; font-family: inherit; border-radius: var(--radius); cursor: pointer; border: 1px solid transparent; }
.a1-policy-wizard .btn:disabled { opacity: .5; cursor: not-allowed; }
.a1-policy-wizard .btn-primary { background: var(--accent); color: #fff; }
.a1-policy-wizard .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
.a1-policy-wizard .btn-secondary { background: var(--bg-card); color: var(--text); border-color: var(--border-input); }
.a1-policy-wizard .btn-secondary:hover:not(:disabled) { background: var(--bg-muted); }
.a1-policy-wizard .wizard-footer { display: flex; align-items: center; gap: 10px; border-top: 1px solid var(--border); margin-top: 24px; padding-top: 16px; }
.a1-policy-wizard .wizard-footer .spacer { flex: 1; }
.a1-policy-wizard .modal-backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, .16); display: grid; place-items: center; padding: 16px; z-index: 20; }
.a1-policy-wizard .modal-card { width: 100%; max-width: 520px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-card); padding: 16px; box-shadow: 0 16px 40px rgba(15, 23, 42, .14); }
.a1-policy-wizard .modal-card h3 { font-size: var(--fs-section); font-weight: 600; margin: 0 0 8px; }
.a1-policy-wizard .modal-card p { margin: 0 0 12px; color: var(--text-2); }
.a1-policy-wizard .modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
@media (max-width: 720px) { .a1-policy-wizard .controls-layout { grid-template-columns: 1fr; height: auto; } }
@media (max-width: 640px) {
  .a1-policy-wizard .grid-3, .a1-policy-wizard .grid-2, .a1-policy-wizard .summary-grid { grid-template-columns: 1fr; }
  .a1-policy-wizard .span-2 { grid-column: span 1; }
  .a1-policy-wizard .stepper { overflow-x: auto; }
}
`;

function cx(...tokens) {
  return tokens.filter(Boolean).join(' ');
}

function getScopeLabel(draft) {
  return draft.scopeType === 'ALL_ENDPOINTS' ? 'All endpoints' : draft.endpointGroupName;
}

function updateDraftField(draft, onChange, fieldName, value) {
  onChange({
    ...draft,
    [fieldName]: value
  });
}

function updateRunScheduleField(draft, onChange, fieldName, value) {
  onChange({
    ...draft,
    runSchedule: {
      ...draft.runSchedule,
      [fieldName]: value
    }
  });
}

function updateOrganization(draft, organizations, onChange, organizationId) {
  const organization = organizations.find((entry) => entry.organizationId === organizationId);
  onChange({
    ...draft,
    organizationId,
    organizationName: organization ? organization.organizationName : '',
    endpointGroupId: '',
    endpointGroupName: ''
  });
}

function updateScopeType(draft, onChange, scopeType) {
  onChange({
    ...draft,
    scopeType,
    endpointGroupId: scopeType === 'ENDPOINT_GROUP' ? draft.endpointGroupId : '',
    endpointGroupName: scopeType === 'ENDPOINT_GROUP' ? draft.endpointGroupName : ''
  });
}

function updateEndpointGroup(draft, endpointGroups, onChange, endpointGroupId) {
  const endpointGroup = endpointGroups.find((entry) => entry.endpointGroupId === endpointGroupId);
  onChange({
    ...draft,
    endpointGroupId,
    endpointGroupName: endpointGroup ? endpointGroup.endpointGroupName : ''
  });
}

function countLabel(count, singularLabel, pluralLabel = `${singularLabel}s`) {
  const normalizedCount = Number(count || 0);
  return `${normalizedCount} ${normalizedCount === 1 ? singularLabel : pluralLabel}`;
}

function getBaselineRecommendation(catalog, baselineId, control) {
  if (!baselineId) {
    return null;
  }

  const baseline = findBaselineById(catalog.baselines, baselineId);
  const recommendedParameters = getRecommendedParametersForBaselineControl(catalog.baselines, baselineId, control.controlId);
  if (!baseline || !recommendedParameters) {
    return null;
  }

  const parts = (control.parameters || [])
    .filter((parameter) => Object.prototype.hasOwnProperty.call(recommendedParameters, parameter.id))
    .map((parameter) => ({
      label: parameter.label,
      value: formatParameterValue(parameter, recommendedParameters[parameter.id])
    }))
    .filter((entry) => entry.value);

  if (!parts.length) {
    return null;
  }

  return {
    label: baseline.tag || 'Recommended',
    value: parts.length === 1 ? parts[0].value : parts.map((entry) => `${entry.label}: ${entry.value}`).join(' · ')
  };
}

function renderConfigInput({ parameter, value, onChange, errorMessage }) {
  const inputProps = {
    value: value ?? '',
    onChange: (event) => onChange(event.target.value)
  };

  let input = null;

  if (parameter.type === 'boolean') {
    input = (
      <label className="radio-item" style={{ marginTop: 6 }}>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{parameter.label}</span>
      </label>
    );
  } else if (parameter.type === 'enum') {
    input = (
      <select {...inputProps}>
        {(parameter.options || []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  } else if (parameter.type === 'integer') {
    input = <input type="number" {...inputProps} min={parameter.minimum} max={parameter.maximum} step={parameter.step || 1} />;
  } else if (parameter.type === 'multiline-string') {
    input = <textarea rows={3} {...inputProps} />;
  } else if (parameter.type === 'time') {
    input = <input type="text" {...inputProps} />;
  } else {
    input = <input type="text" {...inputProps} />;
  }

  return (
    <div className="control-config field" key={parameter.id} onClick={(event) => event.stopPropagation()}>
      {parameter.type === 'boolean' ? null : <label>{parameter.label}</label>}
      {input}
      {errorMessage ? <p className="hint error">{errorMessage}</p> : null}
    </div>
  );
}

function PolicyEditorView({
  catalog,
  draft,
  endpointGroups,
  isEditMode,
  onCancel,
  onChange,
  onSave,
  organizations,
  validationResult
}) {
  const [wizardState, setWizardState] = useState(() => createInitialWizardState({ isEditMode }));
  const [openCategories, setOpenCategories] = useState(() => getInitialOpenCategories(catalog));
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false);
  const [pendingPolicyMode, setPendingPolicyMode] = useState('');
  const [pendingSaveConfirmation, setPendingSaveConfirmation] = useState(false);
  const [runEveryInput, setRunEveryInput] = useState(String(draft.runSchedule?.runEveryHours ?? ''));
  const [completionDeadlineInput, setCompletionDeadlineInput] = useState(String(draft.completionDeadlineMinutes ?? ''));

  useEffect(() => {
    setOpenCategories(getInitialOpenCategories(catalog));
    setWizardState(createInitialWizardState({ isEditMode }));
    setAdvancedSettingsOpen(false);
    setPendingPolicyMode('');
    setPendingSaveConfirmation(false);
  }, [catalog, draft.policyId, isEditMode]);

  useEffect(() => {
    setRunEveryInput(String(draft.runSchedule?.runEveryHours ?? ''));
  }, [draft.runSchedule?.runEveryHours]);

  useEffect(() => {
    setCompletionDeadlineInput(String(draft.completionDeadlineMinutes ?? ''));
  }, [draft.completionDeadlineMinutes]);

  const treeModel = useMemo(
    () =>
      buildControlsTreeViewModel({
        catalog,
        draft,
        wizardState: {
          ...wizardState,
          openCategories
        }
      }),
    [catalog, draft, openCategories, wizardState]
  );

  const displayName = deriveDisplayName(draft.baseName, getScopeLabel(draft));
  const selectedBaseline = findBaselineById(catalog.baselines, wizardState.selectedBaselineId);
  const expectedAutomationCount = countExpectedAutomations(draft.selectedControls || []);
  const reviewModel = useMemo(
    () =>
      buildReviewViewModel({
        catalog,
        draft,
        displayName,
        appliedBaselineId: wizardState.appliedBaselineId
      }),
    [catalog, displayName, draft, wizardState.appliedBaselineId]
  );

  function fieldError(fieldName) {
    return validationResult.fieldErrors?.[fieldName] || '';
  }

  function goToStep(stepNumber) {
    if (stepNumber >= wizardState.currentStep) {
      return;
    }

    setWizardState((currentState) => ({
      ...currentState,
      currentStep: stepNumber
    }));
  }

  function getWizardValidationFields(stepNumber) {
    if (stepNumber === 1) {
      return ['baseName', 'organizationId', 'scopeType', 'endpointGroupId'];
    }
    if (stepNumber === 2) {
      return ['runEveryHours', 'startDate', 'startTime', 'timezone', 'completionDeadlineMinutes'];
    }
    if (stepNumber === 3) {
      return ['selectedControls'];
    }
    return [];
  }

  function canAdvanceCurrentStep() {
    const nextValidationResult = validatePolicyDraft(draft, catalog);
    const requiredFields = getWizardValidationFields(wizardState.currentStep);
    return requiredFields.every((fieldName) => !nextValidationResult.fieldErrors?.[fieldName]);
  }

  function nextStep() {
    if (!canAdvanceCurrentStep()) {
      onSave({ ...draft, __preventSave: true });
      return;
    }

    if (wizardState.currentStep === 4) {
      setPendingSaveConfirmation(true);
      return;
    }

    setWizardState((currentState) => ({
      ...currentState,
      currentStep: currentState.currentStep + 1
    }));
  }

  function prevStep() {
    setWizardState((currentState) => ({
      ...currentState,
      currentStep: Math.max(1, currentState.currentStep - 1)
    }));
  }

  function handlePolicyModeChange(nextPolicyMode) {
    if (nextPolicyMode === 'ASSESS_ONLY') {
      onChange({
        ...draft,
        policyMode: 'ASSESS_ONLY'
      });
      return;
    }

    if (draft.policyMode !== 'ASSESS_AND_REMEDIATE') {
      setPendingPolicyMode('ASSESS_AND_REMEDIATE');
    }
  }

  function confirmAssessAndRemediate() {
    onChange({
      ...draft,
      policyMode: 'ASSESS_AND_REMEDIATE'
    });
    setPendingPolicyMode('');
  }

  function handleRunEveryChange(value) {
    setRunEveryInput(value);
    if (/^\d+$/.test(String(value)) && Number.parseInt(value, 10) > 0) {
      onChange(updateRunEveryHours(draft, value));
      return;
    }

    updateRunScheduleField(draft, onChange, 'runEveryHours', value);
  }

  function handleCompletionDeadlineChange(value) {
    setCompletionDeadlineInput(value);
    if (/^\d+$/.test(String(value)) && Number.parseInt(value, 10) > 0) {
      onChange(updateCompletionDeadline(draft, value));
      return;
    }

    onChange({
      ...draft,
      completionDeadlineMinutes: value
    });
  }

  function handleControlToggle(controlId) {
    const control = catalog.controlsById?.[controlId];
    if (!control) {
      return;
    }

    const isSelected = (draft.selectedControls || []).some((entry) => entry.controlId === controlId);
    onChange(applyControlSelection(draft, control, !isSelected, catalog));
  }

  function handleParameterChange(controlId, parameterId, value) {
    onChange(updateControlParameter(draft, controlId, parameterId, value));
  }

  function baselineChanged(nextBaselineId) {
    setWizardState((currentState) => ({
      ...currentState,
      selectedBaselineId: nextBaselineId,
      inBaselineOnly: nextBaselineId ? currentState.inBaselineOnly : false
    }));
  }

  function applyBaseline() {
    if (!wizardState.selectedBaselineId) {
      return;
    }

    const nextDraft = applyBaselineSelection(draft, catalog, catalog.baselines, wizardState.selectedBaselineId);
    const nextOpenCategories = { ...openCategories };

    for (const selectedControl of nextDraft.selectedControls || []) {
      const controlFamily = catalog.controlFamiliesById?.[selectedControl.automationGroupId];
      if (controlFamily) {
        nextOpenCategories[controlFamily.familyId] = true;
      }
    }

    setOpenCategories(nextOpenCategories);
    onChange(nextDraft);
    setWizardState((currentState) => ({
      ...currentState,
      appliedBaselineId: currentState.selectedBaselineId,
      selectedOnly: true,
      activeControlFamilyId: ''
    }));
  }

  function clearAll() {
    onChange(clearAllSelectedControls(draft));
    setWizardState((currentState) => ({
      ...currentState,
      appliedBaselineId: '',
      selectedOnly: false
    }));
  }

  function confirmSave() {
    setPendingSaveConfirmation(false);
    onSave(draft);
  }

  function toggleCat(categoryId) {
    setOpenCategories((currentState) => ({
      ...currentState,
      [categoryId]: !currentState[categoryId]
    }));
  }

  function selectFamily(automationGroupId) {
    setWizardState((currentState) => ({
      ...currentState,
      activeControlFamilyId: automationGroupId,
      selectedOnly: false
    }));
  }

  function bulk(automationGroupId, value) {
    let nextDraft = draft;

    for (const control of catalog.controls || []) {
      if (control.automationGroupId === automationGroupId) {
        nextDraft = applyControlSelection(nextDraft, control, value, catalog);
      }
    }

    onChange(nextDraft);
  }

  const selectedOnlyRows = treeModel.selectedGroups.flatMap((group) =>
    group.controls.map((control) => ({
      familyName: group.familyName,
      control
    }))
  );

  function renderControlRow(control) {
    const catalogControl = catalog.controlsById?.[control.controlId];
    if (!catalogControl) {
      return null;
    }

    const selectedControl = (draft.selectedControls || []).find((entry) => entry.controlId === control.controlId);
    const baselineRecommendation = getBaselineRecommendation(catalog, wizardState.selectedBaselineId, catalogControl);
    const recommendationLabel = selectedBaseline?.tag || 'Recommended';

    return (
      <div
        key={control.controlId}
        className={cx('control-row', selectedControl ? 'selected selectedControlRow' : '')}
        onClick={() => handleControlToggle(control.controlId)}
      >
        <input
          type="checkbox"
          checked={Boolean(selectedControl)}
          onChange={() => handleControlToggle(control.controlId)}
          onClick={(event) => event.stopPropagation()}
        />
        <div style={{ flex: 1 }}>
          <div className="control-name">{catalogControl.name}</div>
          <div className="control-desc">{catalogControl.description}</div>
          {Array.isArray(control.tags) && control.tags.length > 0 ? (
            <div className="control-meta">
              {control.tags.map((tag) => (
                <span key={`${control.controlId}-${tag}`} className="meta-src">{tag}</span>
              ))}
            </div>
          ) : null}
          {selectedControl ? (
            <>
              {(catalogControl.parameters || []).map((parameter) =>
                renderConfigInput({
                  parameter,
                  value: selectedControl.parameters?.[parameter.id],
                  onChange: (value) => handleParameterChange(control.controlId, parameter.id, value),
                  errorMessage: fieldError(`${control.controlId}.${parameter.id}`)
                })
              )}
              {baselineRecommendation ? (
                <div className="baseline-recs">
                  <span>
                    {recommendationLabel}: <b>{baselineRecommendation.value}</b>
                  </span>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    );
  }

  function renderSelectedOnlyDetail() {
    if (!selectedOnlyRows.length) {
      return <div className="empty-detail">No controls match the current filters.</div>;
    }

    let lastFamilyName = '';

    return (
      <>
        {selectedOnlyRows.map((row) => {
          const showFamily = row.familyName !== lastFamilyName;
          lastFamilyName = row.familyName;

          return (
            <div key={row.control.controlId}>
              {showFamily ? <div className="review-family">{row.familyName}</div> : null}
              {renderControlRow(row.control)}
            </div>
          );
        })}
      </>
    );
  }

  function renderFamilyDetail(activeFamily) {
    return (
      <>
        <div className="detail-head">
          <h4>{activeFamily.familyName}</h4>
          <span className="detail-actions">
            <button type="button" onClick={() => bulk(activeFamily.automationGroupId, true)}>Select all</button>
            <span className="sep">·</span>
            <button type="button" onClick={() => bulk(activeFamily.automationGroupId, false)}>Clear</button>
          </span>
        </div>
        <p className="detail-sub">
          {activeFamily.categoryName} · {activeFamily.selectedCount} of {activeFamily.availableCount} selected
        </p>
        {activeFamily.controls.length === 0 ? (
          <div className="empty-detail">No controls match the current filters.</div>
        ) : (
          activeFamily.controls.map((control) => renderControlRow(control))
        )}
      </>
    );
  }

  const wizardErrors = validationResult.sectionErrors || [];
  const runEveryInvalid = !runEveryInput || Number.parseInt(runEveryInput, 10) < 1;
  const nextDisabled = wizardState.currentStep === 2 && runEveryInvalid;

  return (
    <div className="a1-policy-wizard">
      <style>{WIZARD_CSS}</style>

      <div className="card editorSurface">
        <h2 className="card-title">{isEditMode ? 'Edit Policy' : 'Create Policy'}</h2>
        <p className="card-sub">Create a Windows configuration Policy that evaluates endpoint settings and, when enabled, reserves Action1 automations.</p>

        <div className="stepper" id="stepper">
          {WIZARD_STEPS.map((step, index) => {
            const isActive = wizardState.currentStep === step.number;
            const isDone = wizardState.currentStep > step.number;

            return (
              <div key={step.number} style={{ display: 'contents' }}>
                <button
                  type="button"
                  className={cx('step', isActive && 'active', isDone && 'done', index < WIZARD_STEPS.length - 1 && 'stepConnector')}
                  data-step={step.number}
                  onClick={() => {
                    if (isDone) {
                      goToStep(step.number);
                    }
                  }}
                >
                  <span className="num">{step.number}</span>
                  {step.label}
                </button>
                {index < WIZARD_STEPS.length - 1 ? <span className="step-sep" aria-hidden="true" /> : null}
              </div>
            );
          })}
        </div>

        {validationResult.blockingMessage ? <p className="validation-notice">{validationResult.blockingMessage}</p> : null}
        {wizardErrors.map((sectionError) => (
          <p key={sectionError} className="validation-notice">{sectionError}</p>
        ))}

        <div className={cx('pane', wizardState.currentStep === 1 && 'active')} data-pane="1">
          <div className="section">
            <h3 className="section-title">Policy details</h3>
            <p className="section-sub">Enter policy name and description.</p>
            <div className="field">
              <label>Policy name <span className="req">*</span></label>
              <input type="text" value={draft.baseName} onChange={(event) => updateDraftField(draft, onChange, 'baseName', event.target.value)} />
              {fieldError('baseName') ? <p className="hint error">{fieldError('baseName')}</p> : null}
            </div>
            <div className="field">
              <label>Description</label>
              <textarea value={draft.description || ''} onChange={(event) => updateDraftField(draft, onChange, 'description', event.target.value)} />
            </div>
            <div className="field">
              <label className="label-locked">Policy display name</label>
              <input type="text" className="locked" value={displayName} disabled readOnly />
              <p className="hint">Generated from name and target</p>
            </div>
          </div>

          <div className="section">
            <h3 className="section-title">Target</h3>
            <p className="section-sub">Choose the Organization and the endpoint scope for this Policy.</p>
            {isEditMode ? <p className="hint lockedSectionHint">This Target is locked for saved Policies.</p> : null}
            <div className="grid-3">
              <div className="field">
                <label className={isEditMode ? 'label-locked' : ''}>Organization <span className="req">*</span></label>
                {isEditMode ? (
                  <input type="text" value={draft.organizationName} readOnly={isEditMode} disabled={isEditMode} className="locked" />
                ) : (
                  <select value={draft.organizationId} onChange={(event) => updateOrganization(draft, organizations, onChange, event.target.value)} disabled={isEditMode}>
                    <option value="">Select organization</option>
                    {organizations.map((organization) => (
                      <option key={organization.organizationId} value={organization.organizationId}>
                        {organization.organizationName}
                      </option>
                    ))}
                  </select>
                )}
                {fieldError('organizationId') ? <p className="hint error">{fieldError('organizationId')}</p> : null}
              </div>

              <div className="field">
                <label className={isEditMode ? 'label-locked' : ''}>Apply Policy to <span className="req">*</span></label>
                <div className="radio-row">
                  <label className="radio-item">
                    <input
                      type="radio"
                      name="scopeType"
                      checked={draft.scopeType === 'ALL_ENDPOINTS'}
                      onChange={() => updateScopeType(draft, onChange, 'ALL_ENDPOINTS')}
                      disabled={isEditMode}
                    />
                    All endpoints
                  </label>
                  <label className="radio-item">
                    <input
                      type="radio"
                      name="scopeType"
                      checked={draft.scopeType === 'ENDPOINT_GROUP'}
                      onChange={() => updateScopeType(draft, onChange, 'ENDPOINT_GROUP')}
                      disabled={isEditMode}
                    />
                    Endpoint group
                  </label>
                </div>
                {fieldError('scopeType') ? <p className="hint error">{fieldError('scopeType')}</p> : null}
              </div>

              <div className="field">
                <label className={isEditMode ? 'label-locked' : ''}>Endpoint group <span className="req">*</span></label>
                {isEditMode ? (
                  <input type="text" value={draft.endpointGroupName} readOnly={isEditMode} disabled={isEditMode} className="locked" />
                ) : (
                  <select
                    value={draft.endpointGroupId}
                    onChange={(event) => updateEndpointGroup(draft, endpointGroups, onChange, event.target.value)}
                    disabled={draft.scopeType !== 'ENDPOINT_GROUP' || isEditMode}
                  >
                    <option value="">{draft.scopeType === 'ENDPOINT_GROUP' ? 'Select endpoint group' : 'Choose Endpoint group'}</option>
                    {endpointGroups
                      .filter((entry) => !draft.organizationId || entry.organizationId === draft.organizationId)
                      .map((endpointGroup) => (
                        <option key={endpointGroup.endpointGroupId} value={endpointGroup.endpointGroupId}>
                          {endpointGroup.endpointGroupName}
                        </option>
                      ))}
                  </select>
                )}
                {fieldError('endpointGroupId') ? <p className="hint error">{fieldError('endpointGroupId')}</p> : null}
              </div>
            </div>
          </div>
        </div>

        <div className={cx('pane', wizardState.currentStep === 2 && 'active')} data-pane="2">
          <div className="section">
            <h3 className="section-title">Policy mode</h3>
            <p className="section-sub">Choose whether this Policy only assesses endpoint settings or also remediates them.</p>
            <div className="grid-2">
              <div className={cx('mode-card', draft.policyMode === 'ASSESS_ONLY' && 'selected')} onClick={() => handlePolicyModeChange('ASSESS_ONLY')}>
                <div className="mode-head">
                  <input type="radio" name="mode" checked={draft.policyMode === 'ASSESS_ONLY'} readOnly />
                  Assess only
                </div>
                <p className="mode-desc">Assess configuration without changing endpoint settings.</p>
              </div>
              <div className={cx('mode-card', draft.policyMode === 'ASSESS_AND_REMEDIATE' && 'selected')} onClick={() => handlePolicyModeChange('ASSESS_AND_REMEDIATE')}>
                <div className="mode-head">
                  <input type="radio" name="mode" checked={draft.policyMode === 'ASSESS_AND_REMEDIATE'} readOnly />
                  Assess and remediate
                </div>
                <p className="mode-desc">Assess configuration, remediate once, and verify once.</p>
              </div>
            </div>
          </div>

          <div className={cx('section', 'adv', advancedSettingsOpen && 'open')} id="adv-section">
            <button type="button" className="adv-head" onClick={() => setAdvancedSettingsOpen((currentState) => !currentState)}>
              <span className="chev" aria-hidden="true">{'\u25b6'}</span> Advanced settings
            </button>
            <div className="adv-body">
              <p className="section-sub">Set how often the Policy runs and how long Action1 automation retries remain active.</p>
              <div className="grid-3" style={{ marginBottom: 14 }}>
                <div className="field">
                  <label>Run every <span className="req">*</span></label>
                  <input
                    type="number"
                    id="run-every"
                    value={runEveryInput}
                    min="1"
                    step="1"
                    onChange={(event) => handleRunEveryChange(event.target.value)}
                    className={fieldError('runEveryHours') || runEveryInvalid ? 'invalid' : ''}
                  />
                  <p className={cx('hint', (fieldError('runEveryHours') || runEveryInvalid) && 'error')} id="run-every-hint">
                    {fieldError('runEveryHours') || (runEveryInvalid ? 'Minimum is 1 hour' : 'Hours between runs (minimum 1)')}
                  </p>
                </div>
                <div className="field">
                  <label>Start date <span className="req">*</span></label>
                  <input type="text" value={draft.runSchedule?.startDate || ''} onChange={(event) => updateRunScheduleField(draft, onChange, 'startDate', event.target.value)} />
                  {fieldError('startDate') ? <p className="hint error">{fieldError('startDate')}</p> : null}
                </div>
                <div className="field">
                  <label>Start time <span className="req">*</span></label>
                  <input type="text" value={draft.runSchedule?.startTime || ''} onChange={(event) => updateRunScheduleField(draft, onChange, 'startTime', event.target.value)} />
                  {fieldError('startTime') ? <p className="hint error">{fieldError('startTime')}</p> : null}
                </div>
              </div>
              <div className="grid-3">
                <div className="field span-2">
                  <label>Timezone</label>
                  <input type="text" value={draft.runSchedule?.timezone || ''} onChange={(event) => updateRunScheduleField(draft, onChange, 'timezone', event.target.value)} />
                  {fieldError('timezone') ? <p className="hint error">{fieldError('timezone')}</p> : null}
                </div>
                <div className="field">
                  <label>Automation completion deadline <span className="req">*</span></label>
                  <input type="number" value={completionDeadlineInput} min="1" onChange={(event) => handleCompletionDeadlineChange(event.target.value)} />
                  <p className="hint">Minutes offline endpoints keep retrying</p>
                  {fieldError('completionDeadlineMinutes') ? <p className="hint error">{fieldError('completionDeadlineMinutes')}</p> : null}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={cx('pane', wizardState.currentStep === 3 && 'active')} data-pane="3">
          <div className="section">
            <h3 className="section-title">Controls</h3>
            <p className="section-sub">Choose Control Families and Controls from the released catalog metadata.</p>

            <div className="baseline-bar">
              <span className="b-label">Start from a baseline</span>
              <select id="baseline-select" value={wizardState.selectedBaselineId} onChange={(event) => baselineChanged(event.target.value)}>
                <option value="">None — select controls manually</option>
                {catalog.baselineOptions.map((baselineOption) => (
                  <option key={baselineOption.id} value={baselineOption.id}>{baselineOption.name}</option>
                ))}
              </select>
              <button type="button" className="btn btn-secondary" onClick={applyBaseline} disabled={!wizardState.selectedBaselineId}>Apply</button>
              <span className="hint" id="apply-hint" style={{ margin: 0 }}>
                {selectedBaseline ? `Will select ${selectedBaseline.controls.length} controls and set baseline values` : ''}
              </span>
              <p className="b-note">Applying a baseline adds its recommended Controls and settings to this Policy. Your other selected Controls remain unchanged.</p>
            </div>

            <div className="controls-layout masterDetailLayout">
              <div className="tree">
                <div className="tree-search">
                  <input
                    type="text"
                    placeholder="Search controls"
                    value={wizardState.searchTerm}
                    onChange={(event) => setWizardState((currentState) => ({ ...currentState, searchTerm: event.target.value }))}
                  />
                </div>
                <div className="tree-toolbar">
                  <span className="count" id="total-count">{treeModel.totalSelectedControls}</span> selected
                  <div className="tree-filters">
                    <label className="tree-filter">
                      <input
                        type="checkbox"
                        checked={wizardState.selectedOnly}
                        onChange={(event) => setWizardState((currentState) => ({ ...currentState, selectedOnly: event.target.checked }))}
                      />
                      Selected only
                    </label>
                    <label className={cx('tree-filter', !wizardState.selectedBaselineId && 'disabled')} id="baseline-filter-label">
                      <input
                        type="checkbox"
                        id="show-baseline-only"
                        checked={wizardState.inBaselineOnly}
                        onChange={(event) => setWizardState((currentState) => ({ ...currentState, inBaselineOnly: event.target.checked }))}
                        disabled={!wizardState.selectedBaselineId}
                      />
                      In baseline only
                    </label>
                  </div>
                </div>

                <div id="tree-body">
                  {treeModel.categories.map((category) => (
                    <div key={category.categoryId}>
                      <button
                        type="button"
                        className={cx('tree-cat', category.isExpanded && 'open')}
                        onClick={() => toggleCat(category.categoryId)}
                        aria-label={`Category ${category.categoryName}`}
                      >
                        <span className="chev" aria-hidden="true">{'\u25b6'}</span>
                        <span className="c-name categoryCaption">{category.categoryName}</span>
                        <span className={cx('c-count', category.selectedCount > 0 && 'visible')}>{category.selectedCount}</span>
                      </button>
                      <div className="tree-cat-body">
                        {category.families.map((family) => (
                          <button
                            key={family.automationGroupId}
                            type="button"
                            className={cx('tree-item', wizardState.activeControlFamilyId === family.automationGroupId && !wizardState.selectedOnly && 'active')}
                            onClick={() => selectFamily(family.automationGroupId)}
                            aria-label={`Control Family ${family.familyName}`}
                          >
                            <span className="t-name">{family.familyName}</span>
                            <span className={cx('t-count', family.selectedCount > 0 && 'visible')}>{family.selectedCount}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="detail-pane">
                {wizardState.selectedOnly ? (
                  <>
                    <div className="detail-head">
                      <h4>Selected controls</h4>
                      <span className="detail-actions">
                        <button type="button" onClick={clearAll}>Clear all</button>
                      </span>
                      <span className="detail-sub" style={{ margin: 0 }}>{treeModel.totalSelectedControls} across all families</span>
                    </div>
                    <p className="detail-sub">Everything this Policy will check. Uncheck to remove.</p>
                    {renderSelectedOnlyDetail()}
                  </>
                ) : treeModel.activeFamily ? (
                  renderFamilyDetail(treeModel.activeFamily)
                ) : (
                  <div className="empty-detail">Select a Control Family on the left.</div>
                )}
              </div>
            </div>
            {fieldError('selectedControls') ? <p className="hint error">{fieldError('selectedControls')}</p> : null}
          </div>
        </div>

        <div className={cx('pane', wizardState.currentStep === 4 && 'active')} data-pane="4">
          <div className="section">
            <h3 className="section-title">Summary</h3>
            <p className="section-sub">Review the derived Policy, schedule, and selected Controls before saving.</p>

            <div className="summary-grid">
              {reviewModel.summaryRows.map((row) => (
                <div key={row.label} style={{ display: 'contents' }}>
                  <div className="s-label">{row.label}</div>
                  <div className={cx('s-value', row.emphasized && 'strong')}>
                    <span>{row.value}</span>
                    {row.step ? (
                      <button type="button" className="s-edit" onClick={() => goToStep(row.step)}>
                        Edit
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <div className="review-controls">
              {reviewModel.controlFamilyGroups.length === 0 ? (
                <p className="hint">No controls selected.</p>
              ) : (
                <div className="review-groups">
                  <CompactControlSummaryGroups groups={reviewModel.controlFamilyGroups} />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="wizard-footer">
          {wizardState.currentStep > 1 ? (
            <button type="button" className="btn btn-secondary" onClick={prevStep}>Back</button>
          ) : (
            <span />
          )}
          <div className="spacer" />
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary" id="btn-next" disabled={nextDisabled} onClick={nextStep}>
            {wizardState.currentStep === 4 ? 'Save and apply' : 'Next'}
          </button>
        </div>
      </div>

      {pendingPolicyMode ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3>Confirm remediation</h3>
            <p>Assess and remediate can change endpoint settings. Confirm before the Policy mode changes.</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setPendingPolicyMode('')}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={confirmAssessAndRemediate}>Confirm</button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingSaveConfirmation ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3>Save and apply Policy</h3>
            <p>Save this Policy, apply the current schedule and Controls selection, and then Open details from the list to inspect the saved Action1 automations.</p>
            <div className="summary-grid" style={{ marginBottom: 12 }}>
              <div className="s-label">Policy</div>
              <div className="s-value strong">{displayName || 'Unnamed Policy'}</div>
              <div className="s-label">Target</div>
              <div className="s-value">{getScopeLabel(draft) || 'Not selected'}</div>
              <div className="s-label">Action1 automations</div>
              <div className="s-value">{countLabel(expectedAutomationCount, 'Action1 automation')}</div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setPendingSaveConfirmation(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={confirmSave}>Save and apply</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default PolicyEditorView;
