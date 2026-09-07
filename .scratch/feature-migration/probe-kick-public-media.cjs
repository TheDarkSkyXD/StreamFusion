const fs=require('node:fs');
const endpoints=[
'https://kick.com/api/v2/categories/grand-theft-auto-v/clips?cursor=0&limit=20&sort=view&time=all',
'https://kick.com/api/v2/channels/xqc/videos?cursor=0&limit=20&sort=date',
'https://kick.com/api/v2/channels/xqc/clips?cursor=0&limit=20&sort=date',
'https://kick.com/category/grand-theft-auto-v',
'https://api.kick.com/swagger/doc.yaml'
];
(async()=>{const records=[];for(const url of endpoints){try{const response=await fetch(url,{headers:{Accept:url.endsWith('.yaml')?'text/plain':'application/json,text/html;q=0.9','User-Agent':'Mozilla/5.0','Referer':'https://kick.com/'},signal:AbortSignal.timeout(12000)});const body=await response.text();const record={url,status:response.status,contentType:response.headers.get('content-type'),bytes:body.length};if(url.endsWith('.yaml')){fs.writeFileSync('.scratch/feature-migration/kick-openapi-current.yaml',body);record.mediaPaths=body.split('\n').filter(x=>/^  \/.*(?:video|clip|categor)/i.test(x));}else{try{const data=JSON.parse(body);const rows=Array.isArray(data)?data:Array.isArray(data.clips)?data.clips:Array.isArray(data.videos)?data.videos:[];record.shape=Array.isArray(data)?'array':Object.keys(data);record.count=rows.length;record.nextCursor=Array.isArray(data)?null:data.nextCursor??null;record.firstKeys=rows.length?Object.keys(rows[0]):[];}catch{record.categoryTabLinks=[...body.matchAll(/href="([^"]*(?:grand-theft-auto-v)[^"]*)"/g)].map(x=>x[1]).filter((x,i,a)=>a.indexOf(x)===i);}}records.push(record);}catch(error){records.push({url,error:error.message});}}fs.writeFileSync('.scratch/feature-migration/kick-public-media-probe.json',JSON.stringify(records,null,2));console.log(JSON.stringify(records,null,2));})();
