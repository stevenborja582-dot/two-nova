// Genera los iconos (dos ojos sobre una pastilla oscura) con Chromium/Playwright.
const { chromium } = require('playwright');
const path = require('node:path');
const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
<rect width="64" height="64" rx="16" fill="#0b0d12"/>
<rect x="6" y="20" width="52" height="24" rx="12" fill="#141824" stroke="#8fb0ff" stroke-opacity=".55" stroke-width="2"/>
<rect x="21" y="26" width="7" height="12" rx="3.5" fill="#8fb0ff"/><rect x="36" y="26" width="7" height="12" rx="3.5" fill="#8fb0ff"/></svg>`;
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage();
  for (const [file, size] of [['assets/tray.png', 32], ['build/icon.png', 512]]) {
    await pg.setViewportSize({ width: size, height: size });
    await pg.setContent(`<body style="margin:0;background:transparent">${svg(size)}</body>`);
    await pg.screenshot({ path: path.join(__dirname, '..', file), omitBackground: true });
  }
  await b.close();
})();
