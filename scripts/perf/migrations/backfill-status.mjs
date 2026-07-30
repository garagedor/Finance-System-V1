// Additive backfill of Job.statusCanonical (trim + documented alias). Legacy
// `status` untouched. Idempotent/resumable/reversible. Mirrors canonicalStatus().
import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";
const mode = process.argv[2] || "--validate";
const env = readFileSync(new URL("../../../.env.local", import.meta.url), "utf8");
const uri = env.split("\n").find(l=>l.startsWith("MONGODB_URI=")).slice(12).trim().replace(/^["']|["']$/g,"");
const c=new MongoClient(uri); await c.connect(); const Job=c.db("ag").collection("Job");
const FIELD="statusCanonical";
const target={ status:{ $type:"string", $ne:"" } };
// server-side: trim + alias, identical to src/lib/status-canonical.ts
const setPipeline=[{ $set:{ [FIELD]:{ $let:{ vars:{ t:{ $trim:{ input:"$status" } } }, in:{
  $switch:{ branches:[ { case:{ $eq:["$$t","Customer Cenceled"] }, then:"Customer Canceled" } ], default:"$$t" } } } } } }];

if (mode==="--sample"){
  const ids=await Job.find({status:{$in:[" X close","Client Fixed It ","Customer Cenceled"]}},{projection:{_id:1,status:1}}).limit(5).toArray();
  await Job.updateMany({_id:{$in:ids.map(d=>d._id)}}, setPipeline);
  const after=await Job.find({_id:{$in:ids.map(d=>d._id)}},{projection:{status:1,statusCanonical:1}}).toArray();
  console.log("sample variants (status preserved, canonical added):");
  after.forEach(d=>console.log(`  status=${JSON.stringify(d.status)} -> statusCanonical=${JSON.stringify(d.statusCanonical)}`));
} else if (mode==="--run"){
  const ids=await Job.find(target,{projection:{_id:1}}).map(d=>d._id).toArray();
  let done=0; for(let i=0;i<ids.length;i+=5000){ const r=await Job.updateMany({_id:{$in:ids.slice(i,i+5000)}}, setPipeline); done+=r.modifiedCount; console.log(`  batch ${Math.floor(i/5000)+1}: ${r.modifiedCount} (cum ${done})`); }
  console.log(`targeted ${ids.length}, written ${done}`);
}
// validate
const total=await Job.estimatedDocumentCount();
const withField=await Job.countDocuments({[FIELD]:{$type:"string",$ne:""}});
const strStatus=await Job.countDocuments(target);
const stillString=await Job.countDocuments({status:{$type:"string"}});
const variantsFixed=await Job.countDocuments({$expr:{$ne:["$status","$statusCanonical"]}, status:{$type:"string",$ne:""}});
console.log(`\nJob ${total}: statusCanonical set ${withField} (target ${strStatus}); legacy status still string ${stillString}`);
console.log(`docs where canonical != original (variants normalized): ${variantsFixed}`);
await c.close();
