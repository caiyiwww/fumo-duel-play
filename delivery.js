/* The hosting files are lossless slices of the original Godot export. */
(() => {
  let manifestPromise;
  const received = new Map();
  async function manifest() {
    if (!manifestPromise) manifestPromise = fetch('delivery.json').then(response => {
      if (!response.ok) throw new Error(`资源目录下载失败：${response.status}`);
      return response.json();
    });
    return manifestPromise;
  }
  async function response(name) {
    const data = await manifest();
    const file = data.files[name];
    if (!file) throw new Error(`缺少游戏资源：${name}`);
    let index = 0;
    let reader = null;
    const body = new ReadableStream({
      async pull(controller) {
        try {
          while (index < file.parts.length) {
            const part = file.parts[index];
            if (!reader) {
              const result = await fetch(part.path);
              if (!result.ok) throw new Error(`游戏资源下载失败：${result.status}`);
              if (!result.body) throw new Error('浏览器无法读取游戏资源');
              reader = result.body.getReader();
            }
            const chunk = await reader.read();
            if (chunk.done) {reader.releaseLock();reader = null;index++;continue;}
            received.set(part.path, (received.get(part.path) || 0) + chunk.value.byteLength);
            const progress = document.getElementById('progress');
            if (progress) {progress.max = data.total_bytes;progress.value = [...received.values()].reduce((a,b) => a+b, 0);}
            controller.enqueue(chunk.value);
            return;
          }
          controller.close();
        } catch (error) {controller.error(error);}
      },
      cancel(reason) {if (reader) return reader.cancel(reason);}
    });
    return new Response(body, {headers: {'Content-Type': name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream'}});
  }
  globalThis.FumoDownload = {response, bytes: async name => (await response(name)).arrayBuffer()};
})();
