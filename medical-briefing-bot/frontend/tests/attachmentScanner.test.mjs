import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clamAvScanner } from '../src/lib/support/attachments/scanner.mjs';
import { validateFile } from '../src/lib/support/attachments/validation.mjs';
import { metadata, pdf, sha } from './fixtures/supportAttachments.mjs';
import { randomUUID } from 'node:crypto';

test('production adapter speaks clamd INSTREAM and fails closed on error, disconnect or timeout',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'clamd-protocol-')); const path=join(dir,'file'); await writeFile(path,pdf);
  try {
    for(const [reply,expected] of [['stream: OK\0','clean'],['stream: Test FOUND\0','infected'],['stream: ERROR\0',null],['disconnect',null],['timeout',null]]) {
      const server=createServer(socket=>{let input=Buffer.alloc(0);socket.on('data',chunk=>{input=Buffer.concat([input,chunk]);if(input.length<10)return;assert.equal(input.subarray(0,10).toString(),'zINSTREAM\0');let offset=10;while(input.length>=offset+4){const length=input.readUInt32BE(offset);if(input.length<offset+4+length)return;if(length===0){if(reply==='timeout')return;if(reply==='disconnect')socket.end();else socket.end(reply);return;}offset+=4+length;}});});
      server.listen(0,'127.0.0.1');await once(server,'listening');
      try {
        const scanner=clamAvScanner({host:'127.0.0.1',port:server.address().port,timeoutMs:300});
        if(expected)assert.equal(await scanner.scan(path),expected);else await assert.rejects(scanner.scan(path));
      }finally{server.close();await once(server,'close');}
    }
  }finally{await rm(dir,{recursive:true});}
});

function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function zip(entries){const local=[];const central=[];let offset=0;for(const [name,text] of entries){const file=Buffer.from(text),filename=Buffer.from(name);const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt32LE(crc32(file),14);header.writeUInt32LE(file.length,18);header.writeUInt32LE(file.length,22);header.writeUInt16LE(filename.length,26);const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt32LE(crc32(file),16);directory.writeUInt32LE(file.length,20);directory.writeUInt32LE(file.length,24);directory.writeUInt16LE(filename.length,28);directory.writeUInt32LE(offset,42);local.push(header,filename,file);central.push(directory,filename);offset+=header.length+filename.length+file.length;}const ending=Buffer.alloc(22);ending.writeUInt32LE(0x06054b50);ending.writeUInt16LE(entries.length,8);ending.writeUInt16LE(entries.length,10);ending.writeUInt32LE(Buffer.concat(central).length,12);ending.writeUInt32LE(offset,16);return Buffer.concat([...local,...central,ending]);}
test('valid DOCX/XLSX archives pass; macros, traversal, format disguise and expansion limits fail',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'office-validation-'));const path=join(dir,'file');
  try{for(const kind of ['docx','xlsx']){
    const word=kind==='docx';const mime=word?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const entries=[['[Content_Types].xml',`<Types><Override ContentType="${mime}.main+xml"/></Types>`],['_rels/.rels','<Relationships/>'],[word?'word/document.xml':'xl/workbook.xml','<document/>']];
    for(const [extra,valid] of [[[],true],[[['word/vbaProject.bin','macro']],false],[[['../escape','bad']],false],[[['huge', 'x'.repeat(10485761)]],false]]){
      const data=zip([...entries,...extra]);await writeFile(path,data);const value={...metadata(randomUUID(),data),mime,original_name:`test.${kind}`};
      if(valid)await validateFile(path,value);else await assert.rejects(validateFile(path,value));
    }
    const disguised=zip(entries);await writeFile(path,disguised);await assert.rejects(validateFile(path,{bytes:disguised.length,sha256:sha(disguised),mime:word?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',original_name:word?'test.xlsx':'test.docx'}));
  }}finally{await rm(dir,{recursive:true});}
});
