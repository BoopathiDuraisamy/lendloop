// Error Trigger payload -> minimal, signed report for LendLoop's admin view.
const { execution = {}, workflow = {}, trigger } = $input.first().json;
const message = (execution.error && execution.error.message) || (trigger && trigger.error && trigger.error.message) || 'Unknown error';
const report = {
  executionId: String(execution.id || `trigger-${Date.now()}`),
  workflowName: workflow.name || 'unknown workflow',
  nodeName: execution.lastNodeExecuted || undefined,
  message: String(message).slice(0, 500),
};
console.error(`[lendloop] workflow failed: ${report.workflowName} › ${report.nodeName}: ${report.message} (${execution.url || 'no url'})`);
return [{ json: signForLendLoop(report) }];
