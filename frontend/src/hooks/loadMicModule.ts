import type { MicModule } from "../types/mic-recorder";

// public/mic.js는 Vite 번들링 대상이 아닌 정적 파일이다. src 안에서 import()나 동적
// import(변수)로 이 파일을 불러오면 Vite의 import-analysis 플러그인이 "public 폴더 파일은
// import 불가"라며 (요청에 자체 쿼리 마커를 붙여서까지) 막는다. 반면 순수 <script
// type="module"> 태그로 로드하면 브라우저가 네이티브로 처리해서 Vite 트랜스폼 파이프라인을
// 아예 거치지 않는다 — 그래서 인라인 모듈 스크립트를 직접 주입해서 불러온다.
let modulePromise: Promise<MicModule> | null = null;

export function loadMicModule(): Promise<MicModule> {
  if (modulePromise) return modulePromise;

  modulePromise = new Promise<MicModule>((resolve, reject) => {
    const callbackKey = "__veilnoteMicModule";
    const win = window as unknown as Record<string, (mod: MicModule) => void>;

    win[callbackKey] = (mod: MicModule) => {
      delete win[callbackKey];
      resolve(mod);
    };

    const script = document.createElement("script");
    script.type = "module";
    script.textContent = `
      import * as mod from "/mic.js";
      window.${callbackKey}(mod);
    `;
    script.onerror = () => reject(new Error("mic.js를 불러오지 못했습니다."));
    script.addEventListener("load", () => script.remove());
    document.head.appendChild(script);
  }).catch((err) => {
    modulePromise = null;
    throw err;
  });

  return modulePromise;
}
