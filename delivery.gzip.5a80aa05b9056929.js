/* Lossless gzip transport. Runtime PCK/WASM bytes remain exact. */
(() => {
  const manifestUrl = "delivery.dc29ed66bca3cd48.json";
  let manifestPromise;
  const received = new Map();
  async function manifest() {
    if (!manifestPromise) manifestPromise = fetch(manifestUrl).then(r => {
      if (!r.ok) throw new Error(`资源目录下载失败：${r.status}`);
      return r.json();
    });
    return manifestPromise;
  }
  function unzip() {
    if (typeof DecompressionStream === 'function') {
      try {return new DecompressionStream('gzip');} catch (_) {}
    }
    if (!globalThis.fflate) throw new Error('浏览器无法解压游戏资源，请更新浏览器后重试');
    // fflate inflates bytes but does not validate the gzip trailer. Match native
    // gzip integrity checks without buffering the whole PCK in memory.
    const table=new Uint32Array(256);
    for(let n=0;n<256;n++) {
      let value=n;
      for(let bit=0;bit<8;bit++) value=(value>>>1)^((value&1)?0xedb88320:0);
      table[n]=value>>>0;
    }
    let output,crc=0xffffffff,decodedSize=0,packedSize=0;
    const tail=new Uint8Array(8);
    const decoder = new globalThis.fflate.Gunzip(chunk => {
      for(let i=0;i<chunk.length;i++) crc=table[(crc^chunk[i])&255]^(crc>>>8);
      decodedSize=(decodedSize+chunk.byteLength)>>>0;
      if(chunk.byteLength) output.enqueue(chunk);
    });
    const read32=at=>(tail[at]|(tail[at+1]<<8)|(tail[at+2]<<16)|(tail[at+3]<<24))>>>0;
    return new TransformStream({
      transform(chunk, controller) {
        output=controller;packedSize+=chunk.byteLength;
        if(chunk.length>=8) tail.set(chunk.subarray(chunk.length-8));
        else {tail.copyWithin(0,chunk.length);tail.set(chunk,8-chunk.length);}
        decoder.push(chunk,false);
      },
      flush(controller) {
        output=controller;decoder.push(new Uint8Array(),true);
        if(packedSize<18 || read32(0)!==((crc^0xffffffff)>>>0) || read32(4)!==decodedSize)
          throw new Error('游戏资源校验失败，请重新加载');
      }
    });
  }
  async function response(name) {
    const data = await manifest();
    const file = data.files[name];
    if (!file) throw new Error(`缺少游戏资源：${name}`);
    let index=0, reader=null;
    const packed = new ReadableStream({
      async pull(controller) {
        try {
          while (index < file.parts.length) {
            const part=file.parts[index];
            if (!reader) {
              const result=await fetch(part.path);
              if (!result.ok) throw new Error(`游戏资源下载失败：${result.status}`);
              if (!result.body) throw new Error('浏览器无法读取游戏资源');
              received.set(part.path,0);reader=result.body.getReader();
            }
            const chunk=await reader.read();
            if (chunk.done) {
              if (received.get(part.path)!==part.bytes) throw new Error('游戏资源下载不完整，请重新加载');
              reader.releaseLock();reader=null;index++;continue;
            }
            received.set(part.path,received.get(part.path)+chunk.value.byteLength);
            const progress=document.getElementById('progress');
            if (progress) {progress.max=data.total_bytes;progress.value=[...received.values()].reduce((a,b)=>a+b,0);}
            controller.enqueue(chunk.value);return;
          }
          controller.close();
        } catch (error) {controller.error(error);}
      },
      cancel(reason) {if (reader) return reader.cancel(reason);}
    });
    let decoded=0;
    const body=packed.pipeThrough(unzip()).pipeThrough(new TransformStream({
      transform(chunk,controller) {
        decoded+=chunk.byteLength;
        if(decoded>file.bytes) throw new Error('游戏资源解压大小不正确，请重新加载');
        controller.enqueue(chunk);
      },
      flush() {if(decoded!==file.bytes) throw new Error('游戏资源解压不完整，请重新加载');}
    }));
    return new Response(body,{headers:{'Content-Type':name.endsWith('.wasm')?'application/wasm':'application/octet-stream'}});
  }
  globalThis.FumoDownload={response,bytes:async name=>(await response(name)).arrayBuffer()};
})();
