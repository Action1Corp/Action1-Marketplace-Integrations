import { useEffect, useMemo, useState } from 'react';
import { countExpectedAutomations, countSelectedControlFamilies } from '../catalog/controlPackCatalog.js';
import {
  applyControlSelection,
  getInitialOpenControlFamilies,
  updateCompletionDeadline,
  updateControlParameter,
  updateRunEveryHours
} from './policyEditorState.js';
import {
  compactCheckboxStyle,
  disabledControlStyle,
  formControlStyle,
  helperTextStyle,
  primaryButtonStyle,
  readOnlyControlStyle,
  secondaryButtonStyle,
  textareaControlStyle
} from './policyUiStyles.js';
import { validatePolicyDraft } from './policyValidation.js';
import { deriveDisplayName } from './policyViewModel.js';
import ParameterField from './ParameterField.jsx';

const styles = {
  shell: {
    display: 'grid',
    gap: '0.75rem'
  },
  editorSurface: {
    border: '1px solid var(--border-color, #d7dee8)',
    borderRadius: 16,
    background: '#ffffff',
    padding: '1.1rem',
    display: 'grid',
    gap: '1rem'
  },
  header: {
    display: 'grid',
    gap: '0.3rem'
  },
  title: {
    margin: 0,
    fontSize: '1.18rem',
    color: '#12283d'
  },
  description: {
    margin: 0,
    color: '#4a627d',
    lineHeight: 1.5
  },
  errorNotice: {
    margin: 0,
    padding: '0.8rem 0.9rem',
    borderRadius: 12,
    border: '1px solid #f3c2c7',
    background: '#fff4f5',
    color: '#a61b29'
  },
  section: {
    display: 'grid',
    gap: '0.85rem'
  },
  sectionHeading: {
    margin: 0,
    fontSize: '0.98rem',
    fontWeight: 600,
    color: '#16314a'
  },
  sectionDivider: {
    border: 'none',
    borderTop: '1px solid #e3eaf2',
    margin: 0
  },
  fields: {
    display: 'grid',
    gap: '0.85rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))'
  },
  fullWidth: {
    gridColumn: '1 / -1'
  },
  fieldStack: {
    display: 'grid',
    gap: '0.35rem',
    alignContent: 'start'
  },
  label: {
    fontWeight: 500,
    fontSize: '0.9rem',
    color: '#1f3448'
  },
  helperText: {
    ...helperTextStyle
  },
  errorText: {
    margin: 0,
    color: '#b42318',
    fontSize: '0.84rem'
  },
  radioRow: {
    display: 'grid',
    gap: '0.7rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))'
  },
  radioOption: {
    display: 'grid',
    gap: '0.35rem',
    padding: '0.85rem',
    border: '1px solid #d7dee8',
    borderRadius: 12,
    background: '#fbfdff'
  },
  scheduleLayout: {
    display: 'grid',
    gap: '0.85rem'
  },
  schedulePrimaryRow: {
    display: 'grid',
    gap: '0.85rem',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))'
  },
  scheduleSecondaryRow: {
    display: 'grid',
    gap: '0.85rem',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)'
  },
  hierarchy: {
    display: 'grid',
    gap: '0.85rem'
  },
  categoryBlock: {
    display: 'grid',
    gap: '0.38rem'
  },
  categoryHeading: {
    margin: 0,
    fontSize: '0.82rem',
    fontWeight: 600,
    letterSpacing: '0.02em',
    color: '#5a6f84'
  },
  categoryName: {
    margin: 0,
    fontSize: '0.94rem',
    fontWeight: 500,
    color: '#22384d'
  },
  familyList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'grid',
    gap: '0.42rem'
  },
  familyItem: {
    border: '1px solid #dfe7f0',
    borderRadius: 12,
    background: '#ffffff'
  },
  familyToggle: {
    width: '100%',
    border: 'none',
    background: '#f8fbff',
    borderRadius: 12,
    padding: '0.68rem 0.8rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.75rem',
    cursor: 'pointer',
    textAlign: 'left',
    color: '#13304b'
  },
  familyMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flexWrap: 'wrap'
  },
  familyHeading: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '0.35rem',
    flexWrap: 'wrap'
  },
  familyLabel: {
    fontSize: '0.9rem',
    fontWeight: 600
  },
  familyName: {
    fontSize: '0.94rem',
    fontWeight: 500
  },
  countBadge: {
    borderRadius: 999,
    padding: '0.1rem 0.45rem',
    background: '#e8f0fb',
    color: '#2b4f72',
    fontSize: '0.78rem'
  },
  controlList: {
    listStyle: 'none',
    margin: 0,
    padding: '0.18rem 0.8rem 0.75rem 1.2rem',
    display: 'grid',
    gap: '0.55rem'
  },
  controlItem: {
    display: 'grid',
    gap: '0.28rem'
  },
  controlLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.5rem',
    color: '#13304b'
  },
  controlName: {
    display: 'block',
    fontSize: '0.94rem',
    fontWeight: 600,
    lineHeight: 1.3
  },
  controlDescription: {
    display: 'block',
    color: '#5a6f84',
    marginTop: '0.12rem',
    fontSize: '0.87rem',
    lineHeight: 1.4
  },
  parameterBlock: {
    marginLeft: '1.5rem',
    paddingLeft: '0.85rem',
    borderLeft: '2px solid #e3eaf2',
    display: 'grid',
    gap: '0.65rem'
  },
  summaryList: {
    display: 'grid',
    gap: '0.5rem'
  },
  summaryRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(145px, 210px) 1fr',
    gap: '0.65rem',
    alignItems: 'start'
  },
  summaryLabel: {
    margin: 0,
    color: '#5a6f84',
    fontSize: '0.84rem'
  },
  summaryValue: {
    margin: 0,
    color: '#20364b',
    fontSize: '0.94rem',
    fontWeight: 500,
    lineHeight: 1.4
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.5rem',
    flexWrap: 'wrap'
  },
  button: {
    ...secondaryButtonStyle
  },
  primaryButton: {
    ...primaryButtonStyle
  },
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.16)',
    display: 'grid',
    placeItems: 'center',
    padding: '1rem',
    zIndex: 20
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 14,
    border: '1px solid #d7dee8',
    background: '#ffffff',
    padding: '1rem',
    display: 'grid',
    gap: '0.75rem',
    boxShadow: '0 18px 48px rgba(15, 23, 42, 0.12)'
  },
  modalTitle: {
    margin: 0,
    fontSize: '1.05rem',
    color: '#12283d'
  },
  modalText: {
    margin: 0,
    color: '#4a627d',
    lineHeight: 1.5
  }
};

function getScopeLabel(draft) {
  return draft.scopeType === 'ALL_ENDPOINTS' ? 'All endpoints' : draft.endpointGroupName;
}

function getSelectedControlEntry(draft, controlId) {
  return (draft.selectedControls || []).find((entry) => entry.controlId === controlId) || null;
}

function groupCatalogByCategory(catalog) {
  return (catalog.families || []).map((category) => ({
    category,
    controlFamilies: (catalog.controlFamilies || []).filter((controlFamily) => controlFamily.familyId === category.familyId)
  }));
}

function filterCatalogGroups(groupedCatalog, catalog, searchTerm) {
  const normalizedSearchTerm = String(searchTerm || '').trim().toLowerCase();
  if (!normalizedSearchTerm) {
    return groupedCatalog.map(({ category, controlFamilies }) => ({
      category,
      controlFamilies: controlFamilies.map((controlFamily) => ({
        ...controlFamily,
        controls: (catalog.controls || []).filter((control) => control.automationGroupId === controlFamily.automationGroupId)
      }))
    }));
  }

  return groupedCatalog
    .map(({ category, controlFamilies }) => ({
      category,
      controlFamilies: controlFamilies
        .map((controlFamily) => {
          const controls = (catalog.controls || []).filter((control) => {
            if (control.automationGroupId !== controlFamily.automationGroupId) {
              return false;
            }

            return (
              String(category.name || '').toLowerCase().includes(normalizedSearchTerm) ||
              String(controlFamily.name || '').toLowerCase().includes(normalizedSearchTerm) ||
              String(control.name || '').toLowerCase().includes(normalizedSearchTerm)
            );
          });

          return {
            ...controlFamily,
            controls
          };
        })
        .filter((controlFamily) => controlFamily.controls.length > 0)
    }))
    .filter((entry) => entry.controlFamilies.length > 0);
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
  const groupedCatalog = useMemo(() => groupCatalogByCategory(catalog), [catalog]);
  const [searchTerm, setSearchTerm] = useState('');
  const [openControlFamilies, setOpenControlFamilies] = useState(() => getInitialOpenControlFamilies(draft, catalog));
  const [pendingPolicyMode, setPendingPolicyMode] = useState('');
  const [pendingSaveConfirmation, setPendingSaveConfirmation] = useState(false);

  useEffect(() => {
    setOpenControlFamilies(getInitialOpenControlFamilies(draft, catalog));
  }, [catalog, draft.policyId, draft.selectedControls]);

  const filteredGroups = useMemo(
    () => filterCatalogGroups(groupedCatalog, catalog, searchTerm),
    [catalog, groupedCatalog, searchTerm]
  );

  const displayName = deriveDisplayName(draft.baseName, getScopeLabel(draft));
  const selectedFamilyCount = countSelectedControlFamilies(draft.selectedControls || []);
  const expectedAutomationCount = countExpectedAutomations(draft.selectedControls || []);
  const sectionErrors = validationResult.sectionErrors || [];
  const blockingMessage = validationResult.blockingMessage || '';

  function fieldError(fieldName) {
    return validationResult.fieldErrors?.[fieldName] || '';
  }

  function handleRunEveryHoursChange(value) {
    onChange(updateRunEveryHours(draft, value));
  }

  function handleCompletionDeadlineChange(value) {
    onChange(updateCompletionDeadline(draft, value));
  }

  function handleControlToggle(control, selected) {
    const nextDraft = applyControlSelection(draft, control, selected, catalog);
    onChange(nextDraft);
    if (selected) {
      setOpenControlFamilies((currentState) => ({
        ...currentState,
        [control.automationGroupId]: true
      }));
    }
  }

  function handleParameterChange(controlId, parameterId, value) {
    onChange(updateControlParameter(draft, controlId, parameterId, value));
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

  function requestSaveConfirmation() {
    const nextValidationResult = validatePolicyDraft(draft, catalog, {});
    if (nextValidationResult.blockingMessage || Object.keys(nextValidationResult.fieldErrors || {}).length > 0) {
      onSave({ ...draft, __preventSave: true });
      return;
    }

    setPendingSaveConfirmation(true);
  }

  function confirmSave() {
    setPendingSaveConfirmation(false);
    onSave(draft);
  }

  const immutableControlStyle = isEditMode ? disabledControlStyle : formControlStyle;

  return (
    <div style={styles.shell}>
      <section style={styles.editorSurface}>
        <div style={styles.header}>
          <h2 style={styles.title}>{isEditMode ? 'Edit Policy' : 'Create Policy'}</h2>
          <p style={styles.description}>
            {isEditMode
              ? 'Update the saved demo Policy while preserving its locked Organization and Target scope.'
              : 'Create a Windows configuration Policy that evaluates endpoint settings and, when enabled, reserves deterministic demo Action1 automations.'}
          </p>
        </div>

        {blockingMessage ? <p style={styles.errorNotice}>{blockingMessage}</p> : null}
        {sectionErrors.map((sectionError) => (
          <p key={sectionError} style={styles.errorNotice}>{sectionError}</p>
        ))}

        <section style={styles.section}>
          <h3 style={styles.sectionHeading}>Policy details</h3>
          <div style={styles.fields}>
            <label style={{ ...styles.fieldStack, ...styles.fullWidth }}>
              <span style={styles.label}>Policy name *</span>
              <input
                type="text"
                value={draft.baseName}
                onChange={(event) => updateDraftField(draft, onChange, 'baseName', event.target.value)}
                style={formControlStyle}
              />
              {fieldError('baseName') ? <p style={styles.errorText}>{fieldError('baseName')}</p> : null}
            </label>
            <label style={{ ...styles.fieldStack, ...styles.fullWidth }}>
              <span style={styles.label}>Description</span>
              <textarea
                rows={4}
                value={draft.description || ''}
                onChange={(event) => updateDraftField(draft, onChange, 'description', event.target.value)}
                style={textareaControlStyle}
              />
            </label>
            <label style={{ ...styles.fieldStack, ...styles.fullWidth }}>
              <span style={styles.label}>Policy display name</span>
              <input type="text" value={displayName} readOnly style={readOnlyControlStyle} />
            </label>
          </div>
        </section>

        <hr style={styles.sectionDivider} />

        <section style={styles.section}>
          <h3 style={styles.sectionHeading}>Target</h3>
          <div style={styles.fields}>
            <label style={styles.fieldStack}>
              <span style={styles.label}>Organization *</span>
              {isEditMode ? (
                <input type="text" value={draft.organizationName} readOnly={isEditMode} disabled={isEditMode} style={readOnlyControlStyle} />
              ) : (
                <select
                  value={draft.organizationId}
                  onChange={(event) => updateOrganization(draft, organizations, onChange, event.target.value)}
                  disabled={isEditMode}
                  style={immutableControlStyle}
                >
                  <option value="">Select organization</option>
                  {organizations.map((organization) => (
                    <option key={organization.organizationId} value={organization.organizationId}>
                      {organization.organizationName}
                    </option>
                  ))}
                </select>
              )}
              {fieldError('organizationId') ? <p style={styles.errorText}>{fieldError('organizationId')}</p> : null}
            </label>

            <div style={styles.fieldStack}>
              <span style={styles.label}>Apply Policy to *</span>
              <label>
                <input
                  type="radio"
                  name="scopeType"
                  checked={draft.scopeType === 'ALL_ENDPOINTS'}
                  onChange={() => updateScopeType(draft, onChange, 'ALL_ENDPOINTS')}
                  disabled={isEditMode}
                  style={compactCheckboxStyle}
                />{' '}
                All endpoints
              </label>
              <label>
                <input
                  type="radio"
                  name="scopeType"
                  checked={draft.scopeType === 'ENDPOINT_GROUP'}
                  onChange={() => updateScopeType(draft, onChange, 'ENDPOINT_GROUP')}
                  disabled={isEditMode}
                  style={compactCheckboxStyle}
                />{' '}
                Endpoint group
              </label>
              {fieldError('scopeType') ? <p style={styles.errorText}>{fieldError('scopeType')}</p> : null}
            </div>

            <label style={styles.fieldStack}>
              <span style={styles.label}>Endpoint group *</span>
              {isEditMode ? (
                <input
                  type="text"
                  value={draft.scopeType === 'ALL_ENDPOINTS' ? 'All endpoints' : draft.endpointGroupName}
                  readOnly={isEditMode}
                  disabled={isEditMode}
                  style={readOnlyControlStyle}
                />
              ) : (
                <select
                  value={draft.endpointGroupId}
                  onChange={(event) => updateEndpointGroup(draft, endpointGroups, onChange, event.target.value)}
                  disabled={isEditMode || draft.scopeType !== 'ENDPOINT_GROUP'}
                  style={isEditMode || draft.scopeType !== 'ENDPOINT_GROUP' ? disabledControlStyle : formControlStyle}
                >
                  <option value="">Select endpoint group</option>
                  {endpointGroups.map((endpointGroup) => (
                    <option key={endpointGroup.endpointGroupId} value={endpointGroup.endpointGroupId}>
                      {endpointGroup.endpointGroupName}
                    </option>
                  ))}
                </select>
              )}
              {fieldError('endpointGroupId') ? <p style={styles.errorText}>{fieldError('endpointGroupId')}</p> : null}
            </label>
          </div>
        </section>

        <hr style={styles.sectionDivider} />

        <section style={styles.section}>
          <h3 style={styles.sectionHeading}>Policy mode</h3>
          <div style={styles.radioRow}>
            <label style={styles.radioOption}>
              <span>
                <input
                  type="radio"
                  name="policyMode"
                  checked={draft.policyMode === 'ASSESS_ONLY'}
                  onChange={() => handlePolicyModeChange('ASSESS_ONLY')}
                  style={compactCheckboxStyle}
                />{' '}
                Assess only
              </span>
              <span style={styles.helperText}>Assess configuration without changing endpoint settings.</span>
            </label>
            <label style={styles.radioOption}>
              <span>
                <input
                  type="radio"
                  name="policyMode"
                  checked={draft.policyMode === 'ASSESS_AND_REMEDIATE'}
                  onChange={() => handlePolicyModeChange('ASSESS_AND_REMEDIATE')}
                  style={compactCheckboxStyle}
                />{' '}
                Assess and remediate
              </span>
              <span style={styles.helperText}>Assess configuration, remediate once, and verify once.</span>
            </label>
          </div>
        </section>

        <hr style={styles.sectionDivider} />

        <section style={styles.section}>
          <h3 style={styles.sectionHeading}>Run schedule</h3>
          <div style={styles.scheduleLayout}>
            <div style={styles.schedulePrimaryRow}>
              <label style={styles.fieldStack}>
                <span style={styles.label}>Run every *</span>
                <input
                  type="number"
                  min="1"
                  value={draft.runSchedule.runEveryHours}
                  onChange={(event) => handleRunEveryHoursChange(event.target.value)}
                  style={formControlStyle}
                />
                <p style={styles.helperText}>Hours between Policy automation runs.</p>
                {fieldError('runEveryHours') ? <p style={styles.errorText}>{fieldError('runEveryHours')}</p> : null}
              </label>
              <label style={styles.fieldStack}>
                <span style={styles.label}>Start date *</span>
                <input
                  type="date"
                  value={draft.runSchedule.startDate}
                  onChange={(event) => updateRunScheduleField(draft, onChange, 'startDate', event.target.value)}
                  style={formControlStyle}
                />
                <p style={styles.helperText}>First scheduled Policy date.</p>
                {fieldError('startDate') ? <p style={styles.errorText}>{fieldError('startDate')}</p> : null}
              </label>
              <label style={styles.fieldStack}>
                <span style={styles.label}>Start time *</span>
                <input
                  type="time"
                  value={draft.runSchedule.startTime}
                  onChange={(event) => updateRunScheduleField(draft, onChange, 'startTime', event.target.value)}
                  style={formControlStyle}
                />
                <p style={styles.helperText}>Local Marketplace time for the first run.</p>
                {fieldError('startTime') ? <p style={styles.errorText}>{fieldError('startTime')}</p> : null}
              </label>
            </div>
            <div style={styles.scheduleSecondaryRow}>
              <label style={styles.fieldStack}>
                <span style={styles.label}>Timezone</span>
                <input
                  type="text"
                  value={draft.runSchedule.timezone}
                  onChange={(event) => updateRunScheduleField(draft, onChange, 'timezone', event.target.value)}
                  style={formControlStyle}
                />
                <p style={styles.helperText}>Timezone used for scheduled starts.</p>
                {fieldError('timezone') ? <p style={styles.errorText}>{fieldError('timezone')}</p> : null}
              </label>
              <label style={styles.fieldStack}>
                <span style={styles.label}>Automation completion deadline *</span>
                <input
                  type="number"
                  min="1"
                  value={draft.completionDeadlineMinutes}
                  onChange={(event) => handleCompletionDeadlineChange(event.target.value)}
                  style={formControlStyle}
                />
                <p style={styles.helperText}>
                  Offline or disconnected endpoints can continue retrying until this deadline is reached.
                </p>
                {fieldError('completionDeadlineMinutes') ? (
                  <p style={styles.errorText}>{fieldError('completionDeadlineMinutes')}</p>
                ) : null}
              </label>
            </div>
          </div>
        </section>

        <hr style={styles.sectionDivider} />

        <section style={styles.section}>
          <h3 style={styles.sectionHeading}>Controls</h3>
          <label style={{ ...styles.fieldStack, ...styles.fullWidth }}>
            <span style={styles.label}>Search Controls</span>
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search controls"
              style={formControlStyle}
            />
          </label>
          <div style={styles.hierarchy}>
            {filteredGroups.map(({ category, controlFamilies }) => (
              <section key={category.familyId} style={styles.categoryBlock} aria-label={`Category ${category.name}`}>
                <h4 style={styles.categoryHeading}>Category</h4>
                <p style={styles.categoryName}>{category.name}</p>
                <ul style={styles.familyList}>
                  {controlFamilies.map((controlFamily) => {
                    const selectedControls = controlFamily.controls.filter((control) => Boolean(getSelectedControlEntry(draft, control.controlId)));
                    const isOpen = Boolean(openControlFamilies[controlFamily.automationGroupId]);
                    return (
                      <li key={controlFamily.automationGroupId} style={styles.familyItem}>
                        <button
                          type="button"
                          style={styles.familyToggle}
                          aria-expanded={isOpen}
                          aria-label={`Control Family ${controlFamily.name}`}
                          onClick={() =>
                            setOpenControlFamilies((currentState) => ({
                              ...currentState,
                              [controlFamily.automationGroupId]: !currentState[controlFamily.automationGroupId]
                            }))
                          }
                        >
                          <span style={styles.familyHeading}>
                            <span style={styles.familyLabel}>Control Family</span>
                            <span style={styles.familyName}>{controlFamily.name}</span>
                          </span>
                          <span style={styles.familyMeta}>
                            {selectedControls.length > 0 ? (
                              <span style={styles.countBadge}>{selectedControls.length} selected</span>
                            ) : null}
                            <span>{isOpen ? 'Collapse' : 'Expand'}</span>
                          </span>
                        </button>
                        {isOpen ? (
                          <ul style={styles.controlList}>
                            {controlFamily.controls.map((control) => {
                              const selectedControl = getSelectedControlEntry(draft, control.controlId);
                              return (
                                <li key={control.controlId} style={styles.controlItem}>
                                  <label style={styles.controlLabel} aria-label={`Control ${control.name}`}>
                                    <input
                                      type="checkbox"
                                      checked={Boolean(selectedControl)}
                                      onChange={(event) => handleControlToggle(control, event.target.checked)}
                                      style={compactCheckboxStyle}
                                    />
                                    <span>
                                      <span style={styles.controlName}>{control.name}</span>
                                      <span style={styles.controlDescription}>{control.description}</span>
                                    </span>
                                  </label>
                                  {selectedControl ? (
                                    <div style={styles.parameterBlock}>
                                      {(control.parameters || []).map((parameter) => (
                                        <ParameterField
                                          key={parameter.id}
                                          parameter={parameter}
                                          value={selectedControl.parameters?.[parameter.id]}
                                          onChange={(value) => handleParameterChange(control.controlId, parameter.id, value)}
                                          errorMessage={fieldError(`${control.controlId}.${parameter.id}`)}
                                        />
                                      ))}
                                    </div>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
          {fieldError('selectedControls') ? <p style={styles.errorText}>{fieldError('selectedControls')}</p> : null}
        </section>

        <hr style={styles.sectionDivider} />

        <section style={styles.section}>
          <h3 style={styles.sectionHeading}>Summary</h3>
          <div style={styles.summaryList}>
            <div style={styles.summaryRow}>
              <p style={styles.summaryLabel}>Policy</p>
              <p style={styles.summaryValue}>{displayName || 'Choose an Organization and Target scope to derive the Policy name.'}</p>
            </div>
            <div style={styles.summaryRow}>
              <p style={styles.summaryLabel}>Organization</p>
              <p style={styles.summaryValue}>{draft.organizationName || 'Not selected'}</p>
            </div>
            <div style={styles.summaryRow}>
              <p style={styles.summaryLabel}>Target</p>
              <p style={styles.summaryValue}>{getScopeLabel(draft) || 'Not selected'}</p>
            </div>
            <div style={styles.summaryRow}>
              <p style={styles.summaryLabel}>Mode</p>
              <p style={styles.summaryValue}>{draft.policyMode === 'ASSESS_ONLY' ? 'Assess only' : 'Assess and remediate'}</p>
            </div>
            <div style={styles.summaryRow}>
              <p style={styles.summaryLabel}>Run schedule</p>
              <p style={styles.summaryValue}>Every {draft.runSchedule.runEveryHours} hour(s)</p>
            </div>
            <div style={styles.summaryRow}>
              <p style={styles.summaryLabel}>Controls</p>
              <p style={styles.summaryValue}>{countLabel(draft.selectedControls.length, 'selected Control')}</p>
            </div>
            <div style={styles.summaryRow}>
              <p style={styles.summaryLabel}>Control Families</p>
              <p style={styles.summaryValue}>{countLabel(selectedFamilyCount, 'Control Family', 'Control Families')}</p>
            </div>
            <div style={styles.summaryRow}>
              <p style={styles.summaryLabel}>Action1 automations</p>
              <p style={styles.summaryValue}>{countLabel(expectedAutomationCount, 'Action1 automation')}</p>
            </div>
          </div>
        </section>

        <div style={styles.footer}>
          <button type="button" style={styles.button} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" style={styles.primaryButton} onClick={requestSaveConfirmation}>
            Save and apply
          </button>
        </div>
      </section>

      {pendingPolicyMode ? (
        <div style={styles.modalBackdrop}>
          <div style={styles.modalCard}>
            <h3 style={styles.modalTitle}>Confirm remediation</h3>
            <p style={styles.modalText}>
              Assess and remediate can change endpoint settings. Confirm before the Policy mode changes.
            </p>
            <div style={styles.footer}>
              <button type="button" style={styles.button} onClick={() => setPendingPolicyMode('')}>
                Cancel
              </button>
              <button type="button" style={styles.primaryButton} onClick={confirmAssessAndRemediate}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingSaveConfirmation ? (
        <div style={styles.modalBackdrop}>
          <div style={styles.modalCard}>
            <h3 style={styles.modalTitle}>Save and apply Policy</h3>
            <p style={styles.modalText}>
              Save this Policy, apply the current schedule and Controls selection, and then Open details from the list to inspect the saved demo Action1 automations.
            </p>
            <div style={styles.summaryList}>
              <div style={styles.summaryRow}>
                <p style={styles.summaryLabel}>Policy</p>
                <p style={styles.summaryValue}>{displayName || 'Unnamed Policy'}</p>
              </div>
              <div style={styles.summaryRow}>
                <p style={styles.summaryLabel}>Target</p>
                <p style={styles.summaryValue}>{getScopeLabel(draft) || 'Not selected'}</p>
              </div>
              <div style={styles.summaryRow}>
                <p style={styles.summaryLabel}>Action1 automations</p>
                <p style={styles.summaryValue}>{countLabel(expectedAutomationCount, 'Action1 automation')}</p>
              </div>
            </div>
            <div style={styles.footer}>
              <button type="button" style={styles.button} onClick={() => setPendingSaveConfirmation(false)}>
                Cancel
              </button>
              <button type="button" style={styles.primaryButton} onClick={confirmSave}>
                Save and apply
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default PolicyEditorView;
