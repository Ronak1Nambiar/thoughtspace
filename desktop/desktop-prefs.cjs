const fs=require('node:fs');

// Desktop-only behaviour: stay in the tray when the window closes, start with Windows, and the quick-capture shortcut.
// Starting with Windows is opt-in; the other two are on by default.
const DEFAULTS=Object.freeze({closeToTray:true,openAtLogin:false,quickCapture:true});
const QUICK_CAPTURE='CommandOrControl+Shift+Space';
const normalizePrefs=value=>Object.fromEntries(Object.entries(DEFAULTS).map(([key,fallback])=>[key,typeof value?.[key]==='boolean'?value[key]:fallback]));
function loadPrefs(file){try{return normalizePrefs(JSON.parse(fs.readFileSync(file,'utf8')));}catch{return normalizePrefs({});}}
function savePrefs(file,prefs){const clean=normalizePrefs(prefs);fs.writeFileSync(file,JSON.stringify(clean));return clean;}
// Launched by Windows at sign-in: start in the tray instead of opening the window.
const startedHidden=argv=>argv.includes('--hidden');
module.exports={DEFAULTS,QUICK_CAPTURE,normalizePrefs,loadPrefs,savePrefs,startedHidden};
