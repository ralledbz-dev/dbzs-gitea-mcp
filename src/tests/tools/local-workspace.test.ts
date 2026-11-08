import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DbzsEventBus } from "../../core/observability.js";
import { DbzsError } from "../../core/errors.js";
import { LocalWorkspaceBridge } from "../../local/workspace-bridge.js";
test("Workspace bridge confines file access and writes to its root",async()=>{const root=await mkdtemp(join(tmpdir(),"dbzs-workspace-"));try{await writeFile(join(root,"inside.txt"),"before");const b=new LocalWorkspaceBridge({rootPath:root,processAllowlist:["node"],eventBus:new DbzsEventBus()});await b.initialize();assert.equal(await b.read("inside.txt"),"before");await b.write("inside.txt","after");assert.equal(await readFile(join(root,"inside.txt"),"utf8"),"after");await assert.rejects(()=>b.read("../outside.txt"),DbzsError);}finally{await rm(root,{recursive:true,force:true});}});
test("Workspace bridge refuses executables outside allowlist",async()=>{const root=await mkdtemp(join(tmpdir(),"dbzs-workspace-"));try{const b=new LocalWorkspaceBridge({rootPath:root,processAllowlist:["node"],eventBus:new DbzsEventBus()});await b.initialize();await assert.rejects(()=>b.startProcess("cmd.exe",["/c","whoami"]),DbzsError);}finally{await rm(root,{recursive:true,force:true});}});

test("Workspace bridge reuses slots after short-lived processes exit",async()=>{const root=await mkdtemp(join(tmpdir(),"dbzs-workspace-"));try{const b=new LocalWorkspaceBridge({rootPath:root,processAllowlist:["node"],eventBus:new DbzsEventBus()});await b.initialize();for(let i=0;i<9;i++){const started=await b.startProcess("node",["-e","setTimeout(()=>process.exit(0),5)"]) as {processId:string};await new Promise(resolve=>setTimeout(resolve,50));assert.equal((b.pollProcess(started.processId) as {running:boolean}).running,false);}}finally{await rm(root,{recursive:true,force:true});}});
