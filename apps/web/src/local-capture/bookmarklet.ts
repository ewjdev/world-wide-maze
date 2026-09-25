/**
 * Phase 14 bookmarklet (lower fidelity fallback). It runs `@wwm/capture-script`'s `extractPage` on the page
 * you're on, opens the game at `/play/local` in a new tab, waits for that tab's `wwm:ready`, and posts a
 * DOM-only `wwm:capture` (no screenshot: the game draws a sketch texture). It sends only to the game origin
 * and only to the tab it opened.
 *
 * `extractPage` is self-contained by contract (no outer references), so its source can be inlined. A no-op
 * `__name` is declared for bundlers that inject it (see capture-script `pageExpression`).
 */
import { extractPage } from '@wwm/capture-script';
import { CAPTURE_LIMITS, MAX_PAGE_HEIGHT_PX } from '@wwm/schema';
import { MSG } from './protocol.ts';

/** The JavaScript the bookmarklet runs (without the `javascript:` scheme). */
export function bookmarkletCode(origin: string): string {
  const O = JSON.stringify(origin);
  const opts = JSON.stringify({ maxPageHeight: MAX_PAGE_HEIGHT_PX });
  return `(()=>{const O=${O};const say=m=>alert('World Wide Maze: '+m);
if(location.origin===O){say('open another page first, then click the bookmarklet there.');return}
const __name=t=>t;let x;
try{x=(${extractPage.toString()})(${opts})}catch(e){say('this page could not be read ('+e+').');return}
const w=window.open(O+'/play/local?via=bookmarklet','_blank');
if(!w){say('allow pop-ups for this site, then click the bookmarklet again.');return}
const b={schema:'wwm.capture/1',captureId:'local',url:location.href.slice(0,${CAPTURE_LIMITS.url}),
title:String(x.title||document.title||'').slice(0,${CAPTURE_LIMITS.title}),capturedAt:new Date().toISOString(),
viewport:x.viewport,page:x.page,screenshot:{path:'sketch.png',width:x.page.width,height:x.page.height,format:'png',scale:1},
backgroundColor:x.backgroundColor,elements:x.elements};
const m={type:${JSON.stringify(MSG.capture)},version:1,bundle:b,image:null};let sent=0,heard=0;
const on=e=>{if(e.source!==w||e.origin!==O)return;heard=1;const t=e.data&&e.data.type;
if(t===${JSON.stringify(MSG.ready)}&&!sent){sent=1;w.postMessage(m,O)}
else if(t===${JSON.stringify(MSG.ack)}||t===${JSON.stringify(MSG.reject)})removeEventListener('message',on)};
addEventListener('message',on);
setTimeout(()=>{if(!heard&&w.closed)say('this site blocks the handoff to the game tab. Try the extension instead.')},4000);
setTimeout(()=>removeEventListener('message',on),120000)})()`;
}

/** The bookmark URL. */
export function bookmarkletHref(origin: string): string {
  return `javascript:${encodeURIComponent(bookmarkletCode(origin))}`;
}
