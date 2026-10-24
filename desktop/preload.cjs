const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('thoughtspaceDesktop',Object.freeze({
  isDesktop:true,
  configureWake(config){return ipcRenderer.invoke('wake-config',{enabled:config.enabled===true,suspended:config.suspended===true,name:typeof config.name==='string'?config.name.slice(0,40):undefined,device:typeof config.device==='string'?config.device.slice(0,120):''});},
  testWakeName(name,seconds=12,device=''){return ipcRenderer.invoke('wake-test',{name:typeof name==='string'?name.slice(0,40):'',seconds:Number(seconds)||12,device:typeof device==='string'?device.slice(0,120):''});},
  onWake(callback){
    const listener=(_event,value)=>{if(['off','paused','starting','listening','detected','error'].includes(value?.status))callback(value);};
    ipcRenderer.on('wake-event',listener);
    return ()=>ipcRenderer.removeListener('wake-event',listener);
  },
  onUpdateReady(callback){
    const listener=(_event,value)=>{if(typeof value?.version==='string')callback({version:value.version.slice(0,40)});};
    ipcRenderer.on('update-ready',listener);
    return ()=>ipcRenderer.removeListener('update-ready',listener);
  },
  installUpdate(){return ipcRenderer.invoke('update-install');},
  sendFeedback(text){return ipcRenderer.invoke('feedback-open',typeof text==='string'?text.slice(0,6000):'');},
  appInfo(){return ipcRenderer.invoke('app-info');},
  prefs:Object.freeze({
    get(){return ipcRenderer.invoke('desktop-prefs');},
    set(change){const clean={};for(const key of ['closeToTray','openAtLogin','quickCapture'])if(typeof change?.[key]==='boolean')clean[key]=change[key];return ipcRenderer.invoke('desktop-prefs-set',clean);},
  }),
  backups:Object.freeze({
    list(){return ipcRenderer.invoke('backups-list');},
    read(name){return ipcRenderer.invoke('backups-read',typeof name==='string'?name.slice(0,80):'');},
    now(){return ipcRenderer.invoke('backups-now');},
    openFolder(){return ipcRenderer.invoke('backups-open');},
  }),
  pickImport(kind){return ipcRenderer.invoke('import-pick',['chatgpt','claude','markdown'].includes(kind)?kind:null);},
  onCommand(callback){
    const listener=(_event,command)=>{if(['export','settings','library','feedback','capture'].includes(command))callback(command);};
    ipcRenderer.on('workspace-command',listener);
    return ()=>ipcRenderer.removeListener('workspace-command',listener);
  },
}));
