import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { DbzsEventBus } from "../core/observability.js";
import { LocalWorkspaceBridge } from "../local/workspace-bridge.js";
import { buildAnnotations, executeTool } from "./shared.js";
export function registerLocalWorkspaceTools(server:McpServer,eventBus:DbzsEventBus,bridge?:LocalWorkspaceBridge):number{
 if(!bridge)return 0;
 const reg=(name:string,title:string,description:string,schema:z.ZodType,handler:(v:any)=>Promise<unknown>|unknown,write=false)=>server.registerTool(name,{title,description,inputSchema:schema,annotations:buildAnnotations(write)},async v=>executeTool(eventBus,name,()=>handler(v)));
 reg("workspace_list","Workspace-Dateien auflisten","Listet begrenzt Dateien im freigegebenen Workspace; Symlinks, .git und node_modules werden ausgelassen.",z.object({path:z.string().default("."),depth:z.number().int().min(0).max(5).default(2)}),v=>bridge.list(v.path,v.depth));
 reg("workspace_read_file","Workspace-Datei lesen","Liest UTF-8-Dateien bis 1 MB innerhalb des Roots.",z.object({path:z.string().min(1).max(4096)}),v=>bridge.read(v.path));
 reg("workspace_write_file","Workspace-Datei schreiben","Überschreibt eine Datei im Workspace; Zielordner muss existieren. confirm: true erforderlich.",z.object({path:z.string().min(1).max(4096),content:z.string().max(1000000),confirm:z.literal(true)}),v=>bridge.write(v.path,v.content),true);
 reg("workspace_git_status","Git-Status lesen","Liest git status --short --branch.",z.object({}),()=>bridge.git(["status","--short","--branch"]));
 reg("workspace_git_diff","Git-Diff lesen","Liest staged oder unstaged Diff.",z.object({staged:z.boolean().default(false)}),v=>bridge.git(v.staged?["diff","--cached","--"]:["diff","--"]));
 reg("workspace_git_log","Git-Historie lesen","Liest maximal 30 Commits.",z.object({limit:z.number().int().min(1).max(30).default(10)}),v=>bridge.git(["log","-n",String(v.limit),"--oneline","--decorate"]));
 reg("workspace_run_process","Lokalen Prozess starten","Startet nach confirm: true eine freigegebene Executable ohne Shell und innerhalb des Workspace.",z.object({executable:z.string().min(1).max(80),args:z.array(z.string().max(4000)).max(64).default([]),cwd:z.string().default("."),confirm:z.literal(true)}),v=>bridge.startProcess(v.executable,v.args,v.cwd),true);
 reg("workspace_poll_process","Prozessstatus lesen","Liest Status und begrenzte Ausgabe eines gestarteten Prozesses.",z.object({processId:z.string().uuid()}),v=>bridge.pollProcess(v.processId));
 reg("workspace_stop_process","Lokalen Prozess stoppen","Beendet einen gestarteten Prozess; confirm: true erforderlich.",z.object({processId:z.string().uuid(),confirm:z.literal(true)}),v=>bridge.stopProcess(v.processId),true);
 return 9;
}
