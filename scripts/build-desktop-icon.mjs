import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'msedge'});
try{
  const page=await browser.newPage({viewport:{width:256,height:256},deviceScaleFactor:1});
  await page.setContent('<style>body{margin:0}</style>'+await readFile('desktop/icon.svg','utf8'));
  const png=await page.screenshot({path:'desktop/icon.png',omitBackground:true});
  const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);
  header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
  await writeFile('desktop/icon.ico',Buffer.concat([header,png]));
}finally{await browser.close();}
