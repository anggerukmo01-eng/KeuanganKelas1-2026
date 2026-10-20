# Keuangan Kelas 1 2026

Aplikasi pencatatan pembayaran siswa untuk guru: data siswa, jenis tagihan, transaksi, kuitansi, rekap dan setoran.

## Versi aplikasi dan link

- Aplikasi: https://anggerukmo01-eng.github.io/KeuanganKelas1-2026/
- Kode sumber: https://github.com/anggerukmo01-eng/KeuanganKelas1-2026
- Validasi sintaks JavaScript berjalan otomatis melalui GitHub Actions ketika `index.html` berubah.

## Backup lokal

- Data operasional tetap disimpan di penyimpanan lokal browser/perangkat. Data tidak otomatis tersinkron jika backend cloud belum disiapkan.
- Buat backup JSON berkala melalui **Pengaturan → Backup & Restore Data**. Untuk pindah perangkat tanpa cloud, unduh backup pada perangkat lama lalu restore pada perangkat baru.
- Restore mengganti database lokal. Periksa tanggal, jumlah siswa, jumlah transaksi dan total pembayaran sebelum mengonfirmasi.
- File backup dapat berisi data pribadi siswa dan catatan pembayaran. Simpan di lokasi aman dan jangan bagikan secara publik.

## Jejak perubahan dan rekap tunggakan

- Jejak perubahan lokal mencatat pembayaran baru, koreksi/penghapusan transaksi, pengelolaan siswa/tagihan, pengaturan, backup, restore, dan reset.
- Jejak audit dibatasi pada 1.500 entri terbaru dan dapat diekspor ke CSV. Ini bukan audit server dan tidak memverifikasi identitas orang yang menggunakan perangkat.
- Rekap tunggakan memperlihatkan target, pembayaran tercatat, sisa tagihan dan jumlah siswa menunggak per jenis biaya. Target memakai tarif tagihan yang aktif saat ini.
- Tagihan berulang seperti bulanan belum dibuat sebagai kewajiban terpisah untuk setiap bulan.

## Menyiapkan sinkronisasi cloud (Supabase)

Fitur cloud pada aplikasi mendukung autentikasi email/kata sandi, ruang kelas, kode undangan guru, serta sinkronisasi manual berbasis revisi. Perangkat yang bergabung ke ruang yang sama akan menggunakan satu snapshot bersama. Jika revisi cloud berubah sejak sinkronisasi terakhir, pengiriman ditolak agar data terbaru tidak tertimpa.

**Langkah persiapan backend:**

1. Buat proyek Supabase baru dan atur Auth → Providers → Email sesuai kebijakan sekolah. Untuk penggunaan nyata, aktifkan verifikasi email dan gunakan akun per guru.
2. Buka SQL Editor Supabase lalu jalankan seluruh file [`supabase/migrations/202610190001_cloud_sync.sql`](https://github.com/anggerukmo01-eng/KeuanganKelas1-2026/blob/main/supabase/migrations/202610190001_cloud_sync.sql). File membuat tabel, kebijakan Row Level Security (RLS), dan fungsi RPC untuk ruang, undangan, dan snapshot.
3. Di Supabase Project Settings → API, salin Project URL serta **publishable key** (atau anon key lama). Jangan pernah menaruh `service_role` atau secret key pada `index.html`, repo, browser, atau pesan.
4. Buka aplikasi → Pengaturan → Sinkronisasi Cloud Antarperangkat. Masukkan URL dan public key, simpan, lalu daftar/masuk akun.
5. Pada perangkat pertama, tekan **Buat Ruang Baru** dan simpan kode undangan secara pribadi. Perangkat lain masuk ke akun masing-masing lalu bergabung menggunakan kode tersebut.
6. Perangkat yang baru bergabung harus menekan **Ambil dari Cloud** dan memeriksa ringkasan sebelum mengirim data. Untuk inisialisasi pertama, hanya kirim data lokal jika memang itulah database yang akan dijadikan sumber bersama.
7. Setelah melakukan perubahan, gunakan Ambil dari Cloud atau Kirim Data Lokal ke Cloud secara manual. Bila muncul konflik revisi, ambil ulang snapshot cloud lalu tinjau data lokal sebelum mengirim kembali.

**Penting:** file SQL di repo baru menjadi backend setelah dijalankan di proyek Supabase milik Anda. Saya tidak dapat membuat proyek Supabase atau menerapkan SQL ke akun Anda dari repo GitHub. Sampai langkah tersebut selesai, tombol cloud belum bisa melakukan sinkronisasi sungguhan. Simpan backup lokal terpisah sebelum pengujian pertama.

## Batasan sinkronisasi saat ini

- Sinkronisasi berjalan manual, bukan realtime/background.
- Snapshot cloud adalah salinan keseluruhan database aplikasi, bukan penggabungan transaksi per baris. Gunakan satu sumber data utama dan selesaikan konflik sebelum mengirim ulang.
- Konflik revisi dicegah pada server dengan penguncian per ruang kelas. Namun alur aplikasi belum menyediakan perbandingan visual perubahan antarperangkat; jika terjadi konflik, ambil cloud dan periksa data sebelum mengirim lagi.
- Audit lokal ikut dalam snapshot, tetapi bukan catatan audit server yang tahan manipulasi.
- Tagihan rutin seperti bulanan belum dimodelkan sebagai kewajiban unik setiap bulan. Sinkronisasi tidak memperbaiki keterbatasan model tagihan itu.

## Validasi

Restore lokal memeriksa struktur data, ID ganda, data historis siswa, nomor kuitansi ganda, kecocokan total dan rincian item, serta struktur jejak audit. Endpoint simpan cloud memvalidasi ulang ukuran dan struktur snapshot di sisi server.
## Ruang kerja guru — pembaruan 2.2

- **Beranda** menampilkan penerimaan hari ini, siswa yang belum lunas, sisa tagihan, pencarian cepat, dan pembayaran terakhir.
- **Cek Pembayaran** mencari siswa berdasarkan nama, NIS, ayah/ibu/wali; memfilter jenis biaya dan status; mengurutkan sisa terbesar; serta membuka pencatatan, rincian, atau riwayat siswa. Filter jenis biaya ikut diterapkan ketika membuka kasir.
- **Riwayat** menyediakan tanggal awal–akhir, siswa, jenis biaya, kata kunci, tombol hari ini/bulan ini, dan ekspor CSV sesuai hasil filter. Nominal ekspor adalah **total utuh kuitansi**, termasuk bila kuitansi berisi beberapa jenis biaya.
- Navigasi bawah tersedia pada HP/tablet. Riwayat menjadi kartu pada layar kecil. Mode terang/gelap tetap tersedia.
- CSS sekarang disertakan di `assets/app.css`, sehingga tata letak tidak memerlukan Tailwind CDN. Ekspor XLSX, ekspor gambar, font Google, dan klien cloud masih memakai layanan eksternal; ini belum merupakan aplikasi offline penuh.

### Ketepatan pencatatan

Sisa dihitung per biaya sebelum dijumlahkan. Kelebihan bayar satu biaya tidak melunasi biaya lain. Tanggal pembayaran terakhir memakai tanggal paling baru, bukan urutan penyimpanan. Nomor kuitansi memakai urutan tertinggi yang tersimpan dan penanda urutan di pengaturan untuk mencegah pemakaian ulang setelah penghapusan biasa. Reset database atau restore cadangan lama dapat mengembalikan penanda ini.

Siswa yang belum memiliki isian ayah tetap dipertahankan saat aplikasi dibuka. Formulir koreksi tidak menggambar ulang seluruh halaman ketika nominal diketik, wajib memiliki alasan koreksi, serta memvalidasi nominal dan uang diterima. Pencatatan, koreksi, dan penghapusan transaksi memulihkan keadaan sebelumnya bila penyimpanan gagal. Pembayaran melalui guru kelas dan guru lain dihitung per rincian transaksi untuk rekap bendahara.

Status lunas/cicilan ditentukan dari nominal. Pencatatan pembebasan tagihan dan kewajiban per bulan belum tersedia sebagai model tersendiri. Jangan memakai nominal pembayaran untuk mencatat pembebasan.

### Pengembangan dan pengujian

```sh
npm ci
npm test
npm run build:css
python -m http.server 8000
```

Buka `http://localhost:8000`. Jalankan ulang `npm run build:css` setelah mengubah kelas Tailwind di HTML/JavaScript, lalu sertakan `assets/app.css` dalam commit. GitHub Pages menyajikan berkas statis yang sudah tersedia; tidak memerlukan build Node saat dibuka pengguna.

Pengujian regresi mencakup saldo per biaya, tipe angka dari backup, pencarian, kombinasi filter, urutan kuitansi, cicilan, validasi tanggal/nominal, rollback saat penyimpanan gagal, koreksi, dan pemisahan penerima. Hasil pemeriksaan dan batasannya ada di [catatan validasi](docs/VALIDATION.md).


### Foto Rapor Siswa Kelas 1

Tagihan **Foto Rapor Siswa Kelas 1** sebesar **Rp30.000** berlaku untuk putra dan putri, satu kali pembayaran. Tersedia di Jenis Pembayaran, Cek Pembayaran, kasir, rincian siswa, kuitansi, dan rekap.

Saat membuka data lama atau memulihkan backup/snapshot lama, aplikasi menambahkan tagihan ini satu kali jika belum ada. ID, nominal, dan transaksi yang sudah tersimpan tetap dipertahankan. Jenis dengan ID atau nama yang sama tidak digandakan; perubahan tarif, penonaktifan, atau penghapusan yang dilakukan setelah migrasi tetap dihormati. Penanda migrasi ikut disimpan bersama data/pengaturan saat penyimpanan berikutnya.
