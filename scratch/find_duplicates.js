
const fs = require('fs');
const content = fs.readFileSync('/Users/macbook/dev/rust/sandra-desktop-container/src/app/pages/security/security.component.ts', 'utf8');
const lines = content.split('\n');
const functions = Object.create(null);

lines.forEach((line, index) => {
  // Match method definitions: spaces followed by optional async/public/private, then name, then (
  const match = line.match(/^\s*(?:async\s+|public\s+|private\s+)*([a-zA-Z0-9_]+)\s*\(/);
  if (match) {
    const name = match[1];
    // Ignore common keywords that might look like functions
    if (['if', 'for', 'while', 'switch', 'catch', 'constructor', 'invoke', 'listen'].includes(name)) return;
    
    if (!functions[name]) {
      functions[name] = [];
    }
    functions[name].push(index + 1);
  }
});

for (const name in functions) {
  if (functions[name].length > 1) {
    console.log(`Duplicate function: ${name} at lines ${functions[name].join(', ')}`);
  }
}
