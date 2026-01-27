/* webtor-refresh-tabs.v4.js
   - Ferme Webtor si ouvert sur clic FR/Film
   - Si Webtor a été ouvert durant la session, fait UN SEUL reload de récupération
   - Restaure l'onglet demandé après reload
   - Anti-boucle : le click de restauration ne relance pas un reload
*/
(function(){
  const KEY_NEEDS='webtorWasOpen';
  const KEY_TAB='tronTabAfterReload';
  const KEY_RESTORING='tronRestoringTab';

  function webtorIsOpen(){
    const ov = document.getElementById('webtorRectOverlay');
    return !!(ov && !ov.classList.contains('hidden'));
  }

  function closeWebtorSoft(){
    try{
      if (typeof window.closeWebtorRectOverlay === 'function') {
        window.closeWebtorRectOverlay({ reload:false });
      } else {
        const ov = document.getElementById('webtorRectOverlay');
        if (ov) ov.classList.add('hidden');
      }
    }catch(_){}
  }

  function needsRecover(){
    try { return sessionStorage.getItem(KEY_NEEDS)==='1'; } catch(e){ return false; }
  }

  function setNextTab(tab){
    try { sessionStorage.setItem(KEY_TAB, tab); } catch(e){}
  }

  function consumeNextTab(){
    try{
      const t = sessionStorage.getItem(KEY_TAB);
      if (t) sessionStorage.removeItem(KEY_TAB);
      return t;
    }catch(e){ return null; }
  }

  function setRestoring(v){
    try {
      if (v) sessionStorage.setItem(KEY_RESTORING,'1');
      else sessionStorage.removeItem(KEY_RESTORING);
    } catch(e){}
  }

  function isRestoring(){
    try { return sessionStorage.getItem(KEY_RESTORING)==='1'; } catch(e){ return false; }
  }

  function clearRecoverFlag(){
    try { sessionStorage.removeItem(KEY_NEEDS); } catch(e){}
  }

  function hardReload(){
    try { location.reload(); } catch(e){ try{ window.location.reload(); }catch(_){} }
  }

  function hook(tab){
    const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
    if (!btn) return;

    btn.addEventListener('click', ()=>{
      if (isRestoring()) return;

      if (webtorIsOpen()) closeWebtorSoft();

      if (needsRecover()){
        setNextTab(tab);
        setRestoring(true);
        clearRecoverFlag();  // => pas de second reload après restauration
        hardReload();
      }
    }, true);
  }

  function restoreTabAfterReload(){
    if (!isRestoring()) return;
    setRestoring(false);

    const tab = consumeNextTab();
    if (!tab) return;

    const tryClick = ()=>{
      const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
      if (btn) btn.click();
      else setTimeout(tryClick, 80);
    };
    setTimeout(tryClick, 160);
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    hook('fr');
    hook('channels');
    restoreTabAfterReload();
  });
})();
