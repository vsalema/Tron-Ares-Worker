/* webtor-torrents-ui.js
   Rend la liste Torrents dans #torrentList + ouvre Webtor via openWebtorRectOverlay(url)
*/
(function () {
  const STORE_KEY = "tron_torrents_rect_v1";

  function $all(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }

  function isMagnet(v){ return typeof v==='string' && v.trim().startsWith('magnet:?'); }
  function isTorrentUrl(v){
    if (typeof v!=='string') return false;
    const s=v.trim();
    return /^https?:\/\//i.test(s) && /\.torrent(\?|#|$)/i.test(s);
  }

  function safeParse(s, fallback){ try { return JSON.parse(s); } catch { return fallback; } }

  function loadTorrents(){
    const arr = safeParse(localStorage.getItem(STORE_KEY) || '[]', []);
    return (Array.isArray(arr)?arr:[])
      .filter(x => x && typeof x.url==='string' && (isMagnet(x.url)||isTorrentUrl(x.url)))
      .map(x => ({ name: String(x.name||'Torrent'), url: String(x.url) }));
  }
  function saveTorrents(list){ localStorage.setItem(STORE_KEY, JSON.stringify(list)); }

  function render(){
    const root = document.getElementById('torrentList');
    if (!root) return;

    const items = loadTorrents();
    root.innerHTML = '';

    const hint=document.createElement('div');
    hint.className='tor-hint';
    hint.innerHTML='Colle un <b>magnet</b> (magnet:?) ou une URL <b>.torrent</b> (https://.../fichier.torrent).';

    const tip=document.createElement('div');
    tip.className='tor-hint';
    tip.textContent='Astuce : ouvrez en plein écran pour voir les controls.';

    const row=document.createElement('div');
    row.className='tor-toolbar';

    const nameInput=document.createElement('input');
    nameInput.className='tor-input';
    nameInput.placeholder='Nom (optionnel)';

    const urlInput=document.createElement('input');
    urlInput.className='tor-input';
    urlInput.placeholder='magnet:?xt=...  ou  https://.../file.torrent';

    const addBtn=document.createElement('button');
    addBtn.className='tor-btn';
    addBtn.type='button';
    addBtn.textContent='+ Ajouter';

    const fsBtn=document.createElement('button');
    fsBtn.className='tor-btn';
    fsBtn.type='button';
    fsBtn.textContent='⛶ Plein écran';
    fsBtn.addEventListener('click', async ()=>{
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
          return;
        }
        // Plein écran PAGE (comme les autres overlays) : on ne fullscreen PAS l'iframe.
        const target = document.documentElement;
        const req = target.requestFullscreen || target.webkitRequestFullscreen || target.msRequestFullscreen;
        if (req) await req.call(target);
      } catch(e) { /* ignore */ }
    });
addBtn.addEventListener('click', ()=>{
      const url=(urlInput.value||'').trim();
      const name=(nameInput.value||'').trim() || 'Torrent';
      if (!isMagnet(url) && !isTorrentUrl(url)) return;

      const cur=loadTorrents();
      cur.unshift({ name, url });
      saveTorrents(cur);
      urlInput.value=''; nameInput.value='';
      render();
    });

    row.appendChild(nameInput);
    row.appendChild(urlInput);
    row.appendChild(addBtn);

    
    row.appendChild(fsBtn);
const list=document.createElement('div');
    list.className='tor-list';

    items.forEach(it=>{
      const item=document.createElement('div');
      item.className='tor-item';

      const meta=document.createElement('div');
      meta.className='tor-meta';
const actions=document.createElement('div');
      actions.className='tor-actions';

      const playBtn=document.createElement('button');
      playBtn.className='tor-btn';
      playBtn.type='button';
      playBtn.textContent = '▶ ' + it.name;
      playBtn.title = 'Lire (overlay sur player)';
      playBtn.addEventListener('click', ()=>{
        if (typeof window.openWebtorRectOverlay === 'function') {
          window.openWebtorRectOverlay(it.url);
        }
      });

      const closeBtn=document.createElement('button');
      closeBtn.className='tor-btn';
      closeBtn.type='button';
      closeBtn.textContent='Fermer overlay';
      closeBtn.addEventListener('click', ()=>{
        if (typeof window.closeWebtorRectOverlay === 'function') window.closeWebtorRectOverlay({ reload:true });
      });

      const delBtn=document.createElement('button');
      delBtn.className='tor-btn danger';
      delBtn.type='button';
      delBtn.textContent='Suppr';
      delBtn.addEventListener('click', ()=>{
        const cur=loadTorrents().filter(x=>x.url!==it.url);
        saveTorrents(cur);
        render();
      });

      actions.appendChild(playBtn);
      actions.appendChild(closeBtn);
      actions.appendChild(delBtn);

      item.appendChild(meta);
      item.appendChild(actions);
      list.appendChild(item);
    });

    root.appendChild(hint);
    
    root.appendChild(tip);
root.appendChild(row);
    root.appendChild(list);
  }

  function activateTorrentsTab(){
    $all('.tab-btn').forEach(b=>b.classList.remove('active'));
    const tb = document.querySelector('.tab-btn[data-tab="torrents"]');
    if (tb) tb.classList.add('active');

    $all('.list').forEach(l=>l.classList.remove('active'));
    const tl = document.getElementById('torrentList');
    if (tl) tl.classList.add('active');
    // Stop la lecture en cours quand on ouvre TorrentList (évite audio/vidéo qui continue)
    try { if (typeof window.destroyHls === 'function') window.destroyHls(); } catch(e) {}
    try { if (typeof window.destroyDash === 'function') window.destroyDash(); } catch(e) {}
    try {
      const v = document.querySelector('video');
      if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    } catch(e) {}

    render();
  }

  function wireTab(){
    const tb = document.querySelector('.tab-btn[data-tab="torrents"]');
    if (!tb) return;

    tb.addEventListener('click', (e)=>{
      e.preventDefault();
      e.stopImmediatePropagation();
      activateTorrentsTab();
    }, true);
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    wireTab();
    render();
  });
})();
