import {emptyWorkspace} from './core.js';
export const STORAGE_KEY='thoughtspace.workspace.v1';
export function readWorkspace(){const raw=localStorage.getItem(STORAGE_KEY);if(!raw)return emptyWorkspace();const data=JSON.parse(raw);if(data.version!==1||!Array.isArray(data.cards)||!Array.isArray(data.captures))throw new Error('Saved workspace could not be read. Export the stored data before resetting it.');return data;}
export const persist=state=>localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
async function db(){return new Promise((resolve,reject)=>{const r=indexedDB.open('thoughtspace-audio',1);r.onupgradeneeded=()=>r.result.createObjectStore('recordings',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function audioStore(action,value){const d=await db();try{return await new Promise((resolve,reject)=>{const tx=d.transaction('recordings',action==='getAll'?'readonly':'readwrite');const store=tx.objectStore('recordings');const r=action==='getAll'?store.getAll():store[action](value);tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);});}finally{d.close();}}
