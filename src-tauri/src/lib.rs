use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;

mod winsys;

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Apakah aplikasi terdaftar buka otomatis saat Windows menyala.
#[tauri::command]
fn autostart_enabled() -> Result<bool, String> {
    winsys::is_enabled()
}

#[tauri::command]
fn autostart_set(on: bool) -> Result<(), String> {
    winsys::set(on)
}

/// Notifikasi desktop lewat sisi Rust, tidak tergantung izin Notification milik webview.
#[tauri::command]
fn show_notification(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        // Satu jendela saja: membuka ulang aplikasi cukup memunculkan jendela yang sudah ada.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![autostart_enabled, autostart_set, show_notification])
        .setup(|app| {
            winsys::register_notification_identity(&app.config().identifier);

            let open = MenuItem::with_id(app, "open", "Buka Luna Finance", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Keluar", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;

            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Luna Finance")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            // Jendela dibuat tersembunyi di konfigurasi. Selalu tampilkan saat aplikasi mulai,
            // termasuk saat dijalankan otomatis oleh Windows, supaya langsung kelihatan.
            show_main(app.handle());

            // Detak tiap menit dari sisi Rust. Pengecekan pengingat di webview ikut jalan walau
            // jendela disembunyikan ke tray dan timer webview diperlambat.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(60));
                let _ = handle.emit("tick", ());
            });
            Ok(())
        })
        // Tombol tutup menyembunyikan jendela ke tray supaya pengingat tetap jalan.
        // Keluar penuh lewat menu tray.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("gagal menjalankan Luna Finance");
}
