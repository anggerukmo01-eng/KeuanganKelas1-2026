/* Teacher workflow UI. Uses the existing store and storage keys; no migration required. */
(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money = value => 'Rp ' + Number(value || 0).toLocaleString('id-ID');
  const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('id-ID').trim();
  const jsArg = value => esc(JSON.stringify(String(value)));
  const dateLabel = value => value ? new Date(value + 'T12:00:00').toLocaleDateString('id-ID', {day:'numeric',month:'short',year:'numeric'}) : 'Belum ada';
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const icons = {
    home: '<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.search}</svg>`;
  const state = { search: '', type: 'ALL', status: 'ALL', sort: 'name' };
  const api = window.TeacherWorkspace = {
    state,
    validDate(value) {
      return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value+'T12:00:00Z')) && new Date(value+'T12:00:00Z').toISOString().slice(0,10) === value;
    },
    matchesStudent(student, query) {
      const haystack = normalize([student.name, student.nis, student.parentName, student.father, student.mother, student.address].join(' '));
      return normalize(query).split(/\s+/).every(word => haystack.includes(word));
    },
    typeOptions(selected) {
      const types = new Map(Store.paymentTypes.map(p => [p.id,p.name]));
      Store.transactions.forEach(tx => (tx.items || []).forEach(item => { if (!types.has(item.paymentTypeId)) types.set(item.paymentTypeId, item.paymentTypeName || 'Biaya lama'); }));
      return [...types].map(([id,name]) => `<option value="${esc(id)}" ${selected===id?'selected':''}>${esc(name)}</option>`).join('');
    },
    dashboard(stats) {
      const rows = Store.students.filter(s=>s.active).map(s=>Store.getStudentSummary(s));
      const outstanding = rows.filter(row=>row.remainingTarget>0).length;
      const recent = [...Store.transactions].sort((a,b)=>String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date))).slice(0,4);
      return `<div class="tw-workspace">
        <section class="tw-hero">
          <div class="tw-eyebrow">RUANG KERJA GURU <span>•</span> ${esc(Store.settings.className)} / ${esc(Store.settings.academicYear)}</div>
          <div class="tw-hero-row"><div><h1>Pembayaran kelas,<br>lebih mudah dipantau.</h1><p>Catat penerimaan, periksa sisa tagihan, dan temukan bukti pembayaran dalam satu tempat.</p></div><div class="tw-hero-mark" aria-hidden="true">${icon('check')}<span>SI-BAYAR</span></div></div>
          <div class="tw-hero-actions"><button class="tw-button tw-white" onclick="AppActions.navigate('payment')">${icon('plus')} Catat pembayaran</button><button class="tw-button tw-glass" onclick="AppActions.navigate('check')">${icon('search')} Cek pembayaran siswa</button></div>
        </section>
        <section class="tw-panel"><div class="tw-section-title"><h2>Kas pembayaran utama</h2><button class="tw-link" onclick="AppActions.navigate('deposit')">Setoran & saldo →</button></div>${Finance.cards('main')}</section>
        <div class="tw-metrics">
          <div class="tw-metric"><span>Penerimaan hari ini</span><strong>${money(stats.todayRevenue)}</strong><small>${stats.todayTxCount} transaksi tercatat</small></div>
          <div class="tw-metric"><span>Masih perlu pembayaran</span><strong class="tw-amber">${outstanding} <em>siswa</em></strong><small>dari ${stats.totalStudents} siswa aktif</small></div>
          <div class="tw-metric"><span>Sisa tagihan aktif</span><strong>${money(stats.totalClassRemaining)}</strong><small>Dihitung per siswa dan per biaya</small></div>
          <div class="tw-metric"><span>Semua tagihan lunas</span><strong class="tw-green">${rows.filter(r=>r.totalTarget>0 && r.remainingTarget===0).length} <em>siswa</em></strong><small>${stats.progressPercentage}% nilai tagihan terpenuhi</small></div>
        </div>
        <section class="tw-panel"><div class="tw-section-title"><div><span class="tw-eyebrow">MULAI DARI NAMA SISWA</span><h2>Siapa yang ingin dicek?</h2></div>${icon('search')}</div>
          <form class="tw-quick-search" onsubmit="event.preventDefault(); TeacherWorkspace.openCheck(this.elements.student.value)"><label class="tw-sr" for="dashboard-student">Nama siswa, NIS, atau orang tua</label><input id="dashboard-student" name="student" placeholder="Nama siswa, NIS, atau orang tua…" autocomplete="off"><button class="tw-button tw-primary" type="submit">Cari siswa ${icon('arrow')}</button></form>
          <div class="tw-shortcuts"><button onclick="TeacherWorkspace.openCheck('', 'OUTSTANDING')">${icon('search')} Lihat yang belum lunas</button><button onclick="AppActions.navigate('history'); TeacherWorkspace.historyRange('today')">${icon('history')} Pembayaran hari ini</button><button onclick="AppActions.navigate('reports')">${icon('arrow')} Buka laporan kelas</button></div>
        </section>
        <div class="tw-bottom-grid"><section class="tw-panel"><div class="tw-section-title"><div><span class="tw-eyebrow">CATATAN TERBARU</span><h2>Pembayaran terakhir</h2></div><button class="tw-link" onclick="AppActions.navigate('history')">Lihat semua →</button></div>
          ${recent.length ? recent.map(tx=>`<button class="tw-recent" onclick="AppActions.navigate('receipt', {receiptId:${jsArg(tx.id)}})"><span class="tw-avatar">${esc((tx.studentName||'?').slice(0,1))}</span><span><b>${esc(tx.studentName)}</b><small>${dateLabel(tx.date)} · ${esc(tx.receiptNo)}</small></span><strong>${money(tx.totalAmount)}</strong>${icon('arrow')}</button>`).join('') : '<div class="tw-empty">Belum ada pembayaran tercatat.<br>Gunakan tombol “Catat pembayaran” untuk memulai.</div>'}
        </section><aside class="tw-panel tw-note"><span class="tw-eyebrow">DATA KELAS</span><h2>Catatan tetap terjaga.</h2><p>Data disimpan di browser perangkat ini. Unduh cadangan secara berkala, terutama sebelum pindah perangkat.</p><button class="tw-button" onclick="AppActions.downloadBackupJSON()">Unduh cadangan JSON</button><button class="tw-link" onclick="AppActions.navigate('backup')">Backup Dropbox →</button><small>Sinkronisasi cloud dijalankan manual setelah dikonfigurasi.</small></aside></div>
      </div>`;
    },
    openCheck(search='', status='ALL') {
      Object.assign(state,{ search, status, type:'ALL' });
      AppActions.navigate('check');
    },
    rows() {
      return Store.students.filter(s=>s.active && api.matchesStudent(s,state.search)).map(student=>{
        const summary = Store.getStudentSummary(student);
        const items = summary.itemBreakdowns.filter(item=>state.type==='ALL'||item.paymentTypeId===state.type);
        const target=items.reduce((n,i)=>n+i.billPrice,0), paid=items.reduce((n,i)=>n+i.paidAmount,0), remaining=items.reduce((n,i)=>n+i.remainingAmount,0);
        const status = target===0 ? 'NONE' : remaining===0 ? 'PAID' : paid>0 ? 'PARTIAL' : 'UNPAID';
        const last = items.map(i=>i.lastPaymentDate).filter(Boolean).sort().pop();
        return { student,summary,items,target,paid,remaining,status,last };
      }).filter(row=>(state.type==='ALL'||row.items.length) && (state.status==='ALL'||(state.status==='OUTSTANDING'?row.remaining>0:row.status===state.status))).sort((a,b)=>state.sort==='remaining' ? b.remaining-a.remaining || a.student.name.localeCompare(b.student.name,'id') : a.student.name.localeCompare(b.student.name,'id'));
    },
    render() {
      return `<div class="tw-workspace"><section class="tw-panel"><div class="tw-section-title"><div><span class="tw-eyebrow">CEK CEPAT</span><h1>Temukan siswa. Pastikan pembayaran.</h1><p>Status berdasarkan nominal yang tercatat untuk tagihan aktif.</p></div></div>
        <div class="tw-filters"><label class="tw-search-label">Cari siswa atau orang tua<input id="check-search" type="search" placeholder="Nama, NIS, ayah / ibu…" value="${esc(state.search)}" oninput="TeacherWorkspace.setFilter('search',this.value)"></label>
        <label>Jenis biaya<select id="check-type" onchange="TeacherWorkspace.setFilter('type',this.value)"><option value="ALL">Semua tagihan aktif</option>${Store.paymentTypes.filter(t=>t.active).map(t=>`<option value="${esc(t.id)}" ${state.type===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label>
        <label>Urutan<select onchange="TeacherWorkspace.setFilter('sort',this.value)"><option value="name" ${state.sort==='name'?'selected':''}>Nama A–Z</option><option value="remaining" ${state.sort==='remaining'?'selected':''}>Sisa terbesar</option></select></label></div>
        <div id="check-chips" class="tw-chips">${api.chips()}</div>
        <div class="tw-filter-footer"><span id="check-summary" role="status" aria-live="polite"></span><button class="tw-link" onclick="TeacherWorkspace.resetCheck()">Reset filter</button></div></section>
        <p class="tw-context">${Store.paymentTypes.some(p=>p.active&&p.period!=='1 Kali')?'Tagihan mengikuti tarif aktif; periode bulanan belum dihitung terpisah.':'Pilih jenis biaya untuk mengecek satu pembayaran di seluruh kelas.'}</p>
        <div id="check-results" class="tw-student-grid">${api.cards()}</div></div>`;
    },
    chips() {
      return [['ALL','Semua'],['OUTSTANDING','Belum lunas'],['PARTIAL','Cicilan'],['PAID','Lunas'],['UNPAID','Belum bayar'],['NONE','Tanpa tagihan']].map(([id,label])=>`<button class="tw-chip ${state.status===id?'is-active':''}" aria-pressed="${state.status===id}" onclick="TeacherWorkspace.setFilter('status','${id}')">${label}</button>`).join('');
    },
    cards() {
      const rows=api.rows();
      const summary=`${rows.length} siswa · Sisa pada hasil ini ${money(rows.reduce((n,r)=>n+r.remaining,0))}`;
      // Initial render has no target node yet; after render setFilter refreshes it synchronously.
      setTimeout(()=>{ const el=document.getElementById('check-summary'); if(el) el.textContent=summary; },0);
      if(!rows.length) return '<div class="tw-empty tw-panel">Tidak ada siswa yang cocok.<br>Coba nama orang tua, ubah jenis biaya, atau reset filter.</div>';
      return rows.map(r=>{
        const labels={PAID:'Lunas',PARTIAL:'Cicilan',UNPAID:'Belum bayar',NONE:'Tanpa tagihan'};
        const unpaid=r.items.filter(i=>i.remainingAmount>0);
        const excess=r.items.reduce((n,i)=>n+Math.max(0,i.paidAmount-i.billPrice),0);
        return `<article class="tw-student-card"><div class="tw-card-head"><span class="tw-avatar">${esc(r.student.name.slice(0,1))}</span><div><h2>${esc(r.student.name)}</h2><small>NIS ${esc(r.student.nis||'—')} · ${esc(r.student.class||Store.settings.className)}</small></div><span class="tw-badge ${r.status.toLowerCase()}">${labels[r.status]}</span></div>
          <p class="tw-parent">Orang tua: ${esc(r.student.parentName || r.student.father || r.student.mother || 'Belum diisi')}</p>
          <div class="tw-card-balance"><div><span>Sisa pembayaran</span><strong>${money(r.remaining)}</strong></div><div><span>Sudah dibayar</span><b>${money(r.paid)}</b></div></div>
          <div class="tw-progress" role="progressbar" aria-label="Pemenuhan tagihan ${esc(r.student.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${r.target?Math.round((r.target-r.remaining)/r.target*100):0}"><span style="width:${r.target?(r.target-r.remaining)/r.target*100:0}%"></span></div>
          <div class="tw-card-items">${unpaid.slice(0,2).map(i=>`<div><span>${esc(i.name)}</span><b>${money(i.remainingAmount)}</b></div>`).join('') || `<span class="tw-green">${r.status==='NONE'?'Tidak ada kewajiban bernilai positif.':'Semua biaya yang dipilih sudah lunas.'}</span>`}${unpaid.length>2?`<small>+${unpaid.length-2} biaya lainnya · lihat rincian</small>`:''}${excess>0?`<small class="tw-amber">Kelebihan tercatat ${money(excess)}. Periksa rincian.</small>`:''}</div>
          <p class="tw-last">Pembayaran terakhir: ${dateLabel(r.last)}</p>
          <div class="tw-card-actions"><button class="tw-button tw-primary" ${r.remaining===0?'disabled':''} onclick="TeacherWorkspace.pay(${jsArg(r.student.id)})">${icon('plus')} Catat bayar</button><button class="tw-button" onclick="AppActions.navigate('student-detail',{studentId:${jsArg(r.student.id)}})">Rincian</button><button class="tw-link" onclick="TeacherWorkspace.historyFor(${jsArg(r.student.id)})">Riwayat</button></div></article>`;
      }).join('');
    },
    setFilter(key,value) {
      state[key]=value;
      const results=document.getElementById('check-results'); if(results) results.innerHTML=api.cards();
      const chips=document.getElementById('check-chips'); if(chips) chips.innerHTML=api.chips();
    },
    resetCheck() { Object.assign(state,{search:'',type:'ALL',status:'ALL',sort:'name'}); Store.render(); },
    pay(studentId) {
      AppActions.selectPOSStudent(studentId);
      if(state.type!=='ALL') { Object.entries(Store.pos.selectedItems).forEach(([id,item])=>item.checked=id===state.type && item.remainingAmount>0); Store.render(); }
    },
    historyFor(studentId) {
      Store.historyFilter={search:'',studentId,startDate:'',endDate:'',sort:'NEWEST',paymentTypeId:state.type};
      AppActions.navigate('history');
    },
    filteredTransactions() {
      const f=Store.historyFilter;
      if(f.startDate && f.endDate && f.startDate>f.endDate) return [];
      const q=normalize(f.search);
      return Store.transactions.filter(tx=>{
        const student=Store.students.find(s=>s.id===tx.studentId)||{};
        return (f.studentId==='ALL'||tx.studentId===f.studentId) && (!f.startDate||tx.date>=f.startDate) && (!f.endDate||tx.date<=f.endDate) && (!f.paymentTypeId||f.paymentTypeId==='ALL'||(tx.items||[]).some(i=>i.paymentTypeId===f.paymentTypeId)) && normalize([tx.receiptNo,tx.studentName,tx.parentName,student.nis,student.father,student.mother,tx.generalNotes,...(tx.items||[]).map(i=>i.paymentTypeName)].join(' ')).includes(q);
      }).sort((a,b)=>{ const order=String(b.date).localeCompare(String(a.date)) || String(b.createdAt||'').localeCompare(String(a.createdAt||'')) || String(b.receiptNo).localeCompare(String(a.receiptNo)); return f.sort==='OLDEST'?-order:order; });
    },
    historyRange(range) { const d=today(); Object.assign(Store.historyFilter,{startDate:range==='today'?d:d.slice(0,7)+'-01',endDate:d}); Store.render(); },
    resetHistory() { Store.historyFilter={search:'',studentId:'ALL',startDate:'',endDate:'',sort:'NEWEST',paymentTypeId:'ALL'}; Store.render(); },
    exportHistory() {
      const rows=api.filteredTransactions();
      if(!rows.length) { Store.showToast('Tidak ada transaksi pada filter ini.','warning'); return; }
      const cell=value=>'"'+String(value??'').replace(/^[\s]*[=+@-]/,match=>"'"+match).replace(/"/g,'""')+'"';
      const data=[['No kuitansi','Tanggal','Siswa','Orang tua','Rincian','Total transaksi (Rp)','Petugas','Catatan'],...rows.map(tx=>[tx.receiptNo,tx.date,tx.studentName,tx.parentName,(tx.items||[]).map(i=>`${i.paymentTypeName}: ${i.paidAmount}`).join('; '),tx.totalAmount,tx.officer,tx.generalNotes])];
      const blob=new Blob(['\uFEFF'+data.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
      const url=URL.createObjectURL(blob), link=document.createElement('a'); link.href=url; link.download=`Riwayat_Pembayaran_${today()}.csv`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    },
    updateCorrectionTotal() {
      const total=(Store.modal?.editItems||[]).reduce((n,i)=>n+(Number(i.paidAmount)||0),0);
      const cash=document.getElementById('etf_cashReceived');
      const amount=cash && cash.value!==''?Number(cash.value):total;
      const totalEl=document.getElementById('correction-live-total');
      const changeEl=document.getElementById('correction-live-change');
      if(totalEl) totalEl.textContent=money(total);
      if(changeEl) { changeEl.textContent=(amount<total?'Kurang: ':'Kembalian: ')+money(Math.abs(amount-total)); changeEl.className='text-[11px] mt-1 font-semibold '+(amount<total?'text-rose-600':'text-emerald-700'); }
    },
    mobileNav() {
      return `<nav class="tw-mobile-nav no-print" aria-label="Menu cepat">${[['dashboard','home','Beranda'],['check','search','Cek'],['payment','plus','Catat'],['history','history','Riwayat']].map(([tab,glyph,label])=>`<button ${Store.currentTab===tab?'aria-current="page"':''} onclick="AppActions.navigate('${tab}')">${icon(glyph)}<span>${label}</span></button>`).join('')}<button onclick="AppActions.toggleSidebar(true)">${icon('menu')}<span>Menu</span></button></nav>`;
    }
  };
})();
