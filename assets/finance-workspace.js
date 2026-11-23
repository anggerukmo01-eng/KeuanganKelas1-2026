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
    /* Sortir per jenis pembayaran (23 Nov 2026): filter + urutan disimpan
       per kategori (utama / lain-lain) agar tidak tercampur saat pindah. */
    typeMain:'', typeOther:'', sortMain:'default', sortOther:'default',
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
    /* ---- Sortir per jenis pembayaran (23 Nov 2026) ----
       SATU SUMBER KEBENARAN: semua ringkasan per jenis dihitung dari
       buckets() yang sama dengan tabel rincian, jadi angkanya tidak
       mungkin berbeda dengan yang tampil di tabel. Filter memakai
       typeId (bukan nama) karena id dijamin unik oleh validasi impor,
       sedangkan nama hanya label. Baris yang sudah dibatalkan (voided)
       sudah dikeluarkan oleh buckets(), jadi tidak ikut terhitung. */
    typeList(rows) {
      const map = new Map();
      for (const r of rows) if (!map.has(r.typeId)) map.set(r.typeId, r.typeName);
      return [...map.entries()].map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'id'));
    },
    sumRows(rows) {
      return rows.reduce((s, r) => { for (const k of ['teacher','direct','transferred','balance','treasurer','total']) s[k] += r[k] || 0; return s; }, { teacher:0, direct:0, transferred:0, balance:0, treasurer:0, total:0 });
    },
    typeTotals(rows) {
      const map = new Map();
      for (const r of rows) {
        if (!map.has(r.typeId)) map.set(r.typeId, { typeId: r.typeId, typeName: r.typeName, count: 0, teacher: 0, direct: 0, transferred: 0, balance: 0, treasurer: 0, total: 0 });
        const t = map.get(r.typeId); t.count++;
        for (const k of ['teacher','direct','transferred','balance','treasurer','total']) t[k] += r[k] || 0;
      }
      return [...map.values()].sort((a, b) => a.typeName.localeCompare(b.typeName, 'id'));
    },
    sortRows(rows, mode) {
      const byName = (a, b) => a.studentName.localeCompare(b.studentName, 'id') || a.typeName.localeCompare(b.typeName, 'id');
      const byType = (a, b) => a.typeName.localeCompare(b.typeName, 'id') || a.studentName.localeCompare(b.studentName, 'id');
      const out = [...rows];
      if (mode === 'type') out.sort(byType);
      else if (mode === 'student') out.sort(byName);
      else if (mode === 'total') out.sort((a, b) => (b.treasurer || 0) - (a.treasurer || 0) || byName(a, b));
      else if (mode === 'balance') out.sort((a, b) => (b.balance || 0) - (a.balance || 0) || byName(a, b));
      else if (mode === 'remaining') out.sort((a, b) => (b.remaining || 0) - (a.remaining || 0) || byName(a, b));
      else if (mode === 'paid') out.sort((a, b) => (b.paid || 0) - (a.paid || 0) || byName(a, b));
      return out;
    },
    /* Baris yang terlihat: filter jenis (AND) pencarian teks. Bila jenis
       yang dipilih sudah tidak ada datanya (mis. semua catatannya
       dibatalkan), filter direset ke "Semua" agar tampilan tidak kosong. */
    visibleMain(rows) {
      const list = api.typeList(rows);
      if (api.typeMain && !list.some(t => t.id === api.typeMain)) api.typeMain = '';
      return api.sortRows(rows.filter(r => (!api.typeMain || r.typeId === api.typeMain) && TeacherWorkspace.matchesStudent({ name: r.studentName, parentName: r.typeName }, api.search)), api.sortMain);
    },
    visibleOther(rows) {
      const list = api.typeList(rows);
      if (api.typeOther && !list.some(t => t.id === api.typeOther)) api.typeOther = '';
      return api.sortRows(rows.filter(r => (!api.typeOther || r.typeId === api.typeOther) && TeacherWorkspace.matchesStudent({ name: r.studentName, parentName: r.typeName }, api.search)), api.sortOther);
    },
    typeSelectHTML(rows, field) {
      const list = api.typeList(rows), current = api[field];
      return `<select onchange="Finance.${field}=this.value;Store.render()" aria-label="Jenis pembayaran"><option value="">Semua jenis pembayaran</option>${list.map(t => `<option value="${esc(t.id)}"${current === t.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`;
    },
    sortSelectHTML(field, options) {
      const current = api[field];
      return `<select onchange="Finance.${field}=this.value;Store.render()" aria-label="Urutan data">${options.map(([v, label]) => `<option value="${v}"${current === v ? ' selected' : ''}>${label}</option>`).join('')}</select>`;
    },
    typeSummaryInner(rows) {
      const vis = api.visibleMain(rows), s = api.sumRows(vis);
      if (!api.typeMain) return `Menampilkan <b>semua jenis pembayaran</b> — ${vis.length} baris. Pilih satu jenis di atas untuk melihat total jenis itu saja.`;
      const name = (api.typeList(rows).find(t => t.id === api.typeMain) || {}).name || '';
      return `Jenis: <b>${esc(name)}</b> — ${vis.length} siswa · Diterima guru <b>${money(s.teacher)}</b> · Langsung bendahara <b>${money(s.direct)}</b> · Disetor guru <b>${money(s.transferred)}</b> · Saldo guru <b>${money(s.balance)}</b> · Total bendahara <b>${money(s.treasurer)}</b>`;
    },
    typeTableHTML(rows) {
      const totals = api.typeTotals(rows);
      if (!totals.length) return `<p class="tw-context">Belum ada catatan pembayaran.</p>`;
      return api.tableHTML(['Jenis pembayaran', 'Siswa', 'Ke guru', 'Langsung bendahara', 'Disetor guru', 'Saldo guru', 'Total bendahara', ''], totals.map(t => [esc(t.typeName), String(t.count), money(t.teacher), money(t.direct), money(t.transferred), money(t.balance), money(t.treasurer), `<button class="tw-link no-print" onclick="Finance.typeMain=${arg(t.typeId)};Store.render()">Lihat</button>`]));
    },
    otherTypeTableHTML(rows) {
      const map = new Map();
      for (const r of rows) {
        if (!map.has(r.typeId)) map.set(r.typeId, { typeId: r.typeId, typeName: r.typeName, count: 0, target: 0, paid: 0, remaining: 0 });
        const t = map.get(r.typeId); t.count++; t.target += r.target; t.paid += r.paid; t.remaining += r.remaining;
      }
      const totals = [...map.values()].sort((a, b) => a.typeName.localeCompare(b.typeName, 'id'));
      if (!totals.length) return `<p class="tw-context">Belum ada tagihan lain-lain.</p>`;
      return api.tableHTML(['Jenis pembayaran', 'Siswa', 'Tagihan', 'Dibayar', 'Sisa', ''], totals.map(t => [esc(t.typeName), String(t.count), money(t.target), money(t.paid), money(t.remaining), `<button class="tw-link no-print" onclick="Finance.typeOther=${arg(t.typeId)};Store.render()">Lihat</button>`]));
    },
    otherTypeSummaryInner(rows) {
      const vis = api.visibleOther(rows);
      const target = vis.reduce((s, r) => s + r.target, 0), paid = vis.reduce((s, r) => s + r.paid, 0), rem = vis.reduce((s, r) => s + r.remaining, 0);
      if (!api.typeOther) return `Menampilkan <b>semua jenis pembayaran</b> — ${vis.length} baris. Pilih satu jenis di atas untuk melihat total jenis itu saja.`;
      const name = (api.typeList(rows).find(t => t.id === api.typeOther) || {}).name || '';
      return `Jenis: <b>${esc(name)}</b> — ${vis.length} siswa · Tagihan <b>${money(target)}</b> · Sudah dibayar <b>${money(paid)}</b> · Sisa <b>${money(rem)}</b>`;
    },
    /* ---- Setor massal per jenis pembayaran (23 Nov 2026) ----
       Satu jumlah untuk satu jenis dibagi otomatis ke tiap siswa yang
       masih punya saldo jenis itu, urut nama A–Z, masing-masing sampai
       lunas; siswa terakhir menerima sisa bila jumlah tidak bulat.
       TIDAK ADA model baru: hasilnya tetap transfer per siswa seperti
       form per siswa, jadi buckets(), validasi, CSV, dan XLSX tidak
       berubah. Satu commit menulis semua transfer sekaligus — bila
       satu alokasi tidak valid, semuanya batal. */
    bulkPlan(category, typeId, n, date) {
      const rows = api.buckets(category).filter(r => r.typeId === typeId && r.balance > 0)
        .sort((a, b) => a.studentName.localeCompare(b.studentName, 'id') || a.studentId.localeCompare(b.studentId));
      const totalBalance = rows.reduce((s, r) => s + r.balance, 0);
      const typeName = rows[0]?.typeName || (api.typeList(api.buckets(category)).find(t => t.id === typeId) || {}).name || '';
      if (!amount(n)) return { ok: false, error: 'Isi jumlah setoran yang valid.', allocations: [], total: 0, totalBalance, typeName };
      if (n > totalBalance) return { ok: false, error: `Jumlah melebihi saldo jenis ini (${money(totalBalance)}).`, allocations: [], total: 0, totalBalance, typeName };
      let rest = n; const allocations = [];
      for (const r of rows) {
        if (rest <= 0) break;
        const take = Math.min(r.balance, rest);
        allocations.push({ studentId: r.studentId, studentName: r.studentName, typeId: r.typeId, typeName: r.typeName, amount: take, full: take === r.balance, remaining: r.balance - take });
        rest -= take;
      }
      // Aturan yang sama dengan setoran per siswa: uang tidak boleh
      // disetor sebelum diterima. Cek per alokasi terhadap saldo
      // per tanggal setoran (transaksi, pembayaran, DAN setoran lama
      // difilter tanggalnya — persis seperti validasi di commit()).
      if (date && TeacherWorkspace.validDate(date) && date <= today()) {
        const prior = api.buckets(category, Store.transactions.filter(t => t.date <= date), { ...api.ledger(), payments: api.ledger().payments.filter(p => p.date <= date), transfers: api.ledger().transfers.filter(t => t.date <= date) });
        for (const a of allocations) {
          const p = prior.find(r => key(r.studentId, r.typeId) === key(a.studentId, a.typeId));
          if (!p || a.amount > p.balance) return { ok: false, error: `Penerimaan ${a.studentName} sampai ${date} belum cukup untuk setor ${money(a.amount)} (saldo saat itu ${money(p ? p.balance : 0)}).`, allocations, total: n, totalBalance, typeName };
        }
      }
      return { ok: true, error: '', allocations, total: n, totalBalance, typeName };
    },
    bulkPreviewHTML(category, typeId, n, date) {
      if (!typeId) return 'Pilih jenis pembayaran dan isi jumlah total setoran.';
      const rows = api.buckets(category).filter(r => r.typeId === typeId);
      const typeName = rows[0]?.typeName || '';
      const totalBalance = rows.reduce((s, r) => s + Math.max(0, r.balance), 0);
      if (date && (!TeacherWorkspace.validDate(date) || date > today())) return `Jenis: <b>${esc(typeName)}</b> — saldo guru jenis ini <b>${money(totalBalance)}</b>.<br><span class="fw-warn">Tanggal setoran belum valid atau di masa depan.</span>`;
      if (!amount(n)) return `Jenis: <b>${esc(typeName)}</b> — saldo guru jenis ini <b>${money(totalBalance)}</b>. Isi jumlah total setoran (Rp).`;
      if (n > totalBalance) return `Jenis: <b>${esc(typeName)}</b> — saldo guru jenis ini <b>${money(totalBalance)}</b>.<br><span class="fw-warn">Jumlah melebihi saldo. Kurangi nominal setoran.</span>`;
      const plan = api.bulkPlan(category, typeId, n, date);
      const lines = plan.allocations.map(a => `${esc(a.studentName)} — <b>${money(a.amount)}</b>${a.full ? ' (lunas)' : ` (sebagian, sisa ${money(a.remaining)})`}`).join('<br>');
      const warn = plan.ok ? '' : `<br><span class="fw-warn">${esc(plan.error)}</span>`;
      return `Jenis: <b>${esc(typeName)}</b> — setor <b>${money(n)}</b> dari saldo <b>${money(totalBalance)}</b>, dibagi ke ${plan.allocations.length} siswa (urut nama A–Z):<br>${lines}${warn}`;
    },
    updateBulkPreview(form) {
      const el = document.getElementById('bulk-preview'); if (!el) return;
      const f = form.elements;
      el.innerHTML = api.bulkPreviewHTML(api.category, f.type.value, Number(f.amount.value), f.date.value);
    },
    addBulkTransfer(form) {
      const f = form.elements;
      const typeId = f.type.value, n = Number(f.amount.value), date = f.date.value;
      const recipient = f.recipient.value.trim(), note = f.note.value.trim();
      if (!typeId) return Store.showToast('Pilih jenis pembayaran yang akan disetor.', 'error');
      if (!recipient || !note) return Store.showToast('Isi nama bendahara penerima dan nomor bukti / catatan.', 'error');
      if (!TeacherWorkspace.validDate(date) || date > today()) return Store.showToast('Periksa tanggal setoran (tidak boleh di masa depan).', 'error');
      const plan = api.bulkPlan(api.category, typeId, n, date);
      if (!plan.ok) return Store.showToast(plan.error, 'error');
      const batchId = uid();
      const stamp = ` — setor per jenis, ${plan.allocations.length} siswa`;
      api.commit('SETOR KE BENDAHARA (PER JENIS)', l => {
        for (const a of plan.allocations) l.transfers.push({ id: uid(), batchId, category: api.category, studentId: a.studentId, studentName: a.studentName, typeId: a.typeId, typeName: a.typeName, amount: a.amount, date, recipient, note: note + stamp, createdAt: new Date().toISOString() });
      });
    },
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
      /* Jenis untuk setor massal: hanya yang masih punya saldo, dengan
         hitungan SISWA BERSALDO (bukan semua siswa yang pernah bayar
         jenis itu) agar labelnya tidak menyesatkan. */
      const bulkMap=new Map();
      for (const r of rows) if (r.balance>0) { if(!bulkMap.has(r.typeId)) bulkMap.set(r.typeId,{typeId:r.typeId,typeName:r.typeName,balance:0,count:0}); const t=bulkMap.get(r.typeId); t.balance+=r.balance; t.count++; }
      const bulkTypes=[...bulkMap.values()].sort((a,b)=>a.typeName.localeCompare(b.typeName,'id'));
      return `<div class="tw-workspace fw-workspace">${api.header('Setoran yang jelas. Saldo yang terpantau.','Penerimaan siswa dan penyerahan guru dicatat terpisah agar uang tidak dihitung dua kali.')}
      <div class="tw-chips no-print">${[['main','Pembayaran utama'],['other','Pembayaran lain-lain']].map(([id,label])=>`<button class="tw-chip ${cat===id?'is-active':''}" onclick="Finance.category='${id}';Store.render()">${label}</button>`).join('')}</div>
      <h2 class="fw-title">Rekap ${cat==='main'?'pembayaran utama':'lain-lain'} • seluruh periode</h2>${api.cards(cat)}
      <p class="tw-context">Total dibayar siswa: <b>${money(api.totals(cat).total)}</b>. Angka mencakup catatan siswa dan jenis biaya nonaktif. ${cat==='main'?'Catatan lama berstatus “Dibayar ke Guru Lain” tetap dikelompokkan sebagai pembayaran langsung ke bendahara; periksa penerimanya pada riwayat.':''}</p>
      <section class="tw-panel no-print"><h2 class="fw-title">Catat penyerahan ke bendahara</h2><p>Pilih asal uang agar setoran dapat ditelusuri sampai siswa dan jenis pembayaran.</p>
      <form class="fw-form" onsubmit="event.preventDefault();Finance.addTransfer(this)">
      <label>Asal uang<select name="bucket" required><option value="">Pilih siswa / pembayaran</option>${available.map(r=>`<option value="${esc(key(r.studentId,r.typeId))}">${esc(r.studentName)} · ${esc(r.typeName)} · saldo ${money(r.balance)}</option>`).join('')}</select></label>
      <label>Tanggal setoran<input name="date" type="date" value="${today()}" max="${today()}" required></label><label>Nominal (Rp)<input name="amount" type="number" min="1" step="1" required></label><label>Nama bendahara penerima<input name="recipient" maxlength="120" value="${esc(Store.settings.bookTreasurerName||'')}" required></label><label>Nomor bukti / catatan<input name="note" maxlength="300" required placeholder="Contoh: Bukti setor 001"></label><button class="tw-button tw-primary" ${available.length?'':'disabled'}>Simpan setoran</button></form></section>
      <section class="tw-panel no-print"><h2 class="fw-title">Setor sekaligus per jenis pembayaran</h2><p>Isi satu jumlah untuk satu jenis — aplikasi membaginya otomatis ke tiap siswa yang masih punya saldo jenis itu, urut nama A–Z. Tidak perlu klik per siswa.</p>
      <form class="fw-form" onsubmit="event.preventDefault();Finance.addBulkTransfer(this)">
      <label>Jenis pembayaran<select name="type" required onchange="Finance.updateBulkPreview(this.form)"><option value="">Pilih jenis pembayaran</option>${bulkTypes.map(t=>`<option value="${esc(t.typeId)}">${esc(t.typeName)} · saldo ${money(t.balance)} · ${t.count} siswa</option>`).join('')}</select></label>
      <label>Tanggal setoran<input name="date" type="date" value="${today()}" max="${today()}" required onchange="Finance.updateBulkPreview(this.form)"></label><label>Jumlah total (Rp)<input name="amount" type="number" min="1" step="1" required oninput="Finance.updateBulkPreview(this.form)"></label><label>Nama bendahara penerima<input name="recipient" maxlength="120" value="${esc(Store.settings.bookTreasurerName||'')}" required></label><label>Nomor bukti / catatan<input name="note" maxlength="300" required placeholder="Contoh: Bukti setor 002"></label><button class="tw-button tw-primary" ${bulkTypes.length?'':'disabled'}>Simpan setoran per jenis</button></form>
      <div class="fw-notice" id="bulk-preview">Pilih jenis dan isi jumlah untuk melihat pembagiannya.</div></section>
      <section class="tw-panel"><div class="tw-section-title"><h2>Rincian per siswa dan pembayaran</h2><div class="no-print"><button class="tw-button" onclick="Finance.exportRekap()">Unduh CSV</button> <button class="tw-button" onclick="window.print()">Cetak rekap</button></div></div>
      <h3 class="fw-title">Total per jenis pembayaran</h3><p class="tw-context">Dihitung dari data yang sama dengan tabel rincian di bawah — tekan “Lihat” untuk menyaring rincian ke jenis itu saja.</p>${api.typeTableHTML(rows)}
      <div class="fw-filters no-print"><label>Jenis pembayaran${api.typeSelectHTML(rows, 'typeMain')}</label><label>Urutkan${api.sortSelectHTML('sortMain', [['default', 'Urutan data'], ['type', 'Jenis pembayaran (A–Z)'], ['student', 'Nama siswa (A–Z)'], ['total', 'Total bendahara terbesar'], ['balance', 'Saldo guru terbesar']])}</label></div>
      <div class="fw-notice" id="finance-type-summary">${api.typeSummaryInner(rows)}</div>
      <label class="no-print">Cari nama siswa / jenis pembayaran<input class="fw-search" type="search" value="${esc(api.search)}" oninput="Finance.search=this.value;Finance.updateRows()"></label><div id="finance-rows">${api.table(rows)}</div></section>
      <section class="tw-panel"><h2 class="fw-title">Bukti penyerahan ke bendahara</h2>${api.transferTable(l.transfers.filter(t=>t.category===cat))}</section></div>`;
    },
    table(rows) {
      rows = api.visibleMain(rows);
      return api.tableHTML(['Siswa', 'Jenis pembayaran', 'Ke guru', 'Langsung bendahara', 'Disetor guru', 'Saldo guru', 'Total bendahara'], rows.map(r => [esc(r.studentName), esc(r.typeName), money(r.teacher), money(r.direct), money(r.transferred), money(r.balance), money(r.treasurer)]));
    },
    tableHTML(headers, rows) { return `<div class="fw-table-wrap"><table class="fw-table"><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(v => `<td>${v}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${headers.length}">Belum ada catatan.</td></tr>`}</tbody></table></div>`; },
    updateRows() { const rows = api.buckets(api.category); const el = document.getElementById('finance-rows'); if (el) el.innerHTML = api.table(rows); const s = document.getElementById('finance-type-summary'); if (s) s.innerHTML = api.typeSummaryInner(rows); },
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
      <section class="tw-panel"><div class="tw-section-title"><h2>Rekap tagihan lain-lain</h2><div class="no-print"><button class="tw-button" onclick="Finance.exportOther()">Unduh CSV</button> <button class="tw-button" onclick="window.print()">Cetak</button> <button class="tw-link" onclick="Finance.category='other';AppActions.navigate('deposit')">Setor ke bendahara →</button></div></div><p>Total tagihan ${money(rows.reduce((s, r) => s + r.target, 0))} · Sudah dibayar ${money(rows.reduce((s, r) => s + r.paid, 0))} · Sisa ${money(rows.reduce((s, r) => s + r.remaining, 0))}</p>
      <h3 class="fw-title">Total per jenis pembayaran</h3><p class="tw-context">Dihitung dari data yang sama dengan tabel rekap di bawah — tekan “Lihat” untuk menyaring rekap ke jenis itu saja.</p>${api.otherTypeTableHTML(rows)}
      <div class="fw-filters no-print"><label>Jenis pembayaran${api.typeSelectHTML(rows, 'typeOther')}</label><label>Urutkan${api.sortSelectHTML('sortOther', [['default', 'Urutan data'], ['type', 'Jenis pembayaran (A–Z)'], ['student', 'Nama siswa (A–Z)'], ['remaining', 'Sisa tagihan terbesar'], ['paid', 'Sudah dibayar terbesar']])}</label></div>
      <div class="fw-notice" id="other-type-summary">${api.otherTypeSummaryInner(rows)}</div>
      <label class="no-print">Cari siswa / pembayaran<input class="fw-search" type="search" value="${esc(api.search)}" oninput="Finance.search=this.value;Finance.updateOtherRows()"></label><div id="other-rows">${api.otherTable()}</div></section>
      <section class="tw-panel"><h2 class="fw-title">Riwayat pembayaran lain-lain</h2>${api.tableHTML(['Tanggal / bukti','Siswa / jenis','Penerima','Nominal','Status'],[...l.payments].reverse().map(p=>[`${esc(p.date)}<small>LL-${esc(p.id)} · ${esc(p.note)}</small>`,`${esc(p.studentName)}<small>${esc(p.typeName)}</small>`,`${esc(p.recipient)}<small>${p.destination==='teacher'?'Guru':'Bendahara'}</small>`,money(p.amount),p.voided?`Batal: ${esc(p.voidReason)}`:`<button class="tw-link no-print" onclick="Finance.voidRecord('payments',${arg(p.id)})">Batalkan</button>`]))}</section></div>`;},
    otherTable() { return api.tableHTML(['Siswa', 'Pembayaran', 'Tagihan', 'Dibayar', 'Sisa', 'Status'], api.visibleOther(api.otherRows()).map(r => [esc(r.studentName), esc(r.typeName), money(r.target), money(r.paid), money(r.remaining), r.remaining === 0 ? 'Lunas' : r.paid ? 'Cicilan' : 'Belum bayar'])); },
    updateOtherRows() { const rows = api.otherRows(); const el = document.getElementById('other-rows'); if (el) el.innerHTML = api.otherTable(); const s = document.getElementById('other-type-summary'); if (s) s.innerHTML = api.otherTypeSummaryInner(rows); },
    addType(form){const f=form.elements,price=Number(f.price.value),name=f.name.value.trim();const ids=Store.students.filter(s=>s.active&&(f.student.value==='ALL'||s.id===f.student.value)).map(s=>s.id);if(!amount(price)||!name||!ids.length)return Store.showToast('Isi nama, tarif, dan siswa aktif.','error');if(api.ledger().types.some(t=>t.name.toLocaleLowerCase()===name.toLocaleLowerCase()))return Store.showToast('Nama sudah digunakan. Bedakan nama atau periode kegiatan.','error');api.commit('TAMBAH TAGIHAN LAIN-LAIN',l=>l.types.push({id:uid(),name,price,studentIds:ids}));},
    addOtherPayment(form){const f=form.elements,row=api.otherRows().find(r=>key(r.studentId,r.typeId)===f.bill.value),n=Number(f.amount.value);if(!row||!amount(n)||n>row.remaining||!TeacherWorkspace.validDate(f.date.value)||f.date.value>today()||!f.recipient.value.trim())return Store.showToast('Periksa tagihan, nominal, tanggal, dan nama penerima.','error');api.commit('PEMBAYARAN LAIN-LAIN',l=>l.payments.push({id:uid(),studentId:row.studentId,studentName:row.studentName,typeId:row.typeId,typeName:row.typeName,amount:n,date:f.date.value,destination:f.destination.value,recipient:f.recipient.value.trim(),note:f.note.value.trim(),createdAt:new Date().toISOString()}));},
    csv(name,rows){const cell=v=>'"'+String(v??'').replace(/^\s*[=+@-]/,m=>"'"+m).replace(/"/g,'""')+'"';const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name+'_'+today()+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},
    exportRekap() { const rows = api.visibleMain(api.buckets(api.category)); const typeName = api.typeMain ? (api.typeList(api.buckets(api.category)).find(t => t.id === api.typeMain) || {}).name || '' : 'Semua'; api.csv('Setoran_' + api.category, [['Rekap setoran', api.category === 'main' ? 'Utama' : 'Lain-lain', 'Seluruh periode', 'Jenis: ' + typeName, 'Cari: ' + api.search], ['Siswa', 'Jenis', 'Diterima guru', 'Langsung bendahara', 'Disetor guru', 'Saldo guru', 'Total bendahara'], ...rows.map(r => [r.studentName, r.typeName, r.teacher, r.direct, r.transferred, r.balance, r.treasurer]), [], ['BUKTI SETORAN (seluruh catatan kategori)'], ['ID', 'Tanggal', 'Siswa', 'Jenis', 'Nominal', 'Penerima', 'Bukti', 'Status', 'Alasan batal'], ...api.ledger().transfers.filter(t => t.category === api.category).map(t => [t.id, t.date, t.studentName, t.typeName, t.amount, t.recipient, t.note, t.voided ? 'Batal' : 'Aktif', t.voidReason || ''])]); },
    exportOther() { const rows = api.visibleOther(api.otherRows()); const typeName = api.typeOther ? (api.typeList(api.otherRows()).find(t => t.id === api.typeOther) || {}).name || '' : ''; api.csv('Pembayaran_lain_lain', [['REKAP LAIN-LAIN' + (typeName ? ' — Jenis: ' + typeName : ' (seluruh siswa)')], ['Siswa', 'Jenis', 'Tagihan', 'Dibayar', 'Sisa'], ...rows.map(r => [r.studentName, r.typeName, r.target, r.paid, r.remaining]), [], ['RIWAYAT'], ['ID', 'Tanggal', 'Siswa', 'Jenis', 'Nominal', 'Tujuan', 'Penerima', 'Catatan', 'Status', 'Alasan batal'], ...api.ledger().payments.map(p => [p.id, p.date, p.studentName, p.typeName, p.amount, p.destination, p.recipient, p.note, p.voided ? 'Batal' : 'Aktif', p.voidReason || ''])]); }
  };
})();
