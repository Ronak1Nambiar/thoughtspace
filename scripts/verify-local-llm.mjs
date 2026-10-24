const base=process.env.LOCAL_TEST_URL||'http://127.0.0.1:3010';
const health=await (await fetch(base+'/api/health?refresh=1')).json();
if(health.provider!=='Ollama'||!health.ready)throw new Error(JSON.stringify(health));
const response=await fetch(base+'/api/discuss',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'Give one short next step for testing a reading-tracker app.',cards:[],history:[]})});
const data=await response.json();if(!response.ok||!data.reply?.trim())throw new Error(JSON.stringify(data));
console.log(JSON.stringify({provider:health.provider,model:health.models.chat,reply:data.reply},null,2));
