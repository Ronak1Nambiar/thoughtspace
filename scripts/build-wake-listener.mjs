import {execFileSync} from 'node:child_process';
import {copyFileSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
mkdirSync('desktop/native',{recursive:true});
const out=path.resolve('desktop/native/WakeListener.exe'),source=path.resolve('desktop/WakeListener.cs');
if(process.platform==='win32'){
  const framework=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319');
  const speechAssembly=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Add-Type -AssemblyName System.Speech; [System.Speech.Recognition.SpeechRecognitionEngine].Assembly.Location'],{encoding:'utf8',windowsHide:true}).trim();
  execFileSync(path.join(framework,'csc.exe'),['/nologo','/target:exe','/optimize+','/out:'+out,'/reference:'+speechAssembly,source],{stdio:'inherit',windowsHide:true});
}else{
  // Cross-compile on Linux/macOS with the .NET SDK against the .NET Framework 4.8 reference assemblies.
  const work=path.resolve('.desktop-cache/wake');mkdirSync(work,{recursive:true});
  writeFileSync(path.join(work,'WakeListener.csproj'),`<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net48</TargetFramework><Optimize>true</Optimize><AssemblyName>WakeListener</AssemblyName><EnableDefaultCompileItems>false</EnableDefaultCompileItems></PropertyGroup>
  <ItemGroup>
    <Compile Include="${source}" />
    <Reference Include="System.Speech" />
    <PackageReference Include="Microsoft.NETFramework.ReferenceAssemblies.net48" Version="1.0.3" PrivateAssets="all" />
  </ItemGroup>
</Project>
`);
  const hasSdk=()=>{try{return execFileSync('dotnet',['--list-sdks'],{encoding:'utf8'}).trim().length>0;}catch{return false;}};
  const [cmd,...pre]=hasSdk()?['dotnet']:['mise','exec','dotnet@8','--','dotnet'];
  try{execFileSync(cmd,[...pre,'build','-c','Release','-o',path.join(work,'out'),'--nologo','-v','q'],{cwd:work,stdio:'inherit'});}
  catch(error){throw new Error('Building the wake listener off Windows needs the .NET SDK (or mise to fetch it). '+error.message);}
  copyFileSync(path.join(work,'out','WakeListener.exe'),out);
}
console.log('Built local Windows wake recognizer.');
