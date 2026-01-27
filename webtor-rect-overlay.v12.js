/* webtor-rect-overlay.js (v5)
   Overlay Webtor totalement indépendant, aligné sur le rectangle du player existant.
   Supporte aussi le "Plein écran" via Fullscreen API (document.fullscreenElement).

   API:
     openWebtorRectOverlay(url)
     closeWebtorRectOverlay({ reload: false|true })
*/
(function () {
  const SDK_SRC = "https://cdn.jsdelivr.net/npm/@webtor/embed-sdk-js@0.2.19/dist/index.min.js";
  const OVERLAY_ID = "webtorRectOverlay";
  const HOST_ID = "webtorRectHost";
  const MOUNT_ID = "webtorRectMount";

  let ro = null;
  let tracking = false;
  let anchorEl = null;
  let currentContainer = null; // body ou fullscreenElement
  let forceFullPage = false;

  let suspendedByModal = false;

  function isBlockingModalOpen(){
    // StreamURL overlay (déjà dans ton CSS) + autres overlays plein écran éventuels
    const su = document.querySelector('.streamurl-overlay');
    if (su && getComputedStyle(su).display !== 'none' && getComputedStyle(su).visibility !== 'hidden') return true;

    const radio = document.querySelector('#radioOverlayLayer');
    if (radio && getComputedStyle(radio).display !== 'none' && getComputedStyle(radio).visibility !== 'hidden') return true;

    // iFrame overlay (si présent)
    const ifOv = document.querySelector('#iframeOverlay, .iframe-overlay, .iframeOverlay');
    if (ifOv && getComputedStyle(ifOv).display !== 'none' && getComputedStyle(ifOv).visibility !== 'hidden') return true;

    return false;
  }

  function applyModalSuspension(){
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;

    const open = !overlay.classList.contains('hidden');
    const modalOpen = isBlockingModalOpen();

    if (open && modalOpen && !suspendedByModal){
      suspendedByModal = true;
      overlay.dataset.webtorSuspended = '1';
      overlay.classList.add('hidden');
      return;
    }

    if (suspendedByModal && !modalOpen){
      suspendedByModal = false;
      delete overlay.dataset.webtorSuspended;
      overlay.classList.remove('hidden');
    }
  }

  function observeBlockingModals(){
    const mo = new MutationObserver(() => applyModalSuspension());
    mo.observe(document.documentElement, { childList:true, subtree:true, attributes:true, attributeFilter:['style','class'] });
    // filet de sécurité
    setInterval(applyModalSuspension, 400);
  }


  function isMagnet(v){ return typeof v==="string" && v.trim().startsWith("magnet:?"); }
  function isTorrentUrl(v){
    if (typeof v!=="string") return false;
    const s=v.trim();
    return /^https?:\/\//i.test(s) && /\.torrent(\?|#|$)/i.test(s);
  }

  function loadWebtorSDK(){
    return new Promise((resolve,reject)=>{
      if (window.__webtorSdkLoaded) return resolve(true);
      const existing = Array.from(document.scripts).some(s => (s.src||"").includes("@webtor/embed-sdk-js"));
      if (existing){ window.__webtorSdkLoaded = true; return resolve(true); }
      const sc=document.createElement("script");
      sc.src = SDK_SRC;
      sc.async = true;
      sc.onload = ()=>{ window.__webtorSdkLoaded=true; resolve(true); };
      sc.onerror = reject;
      document.head.appendChild(sc);
    });
  }

  function findAnchorElement(){
    const candidates = [
      "#playerHost","#playerWrap","#playerContainer",
      "#videoWrap","#videoContainer",".playerHost",".playerWrap",".playerContainer"
    ];
    for (const sel of candidates){
      const el=document.querySelector(sel);
      if (el) return el;
    }
    const v=document.querySelector("video");
    if (v){
      const r=v.getBoundingClientRect();
      if (r.width>200 && r.height>120) return v;
      if (v.parentElement) return v.parentElement;
    }
    return null;
  }

  function ensureOverlayDom(){
    let overlay=document.getElementById(OVERLAY_ID);
    if (overlay) return overlay;

    overlay=document.createElement("div");
    overlay.id=OVERLAY_ID;
    overlay.className="webtorRectOverlay hidden";

    const host=document.createElement("div");
    host.id=HOST_ID;
    host.className="webtorRectHost";

    overlay.appendChild(host);
    document.body.appendChild(overlay);

    return overlay;
  }

  function setFixedRect(overlay, rect){
    overlay.style.position = "fixed";
    overlay.style.left = Math.round(rect.left) + "px";
    overlay.style.top = Math.round(rect.top) + "px";
    overlay.style.width = Math.round(rect.width) + "px";
    overlay.style.height = Math.round(rect.height) + "px";
  }

  function setFullscreenFill(overlay, container){
    overlay.style.position = "absolute";
    overlay.style.left = "0px";
    overlay.style.top = "0px";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    const cs = getComputedStyle(container);
    if (cs.position === "static") container.style.position = "relative";
  }

  function moveOverlayIfNeeded(){
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay || overlay.classList.contains("hidden")) return;

    const fsEl = document.fullscreenElement;
    const desired = fsEl ? fsEl : document.body;

    if (currentContainer !== desired){
      try { desired.appendChild(overlay); } catch (_) {}
      currentContainer = desired;
    }
  }

  function updateOverlayPosition(){
    const overlay=document.getElementById(OVERLAY_ID);
    if (!overlay || overlay.classList.contains("hidden")) return;

    applyModalSuspension();
    if (overlay.classList.contains('hidden')) return;

    if (!anchorEl || !document.contains(anchorEl)) anchorEl=findAnchorElement();
    if (!anchorEl) return;

    moveOverlayIfNeeded();

    const fsEl = document.fullscreenElement;
    // En plein écran : on garde le même comportement que les autres overlays
    // -> overlay calé sur le rectangle du player (pas plein écran noir)
const rect=anchorEl.getBoundingClientRect();
    if (rect.width<50 || rect.height<50) return;
    setFixedRect(overlay, rect);
  }

  function startTracking(){
    if (tracking) return;
    tracking=true;


    // observe StreamURL / overlays plein écran
    observeBlockingModals();

    window.addEventListener("scroll", updateOverlayPosition, { passive:true, capture:true });
    window.addEventListener("resize", updateOverlayPosition, { passive:true });
    document.addEventListener("fullscreenchange", updateOverlayPosition, true);

    if (window.visualViewport){
      window.visualViewport.addEventListener("resize", updateOverlayPosition, { passive:true });
      window.visualViewport.addEventListener("scroll", updateOverlayPosition, { passive:true });
    }

    if (window.ResizeObserver){
      ro=new ResizeObserver(()=>updateOverlayPosition());
      if (anchorEl) ro.observe(anchorEl);
    }

    const tick=()=>{
      if (!tracking) return;
      updateOverlayPosition();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function stopTracking(){
    tracking=false;
    window.removeEventListener("scroll", updateOverlayPosition, true);
    window.removeEventListener("resize", updateOverlayPosition);
    document.removeEventListener("fullscreenchange", updateOverlayPosition, true);

    if (window.visualViewport){
      try { window.visualViewport.removeEventListener("resize", updateOverlayPosition); } catch (_) {}
      try { window.visualViewport.removeEventListener("scroll", updateOverlayPosition); } catch (_) {}
    }

    if (ro){ try{ ro.disconnect(); }catch(_){} ro=null; }
    currentContainer = null;
  }

  function mountWebtor(url){
    const v=(url||"").trim();
    if (!isMagnet(v) && !isTorrentUrl(v)) return;

    const host=document.getElementById(HOST_ID);
    if (!host) return;

    host.innerHTML="";
    const mount=document.createElement("div");
    mount.id=MOUNT_ID;
    mount.className="webtor";
    host.appendChild(mount);

    window.webtor = window.webtor || [];
    const payload={ id:MOUNT_ID, width:"100%", height:"100%", controls:true };
    if (isMagnet(v)) payload.magnet=v;
    else payload.torrentUrl=v;

    try { window.webtor.push(payload); }
    catch(e){ console.error("Webtor push error:", e); }
  }

  
  function setViewportFill(overlay){
    overlay.style.position = "fixed";
    overlay.style.left = "0px";
    overlay.style.top = "0px";
    overlay.style.width = "100vw";
    overlay.style.height = "100vh";
  }

  window.webtorRectIsOpen = function(){
    const overlay=document.getElementById(OVERLAY_ID);
    return !!(overlay && !overlay.classList.contains("hidden"));
  };

  window.webtorRectSetFullPage = function(enabled){
    forceFullPage = !!enabled;
    const overlay=document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    if (!overlay.classList.contains("hidden")){
      // keep overlay at top of DOM tree
      try { document.body.appendChild(overlay); } catch (_) {}
      if (forceFullPage) setViewportFill(overlay);
      else updateOverlayPosition();
    }
  };

window.openWebtorRectOverlay = async function(url){
    try{ sessionStorage.setItem('webtorWasOpen','1'); }catch(_){}

    anchorEl=findAnchorElement();
    if (!anchorEl){
      console.warn("Webtor rect overlay: ancre player introuvable.");
      return;
    }
    const overlay=ensureOverlayDom();
    overlay.classList.remove("hidden");

    // Masque automatiquement si un overlay bloquant (StreamURL, etc.) est ouvert
    applyModalSuspension();
    if (overlay.parentElement !== document.body) document.body.appendChild(overlay);
    currentContainer = document.body;

    updateOverlayPosition();
    startTracking();

    await loadWebtorSDK();
    mountWebtor(url);
  };

  window.__webtorRectFindAnchor = function(){
    try { return findAnchorElement(); } catch(e){ return null; }
  };

  window.closeWebtorRectOverlay = function(opts){
    const overlay=document.getElementById(OVERLAY_ID);
    const host=document.getElementById(HOST_ID);
    if (host) host.innerHTML="";
    if (overlay) overlay.classList.add("hidden");
    stopTracking();


    forceFullPage = false;
    if (overlay && overlay.parentElement !== document.body) {
      try { document.body.appendChild(overlay); } catch (_) {}
    }

    if (opts && opts.reload){
      try { location.reload(); } catch(e) { try { window.location.reload(); } catch(_){} }
    }
  };
})();
