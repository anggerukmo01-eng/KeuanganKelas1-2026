/* Separate cash books. Ledger lives in settings so existing backups/cloud snapshots retain it. */
(function () {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = v => 'Rp ' + Number(v || 0).toLocaleString('id-ID');
  const arg = v => esc(JSON.stringify(String(v)));
  const today = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const uid = () => crypto.randomUUID();
  const amount = n => Number.isSafeInteger(n) && n > 0;
  const ledger = s => s.financeLedger || {version:1,types:[],payments:[],transfers:[]};
  const key = (s,t) => JSON.stringify([s,t]);
  const api = window.Finance = {
    search:'', category:'main',
    ledger: () => ledger(Store.settings),
    validate(settings, transactions=[]) {
      if (!settings?.financeLedger) return '';
      const l=settings.financeLedger;
      if(l.version!==1 || !['types','payments','transfers'].every(k=>Array.isArray(l[k]))) return 'Buku kas tambahan tidak valid.';
      for(const name of ['types','payments','transfers']) {
        const ids=new Set();
        for(const row of l[name]) {
          if(!row || typeof row.id!=='string' || !row.id || ids.has(row.id)) return 'ID buku kas tidak valid/ganda.';
          ids.add(row.id);
          if(name==='types') {
            if(typeof row.name!=='string' || !row.name.trim() || !amount(row.price) || !Array.isArray(row.studentIds) || row.studentIds.some(id=>typeof id!=='string') || new Set(row.studentIds).size!==row.studentIds.length) return 'Jenis pembayaran lain-lain tidak valid.';
          } else {
            if(!amount(row.amount) || !TeacherWorkspace.validDate(row.date) || typeof row.studentId!=='string' || typeof row.typeId!=='string' || typeof row.studentName!=='string' || typeof row.typeName!=='string' || typeof row.recipient!=='string' || !row.recipient.trim() || (row.voided && !row.voidReason)) return 'Rincian buku kas tidak valid.';
            if(name==='payments' && (!['teacher','treasurer'].includes(row.destination) || !l.types.some(t=>t.id===row.typeId && t.studentIds.includes(row.studentId)))) return 'Pembayaran lain-lain tidak memiliki tagihan.';
            if(name==='transfers' && !['main','other'].includes(row.category)) return 'Kategori setoran tidak valid.';
          }
        }
      }
      for(const type of l.types) for(const sid of type.studentIds) {
        if(l.payments.filter(p=>!p.voided&&p.typeId===type.id&&p.studentId===sid).reduce((s,p)=>s+p.amount,0)>type.price) return 'Pembayaran lain-lain melebihi tagihan.';
      }
      for(const cat of ['main','other']) for(const row of api.buckets(cat,transactions,l)) {
        if(row.balance<0) return 'Setoran melebihi penerimaan guru. Batalkan setoran terkait sebelum mengoreksi pembayaran.';
      }
      // Reconcile by date too: later receipts cannot fund an earlier handover.
      for(const transfer of l.transfers.filter(t=>!t.voided)) {
        const at={...l,payments:l.payments.filter(p=>p.date<=transfer.date),transfers:l.transfers.filter(t=>t.date<=transfer.date)};
        if(api.buckets(transfer.category,transactions.filter(t=>t.date<=transfer.date),at).some(r=>r.balance<0)) return 'Setoran mendahului penerimaan yang membiayainya. Periksa tanggal pembayaran dan setoran.';
      }
      return '';
    },
    buckets(category='main', transactions=Store.transactions, l=api.ledger()) {
      const rows=new Map();
      const get=(sid,tid,sname,tname)=>{const k=key(sid,tid); if(!rows.has(k)) rows.set(k,{studentId:sid,typeId:tid,studentName:sname,typeName:tname,teacher:0,direct:0,transferred:0});return rows.get(k);};
      if(category==='main') transactions.forEach(tx=>(tx.items||[]).forEach(i=>{
        const row=get(tx.studentId,i.paymentTypeId,tx.studentName,i.paymentTypeName);
        row[i.status==='Dibayar ke Guru Lain'?'direct':'teacher']+=Number(i.paidAmount)||0;
      }));
      else l.payments.filter(p=>!p.voided).forEach(p=>{ get(p.studentId,p.typeId,p.studentName,p.typeName)[p.destination==='treasurer'?'direct':'teacher']+=p.amount; });
      l.transfers.filter(t=>!t.voided&&t.category===category).forEach(t=>{get(t.studentId,t.typeId,t.studentName,t.typeName).transferred+=t.amount;});
      return [...rows.values()].map(r=>({...r,balance:r.teacher-r.transferred,treasurer:r.direct+r.transferred,total:r.teacher+r.direct}));
    },
    totals(category='main') { return api.buckets(category).reduce((s,r)=>{for(const k of ['teacher','direct','transferred','balance','treasurer','total'])s[k]+=r[k];return s;},{teacher:0,direct:0,transferred:0,balance:0,treasurer:0,total:0}); },
    commit(action, mutate) {
      const oldSettings=Store.settings, oldAudit=[...(Store.auditLogs||[])];
      Store.settings=JSON.parse(JSON.stringify(oldSettings));
      if(!Store.settings.financeLedger) Store.settings.financeLedger=ledger({});
      try {
        mutate(Store.settings.financeLedger);
        const error=api.validate(Store.settings,Store.transactions); if(error) throw Error(error);
        Store.recordAudit(action,'Buku Kas','finance',action);
        if(!Store.save()) throw Error('Penyimpanan gagal. Catatan belum disimpan.');
        Store.render(); Store.showToast('Catatan berhasil disimpan.','success'); return true;
      } catch(e) {Store.settings=oldSettings;Store.auditLogs=oldAudit;Store.showToast(e.message,'error');return false;}
    },
    cards(category='main') {
      const s=api.totals(category);
      return `<div class="tw-metrics fw-metrics">${[['Diterima guru',s.teacher,'Akumulasi pembayaran siswa'],['Disetor guru ke bendahara',s.transferred,'Penyerahan yang sudah dicatat'],['Saldo di guru',s.balance,'Penerimaan guru − setoran'],['Diterima bendahara',s.treasurer,`Langsung ${money(s.direct)} + setoran guru`]].map(([title,value,note])=>`<div class="tw-metric"><span>${title}</span><strong>${money(value)}</strong><small>${note}</small></div>`).join('')}</div>`;
    },
    header(title,note) {return `<section class="tw-hero fw-hero"><div class="tw-eyebrow">BUKU KAS KELAS • ${esc(Store.settings.academicYear)}</div><h1>${title}</h1><p>${note}</p></section>`;},
    render() {
      const cat=api.category, l=api.ledger(),rows=api.buckets(cat), available=rows.filter(r=>r.balance>0);
      return `<div class="tw-workspace fw-workspace">${api.header('Setoran yang jelas. Saldo yang terpantau.','Penerimaan siswa dan penyerahan guru dicatat terpisah agar uang tidak dihitung dua kali.')}
      <div class="tw-chips no-print">${[['main','Pembayaran utama'],['other','Pembayaran lain-lain']].map(([id,label])=>`<button class="tw-chip ${cat===id?'is-active':''}" onclick="Finance.category='${id}';Store.render()">${label}</button>`).join('')}</div>
      <h2 class="fw-title">Rekap ${cat==='main'?'pembayaran utama':'lain-lain'} • seluruh periode</h2>${api.cards(cat)}
      <p class="tw-context">Total dibayar siswa: <b>${money(api.totals(cat).total)}</b>. Angka mencakup catatan siswa dan jenis biaya nonaktif. ${cat==='main'?'Catatan lama berstatus “Dibayar ke Guru Lain” tetap dikelompokkan sebagai pembayaran langsung ke bendahara; periksa penerimanya pada riwayat.':''}</p>
      <section class="tw-panel no-print"><h2 class="fw-title">Catat penyerahan ke bendahara</h2><p>Pilih asal uang agar setoran dapat ditelusuri sampai siswa dan jenis pembayaran.</p>
      <form class="fw-form" onsubmit="event.preventDefault();Finance.addTransfer(this)">
      <label>Asal uang<select name="bucket" required><option value="">Pilih siswa / pembayaran</option>${available.map(r=>`<option value="${esc(key(r.studentId,r.typeId))}">${esc(r.studentName)} · ${esc(r.typeName)} · saldo ${money(r.balance)}</option>`).join('')}</select></label>
      <label>Tanggal setoran<input name="date" type="date" value="${today()}" max="${today()}" required></label><label>Nominal (Rp)<input name="amount" type="number" min="1" step="1" required></label><label>Nama bendahara penerima<input name="recipient" maxlength="120" value="${esc(Store.settings.bookTreasurerName||'')}" required></label><label>Nomor bukti / catatan<input name="note" maxlength="300" required placeholder="Contoh: Bukti setor 001"></label><button class="tw-button tw-primary" ${available.length?'':'disabled'}>Simpan setoran</button></form></section>
      <section class="tw-panel"><div class="tw-section-title"><h2>Rincian per siswa dan pembayaran</h2><div class="no-print"><button class="tw-button" onclick="Finance.exportRekap()">Unduh CSV</button> <button class="tw-button" onclick="window.print()">Cetak rekap</button></div></div><label class="no-print">Cari nama siswa / jenis pembayaran<input class="fw-search" type="search" value="${esc(api.search)}" oninput="Finance.search=this.value;Finance.updateRows()"></label><div id="finance-rows">${api.table(rows)}</div></section>
      <section class="tw-panel"><h2 class="fw-title">Bukti penyerahan ke bendahara</h2>${api.transferTable(l.transfers.filter(t=>t.category===cat))}</section></div>`;
    },
    table(rows) {
      rows=rows.filter(r=>TeacherWorkspace.matchesStudent({name:r.studentName,parentName:r.typeName},api.search));
      return api.tableHTML(['Siswa','Jenis pembayaran','Ke guru','Langsung bendahara','Disetor guru','Saldo guru','Total bendahara'],rows.map(r=>[esc(r.studentName),esc(r.typeName),money(r.teacher),money(r.direct),money(r.transferred),money(r.balance),money(r.treasurer)]));
    },
    tableHTML(headers,rows) {return `<div class="fw-table-wrap"><table class="fw-table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${headers.length}">Belum ada catatan.</td></tr>`}</tbody></table></div>`;},
    updateRows(){const el=document.getElementById('finance-rows');if(el)el.innerHTML=api.table(api.buckets(api.category));},
    addTransfer(form) {
      const f=form.elements; const row=api.buckets(api.category).find(r=>key(r.studentId,r.typeId)===f.bucket.value);
      if(!row) return Store.showToast('Pilih asal uang yang tersedia.','error');
      const n=Number(f.amount.value), date=f.date.value;
      if(!amount(n)||n>row.balance||!TeacherWorkspace.validDate(date)||date>today()||!f.recipient.value.trim()||!f.note.value.trim()) return Store.showToast('Periksa tanggal, penerima, bukti, dan nominal. Setoran tidak boleh melebihi saldo.','error');
      // A deposit cannot precede the receipts funding it.
      const prior=api.buckets(api.category,Store.transactions.filter(t=>t.date<=date),{...api.ledger(),payments:api.ledger().payments.filter(p=>p.date<=date)}).find(r=>key(r.studentId,r.typeId)===f.bucket.value);
      if(!prior||n>prior.balance) return Store.showToast('Penerimaan sampai tanggal tersebut belum cukup untuk setoran ini.','error');
      api.commit('SETOR KE BENDAHARA',l=>l.transfers.push({id:uid(),category:api.category,studentId:row.studentId,studentName:row.studentName,typeId:row.typeId,typeName:row.typeName,amount:n,date,recipient:f.recipient.value.trim(),note:f.note.value.trim(),createdAt:new Date().toISOString()}));
    },
    transferTable(rows){return api.tableHTML(['Tanggal / bukti','Siswa / biaya','Penerima','Nominal','Status'],[...rows].reverse().map(t=>[`${esc(t.date)}<small>${esc(t.note)}</small>`,`${esc(t.studentName)}<small>${esc(t.typeName)}</small>`,esc(t.recipient),money(t.amount),t.voided?`Dibatalkan<small>${esc(t.voidReason)}</small>`:`<button class="tw-link no-print" onclick="Finance.voidRecord('transfers',${arg(t.id)})">Batalkan</button>`]));},
    voidRecord(list,id){
      const reason=window.prompt('Alasan pembatalan (catatan asli tetap disimpan):');if(!reason?.trim())return;
      Store.modal={type:'CONFIRM',title:'Batalkan catatan?',message:'Catatan akan ditandai batal dan dikeluarkan dari perhitungan.',confirmText:'Batalkan catatan',variant:'danger',onConfirm:()=>{const ok=api.commit('BATAL CATATAN KAS',l=>{const row=l[list].find(r=>r.id===id);if(!row||row.voided)throw Error('Catatan sudah dibatalkan.');row.voided=true;row.voidReason=reason.trim();row.voidedAt=new Date().toISOString();});if(ok){Store.modal=null;Store.render();}}};Store.render();
    },
    otherRows(){const l=api.ledger();return l.types.flatMap(t=>t.studentIds.map(id=>{const student=Store.students.find(s=>s.id===id);const payments=l.payments.filter(p=>!p.voided&&p.typeId===t.id&&p.studentId===id);const paid=payments.reduce((s,p)=>s+p.amount,0);return {studentId:id,studentName:student?.name||payments[0]?.studentName||id,typeId:t.id,typeName:t.name,target:t.price,paid,remaining:t.price-paid};}));},
    renderOther(){const l=api.ledger(),rows=api.otherRows();return `<div class="tw-workspace fw-workspace">${api.header('Pembayaran lain-lain','Buku tersendiri untuk kegiatan atau kebutuhan tambahan. Tidak masuk tagihan, kasir, maupun total pembayaran utama.')}${api.cards('other')}
      <section class="tw-panel no-print"><h2 class="fw-title">Tambah jenis pembayaran lain-lain</h2><form class="fw-form" onsubmit="event.preventDefault();Finance.addType(this)"><label>Nama pembayaran<input name="name" required maxlength="120" placeholder="Contoh: Kegiatan kelas"></label><label>Tagihan per siswa (Rp)<input name="price" type="number" required min="1" step="1"></label><label>Berlaku untuk<select name="student"><option value="ALL">Semua siswa aktif saat ini</option>${Store.students.filter(s=>s.active).map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label><button class="tw-button tw-primary">Tambah tagihan</button></form><p class="tw-context">Daftar peserta ditetapkan saat tagihan dibuat; siswa baru tidak otomatis ditagih.</p></section>
      <section class="tw-panel no-print"><h2 class="fw-title">Catat pembayaran lain-lain</h2><form class="fw-form" onsubmit="event.preventDefault();Finance.addOtherPayment(this)"><label>Siswa / tagihan<select name="bill" required><option value="">Pilih tagihan</option>${rows.filter(r=>r.remaining>0).map(r=>`<option value="${esc(key(r.studentId,r.typeId))}">${esc(r.studentName)} · ${esc(r.typeName)} · sisa ${money(r.remaining)}</option>`).join('')}</select></label><label>Tanggal<input type="date" name="date" required value="${today()}" max="${today()}"></label><label>Nominal (Rp)<input type="number" name="amount" required min="1" step="1"></label><label>Diterima oleh<select name="destination"><option value="teacher">Guru kelas</option><option value="treasurer">Langsung bendahara</option></select></label><label>Nama penerima<input name="recipient" required maxlength="120"></label><label>Catatan<input name="note" maxlength="300"></label><button class="tw-button tw-primary">Simpan pembayaran</button></form></section>
      <section class="tw-panel"><div class="tw-section-title"><h2>Rekap tagihan lain-lain</h2><div class="no-print"><button class="tw-button" onclick="Finance.exportOther()">Unduh CSV</button> <button class="tw-button" onclick="window.print()">Cetak</button> <button class="tw-link" onclick="Finance.category='other';AppActions.navigate('deposit')">Setor ke bendahara →</button></div></div><p>Total tagihan ${money(rows.reduce((s,r)=>s+r.target,0))} · Sudah dibayar ${money(rows.reduce((s,r)=>s+r.paid,0))} · Sisa ${money(rows.reduce((s,r)=>s+r.remaining,0))}</p><label class="no-print">Cari siswa / pembayaran<input class="fw-search" type="search" value="${esc(api.search)}" oninput="Finance.search=this.value;document.getElementById('other-rows').innerHTML=Finance.otherTable()"></label><div id="other-rows">${api.otherTable()}</div></section>
      <section class="tw-panel"><h2 class="fw-title">Riwayat pembayaran lain-lain</h2>${api.tableHTML(['Tanggal / bukti','Siswa / jenis','Penerima','Nominal','Status'],[...l.payments].reverse().map(p=>[`${esc(p.date)}<small>LL-${esc(p.id)} · ${esc(p.note)}</small>`,`${esc(p.studentName)}<small>${esc(p.typeName)}</small>`,`${esc(p.recipient)}<small>${p.destination==='teacher'?'Guru':'Bendahara'}</small>`,money(p.amount),p.voided?`Batal: ${esc(p.voidReason)}`:`<button class="tw-link no-print" onclick="Finance.voidRecord('payments',${arg(p.id)})">Batalkan</button>`]))}</section></div>`;},
    otherTable(){return api.tableHTML(['Siswa','Pembayaran','Tagihan','Dibayar','Sisa','Status'],api.otherRows().filter(r=>TeacherWorkspace.matchesStudent({name:r.studentName,parentName:r.typeName},api.search)).map(r=>[esc(r.studentName),esc(r.typeName),money(r.target),money(r.paid),money(r.remaining),r.remaining===0?'Lunas':r.paid?'Cicilan':'Belum bayar']));},
    addType(form){const f=form.elements,price=Number(f.price.value),name=f.name.value.trim();const ids=Store.students.filter(s=>s.active&&(f.student.value==='ALL'||s.id===f.student.value)).map(s=>s.id);if(!amount(price)||!name||!ids.length)return Store.showToast('Isi nama, tarif, dan siswa aktif.','error');if(api.ledger().types.some(t=>t.name.toLocaleLowerCase()===name.toLocaleLowerCase()))return Store.showToast('Nama sudah digunakan. Bedakan nama atau periode kegiatan.','error');api.commit('TAMBAH TAGIHAN LAIN-LAIN',l=>l.types.push({id:uid(),name,price,studentIds:ids}));},
    addOtherPayment(form){const f=form.elements,row=api.otherRows().find(r=>key(r.studentId,r.typeId)===f.bill.value),n=Number(f.amount.value);if(!row||!amount(n)||n>row.remaining||!TeacherWorkspace.validDate(f.date.value)||f.date.value>today()||!f.recipient.value.trim())return Store.showToast('Periksa tagihan, nominal, tanggal, dan nama penerima.','error');api.commit('PEMBAYARAN LAIN-LAIN',l=>l.payments.push({id:uid(),studentId:row.studentId,studentName:row.studentName,typeId:row.typeId,typeName:row.typeName,amount:n,date:f.date.value,destination:f.destination.value,recipient:f.recipient.value.trim(),note:f.note.value.trim(),createdAt:new Date().toISOString()}));},
    csv(name,rows){const cell=v=>'"'+String(v??'').replace(/^\s*[=+@-]/,m=>"'"+m).replace(/"/g,'""')+'"';const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name+'_'+today()+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},
    exportRekap(){const rows=api.buckets(api.category).filter(r=>TeacherWorkspace.matchesStudent({name:r.studentName,parentName:r.typeName},api.search));api.csv('Setoran_'+api.category,[['Rekap setoran',api.category==='main'?'Utama':'Lain-lain','Seluruh periode','Filter',api.search],['Siswa','Jenis','Diterima guru','Langsung bendahara','Disetor guru','Saldo guru','Total bendahara'],...rows.map(r=>[r.studentName,r.typeName,r.teacher,r.direct,r.transferred,r.balance,r.treasurer]),[],['BUKTI SETORAN (seluruh catatan kategori)'],['ID','Tanggal','Siswa','Jenis','Nominal','Penerima','Bukti','Status','Alasan batal'],...api.ledger().transfers.filter(t=>t.category===api.category).map(t=>[t.id,t.date,t.studentName,t.typeName,t.amount,t.recipient,t.note,t.voided?'Batal':'Aktif',t.voidReason||''])]);},
    exportOther(){api.csv('Pembayaran_lain_lain',[['REKAP LAIN-LAIN (seluruh siswa)'],['Siswa','Jenis','Tagihan','Dibayar','Sisa'],...api.otherRows().map(r=>[r.studentName,r.typeName,r.target,r.paid,r.remaining]),[],['RIWAYAT'],['ID','Tanggal','Siswa','Jenis','Nominal','Tujuan','Penerima','Catatan','Status','Alasan batal'],...api.ledger().payments.map(p=>[p.id,p.date,p.studentName,p.typeName,p.amount,p.destination,p.recipient,p.note,p.voided?'Batal':'Aktif',p.voidReason||''])]);}
  };
})();
