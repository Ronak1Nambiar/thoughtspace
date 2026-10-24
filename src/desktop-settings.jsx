import React,{useEffect,useState} from 'react';
import {RefreshCw,FolderOpen,Save} from 'lucide-react';

const when=iso=>new Date(iso).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
const keys=shortcut=>shortcut.replace('CommandOrControl','Ctrl').replaceAll('+',' + ');

// Windows app only: tray, start with Windows, quick-capture shortcut, and the automatic backups.
export function DesktopSettings({onRestore,onNotice}){
  const desktop=window.thoughtspaceDesktop;
  const [prefs,setPrefs]=useState(null),[list,setList]=useState([]),[busy,setBusy]=useState(false);
  const refresh=()=>desktop.backups.list().then(setList).catch(()=>setList([]));
  useEffect(()=>{if(!desktop?.prefs)return;void desktop.prefs.get().then(setPrefs).catch(()=>{});void refresh();},[]);
  if(!desktop?.prefs)return null;
  const change=async patch=>{const next=await desktop.prefs.set(patch).catch(()=>null);if(next)setPrefs(next);};
  async function backupNow(){setBusy(true);try{const result=await desktop.backups.now();onNotice(result.saved?'Backup saved.':result.why==='unchanged'?'Nothing changed since the last backup.':'Nothing to back up yet.');await refresh();}finally{setBusy(false);}}
  async function restore(name){
    setBusy(true);
    try{const {raw,error}=await desktop.backups.read(name);if(error)throw new Error(error);await onRestore(JSON.parse(raw),when(list.find(b=>b.name===name).date));await refresh();}
    catch(e){onNotice(e.message);}finally{setBusy(false);}
  }
  return <>
    <h3>In the background</h3>
    {prefs&&<div className="desktop-prefs">
      <label className="check-label"><input type="checkbox" checked={prefs.closeToTray} onChange={e=>void change({closeToTray:e.target.checked})}/> Keep running in the tray when the window closes</label>
      <p className="helper">The wake word and the shortcut only work while Thoughtspace runs. Quit from the tray icon's menu.</p>
      <label className="check-label"><input type="checkbox" checked={prefs.quickCapture} onChange={e=>void change({quickCapture:e.target.checked})}/> {keys(prefs.shortcut)} opens Thoughtspace ready for a new thought</label>
      {prefs.quickCapture&&!prefs.shortcutReady&&<p className="helper error">Another app already uses {keys(prefs.shortcut)}, so the shortcut is off.</p>}
      <label className="check-label"><input type="checkbox" checked={prefs.openAtLogin} disabled={!prefs.canStartAtLogin||!prefs.closeToTray} onChange={e=>void change({openAtLogin:e.target.checked})}/> Start with Windows, in the tray</label>
      {!prefs.canStartAtLogin&&<p className="helper">Available in the installed app.</p>}
    </div>}
    <h3>Automatic backups</h3>
    <p>A copy of your workspace is saved on this computer once a day and when you quit. The last 14 are kept. Restoring one first backs up what you have now.</p>
    <div className="backup-actions"><button disabled={busy} onClick={()=>void backupNow()}><Save size={14}/> Back up now</button><button onClick={()=>void desktop.backups.openFolder()}><FolderOpen size={14}/> Open backups folder</button></div>
    {list.length?<ul className="backup-list">{list.map(b=><li key={b.name}><span>{when(b.date)}<small>{b.cards==null?'unreadable':`${b.cards} ${b.cards===1?'card':'cards'}`} · {Math.max(1,Math.round(b.size/1024))} KB</small></span><button disabled={busy||b.cards==null} onClick={()=>void restore(b.name)}><RefreshCw size={13}/> Restore</button></li>)}</ul>:<p className="helper">No backups yet. The first one is saved a minute after the app opens.</p>}
  </>;
}
