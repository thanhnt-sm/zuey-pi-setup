import type { RemediationDirective } from "./types/security";

export function generateRemediationBlock(params: RemediationDirective): string {
  const dynamicActionItems = [...params.actionItems];
  const dynamicConstraints = [...params.immutableConstraints];

  // Synthesize dynamic action items based on failure reasons
  for (const reason of params.failureReasons) {
    if (reason.toLowerCase().includes("test suite failed") || reason.toLowerCase().includes("test failure")) {
      const fileMatch = reason.match(/([a-zA-Z0-9_-]+\.test\.ts)/i);
      if (fileMatch) {
        dynamicActionItems.push(`Run tests to verify fixes: bun test ${fileMatch[1]}`);
      } else {
        dynamicActionItems.push(`Run full test suite to verify fixes: bun test`);
      }
    }
    
    if (reason.toLowerCase().includes("test evasion") || reason.toLowerCase().includes("deleted assertion")) {
      dynamicActionItems.push("Restore deleted test assertions and ensure tests pass legitimately.");
      dynamicConstraints.push("Do not delete existing assertions or test blocks.");
    }
    
    if (reason.toLowerCase().includes("drift") || reason.toLowerCase().includes("scope creep")) {
      dynamicActionItems.push("Revert unapproved architectural changes and restrict modifications to planned boundaries.");
      dynamicConstraints.push("Strictly adhere to planned architecture and boundaries.");
    }
  }

  const uniqueConstraints = [...new Set(dynamicConstraints)];
  const uniqueActionItems = [...new Set(dynamicActionItems)];

  const constraintsXml = uniqueConstraints.map(c => `    <constraint>${c}</constraint>`).join("\n");
  const reasonsXml = params.failureReasons.map(r => `    <reason>${r}</reason>`).join("\n");
  const actionsXml = uniqueActionItems.map(a => `    <action>${a}</action>`).join("\n");
  const taskTag = params.taskId ? `  <task_id>${params.taskId}</task_id>\n` : "";
  const criteriaTag = params.criteria && params.criteria.length > 0
    ? `  <target_criteria>\n${params.criteria.map(c => `    <criterion>${c}</criterion>`).join("\n")}\n  </target_criteria>\n`
    : "";

  return `<remediation>
  <instruction>${params.instruction}</instruction>
${taskTag}${criteriaTag}  <immutable_constraints>
${constraintsXml}
  </immutable_constraints>
  <failure_reasons>
${reasonsXml}
  </failure_reasons>
  <action_items>
${actionsXml}
  </action_items>
</remediation>`;
}
