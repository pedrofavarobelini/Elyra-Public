import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
const root=process.cwd();const failures=[];
if(process.argv.includes("--filesystem-only") && existsSync(resolve(root,".git")))failures.push("Git metadata present before approval");
const walk=(path)=>readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?(new Set(["node_modules",".next","test-results","playwright-report"]).has(e.name)?[]:walk(resolve(path,e.name))):[resolve(path,e.name)]);
for(const file of walk(root).filter(p=>p.endsWith(".md"))){
 const text=readFileSync(file,"utf8");
 for(const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){
  const link=m[1].replace(/^<|>$/g,"").split("#")[0];
  if(!link||/^(https?:|mailto:)/.test(link))continue;
  if(!existsSync(resolve(dirname(file),link)))failures.push("Broken link: "+link);
 }
}
const env=readFileSync(resolve(root,".env.example"),"utf8");
for(const line of env.split(/\r?\n/)){
 if(!line||line.startsWith("#"))continue;
 const [key,...parts]=line.split("=");const value=parts.join("=");
 if(/KEY|SECRET|PASSWORD|TOKEN/.test(key)&&value&&!/^<[^>]+>$/.test(value))failures.push("Non-placeholder secret variable: "+key);
 if(/https?:\/\//.test(value)&&!/localhost|127\.0\.0\.1|example\.invalid/.test(value))failures.push("Non-local template URL: "+key);
}
for(const p of ["docs/05-QA/evidence","docs/03-Development","docs/00-Governance"]){if(existsSync(resolve(root,p)))failures.push("Private history/archive present: "+p);}
if(failures.length){for(const f of failures)console.error(f);process.exit(1);}
console.log("PUBLIC_DOCUMENTATION_QA=PASS links=valid template=placeholders archive=absent");
