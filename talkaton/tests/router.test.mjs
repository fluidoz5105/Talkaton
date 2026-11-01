import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import handler from "../api/index.js";
function response() { return {statusCode:200,headers:{},once(){},off(){},setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;}}; }
function request(endpoint, raw, type="application/json") {
 return Object.assign(Readable.from([Buffer.from(raw)]),{method:"POST",query:{endpoint},headers:{"content-type":type}});
}
test("single-function router rejects unknown/private/ambiguous endpoints",async()=>{
 for(const endpoint of ["_ollama","constructor","../../server/chat",["chat","auth-email"]]) { const res=response();await handler(request(endpoint,"{}"),res);assert.equal(res.statusCode,404); }
});
test("single-function router parses JSON and preserves endpoint validation",async()=>{
 const res=response();await handler(request("image",'{"prompt":""}'),res);assert.equal(res.statusCode,400);assert.equal(res.body.error,"Image prompt is required.");
});
test("single-function router rejects malformed and oversized JSON",async()=>{
 const invalid=response();await handler(request("image","{"),invalid);assert.equal(invalid.statusCode,400);
 const large=response();await handler(request("image"," ".repeat(4*1024*1024+1)),large);assert.equal(large.statusCode,413);
});
test("single-function router leaves signed hook bytes intact",async()=>{
 const req=request("auth-email","{}");const res=response();await handler(req,res);assert.equal(req.readableEnded,false);assert.equal(res.statusCode,503);
});
