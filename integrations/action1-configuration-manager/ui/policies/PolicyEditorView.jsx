import { useMemo, useState } from 'react';
import { countSelectedControlFamilies, countExpectedAutomations } from '../catalog/controlPackCatalog.js';
import { applyControlSelection, updateControlParameter } from './policyEditorState.js';
import { validatePolicyDraft } from './policyValidation.js';
import { deriveDisplayName } from './policyViewModel.js';
import ParameterField from './ParameterField.jsx';

const styles = {
  shell: {
    display: 'grid',
    gap: '0.5rem'
  },
  card: {
    border: '1px solid var(--border-color, rgba(255,255,255,0.12))',
    borderRadius: 14,
    padding: '1rem',
    background: 'var(--panel-background, rgba(15,23,42,0.36))',
    display: 'grid',
    gap: '0.85rem'
  },
  title: {
    margin: 0,
    fontSize: '1.125rem'
  },
  description: {
    margin: 0,
    color: 'var(--text-secondary)'
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
    gap: '0.35rem'
  },
  helperText: {
    margin: 0,
    color: 'var(--text-secondary)',
    fontSize: '0.82rem'
  },
  errorText: {
    margin: 0,
    color: '#fda4af',
    fontSize: '0.82rem'
  },
  radioRow: {
    display: 'grid',
    gap: '0.75rem'
  },
  radioCard: {
    border: '1px solid var(--border-color, rgba(255,255,255,0.12))',
    borderRadius: 12,
    padding: '0.85rem',
    display: 'grid',
    gap: '0.35rem'
  },
  controlLayout: {
    display: 'grid',
    gap: '0.85rem'
  },
  controlFamilyCard: {
    border: '1px solid var(--border-color, rgba(255,255,255,0.08))',
    borderRadius: 12,
    overflow: 'hidden'
  },
  controlFamilyHeader: {
    width: '100%',
    border: 'none',
    background: 'rgba(255,255,255,0.03)',
    color: 'inherit',
    padding: '0.85rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer',
    textAlign: 'left'
  },
  controlBody: {
    display: 'grid',
    gap: '0.75rem',
    padding: '0.85rem'
  },
  controlCard: {
    border: '1px solid var(--border-color, rgba(255,255,255,0.08))',
    borderRadius: 12,
    padding: '0.85rem',
    display: 'grid',
    gap: '0.5rem'
  },
  summaryGrid: {
    display: 'grid',
    gap: '0.75rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))'
  },
  summaryItem: {
    border: '1px solid var(--border-color, rgba(255,255,255,0.08))',
    borderRadius: 12,
    padding: '0.85rem'
  },
  summaryLabel: {
    margin: 0,
    fontSize: '0.82rem',
    color: 'var(--text-secondary)'
  },
  summaryValue: {
    margin: '0.25rem 0 0',
    fontWeight: 600
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.5rem'
  },
  button: {
    border: '1px solid var(--border-color, rgba(255,255,255,0.18))',
    borderRadius: 999,
    padding: '0.6rem 0.95rem',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer'
  },
  primaryButton: {
    border: 'none',
    borderRadius: 999,
    padding: '0.6rem 1rem',
    background: 'var(--brand-color, #3b82f6)',
    color: 'white',
    cursor: 'pointer',
    fontWeight: 600
  },
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.58)',
    display: 'grid',
    placeItems: 'center',
    padding: '1rem'
  },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    borderRadius: 14,
    border: '1px solid var(--border-color, rgba(255,255,255,0.18))',
    background: 'rgb(15, 23, 42)',
    padding: '1rem',
    display: 'grid',
    gap: '0.75rem'
  }
};

function getScopeLabel(draft) {
  return draft.scopeType === 'ALL_ENDPOINTS' ? 'All endpoints' : draft.endpointGroupName;
}

function getSelectedControlEntry(draft, controlId) {
  return (draft.selectedControls || []).find((entry) => entry.controlId === controlId) || null;
}

function groupControlFamilies(catalog) {
  return catalog.families.map((family) => ({
    family,
    controlFamilies: catalog.controlFamilies.filter((entry) => entry.familyId === family.familyId)
  }));
}

function filterCatalogGroups(groupedControlFamilies, catalog, searchTerm) {
  const normalizedSearch = String(searchTerm || '').trim().toLowerCase();
  if (!normalizedSearch) {
    return groupedControlFamilies;
  }

  return groupedControlFamilies
    .map(({ family, controlFamilies }) => {
      const nextControlFamilies = controlFamilies
        .map((controlFamily) => {
          const controls = catalog.controls.filter(
            (control) =>
              control.automationGroupId === controlFamily.automationGroupId &&
              (control.name.toLowerCase().includes(normalizedSearch) ||
                controlFamily.name.toLowerCase().includes(normalizedSearch) ||
                family.name.toLowerCase().includes(normalizedSearch))
          );

          return {
            ...controlFamily,
            controls
          };
        })
        .filter((controlFamily) => controlFamily.controls.length > 0);

      return {
        family,
        controlFamilies: nextControlFamilies
      };
    })
    .filter((entry) => entry.controlFamilies.length > 0);
}

function updateDraftField(draft, onChange, fieldName, value) {
  onChange({
    ...draft,
    [fieldName]: value
  });
}

function updateRunSchedule(draft, onChange, fieldName, value) {
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
  const groupedControlFamilies = useMemo(() => groupControlFamilies(catalog), [catalog]);
  const [searchTerm, setSearchTerm] = useState('');
  const [openControlFamilies, setOpenControlFamilies] = useState(() => {
    const initialState = {};
    for (const controlFamily of catalog.controlFamilies) {
      initialState[controlFamily.automationGroupId] = true;
    }
    return initialState;
  });
  const [pendingPolicyMode, setPendingPolicyMode] = useState('');
  const filteredGroups = useMemo(
    () => filterCatalogGroups(groupedControlFamilies, catalog, searchTerm),
    [catalog, groupedControlFamilies, searchTerm]
  );

  const displayName = deriveDisplayName(draft.baseName, getScopeLabel(draft));
  const selectedFamilyCount = countSelectedControlFamilies(draft.selectedControls || []);
  const expectedAutomationCount = countExpectedAutomations(draft.selectedControls || []);
  const sectionErrors = validationResult.sectionErrors || [];
  const blockingMessage = validationResult.blockingMessage || '';

  function fieldError(fieldName) {
    return validationResult.fieldErrors?.[fieldName] || '';
  }

  function handleSave() {
    const nextValidationResult = validatePolicyDraft(draft, catalog, {});
    if (nextValidationResult.blockingMessage || Object.keys(nextValidationResult.fieldErrors).length > 0) {
      onSave({ ...draft, __preventSave: true });
      return;
    }
    onSave(draft);
  }

  function handleControlToggle(control, selected) {
    onChange(applyControlSelection(draft, control, selected, catalog));
  }

  function handleParameterChange(controlId, parameterId, value) {
    onChange(updateControlParameter(draft, controlId, parameterId, value));
  }

  function confirmAssessAndRemediate() {
    onChange({
      ...draft,
      policyMode: 'ASSESS_AND_REMEDIATE'
    });
    setPendingPolicyMode('');
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

  return (
    <div style={styles.shell}>
      <section style={styles.card}>
        <h2 style={styles.title}>{isEditMode ? 'Edit Policy' : 'Create Policy'}</h2>
        <p style={styles.description}>
          {isEditMode
            ? 'Update the saved demo Policy without changing its organization or scope.'
            : 'Create a configuration Policy and deploy it through Action1 automations.'}
        </p>
      </section>

      {blockingMessage ? (
        <section style={styles.card}>
          <p style={styles.errorText}>{blockingMessage}</p>
        </section>
      ) : null}

      {sectionErrors.map((sectionError) => (
        <section style={styles.card} key={sectionError}>
          <p style={styles.errorText}>{sectionError}</p>
        </section>
      ))}

      <section style={styles.card}>
        <h2 style={styles.title}>Policy details</h2>
        <div style={styles.fields}>
          <label style={styles.fieldStack}>
            <span>Policy name *</span>
            <input
              type="text"
              value={draft.baseName}
              onChange={(event) => updateDraftField(draft, onChange, 'baseName', event.target.value)}
            />
            {fieldError('baseName') ? <p style={styles.errorText}>{fieldError('baseName')}</p> : null}
          </label>
          <label style={{ ...styles.fieldStack, ...styles.fullWidth }}>
            <span>Description</span>
            <textarea
              rows={3}
              value={draft.description || ''}
              onChange={(event) => updateDraftField(draft, onChange, 'description', event.target.value)}
            />
          </label>
        </div>
      </section>

      <section style={styles.card}>
        <h2 style={styles.title}>Scope</h2>
        <div style={styles.fields}>
          <label style={styles.fieldStack}>
            <span>Organization *</span>
            {isEditMode ? (
              <input type="text" value={draft.organizationName} readOnly={isEditMode} disabled={isEditMode} />
            ) : (
              <select
                value={draft.organizationId}
                onChange={(event) => updateOrganization(draft, organizations, onChange, event.target.value)}
                disabled={isEditMode}
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
            <span>Apply Policy to *</span>
            <label>
              <input
                type="radio"
                name="scopeType"
                checked={draft.scopeType === 'ALL_ENDPOINTS'}
                onChange={() => updateScopeType(draft, onChange, 'ALL_ENDPOINTS')}
                disabled={isEditMode}
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
              />{' '}
              Endpoint group
            </label>
            {fieldError('scopeType') ? <p style={styles.errorText}>{fieldError('scopeType')}</p> : null}
          </div>

          <label style={styles.fieldStack}>
            <span>Endpoint group *</span>
            {isEditMode ? (
              <input type="text" value={draft.endpointGroupName || 'All endpoints'} readOnly={isEditMode} disabled={isEditMode} />
            ) : (
              <select
                value={draft.endpointGroupId}
                onChange={(event) => updateEndpointGroup(draft, endpointGroups, onChange, event.target.value)}
                disabled={isEditMode || draft.scopeType !== 'ENDPOINT_GROUP'}
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

          <div style={{ ...styles.fieldStack, ...styles.fullWidth }}>
            <span>Policy display name</span>
            <input type="text" value={displayName} readOnly />
          </div>
        </div>
      </section>

      <section style={styles.card}>
        <h2 style={styles.title}>Policy mode</h2>
        <div style={styles.radioRow}>
          <label style={styles.radioCard}>
            <span>
              <input
                type="radio"
                name="policyMode"
                checked={draft.policyMode === 'ASSESS_ONLY'}
                onChange={() => handlePolicyModeChange('ASSESS_ONLY')}
              />{' '}
              Assess only
            </span>
            <span style={styles.helperText}>Assess configuration without changing endpoint settings.</span>
          </label>
          <label style={styles.radioCard}>
            <span>
              <input
                type="radio"
                name="policyMode"
                checked={draft.policyMode === 'ASSESS_AND_REMEDIATE'}
                onChange={() => handlePolicyModeChange('ASSESS_AND_REMEDIATE')}
              />{' '}
              Assess and remediate
            </span>
            <span style={styles.helperText}>Assess configuration, remediate once, and verify once.</span>
          </label>
        </div>
        <p style={styles.helperText}>Returning to Assess only does not require confirmation.</p>
      </section>

      <section style={styles.card}>
        <h2 style={styles.title}>Run schedule</h2>
        <div style={styles.fields}>
          <label style={styles.fieldStack}>
            <span>Run every *</span>
            <input
              type="number"
              min="1"
              value={draft.runSchedule.runEveryHours}
              onChange={(event) => updateRunSchedule(draft, onChange, 'runEveryHours', event.target.value)}
            />
            <p style={styles.helperText}>hour(s)</p>
            {fieldError('runEveryHours') ? <p style={styles.errorText}>{fieldError('runEveryHours')}</p> : null}
          </label>
          <label style={styles.fieldStack}>
            <span>Start date *</span>
            <input
              type="date"
              value={draft.runSchedule.startDate}
              onChange={(event) => updateRunSchedule(draft, onChange, 'startDate', event.target.value)}
            />
            {fieldError('startDate') ? <p style={styles.errorText}>{fieldError('startDate')}</p> : null}
          </label>
          <label style={styles.fieldStack}>
            <span>Start time *</span>
            <input
              type="time"
              value={draft.runSchedule.startTime}
              onChange={(event) => updateRunSchedule(draft, onChange, 'startTime', event.target.value)}
            />
            {fieldError('startTime') ? <p style={styles.errorText}>{fieldError('startTime')}</p> : null}
          </label>
          <label style={styles.fieldStack}>
            <span>Timezone</span>
            <input
              type="text"
              value={draft.runSchedule.timezone}
              onChange={(event) => updateRunSchedule(draft, onChange, 'timezone', event.target.value)}
            />
            {fieldError('timezone') ? <p style={styles.errorText}>{fieldError('timezone')}</p> : null}
          </label>
          <label style={{ ...styles.fieldStack, ...styles.fullWidth }}>
            <span>Automation completion deadline *</span>
            <input
              type="number"
              min="1"
              value={draft.completionDeadlineMinutes}
              onChange={(event) => updateDraftField(draft, onChange, 'completionDeadlineMinutes', event.target.value)}
            />
            <p style={styles.helperText}>
              Offline or disconnected endpoints may retry until this deadline. Action1 terminates the automation when the deadline is exceeded.
            </p>
            {fieldError('completionDeadlineMinutes') ? (
              <p style={styles.errorText}>{fieldError('completionDeadlineMinutes')}</p>
            ) : null}
          </label>
        </div>
      </section>

      <section style={styles.card}>
        <h2 style={styles.title}>Controls</h2>
        <div style={styles.controlLayout}>
          <label style={styles.fieldStack}>
            <span>Search Controls</span>
            <input type="text" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search controls..." />
          </label>

          {filteredGroups.map(({ family, controlFamilies }) => (
            <div key={family.familyId} style={styles.controlLayout}>
              <h3 style={{ margin: 0 }}>Family: {family.name}</h3>
              {controlFamilies.map((controlFamily) => {
                const controls = catalog.controls.filter((control) => control.automationGroupId === controlFamily.automationGroupId);
                const selectedCount = controls.filter((control) => Boolean(getSelectedControlEntry(draft, control.controlId))).length;
                const isOpen = openControlFamilies[controlFamily.automationGroupId];
                return (
                  <div key={controlFamily.automationGroupId} style={styles.controlFamilyCard}>
                    <button
                      type="button"
                      style={styles.controlFamilyHeader}
                      onClick={() =>
                        setOpenControlFamilies((currentState) => ({
                          ...currentState,
                          [controlFamily.automationGroupId]: !currentState[controlFamily.automationGroupId]
                        }))
                      }
                    >
                      <span>Control Family: {controlFamily.name}</span>
                      <span>{selectedCount} selected</span>
                    </button>
                    {isOpen ? (
                      <div style={styles.controlBody}>
                        {controls.map((control) => {
                          const selectedControl = getSelectedControlEntry(draft, control.controlId);
                          return (
                            <div key={control.controlId} style={styles.controlCard}>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={Boolean(selectedControl)}
                                  onChange={(event) => handleControlToggle(control, event.target.checked)}
                                />{' '}
                                Control: {control.name}
                              </label>
                              <p style={styles.helperText}>{control.description}</p>
                              {selectedControl
                                ? (control.parameters || []).map((parameter) => (
                                    <ParameterField
                                      key={parameter.id}
                                      parameter={parameter}
                                      value={selectedControl.parameters?.[parameter.id]}
                                      onChange={(value) => handleParameterChange(control.controlId, parameter.id, value)}
                                      errorMessage={fieldError(`${control.controlId}.${parameter.id}`)}
                                    />
                                  ))
                                : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
          {fieldError('selectedControls') ? <p style={styles.errorText}>{fieldError('selectedControls')}</p> : null}
        </div>
      </section>

      <section style={styles.card}>
        <h2 style={styles.title}>Summary</h2>
        <p style={styles.description}>The Summary is read-only and appears at the bottom, not in a side panel.</p>
        <div style={styles.summaryGrid}>
          <div style={styles.summaryItem}>
            <p style={styles.summaryLabel}>Policy</p>
            <p style={styles.summaryValue}>{displayName || 'Choose a scope to derive the Policy name.'}</p>
          </div>
          <div style={styles.summaryItem}>
            <p style={styles.summaryLabel}>Organization</p>
            <p style={styles.summaryValue}>{draft.organizationName || 'Not selected'}</p>
          </div>
          <div style={styles.summaryItem}>
            <p style={styles.summaryLabel}>Scope</p>
            <p style={styles.summaryValue}>{getScopeLabel(draft) || 'Not selected'}</p>
          </div>
          <div style={styles.summaryItem}>
            <p style={styles.summaryLabel}>Mode</p>
            <p style={styles.summaryValue}>{draft.policyMode === 'ASSESS_ONLY' ? 'Assess only' : 'Assess and remediate'}</p>
          </div>
          <div style={styles.summaryItem}>
            <p style={styles.summaryLabel}>Run schedule</p>
            <p style={styles.summaryValue}>Every {draft.runSchedule.runEveryHours || 0} hours</p>
          </div>
          <div style={styles.summaryItem}>
            <p style={styles.summaryLabel}>Controls</p>
            <p style={styles.summaryValue}>{draft.selectedControls.length} selected</p>
          </div>
          <div style={styles.summaryItem}>
            <p style={styles.summaryLabel}>Selected families</p>
            <p style={styles.summaryValue}>{selectedFamilyCount}</p>
          </div>
          <div style={styles.summaryItem}>
            <p style={styles.summaryLabel}>Action1 automations</p>
            <p style={styles.summaryValue}>{expectedAutomationCount} Action1 automations will be created</p>
          </div>
        </div>
      </section>

      <div style={styles.footer}>
        <button type="button" style={styles.button} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" style={styles.primaryButton} onClick={handleSave}>
          {isEditMode ? 'Save changes' : 'Save and apply'}
        </button>
      </div>

      {pendingPolicyMode ? (
        <div style={styles.modalBackdrop}>
          <div style={styles.modalCard}>
            <h3 style={{ margin: 0 }}>Confirm remediation</h3>
            <p style={styles.description}>Assess and remediate can change endpoint settings. Confirm before the Policy mode changes.</p>
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
    </div>
  );
}

export default PolicyEditorView;
