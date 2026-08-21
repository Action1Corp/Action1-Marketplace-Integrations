function buildRunPowerShellParams(scriptText, options = {}) {
  const params = {
    display_summary: '',
    condition_script_text: '',
    condition_script_language: 'PowerShell',
    run_script_params: [],
    run_script_text: String(scriptText || ''),
    run_script_language: 'PowerShell'
  };

  if (options.includeReboot) {
    params.reboot_exit_codes = '';
    params.reboot_options = { auto_reboot: 'no', show_message: 'no', message_text: '', timeout: 240 };
  }

  return params;
}

module.exports = { buildRunPowerShellParams };
