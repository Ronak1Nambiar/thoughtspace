const {app,BrowserWindow,Menu,Tray,globalShortcut,protocol,session,dialog,shell,safeStorage,ipcMain}=require('electron');
const {WakeController,cleanName}=require('./wake-controller.cjs');
const {WakeCheck}=require('./wake-check.cjs');
const {LocalTranscriber}=require('./local-transcribe.cjs');
const {Backups}=require('./backups.cjs');
const {QUICK_CAPTURE,loadPrefs,savePrefs,startedHidden}=require('./desktop-prefs.cjs');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {randomBytes}=require('node:crypto');

const ORIGIN='thoughtspace://workspace';
app.setName('Thoughtspace');
app.setAppUserModelId('com.thoughtspace.desktop');
if(process.env.THOUGHTSPACE_USER_DATA)app.setPath('userData',path.resolve(process.env.THOUGHTSPACE_USER_DATA));
protocol.registerSchemesAsPrivileged([{scheme:'thoughtspace',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}}]);
let window,server,quitting=false,microphoneAllowed=false;
const REPO='https://github.com/Ronak1Nambiar/thoughtspace';
// Updates come from GitHub Releases. Only the installed (NSIS) build can update itself; the portable exe cannot.
const canUpdate=app.isPackaged&&!process.env.PORTABLE_EXECUTABLE_DIR;
let updater=null,updateReady=null;
function setupUpdates(){
  if(!canUpdate)return;
  try{({autoUpdater:updater}=require('electron-updater'));}catch{return;}
  updater.autoDownload=true;updater.autoInstallOnAppQuit=true;updater.logger=null;
  updater.on('update-downloaded',info=>{updateReady=info.version;window?.webContents.send('update-ready',{version:info.version});});
  updater.on('error',()=>{});
  const check=()=>updater.checkForUpdates().catch(()=>{});
  setTimeout(check,15000);setInterval(check,6*60*60*1000).unref();
}
async function checkForUpdatesNow(){
  if(!canUpdate){await dialog.showMessageBox(window,{message:'This copy cannot update itself.',detail:'The portable version does not update. Download the installer from '+REPO+'/releases/latest to get updates automatically.'});return;}
  if(updateReady){window?.webContents.send('update-ready',{version:updateReady});return;}
  try{const result=await updater.checkForUpdates();const latest=result?.updateInfo?.version;
    await dialog.showMessageBox(window,{message:latest&&latest!==app.getVersion()?'Downloading Thoughtspace '+latest+'…':'Thoughtspace is up to date.',detail:latest&&latest!==app.getVersion()?'You will be asked to restart when it is ready.':'Version '+app.getVersion()+'.'});}
  catch{await dialog.showMessageBox(window,{message:'Could not check for updates.',detail:'Check your connection and try again. Releases are at '+REPO+'/releases.'});}
}
// Feedback is written in the app (see src/feedback-dialog.jsx); the user reads and edits it, then copies it or
// opens it as a GitHub issue. No thought content is included, only the version line and the usage numbers shown.
const aboutLine=()=>`Thoughtspace ${app.getVersion()} · Windows ${process.getSystemVersion()} · ${process.arch} · ${canUpdate?'installer':'portable or dev'}`;
function feedbackUrl(text){
  const body=typeof text==='string'&&text.trim()?text.slice(0,6000):['**What happened?**','','','**What did you expect?**','','','---',aboutLine()].join('\n');
  return REPO+'/issues/new?'+new URLSearchParams({title:'',body,labels:'tester-feedback'});
}
// Automatic snapshots of the workspace (it lives in the window's localStorage): once a day while the app runs,
// and on quit. See backups.cjs; the last 14 are kept and offered in Settings.
const WORKSPACE_KEY='thoughtspace.workspace.v1';
const backups=new Backups({folder:path.join(app.getPath('userData'),'backups')});
async function readWorkspaceRaw(){
  if(!window||window.isDestroyed())return null;
  try{return await window.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(WORKSPACE_KEY)})`,true);}catch{return null;}
}
async function snapshot(reason){
  const raw=await readWorkspaceRaw();if(!raw)return {saved:false,why:'empty'};
  try{return backups.save(raw,{reason});}catch{return {saved:false,why:'error'};}
}
let finalSnapshot=false;
// Tray, start with Windows and the quick-capture shortcut (desktop-prefs.cjs).
const prefsPath=()=>path.join(app.getPath('userData'),'desktop-prefs.json');
let prefs=loadPrefs(prefsPath()),tray=null,shortcutReady=false,trayHintShown=false;
// The first time the window appears it opens maximized, also when it starts hidden in the tray at sign-in.
let shownOnce=false;
function showWindow(){if(!window||window.isDestroyed())return;if(!shownOnce){shownOnce=true;window.maximize();}if(window.isMinimized())window.restore();window.show();window.focus();}
function quickCapture(){showWindow();window?.webContents.send('workspace-command','capture');}
function syncTray(){
  if(!prefs.closeToTray){tray?.destroy();tray=null;return;}
  if(tray)return;
  tray=new Tray(path.join(__dirname,'icon.ico'));tray.setToolTip('Thoughtspace');
  tray.setContextMenu(Menu.buildFromTemplate([{label:'Open Thoughtspace',click:showWindow},{label:'New thought',accelerator:QUICK_CAPTURE,click:quickCapture},{type:'separator'},{label:'Quit Thoughtspace',click:()=>app.quit()}]));
  tray.on('click',showWindow);
}
function syncShortcut(){
  if(globalShortcut.isRegistered(QUICK_CAPTURE))globalShortcut.unregister(QUICK_CAPTURE);
  shortcutReady=prefs.quickCapture?globalShortcut.register(QUICK_CAPTURE,quickCapture):false;
}
// Only the installed or portable app registers itself; a dev run would register electron.exe.
function syncLoginItem(){
  if(!app.isPackaged)return;
  try{app.setLoginItemSettings({openAtLogin:prefs.openAtLogin,path:process.env.PORTABLE_EXECUTABLE_FILE||process.execPath,args:['--hidden']});}catch{}
}
const prefsView=()=>({...prefs,shortcut:QUICK_CAPTURE,shortcutReady,canStartAtLogin:app.isPackaged});
// Local Whisper confirmation of the wake name (see wake-check.cjs). Missing files fall back to the
// Windows recognizer alone.
const wakeCheck=new WakeCheck({folder:app.isPackaged?path.join(process.resourcesPath,'whisper'):path.join(__dirname,'native','whisper'),tempDir:path.join(app.getPath('userData'),'wake-check')});
wakeCheck.clean();
// Speech-to-text on this computer (no key needed). Same whisper.cpp folder as the wake check.
const localTranscriber=new LocalTranscriber({folder:wakeCheck.folder,tempDir:path.join(app.getPath('userData'),'speech')});
localTranscriber.clean();
const wakeController=new WakeController({
  check:wakeCheck,
  executable:app.isPackaged?path.join(process.resourcesPath,'wake','WakeListener.exe'):path.join(__dirname,'native','WakeListener.exe'),
  // Development-only acoustic test input; packaged apps always use the microphone.
  args:!app.isPackaged&&process.env.THOUGHTSPACE_WAKE_TEST_WAV?['--wave',process.env.THOUGHTSPACE_WAKE_TEST_WAV]:[],
  onEvent:event=>{if(window&&!window.isDestroyed()){
    if(event.status==='detected'){if(window.isMinimized())window.restore();window.show();window.focus();}
    window.webContents.send('wake-event',event);
  }},
});
let wakeQueue=Promise.resolve();
async function allowMicrophone(wake=false,name='Atlas'){
  if(microphoneAllowed)return true;
  const result=await dialog.showMessageBox(window,{type:'question',buttons:['Allow microphone','Use text instead'],defaultId:0,cancelId:1,message:wake?`Allow local listening for ${name}?`:'Allow Thoughtspace to use your microphone?',detail:wake?`While enabled, the Windows speech recognizer listens locally for ${name} or Hey ${name}. `+'Standby audio is not recorded or sent anywhere. After activation, conversation audio is transcribed on this computer, or by Groq or OpenAI if you chose cloud speech-to-text. Mute or turn off wake mode to stop standby listening.':'Finished recordings are transcribed on this computer, or by Groq or OpenAI if you chose cloud speech-to-text in Settings. Stop releases the microphone; Mute pauses input.'});
  microphoneAllowed=result.response===0;return microphoneAllowed;
}
const IMPORT_KINDS={chatgpt:{title:'Choose your ChatGPT export (.zip)'},claude:{title:'Choose your Claude export (.zip)'},markdown:{title:'Choose a notes folder (Obsidian vault or Markdown files)',folder:true}};
const configPath=()=>path.join(app.getPath('userData'),'provider-config.json');
function ownUrl(url){try{const u=new URL(url);return u.protocol==='thoughtspace:'&&u.host==='workspace';}catch{return false;}}

// Bring-your-own-model settings. Every API key is encrypted with Windows credential protection (safeStorage);
// the renderer never receives one. The file also migrates the 1.5 single-Groq-key format.
const providerStore={
  load(){
    if(!fs.existsSync(configPath()))return null;
    const config=JSON.parse(fs.readFileSync(configPath(),'utf8'));
    if(!safeStorage.isEncryptionAvailable())throw new Error('Windows credential protection is unavailable.');
    const decrypt=value=>safeStorage.decryptString(Buffer.from(value,'base64'));
    if(config.version!==2){
      return {enabled:config.enabled!==false,provider:process.env.LLM_PROVIDER,models:{groq:config.chatModel,ollama:process.env.LOCAL_MODEL},baseUrls:{ollama:process.env.OLLAMA_URL},keys:{groq:decrypt(config.key)}};
    }
    const keys=Object.fromEntries(Object.entries(config.keys||{}).map(([id,value])=>[id,decrypt(value)]));
    const profileKeys=Object.fromEntries(Object.entries(config.profileKeys||{}).map(([id,value])=>[id,decrypt(value)]));
    if(process.env.GROQ_API_KEY&&!keys.groq)keys.groq=process.env.GROQ_API_KEY;
    return {...config,keys,profileKeys};
  },
  save(config){
    if((Object.keys(config.keys).length||Object.keys(config.profileKeys||{}).length)&&!safeStorage.isEncryptionAvailable())throw Object.assign(new Error('Windows credential protection is unavailable, so API keys cannot be stored safely.'),{status:500});
    fs.mkdirSync(app.getPath('userData'),{recursive:true});
    const encrypt=values=>Object.fromEntries(Object.entries(values||{}).map(([id,value])=>[id,safeStorage.encryptString(value).toString('base64')]));
    // Still version 2: 1.7 ignores the saved-model fields, so going back to 1.7 keeps its keys.
    fs.writeFileSync(configPath(),JSON.stringify({version:2,enabled:config.enabled,provider:config.provider,models:config.models,baseUrls:config.baseUrls,keys:encrypt(config.keys),profiles:config.profiles,active:config.active,profileKeys:encrypt(config.profileKeys)}),{mode:0o600});
  },
};
// Connector sign-ins (Notion token, Google refresh token) use the same Windows credential protection as API keys.
const connectorCredentials={
  file:id=>path.join(app.getPath('userData'),`connector-${String(id).replace(/[^a-z0-9-]/gi,'')}.json`),
  load(id){try{const file=this.file(id);if(!fs.existsSync(file)||!safeStorage.isEncryptionAvailable())return null;return JSON.parse(safeStorage.decryptString(Buffer.from(fs.readFileSync(file,'utf8'),'base64')));}catch{return null;}},
  save(id,value){const file=this.file(id);if(!value){fs.rmSync(file,{force:true});return;}if(!safeStorage.isEncryptionAvailable())throw Object.assign(new Error('Windows credential protection is unavailable, so this sign-in cannot be stored safely.'),{status:500});fs.mkdirSync(app.getPath('userData'),{recursive:true});fs.writeFileSync(file,safeStorage.encryptString(JSON.stringify(value)).toString('base64'),{mode:0o600});},
};
function safeProviderStore(){
  return {load(){try{return providerStore.load();}catch{dialog.showErrorBox('Model connection unavailable','Your protected API keys could not be opened. Your workspace is still available. Re-enter your key in workspace settings.');return null;}},save:providerStore.save};
}
function setupMenu(){
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'File',submenu:[{label:'Import your data (ChatGPT, Claude, notes)...',click:()=>window.webContents.send('workspace-command','library')},{label:'Export workspace backup',accelerator:'CmdOrCtrl+Shift+E',click:()=>window.webContents.send('workspace-command','export')},{label:'Workspace settings and restore...',click:()=>window.webContents.send('workspace-command','settings')},{type:'separator'},{role:'quit'}]},
    {label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'View',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen',accelerator:'F11'}]},
    {label:'Connection',submenu:[{label:'Choose AI model and API key...',click:()=>window.webContents.send('workspace-command','settings')},{label:'Reset microphone permission',click:()=>{microphoneAllowed=false;dialog.showMessageBox(window,{message:'Microphone permission reset.',detail:'Stop any active recording. The next voice start will ask for permission again.'});}}]},
    {label:'Help',submenu:[{label:'Send feedback…',click:()=>{showWindow();window?.webContents.send('workspace-command','feedback');}},{label:'Check for updates…',click:()=>void checkForUpdatesNow()},{type:'separator'},{label:'About Thoughtspace',click:()=>dialog.showMessageBox(window,{title:'Thoughtspace',message:'Thoughtspace '+app.getVersion(),detail:'A conversational thinking workspace. Your workspace is stored on this computer. Browser work can be brought in using Export in the browser, then Restore in workspace settings.'})}]},
  ]));
}
async function createWindow(){
  window=new BrowserWindow({width:1450,height:1000,minWidth:850,minHeight:650,title:'Thoughtspace',backgroundColor:'#1b1e21',show:false,autoHideMenuBar:true,icon:path.join(__dirname,'icon.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  window.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\//.test(url))void shell.openExternal(url);return {action:'deny'};});
  window.webContents.on('will-navigate',(event,url)=>{if(!ownUrl(url))event.preventDefault();});
  window.webContents.on('did-start-navigation',(_event,_url,inPlace,mainFrame)=>{if(mainFrame&&!inPlace)void wakeController.configure({enabled:false,suspended:false});});
  window.webContents.on('render-process-gone',()=>wakeController.dispose());
  window.webContents.on('will-prevent-unload',event=>{
    const choice=dialog.showMessageBoxSync(window,{type:'warning',buttons:['Keep working','Close anyway'],defaultId:0,cancelId:0,message:'There is a recording or unsaved work in progress.',detail:'Stop the recording and export any unsaved work before closing.'});
    if(choice===1)event.preventDefault();else finalSnapshot=false;
  });
  window.on('close',event=>{
    if(!quitting&&prefs.closeToTray){
      event.preventDefault();window.hide();
      if(!trayHintShown&&tray){trayHintShown=true;tray.displayBalloon({iconType:'info',title:'Thoughtspace is still running',content:`It stays in the tray so the wake word and ${QUICK_CAPTURE.replace('CommandOrControl','Ctrl')} keep working. Right-click the tray icon to quit.`});}
      return;
    }
    // Closing without the tray ends the app: take the last snapshot while the workspace can still be read.
    if(finalSnapshot)return;
    event.preventDefault();finalSnapshot=true;
    void Promise.race([snapshot('quit'),new Promise(resolve=>setTimeout(resolve,3000))]).finally(()=>{if(!window.isDestroyed())window.close();});
  });
  // Started by Windows at sign-in: stay in the tray until called.
  const hidden=startedHidden(process.argv)&&prefs.closeToTray;
  // Opens like a full application: maximized, no menu bar (Alt shows it, its shortcuts always work), F11 for full screen.
  window.setMenuBarVisibility(false);
  window.once('ready-to-show',()=>{if(!hidden)showWindow();});
  window.webContents.on('did-finish-load',()=>{if(updateReady)window.webContents.send('update-ready',{version:updateReady});});
  await window.loadURL(ORIGIN+'/');
}
async function start(){
  await app.whenReady();
  const trusted=event=>event.sender===window?.webContents&&event.senderFrame===event.sender.mainFrame&&ownUrl(event.senderFrame.url);
  ipcMain.handle('update-install',async()=>{if(updateReady&&updater){quitting=true;if(!finalSnapshot){finalSnapshot=true;await snapshot('quit');}setImmediate(()=>updater.quitAndInstall(false,true));return true;}return false;});
  ipcMain.handle('feedback-open',(event,text)=>trusted(event)?shell.openExternal(feedbackUrl(text)):null);
  ipcMain.handle('app-info',event=>trusted(event)?aboutLine():'');
  ipcMain.handle('desktop-prefs',event=>trusted(event)?prefsView():null);
  ipcMain.handle('desktop-prefs-set',(event,change)=>{
    if(!trusted(event))return null;
    try{prefs=savePrefs(prefsPath(),{...prefs,...change});}catch{prefs=loadPrefs(prefsPath());}
    syncTray();syncShortcut();syncLoginItem();return prefsView();
  });
  ipcMain.handle('backups-list',event=>trusted(event)?backups.list():[]);
  ipcMain.handle('backups-read',(event,name)=>{if(!trusted(event))return {error:'Invalid request.'};try{return {raw:backups.read(name)};}catch(error){return {error:error.status?error.message:'That backup could not be read.'};}});
  ipcMain.handle('backups-now',event=>trusted(event)?snapshot('manual'):{saved:false});
  ipcMain.handle('backups-open',async event=>{if(!trusted(event))return;fs.mkdirSync(backups.folder,{recursive:true});await shell.openPath(backups.folder);});
  ipcMain.handle('wake-config',(event,config)=>{
    if(event.sender!==window?.webContents||event.senderFrame!==event.sender.mainFrame||!ownUrl(event.senderFrame.url)||typeof config?.enabled!=='boolean'||typeof config?.suspended!=='boolean')return {status:'error',message:'Invalid wake request.'};
    const name=cleanName(config.name);
    const operation=async()=>{
      if(config.enabled&&!config.suspended&&!await allowMicrophone(true,name)){await wakeController.configure({enabled:false,suspended:false});return {status:'error',message:'Microphone access denied. Wake mode is off; text capture remains available.'};}
      return wakeController.configure({enabled:config.enabled,suspended:config.suspended,name,device:typeof config.device==='string'?config.device:''});
    };
    const result=wakeQueue.then(operation,operation);wakeQueue=result.catch(()=>{});return result;
  });
  // Name test for onboarding and Settings: counts how often Windows hears the name in a few seconds.
  ipcMain.handle('wake-test',(event,request)=>{
    if(event.sender!==window?.webContents||event.senderFrame!==event.sender.mainFrame||!ownUrl(event.senderFrame.url))return {status:'error',message:'Invalid wake test.'};
    const name=cleanName(request?.name);
    const operation=async()=>{
      if(!await allowMicrophone(true,name))return {status:'error',message:'Microphone access denied. You can still type your thoughts.'};
      return wakeController.calibrate({name,seconds:request?.seconds,device:typeof request?.device==='string'?request.device:''});
    };
    const result=wakeQueue.then(operation,operation);wakeQueue=result.catch(()=>{});return result;
  });
  // Imports: the main process shows the native picker and hands the path to the Library, so the renderer never names a file.
  ipcMain.handle('import-pick',async(event,kind)=>{
    if(event.sender!==window?.webContents||event.senderFrame!==event.sender.mainFrame||!ownUrl(event.senderFrame.url)||!IMPORT_KINDS[kind])return {error:'Invalid import request.'};
    const spec=IMPORT_KINDS[kind];
    // Development-only: automated desktop tests supply the file instead of clicking a native dialog.
    const testPath=!app.isPackaged&&process.env.THOUGHTSPACE_TEST_IMPORT;
    const choice=testPath?{canceled:false,filePaths:[testPath]}:await dialog.showOpenDialog(window,{title:spec.title,properties:[spec.folder?'openDirectory':'openFile'],filters:spec.folder?undefined:[{name:'Export zip',extensions:['zip']}]});
    if(choice.canceled||!choice.filePaths[0])return {cancelled:true};
    try{return await server.library.jobs.startImport({kind,path:choice.filePaths[0],label:path.basename(choice.filePaths[0])});}
    catch(error){return {error:error.status?error.message:'The import could not start. Nothing was changed.'};}
  });
  const token=randomBytes(32).toString('hex');
  // Packaged Thoughtspace is local-first: reasoning runs in Ollama on this machine.
  process.env.AI_ENABLED ||= 'true';
  process.env.LLM_PROVIDER ||= 'ollama';
  process.env.LOCAL_MODEL ||= 'llama3.1:8b';
  process.env.OLLAMA_URL ||= 'http://127.0.0.1:11434';
  process.env.LOCAL_CONTEXT ||= '8192';
  process.env.LOCAL_TIMEOUT ||= '180000';
  const {startWorkspaceServer}=await import(pathToFileURL(path.join(__dirname,'..','server.mjs')).href);
  server=await startWorkspaceServer({port:0,token,desktopOrigin:ORIGIN,providerStore:safeProviderStore(),libraryPath:path.join(app.getPath('userData'),'library.db'),credentials:connectorCredentials,localTranscriber,openExternal:url=>{if(!/^https:\/\/(accounts\.google\.com|openrouter\.ai\/auth)[/?]/.test(url))throw new Error('Unexpected sign-in address.');return shell.openExternal(url);}});
  const address='http://127.0.0.1:'+server.address().port;
  protocol.handle('thoughtspace',async request=>{
    if(!ownUrl(request.url))return new Response('Not found',{status:404});
    const url=new URL(request.url),headers=new Headers(request.headers);
    headers.set('x-thoughtspace-token',token);headers.set('origin',ORIGIN);
    try{
      const response=await fetch(address+url.pathname+url.search,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer(),signal:request.signal});
      const resultHeaders=new Headers(response.headers);
      resultHeaders.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'");
      return new Response(response.body,{status:response.status,headers:resultHeaders});
    }catch{return new Response(JSON.stringify({error:'The desktop service could not complete this request. Saved work remains available.'}),{status:503,headers:{'content-type':'application/json'}});}
  });
  session.defaultSession.setPermissionCheckHandler((contents,permission,requestingOrigin,details)=>ownUrl(requestingOrigin||contents?.getURL())&&(permission==='media'?microphoneAllowed&&details.mediaType!=='video':['clipboard-sanitized-write','speaker-selection'].includes(permission)));
  session.defaultSession.setPermissionRequestHandler(async(contents,permission,callback,details)=>{
    if(!ownUrl(details.requestingUrl||contents?.getURL()))return callback(false);
    if(permission!=='media')return callback(['clipboard-sanitized-write','speaker-selection'].includes(permission));
    if(details.mediaTypes?.includes('video'))return callback(false);
    callback(await allowMicrophone());
  });
  session.defaultSession.on('will-download',(_event,item)=>item.setSaveDialogOptions({title:'Save Thoughtspace file',defaultPath:path.join(app.getPath('downloads'),item.getFilename())}));
  setupMenu();syncTray();syncShortcut();syncLoginItem();await createWindow();setupUpdates();
  // The first daily snapshot waits until the workspace has loaded; later checks are hourly and write once a day.
  setTimeout(()=>void snapshot('daily'),60000).unref();setInterval(()=>void snapshot('daily'),60*60*1000).unref();
}
if(!app.requestSingleInstanceLock()){app.quit();}
else{
  app.on('second-instance',showWindow);
  app.on('window-all-closed',()=>app.quit());
  // Quitting takes one last snapshot first (at most 3 s), then quits for real.
  app.on('before-quit',event=>{
    quitting=true;
    if(!finalSnapshot&&window&&!window.isDestroyed()){event.preventDefault();finalSnapshot=true;void Promise.race([snapshot('quit'),new Promise(resolve=>setTimeout(resolve,3000))]).finally(()=>app.quit());return;}
    wakeController.dispose();
  });
  app.on('will-quit',()=>{globalShortcut.unregisterAll();tray?.destroy();server?.closeAllConnections();server?.close();});
  app.on('activate',()=>{if(!quitting&&BrowserWindow.getAllWindows().length===0)void createWindow();});
  start().catch(error=>{dialog.showErrorBox('Thoughtspace could not start',error.message);app.exit(1);});
}
