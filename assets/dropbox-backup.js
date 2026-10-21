/* Dropbox OAuth authorization code + PKCE; never store an app secret or export tokens. */
(function(){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const read=k=>{try{return JSON.parse(sessionStorage.getItem(k)||'null');}catch{return null;}};
 const redirect=()=>location.origin+location.pathname;
 const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const api=window.DropboxBackup={
  busy:false,message:'',files:[],
  token(){const s=read('dbx_session');return s&&s.expires>Date.now()+30000?s.token:null;},
  async run(fn){if(api.busy)return;api.busy=true;Store.render();try{await fn();}catch(e){api.message=e.message||'Dropbox tidak dapat dihubungi. Coba lagi.';}finally{api.busy=false;Store.render();}},
  render(){return `<div class="tw-workspace fw-workspace">${Finance.header('Cadangan Dropbox','Simpan salinan lengkap: siswa, pembayaran utama, lain-lain, setoran, dan riwayat audit.')}<section class="tw-panel"><h2 class="fw-title">${api.token()?'Dropbox terhubung untuk sesi ini':'Hubungkan Dropbox'}</h2><p>Backup dijalankan saat Anda menekan tombol. Data di Dropbox berupa berkas JSON dalam folder aplikasi.</p>${api.message?`<div class="fw-notice" role="status">${esc(api.message)}</div>`:''}<div class="tw-shortcuts no-print">${api.token()?`<button class="tw-button tw-primary" ${api.busy?'disabled':''} onclick="DropboxBackup.upload()">${api.busy?'Sedang diproses…':'Backup ke Dropbox sekarang'}</button><button class="tw-button" ${api.busy?'disabled':''} onclick="DropboxBackup.list()">Muat daftar backup</button><button class="tw-link" ${api.busy?'disabled':''} onclick="DropboxBackup.disconnect()">Putuskan sesi perangkat ini</button>`:`<button class="tw-button tw-primary" ${api.busy?'disabled':''} onclick="DropboxBackup.connect()">Hubungkan akun Dropbox</button>`}<button class="tw-button" onclick="AppActions.downloadBackupJSON()">Unduh JSON lokal</button></div><p class="tw-context">Backup Dropbox terakhir dari perangkat ini: ${esc(localStorage.getItem('dbx_last_backup')||'Belum tercatat')}. Sesi berakhir otomatis; hubungkan kembali jika diperlukan.</p>
  <details><summary>Pengaturan awal administrator</summary><p>Pemilik aplikasi mendaftarkan integrasi sekali, kemudian guru menghubungkan akun masing-masing.</p><ol><li>Buka <a href="https://www.dropbox.com/developers/apps" target="_blank" rel="noopener noreferrer">Dropbox App Console</a>. Buat aplikasi Scoped access dengan akses <b>App folder</b>.</li><li>Aktifkan izin <code>files.content.write</code>, <code>files.content.read</code>, dan <code>files.metadata.read</code>.</li><li>Tambahkan Redirect URI persis: <code>${esc(redirect())}</code>.</li><li>Masukkan App key publik di bawah. Jangan masukkan App secret atau access token.</li></ol><form class="fw-form" onsubmit="event.preventDefault();DropboxBackup.saveKey(this.elements.key.value)"><label>App key publik<input name="key" autocomplete="off" value="${esc(localStorage.getItem('dbx_app_key')||'')}" required pattern="[A-Za-z0-9]{8,80}" maxlength="80"></label><button class="tw-button" ${api.busy?'disabled':''}>Simpan App key</button></form></details></section>
  <section class="tw-panel"><h2 class="fw-title">Pulihkan cadangan</h2><p>Pilih backup, lalu periksa ringkasannya sebelum menyetujui penggantian data perangkat ini.</p>${Finance.tableHTML(['Berkas','Waktu Dropbox','Ukuran','Tindakan'],api.files.map((f,i)=>[esc(f.name),esc(f.server_modified),`${Math.ceil(f.size/1024)} KB`,`<button class="tw-link" ${api.busy?'disabled':''} onclick="DropboxBackup.restore(${i})">Periksa & pulihkan</button>`]))}<label class="tw-button no-print">Pilih backup JSON lokal<input type="file" accept=".json,application/json" onchange="AppActions.handleRestoreFile(this)"></label></section></div>`;},
  saveKey(value){if(api.busy)return;const key=value.trim();if(!/^[A-Za-z0-9]{8,80}$/.test(key))return Store.showToast('App key tidak valid.','error');localStorage.setItem('dbx_app_key',key);sessionStorage.removeItem('dbx_session');sessionStorage.removeItem('dbx_pending');api.files=[];api.message='App key disimpan. Hubungkan akun Dropbox.';Store.render();},
  connect(){return api.run(async()=>{
    const client=localStorage.getItem('dbx_app_key');if(!client)throw Error('Administrator perlu mengisi App key pada pengaturan awal terlebih dahulu.');
    if(!window.isSecureContext||!crypto.subtle)throw Error('Dropbox memerlukan HTTPS atau localhost.');
    const verifier=b64(crypto.getRandomValues(new Uint8Array(48))),state='dbx_'+b64(crypto.getRandomValues(new Uint8Array(24)));
    const challenge=b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
    sessionStorage.setItem('dbx_pending',JSON.stringify({verifier,state,client,redirect:redirect(),at:Date.now()}));
    const params=new URLSearchParams({client_id:client,response_type:'code',redirect_uri:redirect(),state,code_challenge:challenge,code_challenge_method:'S256',token_access_type:'online',scope:'files.content.write files.content.read files.metadata.read'});
    location.assign('https://www.dropbox.com/oauth2/authorize?'+params);
  });},
  async callback(){
    const params=new URLSearchParams(location.search),state=params.get('state');if(!state?.startsWith('dbx_'))return;
    const pending=read('dbx_pending');sessionStorage.removeItem('dbx_pending');
    const code=params.get('code'),error=params.get('error');['code','state','error','error_description'].forEach(k=>params.delete(k));
    history.replaceState(null,'',location.pathname+(params.size?'?'+params:'')+location.hash);
    Store.currentTab='backup';
    return api.run(async()=>{
      if(!pending||state!==pending.state||Date.now()-pending.at>600000||redirect()!==pending.redirect)throw Error('Sesi penghubungan tidak cocok atau kedaluwarsa. Hubungkan ulang.');
      if(error||!code)throw Error('Izin Dropbox dibatalkan atau tidak diberikan.');
      const res=await fetch('https://api.dropboxapi.com/oauth2/token',{method:'POST',body:new URLSearchParams({code,grant_type:'authorization_code',client_id:pending.client,code_verifier:pending.verifier,redirect_uri:pending.redirect})});
      if(!res.ok)throw Error('Penghubungan Dropbox gagal. Periksa App key dan Redirect URI.');
      const data=await res.json();if(!data.access_token||!Number.isFinite(data.expires_in))throw Error('Respons sesi Dropbox tidak valid.');
      sessionStorage.setItem('dbx_session',JSON.stringify({token:data.access_token,expires:Date.now()+data.expires_in*1000}));api.message='Dropbox berhasil dihubungkan. Tekan Backup untuk menyimpan data.';
    });
  },
  async request(route,args,body){
    const token=api.token();if(!token)throw Error('Sesi Dropbox berakhir. Hubungkan akun kembali.');
    const content=['files/upload','files/download'].includes(route), headers={Authorization:'Bearer '+token};
    if(content){headers['Dropbox-API-Arg']=JSON.stringify(args).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));if(body!==undefined)headers['Content-Type']='application/octet-stream';}
    else headers['Content-Type']='application/json';
    const res=await fetch(`https://${content?'content':'api'}.dropboxapi.com/2/${route}`,{method:'POST',headers,...(content?(body===undefined?{}:{body}):{body:JSON.stringify(args)})});
    if(!res.ok){if(res.status===401){sessionStorage.removeItem('dbx_session');api.files=[];throw Error('Sesi Dropbox tidak berlaku. Hubungkan kembali.');}if(res.status===429)throw Error('Dropbox membatasi permintaan. Tunggu sebentar lalu coba kembali.');throw Error(`Dropbox menolak permintaan (${res.status}). Periksa izin aplikasi, ruang Dropbox, atau keberadaan berkas.`);}return res;
  },
  snapshot(){return {schema:'keuangan-kelas-backup',version:'3.0',appName:'Sistem Pembayaran Kelas 1 SD',exportedAt:new Date().toISOString(),students:Store.students,paymentTypes:Store.paymentTypes,transactions:Store.transactions,settings:Store.settings,auditLogs:Store.auditLogs||[]};},
  upload(){return api.run(async()=>{
    const data=api.snapshot(),check=AppActions.validateBackup(data);if(!check.ok)throw Error(check.message);
    const body=new Blob([JSON.stringify(data)],{type:'application/octet-stream'});if(body.size>50*1024*1024)throw Error('Backup melebihi batas 50 MB.');
    const name='backup_keuangan_'+new Date().toISOString().replace(/[:.]/g,'-')+'_'+crypto.randomUUID()+'.json';
    await api.request('files/upload',{path:'/'+name,mode:'add',autorename:false,mute:true,strict_conflict:true},body);
    api.message='Backup berhasil tersimpan di Dropbox: '+name;
    try{localStorage.setItem('dbx_last_backup',new Date().toLocaleString('id-ID'));}catch{/* Upload already succeeded. */}
  });},
  list(){return api.run(async()=>{api.files=[];let data=await(await api.request('files/list_folder',{path:'',recursive:false,limit:100})).json();let entries=[...data.entries];while(data.has_more){data=await(await api.request('files/list_folder/continue',{cursor:data.cursor})).json();entries.push(...data.entries);}api.files=entries.filter(f=>f['.tag']==='file'&&f.name.startsWith('backup_keuangan_')&&f.name.endsWith('.json')).sort((a,b)=>b.server_modified.localeCompare(a.server_modified));api.message=`${api.files.length} backup ditemukan.`;});},
  restore(index){return api.run(async()=>{const f=api.files[index];if(!f)throw Error('Muat ulang daftar backup.');if(f.size>50*1024*1024)throw Error('Berkas melebihi batas 50 MB.');const res=await api.request('files/download',{path:f.id,rev:f.rev});const blob=await res.blob();if(blob.size>50*1024*1024)throw Error('Berkas melebihi batas 50 MB.');AppActions.handleRestoreFile({files:[new File([blob],f.name,{type:'application/json'})],value:''});api.message='Backup diunduh. Periksa dialog pemulihan sebelum melanjutkan.';});},
  disconnect(){if(api.busy)return;sessionStorage.removeItem('dbx_session');sessionStorage.removeItem('dbx_pending');api.files=[];api.message='Sesi pada perangkat ini dihapus. Untuk mencabut izin aplikasi, gunakan pengaturan akun Dropbox.';Store.render();}
 };
})();
