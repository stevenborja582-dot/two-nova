'use strict';
const { mask, clip } = require('./mask');

// Clasifica el riesgo de una herramienta de Claude Code: 'low' | 'medium' | 'high' | 'unknown'.
// Es un aviso para ti, no una barrera: la decisión es siempre tuya.

const HIGH_BASH = [
  /\brm\s+(-[a-z]*[rf][a-z]*\s+)+/i,
  /\brm\s+--(recursive|force)/i,
  /\bsudo\b/i,
  /\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/i,
  /\b(curl|wget|iwr|irm)\b[^\n|]*\|\s*(iex|invoke-expression)\b/i,
  /\b(iex|invoke-expression)\b/i,
  /\bpowershell(\.exe)?\b[^\n]*\s-(e|enc|encodedcommand)\b/i,
  /\bgit\s+push\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\bgit\s+(checkout|restore)\s+(--\s+)?\.\s*$/i,
  /\bchmod\s+(-R\s+)?[0-7]*777\b/i,
  /\b(mkfs|fdisk|diskpart|format)\b/i,
  /\bdd\s+if=/i,
  /\b(shutdown|reboot|halt)\b/i,
  /\breg(\.exe)?\s+(delete|add)\b/i,
  /\b(del|erase|rmdir|rd)\s+(\/[sfq]\s*)+/i,
  /\bremove-item\b[^\n]*-recurse/i,
  /\bnpm\s+(publish|unpublish|login|adduser|token)\b/i,
  /\bdrop\s+(table|database)\b/i,
  /\b(netsh|schtasks|setx)\b/i,
  /\bset-executionpolicy\b/i,
  /\bdisable-?(defender|firewall)\b|\bset-mppreference\b/i,
  /\.ssh[\\/]|\.aws[\\/]|\.env\b|id_rsa|credentials/i,
  />\s*\/dev\/sd[a-z]/i,
];

const MEDIUM_BASH = [
  /\b(npm|pnpm|yarn|bun)\s+(i|install|add|update|upgrade|remove|uninstall|run|exec|dlx)\b/i,
  /\bnpx\b/i,
  /\bpip3?\s+(install|uninstall)\b/i,
  /\bgit\s+(commit|merge|rebase|stash|pull|checkout|switch|branch|tag|add|rm|mv|cherry-pick|revert)\b/i,
  /\b(mv|cp|mkdir|touch|ren|move|copy|xcopy|robocopy|ln)\b/i,
  /\b(curl|wget|iwr|irm|invoke-webrequest|ssh|scp)\b/i,
  /\b(docker|kubectl|terraform|make|cargo|go|dotnet|python3?|node|deno|java|mvn|gradle)\b/i,
  /(^|[^>])>>?\s*\S/,
  /\b(kill|taskkill|stop-process)\b/i,
];

const LOW_BASH_START = /^\s*(ls|dir|cat|type|head|tail|less|more|pwd|cd|echo|printf|which|where|whoami|date|wc|sort|uniq|find|grep|rg|tree|stat|file|du|df|env|printenv|get-childitem|get-content|select-string|get-location|test-path|git\s+(status|diff|log|show|branch\s*$|remote\s+-v|rev-parse|blame|ls-files)|npm\s+(test|ls|list|view|outdated|--version)|node\s+(-v|--version)|python3?\s+(-V|--version))(\s|$)/i;

function splitSegments(command) {
  return String(command).split(/&&|\|\||;|\||\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function bashRisk(command) {
  const cmd = String(command || '');
  if (!cmd.trim()) return 'unknown';
  if (HIGH_BASH.some((re) => re.test(cmd))) return 'high';
  const segs = splitSegments(cmd);
  const hasRedirect = /(^|[^>&0-9])>>?\s*\S/.test(cmd) && !/>\s*\/dev\/null/.test(cmd);
  if (!hasRedirect && segs.length && segs.every((s) => LOW_BASH_START.test(s))) return 'low';
  if (MEDIUM_BASH.some((re) => re.test(cmd))) return 'medium';
  return 'unknown';
}

const SENSITIVE_PATH = /(^|[\\/])(\.ssh|\.aws|\.gnupg|\.config[\\/]gcloud|AppData[\\/]Roaming[\\/]Microsoft[\\/]Windows[\\/]Start Menu)([\\/]|$)|(^|[\\/])(\.env(\..*)?|settings(\.local)?\.json|\.bashrc|\.zshrc|\.profile|authorized_keys|id_rsa.*|credentials.*)$/i;

function pathRisk(p) {
  if (!p) return 'medium';
  return SENSITIVE_PATH.test(String(p)) ? 'high' : 'medium';
}

function classify(toolName, toolInput) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  switch (toolName) {
    case 'Bash':
    case 'PowerShell':
      return bashRisk(input.command);
    case 'Read':
    case 'Glob':
    case 'Grep':
    case 'LS':
    case 'NotebookRead':
    case 'TodoWrite':
      return SENSITIVE_PATH.test(String(input.file_path || input.path || '')) ? 'high' : 'low';
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return pathRisk(input.file_path || input.notebook_path);
    case 'WebFetch':
    case 'WebSearch':
      return 'medium';
    default:
      return 'unknown';
  }
}

// Texto corto y seguro para mostrar en la isla. En permisos se muestra el comando completo.
function describe(toolName, toolInput, max = 4000) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  let text;
  switch (toolName) {
    case 'Bash':
    case 'PowerShell':
      text = input.command || '';
      break;
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'Read':
      text = input.file_path || '';
      break;
    case 'NotebookEdit':
      text = input.notebook_path || '';
      break;
    case 'Glob':
    case 'Grep':
      text = input.pattern || input.path || '';
      break;
    case 'WebFetch':
      text = input.url || '';
      break;
    case 'WebSearch':
      text = input.query || '';
      break;
    default: {
      try { text = JSON.stringify(input); } catch { text = ''; }
    }
  }
  return clip(mask(text), max);
}

module.exports = { classify, describe, bashRisk };
