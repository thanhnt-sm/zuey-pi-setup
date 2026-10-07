export function sanitizeXmlText(raw: string): string {
  const injectionRegex = /(CRITICAL SYSTEM OVERRIDE|IGNORE ALL PREVIOUS INSTRUCTIONS|SYSTEM PROMPT:)/gi;
  let sanitized = raw.replace(injectionRegex, "[REDACTED_INJECTION_ATTEMPT]");

  return sanitized;
}

export function encloseUntrusted(content: string, tag: string): string {
  let sanitizedContent = sanitizeXmlText(content);
  
  const conflictingTagRegex = new RegExp(`</${tag}>`, 'gi');
  sanitizedContent = sanitizedContent.replace(conflictingTagRegex, `&lt;/${tag}&gt;`);
  
  return `<${tag}>\n${sanitizedContent}\n</${tag}>`;
}
