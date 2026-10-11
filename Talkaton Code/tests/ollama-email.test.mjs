import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { Readable } from "node:stream";

async function load(name) {
  let source = await readFile(new URL(`../server/${name}.js`, import.meta.url), "utf8");
  for (const dep of ["_guest-guard", "_ollama"]) {
    const text = await readFile(new URL(`../server/${dep}.js`, import.meta.url), "utf8");
    source = source.replace(`./${dep}.js`, `data:text/javascript;base64,${Buffer.from(text).toString("base64")}`);
  }
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Math.random()}`);
}
function response() {
  return { statusCode: 200, headers: {}, chunks: [], on() {}, once() {}, off() {}, setHeader(k,v) {this.headers[k.toLowerCase()] = v;}, status(v) {this.statusCode=v;return this;}, json(v) {this.body=v;return this;}, write(v) {this.chunks.push(v);}, end() {this.writableEnded=true;}, flushHeaders() {} };
}
function env(t, values) {
  const previous = {...process.env}; const fetch = globalThis.fetch;
  const info = console.info; const error = console.error;
  console.info = console.error = () => {};
  Object.assign(process.env, values);
  t.after(() => { for (const k of Object.keys(process.env)) if (!(k in previous)) delete process.env[k]; Object.assign(process.env, previous); globalThis.fetch=fetch;console.info=info;console.error=error; });
}
for (const plan of ["guest", "free"]) {
  test(`${plan} chat ignores forged paid plan/model and streams Ollama without OpenRouter`, async t => {
    env(t, {OLLAMA_API_KEY:"test-key", OLLAMA_FALLBACK_MODEL:"test-model", GUEST_USAGE_SECRET:"stable-usage-secret", STRIPE_SECRET_KEY:""});
    delete process.env.OPENROUTER_API_KEY;
    let called = false;
    globalThis.fetch = async (url, opts) => {
      if (String(url).includes("/auth/v1/user")) return Response.json({id:"free-user",email:"free@example.com",app_metadata:{beta:true}});
      if (String(url).includes("/rest/v1/beta_requests")) return Response.json([]);
      if (String(url).includes("/rpc/consume_guest_usage")) return Response.json({allowed:true,remaining:5});
      assert.equal(String(url),"https://ollama.com/api/chat");
      const body=JSON.parse(opts.body); assert.equal(body.model,"test-model");
      assert.match(body.messages[0].content, new RegExp(`Current plan: ${plan}`));
      assert.equal(opts.headers.Authorization,"Bearer test-key"); called=true;
      return new Response('{"message":{"content":"Hello "},"done":false}\n{"message":{"content":"world"},"done":true}\n', {headers:{"content-type":"application/x-ndjson"}});
    };
    const {default:handler}=await load("chat"); const res=response();
    await handler({method:"POST",headers:{"user-agent":"Mozilla/5.0",...(plan==="free"?{authorization:"Bearer user-token"}:{})},body:{message:"Hi",plan:"max",model:"openai/gpt-5.4"}},res);
    assert.equal(res.statusCode,200);assert.equal(called,true);assert.equal(res.headers["x-talkaton-provider"],"ollama");
    assert.equal(res.headers["x-talkaton-fallback"],undefined);assert.match(res.chunks.join(""),/world/);
  });
}
test("unconfigured Ollama fails closed without calling a premium provider", async t => {
  env(t,{OLLAMA_API_KEY:"",GUEST_USAGE_SECRET:"stable-test-key"});
  globalThis.fetch=async url=>{assert.match(String(url),/consume_guest_usage/);return Response.json({allowed:true,remaining:1});};
  const {default:handler}=await load("chat"); const res=response();
  await handler({method:"POST",headers:{"user-agent":"Mozilla/5.0"},body:{message:"Hi"}},res);
  assert.equal(res.statusCode,503);assert.equal(res.body.code,"OLLAMA_KEY_MISSING");
});
test("Guest web research synthesizes only with Ollama",async t=>{
  env(t,{OLLAMA_API_KEY:"test-key",TAVILY_API_KEY:"test-key",GUEST_USAGE_SECRET:"test-secret"});
  globalThis.fetch=async(url,opts)=>{
    if(String(url).includes("consume_guest_usage"))return Response.json({allowed:true,remaining:1});
    if(String(url)==="https://api.tavily.com/search") {assert.equal(JSON.parse(opts.body).include_answer,false);return Response.json({results:[{title:"Source",url:"https://example.com",content:"Evidence"}]});}
    assert.equal(String(url),"https://ollama.com/api/chat");return Response.json({message:{content:"Grounded answer [1]"}});
  };
  const {default:handler}=await load("search");const res=response();
  await handler({method:"POST",headers:{"user-agent":"Mozilla/5.0"},body:{query:"Question"}},res);
  assert.equal(res.statusCode,200);assert.equal(res.body.answerProvider,"ollama+tavily");
});
const secret=`v1,whsec_${Buffer.alloc(32,7).toString("base64")}`;
const payload={user:{email:"person@example.com"},email_data:{email_action_type:"signup",token_hash:"test_hash",redirect_to:"https://talkaton.org/chat?signup-confirmed=1"}};
function signedRequest(data=payload, age=0) {
  const raw=JSON.stringify(data);const timestamp=String(Math.floor(Date.now()/1000)-age);
  const signature=createHmac("sha256",Buffer.alloc(32,7)).update(`event-1.${timestamp}.${raw}`).digest("base64");
  return Object.assign(Readable.from([Buffer.from(raw)]),{method:"POST",headers:{"webhook-id":"event-1","webhook-timestamp":timestamp,"webhook-signature":`v1,${signature}`}});
}
function emailEnv(t) {env(t,{RESEND_API_KEY:"resend-test-secret",RESEND_FROM_EMAIL:"Talkaton <auth@example.com>",SEND_EMAIL_HOOK_SECRET:secret});}
test("signed auth email uses server credentials and stable retry idempotency",async t=>{
  emailEnv(t); const requests=[];globalThis.fetch=async(url,opts)=>{assert.equal(url,"https://api.resend.com/emails");requests.push(opts);return Response.json({id:"email-1"});};
  const {default:handler}=await load("auth-email");
  for(let i=0;i<2;i++){const res=response();await handler(signedRequest(),res);assert.equal(res.statusCode,200);assert.deepEqual(res.body,{});}
  assert.equal(requests[0].headers["Idempotency-Key"],requests[1].headers["Idempotency-Key"]);
  const body=JSON.parse(requests[0].body);assert.deepEqual(body.to,["person@example.com"]);assert.match(body.text,/auth\/v1\/verify\?token=test_hash/);
  assert.equal(requests[0].headers.Authorization,"Bearer resend-test-secret");
});
for (const kind of ["unsigned","tampered","expired","future"]) test(`email hook rejects ${kind} requests before sending`,async t=>{
  emailEnv(t);globalThis.fetch=()=>assert.fail("Must not send email");const req=signedRequest(payload,kind==="expired"?301:kind==="future"?-301:0);
  if(kind==="unsigned")delete req.headers["webhook-signature"];
  if(kind==="tampered")req.headers["webhook-signature"]="v1,bad";
  const {default:handler}=await load("auth-email");const res=response();await handler(req,res);assert.equal(res.statusCode,401);
});
test("Resend rejection is reported without leaking provider data",async t=>{
  emailEnv(t);globalThis.fetch=async()=>Response.json({message:"secret-provider-detail"},{status:403});const {default:handler}=await load("auth-email");const res=response();await handler(signedRequest(),res);assert.equal(res.statusCode,502);assert.doesNotMatch(JSON.stringify(res.body),/secret-provider/);
});
test("secure email change maps both token hashes to the correct recipients",async()=>{
  const {buildAuthEmails}=await load("auth-email");const emails=buildAuthEmails({user:{email:"old@example.com",new_email:"new@example.com"},email_data:{email_action_type:"email_change",token_hash:"new_hash",token_hash_new:"old_hash"}});
  assert.deepEqual(emails.map(e=>e.to[0]),["old@example.com","new@example.com"]);assert.match(emails[0].text,/token=old_hash/);assert.match(emails[1].text,/token=new_hash/);
});
for(const action of ["signup","magiclink","recovery","invite","reauthentication"])test(`email hook renders ${action}`,async()=>{
  const {buildAuthEmails}=await load("auth-email");const emails=buildAuthEmails({...payload,email_data:{...payload.email_data,email_action_type:action,token:"123456"}});assert.equal(emails.length,1);assert.ok(emails[0].text.length>30);
});
test("email hook rejects untrusted redirects and missing configuration",async t=>{
  emailEnv(t);globalThis.fetch=()=>assert.fail("Must not send");const {default:handler}=await load("auth-email");const res=response();await handler(signedRequest({...payload,email_data:{...payload.email_data,redirect_to:"https://evil.example"}}),res);assert.equal(res.statusCode,400);
  delete process.env.RESEND_API_KEY;const missing=response();await handler(signedRequest(),missing);assert.equal(missing.statusCode,503);
});
