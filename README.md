# Keuangan Kelas 1 2026

Aplikasi pencatatan pembayaran siswa untuk guru: data siswa, jenis tagihan, transaksi, kuitansi, rekap dan setoran.

## Backup dan pindah perangkat

- Data disimpan di penyimpanan lokal browser/perangkat. Data **tidak otomatis tersinkron antarperangkat**.
- Buat backup JSON secara berkala dari menu **Pengaturan → Backup & Restore Data**.
- Untuk pindah perangkat, unduh backup dari perangkat lama, buka aplikasi di perangkat baru, lalu pilih file backup tersebut.
- Restore mengganti database aktif pada perangkat tujuan. Periksa tanggal backup, jumlah siswa, transaksi, dan total pembayaran sebelum mengonfirmasi.
- File backup dapat berisi data pribadi siswa dan catatan pembayaran. Simpan di lokasi aman dan jangan bagikan secara publik.
- Backup lama tanpa bagian audit tetap dapat dipulihkan. Jejak audit lokal perangkat tujuan yang ada digabung dengan riwayat audit yang diimpor.

## Jejak perubahan dan rekap tunggakan

- Jejak perubahan lokal mencatat pembayaran baru, koreksi/penghapusan transaksi, pengelolaan siswa/tagihan, pengaturan, backup, restore, dan reset.
- Jejak audit dibatasi pada 1.500 entri terbaru dan dapat diekspor ke CSV. Ini bukan audit server dan tidak memverifikasi identitas orang yang menggunakan perangkat.
- Rekap tunggakan memperlihatkan target, pembayaran tercatat, dan sisa tagihan per jenis biaya dengan label periode pada setiap jenis tagihan.
- Tagihan berulang seperti bulanan belum dijadikan kewajiban terpisah untuk setiap bulan. Tarif yang aktif sekarang juga menjadi dasar target saat ini.

## Sinkronisasi cloud

Sinkronisasi otomatis belum diaktifkan. Fitur itu memerlukan backend terautentikasi, pembatasan akses per sekolah/kelas, revisi data, dan penanganan konflik saat dua perangkat mengubah data bersamaan. Jangan menyimpan secret backend di `index.html` publik atau menggunakan GitHub Pages sebagai database transaksi.

## Validasi

Restore memeriksa struktur data, ID ganda, referensi siswa atau nama historisnya, nomor kuitansi ganda, kecocokan total dengan rincian item, serta struktur jejak audit.