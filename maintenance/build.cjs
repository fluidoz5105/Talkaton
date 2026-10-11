const fs = require('node:fs');
fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/.keep', '');
