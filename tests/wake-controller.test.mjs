import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {WakeController} from '../desktop/wake-controller.cjs';

function harness(){
  const children=[],events=[];
  const controller=new WakeController({executable:'local-wake.exe',onEvent:e=>events.push(e),spawnProcess:(_exe,_args,options)=>{
    assert.equal(options.windowsHide,true);
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stdin=new EventEmitter();
    child.stdin.end=()=>queueMicrotask(()=>child.emit('close',0));child.kill=()=>child.emit('close',0);
    children.push(child);return child;
  }});
  return {controller,children,events};
}
test('wake handoff waits for recognizer exit and duplicate configure does not start another listener',async()=>{
  const {controller,children,events}=harness();await controller.configure({enabled:true,suspended:false});
  await controller.configure({enabled:true,suspended:false});assert.equal(children.length,1);
  children[0].stdout.emit('data','{"type":"ready"}\n{"type":"detected"}\n');
  assert.equal(events.at(-1).status,'listening');children[0].emit('close',0);assert.equal(events.at(-1).status,'detected');
  await controller.configure({enabled:true,suspended:false});assert.equal(children.length,1);
  await controller.configure({enabled:true,suspended:true});await controller.configure({enabled:true,suspended:false});assert.equal(children.length,2);controller.dispose();
});
test('mute or disable releases the helper and ignores late wake events',async()=>{
  const {controller,children,events}=harness();await controller.configure({enabled:true,suspended:false});
  await controller.configure({enabled:true,suspended:true});children[0].stdout.emit('data','{"type":"detected"}\n');
  assert.equal(events.at(-1).status,'paused');assert.equal(controller.run,null);
  await controller.configure({enabled:false,suspended:false});assert.equal(events.at(-1).status,'off');
});
test('missing recognition and process failure produce explicit errors',async()=>{
  const {controller,children,events}=harness();await controller.configure({enabled:true,suspended:false});
  children[0].stdout.emit('data','{"type":"missing-recognizer"}\n');children[0].emit('close',2);
  assert.equal(events.at(-1).status,'error');assert.match(events.at(-1).message,/not installed/);
  await controller.configure({enabled:false,suspended:false});await controller.configure({enabled:true,suspended:false});
  children[1].emit('error',new Error('Missing file'));children[1].emit('close',-1);
  assert.equal(events.at(-1).status,'error');assert.match(events.at(-1).message,/could not start/);
});
