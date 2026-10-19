# Keuangan Kelas 1 2026

Aplikasi pencatatan pembayaran siswa untuk guru: data siswa, jenis tagihan, transaksi, kuitansi, rekap dan setoran.

## Backup dan pindah perangkat

- Data disimpan di penyimpanan lokal browser/perangkat. Data **tidak otomatis tersinkron antarperangkat**.
- Buat backup JSON secara berkala dari menu **Pengaturan → Backup & Restore Data**.
- Untuk pindah perangkat, unduh backup dari perangkat lama, buka aplikasi di perangkat baru, lalu pilih file backup tersebut.
- Restore mengganti database yang sedang aktif di perangkat tujuan. Periksa nama file, tanggal, jumlah siswa, jumlah transaksi, dan total transaksi sebelum mengonfirmasi.
- Simpan salinan backup di lokasi aman. File backup dapat memuat nama siswa dan catatan pembayaran, jadi jangan bagikan secara publik.
- Jika data browser terhapus atau perangkat hilang sebelum backup dibuat, data lokal mungkin tidak dapat dipulihkan.

## Validasi

Restore memeriksa struktur data, ID ganda, rujukan siswa, nomor kuitansi ganda, dan kecocokan total transaksi dengan jumlah rincian sebelum mengganti database.
