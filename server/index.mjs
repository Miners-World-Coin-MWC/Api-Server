import http from 'node:http';
const UPSTREAM='https://api.minersworld.org';
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,Accept','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...CORS});res.end(JSON.stringify(body));};
const send=async(res,url,init={})=>{const r=await fetch(url,init);const text=await r.text();res.writeHead(r.status,{'Content-Type':r.headers.get('content-type')||'application/json',...CORS});res.end(text);};
const server=http.createServer(async(req,res)=>{try{if(req.method==='OPTIONS'){res.writeHead(204,CORS);return res.end()}const u=new URL(req.url,`http://${req.headers.host}`);const p=u.pathname;
 if(!p.startsWith('/api/')) return json(res,404,{error:'Not found'});
 if(p==='/api/nodechain'){return send(res,UPSTREAM+'/info')}
 if(p==='/api/paramschain') return json(res,200,{network:'main',symbol:'MWC',address:{pubKeyHash:20,scriptHash:10,wif:123,bip32Public:'0488b21e',bip32Private:'0488ade4',bech32:'mwc'},chain:{blockTargetSeconds:120,maxSupply:300000000,halvingInterval:300000},cltv:{scriptTemplate:'<unlock-time> OP_CHECKLOCKTIMEVERIFY OP_DROP <their pubkey> OP_CHECKSIG'}});
 if(p==='/api/minimum') return send(res,UPSTREAM+'/fee');
 if(p==='/api/ledgerincome') return json(res,200,{available:false,reason:'No authoritative ledger-income endpoint exists in the supplied upstream API.'});
 if(p==='/api/healthsync') return send(res,UPSTREAM+'/info');
 const m=p.match(/^\/api\/(balance|history|locks|owed)\/(.+)$/);if(m){const type=m[1],value=decodeURIComponent(m[2]);if(type==='balance')return send(res,UPSTREAM+'/balance/'+encodeURIComponent(value));if(type==='history')return send(res,UPSTREAM+'/history/'+encodeURIComponent(value));return json(res,200,{pubkey:value,available:false,items:[],reason:type==='locks'?'No lock index is maintained without a database.':'Reward entitlement is not exposed by the supplied API.'})}
 return json(res,404,{error:'Unknown endpoint'});
}catch(e){json(res,502,{error:e.message})}});
server.listen(process.env.PORT||8787,()=>console.log('MWC stateless API adapter listening on '+(process.env.PORT||8787)));
