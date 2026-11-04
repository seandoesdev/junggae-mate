// dist/ 비우기. Windows의 Node 24는 한글이 들어간 경로에서 fs.rmSync(recursive)가 비정상 종료하므로
// (Vite의 emptyOutDir도 같은 함수를 쓴다) 파일을 하나씩 지운다.
import { existsSync, readdirSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

function clear(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { clear(p); rmdirSync(p); } else unlinkSync(p);
  }
}
const dist = new URL("../dist", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
if (existsSync(decodeURIComponent(dist))) clear(decodeURIComponent(dist));
