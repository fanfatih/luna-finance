//! Bagian yang khusus Windows: daftar autostart, identitas aplikasi untuk notifikasi, dan membuka alamat web.
//! Semua ditulis ke HKEY_CURRENT_USER, jadi tidak butuh hak admin.

#[cfg(windows)]
mod imp {
    use windows_registry::{Type, CURRENT_USER};

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    const NAME: &str = "Luna Finance";
    /// Penanda "diaktifkan" milik Windows (Pengaturan, Aplikasi, Startup).
    const APPROVED_ON: [u8; 12] = [0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    fn err(what: &str, e: impl std::fmt::Display) -> String {
        format!("{what}: {e}")
    }

    pub fn is_enabled() -> Result<bool, String> {
        let Ok(run) = CURRENT_USER.open(RUN) else { return Ok(false) };
        if run.get_string(NAME).is_err() {
            return Ok(false);
        }
        // Windows bisa mematikannya sendiri lewat Pengaturan, Aplikasi, Startup.
        if let Ok(approved) = CURRENT_USER.open(APPROVED) {
            if let Ok(v) = approved.get_value(NAME) {
                let bytes: &[u8] = &v;
                if bytes.len() >= 8 && bytes[bytes.len() - 8..].iter().any(|b| *b != 0) {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }

    pub fn set(on: bool) -> Result<(), String> {
        if on {
            let exe = std::env::current_exe().map_err(|e| err("Lokasi aplikasi tidak ditemukan", e))?;
            let command = format!("\"{}\"", exe.display());
            CURRENT_USER
                .create(RUN)
                .map_err(|e| err("Gagal membuka daftar startup Windows", e))?
                .set_string(NAME, &command)
                .map_err(|e| err("Gagal menulis daftar startup Windows", e))?;
            // Kalau sebelumnya dimatikan lewat Pengaturan Windows, nyalakan lagi. Boleh gagal.
            if let Ok(approved) = CURRENT_USER.options().write().open(APPROVED) {
                let _ = approved.set_bytes(NAME, Type::Bytes, &APPROVED_ON);
            }
            Ok(())
        } else {
            if let Ok(run) = CURRENT_USER.options().write().open(RUN) {
                if run.get_string(NAME).is_ok() {
                    run.remove_value(NAME)
                        .map_err(|e| err("Gagal menghapus dari daftar startup Windows", e))?;
                }
            }
            if let Ok(approved) = CURRENT_USER.options().write().open(APPROVED) {
                let _ = approved.remove_value(NAME);
            }
            Ok(())
        }
    }

    /// Daftarkan identitas aplikasi supaya Windows mau menampilkan notifikasinya dengan nama yang benar.
    pub fn register_notification_identity(app_id: &str) {
        if let Ok(key) = CURRENT_USER.create(format!(r"Software\Classes\AppUserModelId\{app_id}")) {
            let _ = key.set_string("DisplayName", "Luna Finance");
        }
    }

    /// Buka alamat di aplikasi bawaan Windows (browser atau WhatsApp). Pemanggil sudah memeriksa isinya.
    pub fn open_url(url: &str) -> Result<(), String> {
        std::process::Command::new("rundll32")
            .arg("url.dll,FileProtocolHandler")
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|e| err("Gagal membuka WhatsApp", e))
    }
}

#[cfg(windows)]
pub use imp::{is_enabled, open_url, register_notification_identity, set};

#[cfg(not(windows))]
pub fn is_enabled() -> Result<bool, String> {
    Ok(false)
}

#[cfg(not(windows))]
pub fn set(_on: bool) -> Result<(), String> {
    Err("Buka otomatis hanya tersedia di aplikasi Windows.".into())
}

#[cfg(not(windows))]
pub fn register_notification_identity(_app_id: &str) {}

#[cfg(not(windows))]
pub fn open_url(_url: &str) -> Result<(), String> {
    Err("Buka WhatsApp hanya tersedia di aplikasi Windows.".into())
}
