#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod credentials;
mod drivers;
mod engine;
mod host;
mod smoke;
mod updates;

use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::{
    Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

use crate::host::Host;

struct StartupError(Mutex<Option<String>>);

fn trusted(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("非法调用来源".into());
    }
    let url = window.url().map_err(|error| error.to_string())?;
    if url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost") {
        Ok(())
    } else {
        Err("非法调用来源".into())
    }
}

#[tauri::command]
async fn dbaligner_invoke(
    app: tauri::AppHandle,
    window: WebviewWindow,
    host: State<'_, Host>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    trusted(&window)?;
    host.invoke(&app, &window, &method, params).await
}

#[tauri::command]
async fn dbaligner_window(
    app: tauri::AppHandle,
    window: WebviewWindow,
    host: State<'_, Host>,
    action: String,
) -> Result<(), String> {
    trusted(&window)?;
    match action.as_str() {
        "renderer-ready" => {
            host.renderer_ready.store(true, Ordering::SeqCst);
            if let Some(message) = app.state::<StartupError>().0.lock().unwrap().take() {
                window
                    .emit(
                        "dbaligner:event",
                        json!({"event": "engine-error", "message": message}),
                    )
                    .map_err(|error| error.to_string())?;
            }
        }
        "close-confirmed" => {
            if host.close_requested.swap(false, Ordering::SeqCst) {
                host.close_approved.store(true, Ordering::SeqCst);
                window.close().map_err(|error| error.to_string())?;
            }
        }
        "close-cancelled" => {
            host.close_requested.store(false, Ordering::SeqCst);
        }
        "close" => window.close().map_err(|error| error.to_string())?,
        _ => return Err("不允许的窗口操作".into()),
    }
    Ok(())
}

fn workspace_root(app: &tauri::App) -> Result<(PathBuf, Option<PathBuf>), io::Error> {
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let explicit = std::env::var_os("DB_ALIGNER_HOME").map(PathBuf::from);
    let development_repo = cfg!(debug_assertions).then_some(repo.clone());
    let root = if let Some(home) = explicit {
        home
    } else if std::env::var("DB_ALIGNER_DEV").ok().as_deref() == Some("1") {
        repo.join(".local-data/tauri")
    } else {
        app.path()
            .app_local_data_dir()
            .map_err(io::Error::other)?
            .join("data")
    };
    Ok((root, development_repo))
}

fn main() {
    let smoke_fixture = smoke::fixture_path().expect("invalid isolated smoke-test arguments");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![dbaligner_invoke, dbaligner_window])
        .setup(move |app| {
            let (root, development_repo) = workspace_root(app)?;
            fs::create_dir_all(root.join("webview-profile")).map_err(|error| {
                io::Error::other(format!("WebView2 资料目录 {}：{error}", root.display()))
            })?;
            let resource_dir = app
                .path()
                .resource_dir()
                .map_err(|error| io::Error::other(format!("安装资源目录：{error}")))?;
            let update_enabled = !cfg!(debug_assertions)
                && std::env::var("DB_ALIGNER_DEV").ok().as_deref() != Some("1")
                && !std::env::args().any(|argument| argument == "--smoke-test")
                && std::env::current_exe()
                    .ok()
                    .and_then(|exe| exe.parent().map(PathBuf::from))
                    .is_some_and(|directory| directory.join("uninstall.exe").exists());
            let host = Host::new(
                app.handle(),
                root.clone(),
                resource_dir,
                development_repo,
                update_enabled,
            )
            .map_err(|error| io::Error::other(format!("宿主初始化：{error}")))?;
            let startup_error = tauri::async_runtime::block_on(host.engine.start())
                .err()
                .map(|error| error.0);
            app.manage(host);
            app.manage(StartupError(Mutex::new(startup_error)));

            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("DBAligner")
                    .inner_size(1488.0, 1056.0)
                    .min_inner_size(1180.0, 760.0)
                    .visible(false)
                    .drag_and_drop(false)
                    .disable_drag_drop_handler()
                    .transparent(false)
                    .data_directory(root.join("webview-profile"))
                    .on_navigation(|url| {
                        url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")
                    })
                    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                    .build()
                    .map_err(|error| io::Error::other(format!("主窗口初始化：{error}")))?;
            window
                .set_shadow(false)
                .map_err(|error| io::Error::other(format!("标题栏设置：{error}")))?;
            app.state::<Host>()
                .apply_appearance(&window)
                .map_err(|error| io::Error::other(format!("窗口外观设置：{error}")))?;
            if let Some(fixture) = smoke_fixture.clone() {
                let app_handle = app.handle().clone();
                let window_for_smoke = window.clone();
                let root_for_smoke = root.clone();
                tauri::async_runtime::spawn(async move {
                    let outcome =
                        smoke::run(&app_handle, &window_for_smoke, &fixture, &root_for_smoke).await;
                    let passed = smoke::write_result(&root_for_smoke, outcome);
                    let _ = app_handle.state::<Host>().engine.stop().await;
                    app_handle.exit(if passed { 0 } else { 1 });
                });
            } else {
                window
                    .center()
                    .map_err(|error| io::Error::other(format!("窗口居中：{error}")))?;
                window
                    .show()
                    .map_err(|error| io::Error::other(format!("显示窗口：{error}")))?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            let app = window.app_handle();
            let host = app.state::<Host>();
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    if host.close_approved.load(Ordering::SeqCst) {
                        return;
                    }
                    api.prevent_close();
                    if host.frozen.load(Ordering::SeqCst)
                        || host.close_requested.swap(true, Ordering::SeqCst)
                    {
                        return;
                    }
                    if host.renderer_ready.load(Ordering::SeqCst) {
                        let _ = window
                            .emit("dbaligner:event", json!({"event": "window-close-request"}));
                    } else {
                        host.close_requested.store(false, Ordering::SeqCst);
                        if host::confirm_close_before_renderer(app) {
                            host.close_approved.store(true, Ordering::SeqCst);
                            let _ = window.close();
                        }
                    }
                }
                WindowEvent::ThemeChanged(theme) => {
                    if host.theme_mode.lock().unwrap().as_str() == "system" {
                        let resolved = if *theme == tauri::Theme::Dark {
                            "dark"
                        } else {
                            "light"
                        };
                        let _ = window.emit(
                            "dbaligner:event",
                            json!({
                                "event": "appearance-changed",
                                "appearance": {"themeMode": "system", "resolvedTheme": resolved}
                            }),
                        );
                    }
                }
                WindowEvent::Destroyed => {
                    let _ = tauri::async_runtime::block_on(host.engine.stop());
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run DBAligner");
}
