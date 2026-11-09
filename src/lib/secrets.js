'use strict';
// Guarda claves cifradas con el almacén de Windows (safeStorage de Electron).
// La clave NUNCA vuelve a la interfaz: solo se usa dentro del proceso principal.
const fs = require('node:fs');
const path = require('node:path');

function createSecrets({ dir, safeStorage }) {
  const file = path.join(dir, 'secrets.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
  const write = (obj) => {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };
  const available = () => { try { return !!safeStorage?.isEncryptionAvailable(); } catch { return false; } };

  return {
    available,
    set(name, value) {
      if (!available()) throw new Error('Este equipo no permite cifrar claves. No la guardo en texto plano.');
      const v = String(value ?? '').trim();
      if (!v) throw new Error('La clave está vacía.');
      const all = read();
      all[name] = safeStorage.encryptString(v).toString('base64');
      write(all);
    },
    get(name) {
      const b64 = read()[name];
      if (!b64 || !available()) return null;
      try { return safeStorage.decryptString(Buffer.from(b64, 'base64')); } catch { return null; }
    },
    has(name) { return !!read()[name]; },
    clear(name) { const all = read(); delete all[name]; write(all); },
  };
}

module.exports = { createSecrets };
