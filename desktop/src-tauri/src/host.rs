//! Restricted Tauri host API. Java owns SQL plans and execution; this layer owns OS access.

use std::collections::{BTreeMap, VecDeque};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

use serde_json::{json, Map, Value};
use tauri::{webview::Color, AppHandle, Emitter, Manager, Theme, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

use crate::credentials::{self, Credentials};
use crate::drivers::Drivers;
use crate::engine::Engine;
use crate::updates::Updates;

const ENGINE_METHODS: &[&str] = &[
    "ping",
    "state.load",
    "entity.save",
    "connectionGroups.save",
    "connectionGroups.delete",
    "connectionGroups.move",
    "connections.move",
    "entity.delete",
    "connections.test",
    "databases.list",
    "schemas.list",
    "database.capabilities",
    "tables.list",
    "table.get",
    "imports.parse",
    "sync.compare",
    "sync.compare.start",
    "sync.compare.get",
    "sync.compare.cancel",
    "sync.save",
    "record.get",
    "record.file",
    "record.cancel",
    "record.verify",
    "version.save",
    "rollback.preview",
    "rollback.execute",
    "external.declare",
    "external.verify",
    "schema.export",
    "config.export",
    "config.import",
    "archives.clear",
];

pub struct Host {
    pub engine: Engine,
    pub drivers: Drivers,
    pub updates: Updates,
    pub root: PathBuf,
    credentials: AsyncMutex<Credentials>,
    credential_gate: AsyncMutex<()>,
    import_files: Mutex<VecDeque<(String, String)>>,
    import_passwords: Mutex<VecDeque<(String, String)>>,
    pub theme_mode: Mutex<String>,
    pub renderer_ready: AtomicBool,
    pub close_requested: AtomicBool,
    pub close_approved: AtomicBool,
    pub active_requests: AtomicUsize,
    pub frozen: AtomicBool,
}

impl Host {
    pub fn new(
        app: &AppHandle,
        root: PathBuf,
        resource_dir: PathBuf,
        dev_repo: Option<PathBuf>,
        update_enabled: bool,
    ) -> Result<Self, String> {
        fs::create_dir_all(&root).map_err(|error| error.to_string())?;
        let credentials = Credentials::load(&root)?;
        let app_for_engine = app.clone();
        let engine = Engine::new(root.clone(), resource_dir, dev_repo, move |event| {
            if let Some(window) = app_for_engine.get_webview_window("main") {
                let _ = window.emit("dbaligner:event", event);
            }
        });
        let app_for_driver = app.clone();
        let drivers = Drivers::new(root.clone(), move |event| {
            if let Some(window) = app_for_driver.get_webview_window("main") {
                let _ = window.emit("dbaligner:event", event);
            }
        })?;
        let updates = Updates::new(app.clone(), update_enabled);
        let theme_mode = read_theme_mode(&root);
        Ok(Self {
            engine,
            drivers,
            updates,
            root,
            credentials: AsyncMutex::new(credentials),
            credential_gate: AsyncMutex::new(()),
            import_files: Mutex::new(VecDeque::new()),
            import_passwords: Mutex::new(VecDeque::new()),
            theme_mode: Mutex::new(theme_mode),
            renderer_ready: AtomicBool::new(false),
            close_requested: AtomicBool::new(false),
            close_approved: AtomicBool::new(false),
            active_requests: AtomicUsize::new(0),
            frozen: AtomicBool::new(false),
        })
    }

    fn admit(&self) -> Result<RequestGuard<'_>, String> {
        if self.frozen.load(Ordering::SeqCst) {
            return Err("客户端正在准备更新，请稍候".into());
        }
        self.active_requests.fetch_add(1, Ordering::SeqCst);
        if self.frozen.load(Ordering::SeqCst) {
            self.active_requests.fetch_sub(1, Ordering::SeqCst);
            return Err("客户端正在准备更新，请稍候".into());
        }
        Ok(RequestGuard(&self.active_requests))
    }

    pub async fn invoke(
        &self,
        app: &AppHandle,
        window: &WebviewWindow,
        method: &str,
        mut params: Value,
    ) -> Result<Value, String> {
        if !params.is_object() {
            return Err("请求参数必须是对象".into());
        }
        if method.starts_with("updates.") {
            empty_params(&params).map_err(|_| "更新接口不接受自定义参数".to_owned())?;
            return match method {
                "updates.get" => Ok(self.updates.get()),
                "updates.check" => Ok(self.updates.check().await),
                "updates.download" => self.updates.download().await,
                "updates.install" => {
                    self.updates
                        .install(&self.engine, &self.active_requests, &self.frozen)
                        .await
                }
                _ => Err("不允许的更新接口".into()),
            };
        }
        let _request = self.admit()?;
        match method {
            "drivers.list" => {
                empty_params(&params)?;
                return serde_json::to_value(self.drivers.list().await?)
                    .map_err(|error| error.to_string());
            }
            "drivers.get" | "drivers.install" | "drivers.cancel" => {
                let id = driver_id(&params)?;
                let state = match method {
                    "drivers.get" => self.drivers.get(id).await?,
                    "drivers.install" => self.drivers.install(id).await?,
                    _ => self.drivers.cancel(id).await?,
                };
                return serde_json::to_value(state).map_err(|error| error.to_string());
            }
            "appearance.get" => return self.appearance(window),
            "appearance.set" => {
                let selected = params
                    .get("themeMode")
                    .and_then(Value::as_str)
                    .ok_or("无效主题选项")?;
                if !["light", "dark", "system"].contains(&selected) {
                    return Err("无效主题选项".into());
                }
                write_theme_mode(&self.root, selected)?;
                *self.theme_mode.lock().unwrap() = selected.to_owned();
                self.apply_appearance(window)?;
                let appearance = self.appearance(window)?;
                window
                    .emit(
                        "dbaligner:event",
                        json!({"event": "appearance-changed", "appearance": appearance}),
                    )
                    .map_err(|error| error.to_string())?;
                return Ok(appearance);
            }
            "files.read" => return self.read_file(app, &params).await,
            "files.chooseDirectory" => return choose_folder(app).await,
            "files.chooseCertificate" => return choose_certificate(app).await,
            "files.save" => return save_file(app, &params).await,
            "files.openArchives" => {
                let state = self
                    .engine
                    .call("state.load", json!({}))
                    .await
                    .map_err(|error| error.0)?;
                let path = state
                    .pointer("/settings/archivePath")
                    .and_then(Value::as_str)
                    .ok_or("档案目录不存在")?;
                Command::new("explorer.exe")
                    .arg(path)
                    .spawn()
                    .map_err(|error| error.to_string())?;
                return Ok(Value::Bool(true));
            }
            "record.export" => {
                return self
                    .export_with_dialog(app, method, &params, "db-aligner-scripts.zip", "脚本包")
                    .await
            }
            "backup.export" => {
                return self
                    .export_with_dialog(app, method, &params, "db-aligner-backup.zip", "本地备份")
                    .await
            }
            "backup.import" => return self.import_backup(app).await,
            _ => {}
        }
        if !ENGINE_METHODS.contains(&method) {
            return Err("不允许的客户端接口".into());
        }
        self.call_business(method, &mut params).await
    }

    async fn call_business(&self, method: &str, params: &mut Value) -> Result<Value, String> {
        // Serialize credential mutations across the Java commit and the encrypted file update.
        let _mutation = if (method == "entity.save"
            && params.get("kind").and_then(Value::as_str) == Some("connection"))
            || (method == "entity.delete"
                && params.get("kind").and_then(Value::as_str) == Some("connection"))
        {
            Some(self.credential_gate.lock().await)
        } else {
            None
        };

        if method == "imports.parse" {
            if let Some(token) = params.get("fileToken").and_then(Value::as_str) {
                let content = self
                    .import_files
                    .lock()
                    .unwrap()
                    .iter()
                    .find(|(id, _)| id == token)
                    .map(|(_, content)| content.clone())
                    .ok_or("会话文件已过期，请重新选择")?;
                let format = params.get("format").cloned().unwrap_or(Value::Null);
                *params = json!({"format": format, "content": content});
            }
        }

        let mut staged: Option<BTreeMap<String, String>> = None;
        if method == "entity.save"
            && params.get("kind").and_then(Value::as_str) == Some("connection")
        {
            let mut value = params
                .get("value")
                .and_then(Value::as_object)
                .cloned()
                .ok_or("连接配置无效")?;
            let id = value
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| Uuid::new_v4().to_string());
            value.insert("id".into(), Value::String(id.clone()));
            let mut next = self.credentials.lock().await.snapshot();
            let imported = value
                .get("importCredentialId")
                .and_then(Value::as_str)
                .and_then(|id| {
                    self.import_passwords
                        .lock()
                        .unwrap()
                        .iter()
                        .find(|(key, _)| key == id)
                        .map(|(_, password)| password.clone())
                });
            let password = value
                .get("password")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .or(imported);
            if let Some(password) = password {
                next.insert(id.clone(), credentials::encrypt(&password)?);
            }
            if let Some(password) = value
                .get("certificatePassword")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
            {
                next.insert(format!("{id}:certificate"), credentials::encrypt(password)?);
            }
            if value.get("clearPassword").and_then(Value::as_bool) == Some(true) {
                next.remove(&id);
            }
            for key in [
                "importCredentialId",
                "password",
                "certificatePassword",
                "clearPassword",
            ] {
                value.remove(key);
            }
            value.insert("hasPassword".into(), Value::Bool(next.contains_key(&id)));
            params
                .as_object_mut()
                .unwrap()
                .insert("value".into(), Value::Object(value));
            staged = Some(next);
        }

        let mut secrets = self.credentials.lock().await.decrypted();
        if method == "connections.test" && params.get("config").is_some() {
            let mut config = params
                .get("config")
                .and_then(Value::as_object)
                .cloned()
                .ok_or("连接配置无效")?;
            validate_connection(&config)?;
            let original = config
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            let id = Uuid::new_v4().to_string();
            config.insert("id".into(), Value::String(id.clone()));
            let imported = config
                .get("importCredentialId")
                .and_then(Value::as_str)
                .and_then(|key| {
                    self.import_passwords
                        .lock()
                        .unwrap()
                        .iter()
                        .find(|(id, _)| id == key)
                        .map(|(_, password)| password.clone())
                });
            let password = config
                .get("password")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .or(imported)
                .or_else(|| secrets.get(&original).cloned())
                .unwrap_or_default();
            let certificate = config
                .get("certificatePassword")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .or_else(|| secrets.get(&format!("{original}:certificate")).cloned())
                .unwrap_or_default();
            secrets.insert(id.clone(), password);
            secrets.insert(format!("{id}:certificate"), certificate);
            for key in ["password", "certificatePassword", "importCredentialId"] {
                config.remove(key);
            }
            params
                .as_object_mut()
                .unwrap()
                .insert("config".into(), Value::Object(config));
        }
        params.as_object_mut().unwrap().insert(
            "$secrets".into(),
            serde_json::to_value(secrets.clone()).map_err(|error| error.to_string())?,
        );
        let mut response = self
            .engine
            .call(method, params.clone())
            .await
            .map_err(|error| error.0)?;
        if let Some(next) = staged {
            self.credentials.lock().await.replace(next)?;
        }
        if method == "imports.parse" {
            if let Some(rows) = response.as_array_mut() {
                for row in rows {
                    if let Some(object) = row.as_object_mut() {
                        if let Some(password) = object
                            .remove("password")
                            .and_then(|value| value.as_str().map(str::to_owned))
                        {
                            if !password.is_empty() {
                                let id = object
                                    .get("id")
                                    .and_then(Value::as_str)
                                    .unwrap_or("")
                                    .to_owned();
                                bounded_insert(
                                    &mut self.import_passwords.lock().unwrap(),
                                    id,
                                    password,
                                    1000,
                                );
                                object.insert(
                                    "credentialStatus".into(),
                                    Value::String("已读取密码，可直接导入".into()),
                                );
                            }
                        }
                    }
                }
            }
        }
        if method == "entity.delete"
            && params.get("kind").and_then(Value::as_str) == Some("connection")
        {
            let id = params
                .get("id")
                .and_then(Value::as_str)
                .ok_or("连接标识无效")?;
            let mut store = self.credentials.lock().await;
            let mut next = store.snapshot();
            next.remove(id);
            next.remove(&format!("{id}:certificate"));
            store.replace(next)?;
        }
        if method == "state.load" {
            if let Some(connections) = response
                .get_mut("connections")
                .and_then(Value::as_array_mut)
            {
                for connection in connections {
                    if let Some(object) = connection.as_object_mut() {
                        let has_password = object
                            .get("id")
                            .and_then(Value::as_str)
                            .is_some_and(|id| secrets.contains_key(id));
                        object.insert("hasPassword".into(), Value::Bool(has_password));
                    }
                }
            }
        }
        Ok(response)
    }

    fn appearance(&self, window: &WebviewWindow) -> Result<Value, String> {
        let theme_mode = self.theme_mode.lock().unwrap().clone();
        let resolved = if window.theme().map_err(|error| error.to_string())? == Theme::Dark {
            "dark"
        } else {
            "light"
        };
        Ok(json!({"themeMode": theme_mode, "resolvedTheme": resolved}))
    }

    pub fn apply_appearance(&self, window: &WebviewWindow) -> Result<(), String> {
        let selected = self.theme_mode.lock().unwrap().clone();
        let theme = match selected.as_str() {
            "light" => Some(Theme::Light),
            "dark" => Some(Theme::Dark),
            _ => None,
        };
        window.set_theme(theme).map_err(|error| error.to_string())?;
        let dark = window.theme().map_err(|error| error.to_string())? == Theme::Dark;
        window
            .set_background_color(Some(if dark {
                Color(20, 20, 20, 255)
            } else {
                Color(255, 255, 255, 255)
            }))
            .map_err(|error| error.to_string())
    }

    async fn read_file(&self, app: &AppHandle, params: &Value) -> Result<Value, String> {
        let app = app.clone();
        let chosen = tokio::task::spawn_blocking(move || {
            app.dialog()
                .file()
                .add_filter("数据库会话与配置", &["ncx", "json", "xml"])
                .blocking_pick_file()
        })
        .await
        .map_err(|error| error.to_string())?;
        let Some(chosen) = chosen else {
            return Ok(Value::Null);
        };
        let path = chosen.into_path().map_err(|error| error.to_string())?;
        let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
        if metadata.len() > 5_000_000 {
            return Err("文件超过 5 MB".into());
        }
        let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .to_owned();
        if params.get("intent").and_then(Value::as_str) == Some("sessions") {
            let token = Uuid::new_v4().to_string();
            bounded_insert(
                &mut self.import_files.lock().unwrap(),
                token.clone(),
                content,
                20,
            );
            Ok(json!({"name": name, "content": "", "token": token}))
        } else {
            Ok(json!({"name": name, "content": content}))
        }
    }

    async fn export_with_dialog(
        &self,
        app: &AppHandle,
        method: &str,
        params: &Value,
        fallback: &str,
        label: &str,
    ) -> Result<Value, String> {
        let app = app.clone();
        let name = params
            .get("name")
            .and_then(Value::as_str)
            .filter(|name| !name.is_empty())
            .unwrap_or(fallback)
            .to_owned();
        let label = label.to_owned();
        let chosen = tokio::task::spawn_blocking(move || {
            app.dialog()
                .file()
                .set_file_name(name)
                .add_filter(label, &["zip"])
                .blocking_save_file()
        })
        .await
        .map_err(|error| error.to_string())?;
        let Some(chosen) = chosen else {
            return Ok(Value::Null);
        };
        let path = chosen.into_path().map_err(|error| error.to_string())?;
        let mut parameters = if method == "record.export" {
            params.clone()
        } else {
            json!({})
        };
        parameters.as_object_mut().unwrap().insert(
            "destination".into(),
            Value::String(path.to_string_lossy().into_owned()),
        );
        self.engine
            .call(method, parameters)
            .await
            .map_err(|error| error.0)?;
        Ok(Value::String(path.to_string_lossy().into_owned()))
    }

    async fn import_backup(&self, app: &AppHandle) -> Result<Value, String> {
        let app = app.clone();
        let chosen = tokio::task::spawn_blocking(move || {
            app.dialog()
                .file()
                .add_filter("DBAligner 备份", &["zip"])
                .blocking_pick_file()
        })
        .await
        .map_err(|error| error.to_string())?;
        let Some(chosen) = chosen else {
            return Ok(Value::Null);
        };
        let source = chosen.into_path().map_err(|error| error.to_string())?;
        let before = self
            .root
            .join(format!("before-restore-{}.zip", timestamp_millis()));
        self.engine
            .call(
                "backup.export",
                json!({"destination": before.to_string_lossy()}),
            )
            .await
            .map_err(|error| error.0)?;
        let stage = self
            .engine
            .call(
                "backup.prepareRestore",
                json!({"source": source.to_string_lossy()}),
            )
            .await
            .map_err(|error| error.0)?;
        let folder = stage
            .get("folder")
            .and_then(Value::as_str)
            .ok_or("备份暂存目录无效")?
            .to_owned();
        let sqlite = stage
            .get("sqlite")
            .and_then(Value::as_str)
            .ok_or("备份数据库暂存文件无效")?;
        let staged_sqlite = PathBuf::from(sqlite);
        if !staged_sqlite.is_file() {
            return Err("备份数据库暂存文件无效".into());
        }
        let replacement = self
            .root
            .join(format!(".state-restore-{}.sqlite", Uuid::new_v4()));
        fs::copy(&staged_sqlite, &replacement)
            .map_err(|error| format!("暂存恢复数据库失败：{error}"))?;
        File::open(&replacement)
            .and_then(|file| file.sync_all())
            .map_err(|error| format!("持久化恢复数据库失败：{error}"))?;
        self.engine.stop().await.map_err(|error| error.0)?;
        let current = self.root.join("state.sqlite");
        let fallback = self
            .root
            .join(format!(".state-before-restore-{}.sqlite", Uuid::new_v4()));
        for suffix in ["-wal", "-shm"] {
            let p = self.root.join(format!("state.sqlite{suffix}"));
            if p.exists() {
                fs::remove_file(&p).map_err(|error| format!("清理 SQLite 日志失败：{error}"))?;
            }
        }
        if current.exists() {
            fs::rename(&current, &fallback)
                .map_err(|error| format!("保护原数据库失败：{error}"))?;
        }
        if let Err(error) = fs::rename(&replacement, &current) {
            if fallback.exists() {
                let _ = fs::rename(&fallback, &current);
            }
            let _ = self.engine.start().await;
            return Err(format!("切换恢复数据库失败：{error}"));
        }
        if let Err(error) = self.engine.start().await {
            return Err(format!(
                "恢复数据库已切换，但引擎重启失败；原数据库保存在 {}：{}",
                fallback.display(),
                error.0
            ));
        }
        self.engine
            .call("backup.finishRestore", json!({"folder": folder}))
            .await
            .map_err(|error| error.0)?;
        if fallback.exists() {
            let _ = fs::remove_file(fallback);
        }
        Ok(Value::Bool(true))
    }
}

struct RequestGuard<'a>(&'a AtomicUsize);
impl Drop for RequestGuard<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

fn bounded_insert(
    queue: &mut VecDeque<(String, String)>,
    id: String,
    content: String,
    limit: usize,
) {
    if queue.len() >= limit {
        queue.pop_front();
    }
    queue.push_back((id, content));
}

fn empty_params(params: &Value) -> Result<(), String> {
    if params.as_object().is_some_and(Map::is_empty) {
        Ok(())
    } else {
        Err("接口不接受自定义参数".into())
    }
}

fn driver_id(params: &Value) -> Result<&str, String> {
    let object = params.as_object().ok_or("驱动接口仅接受目录标识")?;
    if object.len() != 1 {
        return Err("驱动接口仅接受目录标识".into());
    }
    object
        .get("driverId")
        .and_then(Value::as_str)
        .ok_or("驱动接口仅接受目录标识".into())
}

fn validate_connection(config: &Map<String, Value>) -> Result<(), String> {
    let database_type = config
        .get("databaseType")
        .and_then(Value::as_str)
        .unwrap_or("mysql");
    if !["mysql", "postgresql"].contains(&database_type) {
        return Err("不支持的数据库类型".into());
    }
    if database_type == "postgresql" {
        if config
            .get("initialDatabase")
            .and_then(Value::as_str)
            .is_none_or(|value| value.trim().is_empty())
        {
            return Err("请输入初始连接数据库".into());
        }
        if config.get("ssl").and_then(Value::as_bool) == Some(true)
            && config
                .get("ca")
                .and_then(Value::as_str)
                .is_none_or(|value| value.trim().is_empty())
        {
            return Err("PostgreSQL SSL 连接需要 CA 证书".into());
        }
    }
    let missing: Vec<_> = [
        ("name", "连接名称"),
        ("host", "服务器地址"),
        ("user", "用户名"),
    ]
    .into_iter()
    .filter_map(|(key, label)| {
        config
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .is_none()
            .then_some(label)
    })
    .collect();
    if !missing.is_empty() {
        return Err(format!("请填写{}", missing.join("、")));
    }
    let host = config.get("host").and_then(Value::as_str).unwrap();
    if !host
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ".-:[]".contains(ch))
    {
        return Err("请输入有效的服务器地址".into());
    }
    if config
        .get("port")
        .and_then(Value::as_u64)
        .is_none_or(|port| !(1..=65535).contains(&port))
    {
        return Err("端口必须是 1–65535 的整数".into());
    }
    Ok(())
}

pub fn read_theme_mode(root: &Path) -> String {
    fs::read(root.join("ui-preferences.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|value| {
            value
                .get("themeMode")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .filter(|mode| ["light", "dark", "system"].contains(&mode.as_str()))
        .unwrap_or_else(|| "system".into())
}

fn write_theme_mode(root: &Path, selected: &str) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let destination = root.join("ui-preferences.json");
    let temporary = root.join(format!(".ui-preferences-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        output
            .write_all(format!("{{\"themeMode\":\"{selected}\"}}\n").as_bytes())
            .map_err(|error| error.to_string())?;
        output.sync_all().map_err(|error| error.to_string())?;
        drop(output);
        fs::rename(&temporary, destination).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

async fn choose_folder(app: &AppHandle) -> Result<Value, String> {
    let app = app.clone();
    let selected = tokio::task::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
        .await
        .map_err(|error| error.to_string())?;
    selected
        .map(|path| {
            path.into_path()
                .map(|path| Value::String(path.to_string_lossy().into_owned()))
                .map_err(|error| error.to_string())
        })
        .transpose()
        .map(|value| value.unwrap_or(Value::Null))
}

async fn choose_certificate(app: &AppHandle) -> Result<Value, String> {
    let app = app.clone();
    let selected = tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("证书", &["pem", "crt", "cer", "p12", "pfx"])
            .blocking_pick_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    selected
        .map(|path| {
            path.into_path()
                .map(|path| Value::String(path.to_string_lossy().into_owned()))
                .map_err(|error| error.to_string())
        })
        .transpose()
        .map(|value| value.unwrap_or(Value::Null))
}

async fn save_file(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let app = app.clone();
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
        .unwrap_or("export.sql")
        .to_owned();
    let content = params
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let selected = tokio::task::spawn_blocking(move || {
        app.dialog().file().set_file_name(name).blocking_save_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(selected) = selected else {
        return Ok(Value::Null);
    };
    let path = selected.into_path().map_err(|error| error.to_string())?;
    fs::write(&path, content).map_err(|error| error.to_string())?;
    Ok(Value::String(path.to_string_lossy().into_owned()))
}

fn timestamp_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub fn confirm_close_before_renderer(app: &AppHandle) -> bool {
    app.dialog()
        .message("客户端正在启动，确认关闭？")
        .title("关闭客户端")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "关闭".into(),
            "取消".into(),
        ))
        .blocking_show()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renderer_cannot_choose_driver_url_or_extra_fields() {
        assert!(driver_id(&json!({"driverId": "postgresql"})).is_ok());
        assert!(
            driver_id(&json!({"driverId": "postgresql", "url": "https://example.test"})).is_err()
        );
    }

    #[test]
    fn connection_validation_matches_current_bridge() {
        assert_eq!(
            validate_connection(json!({"databaseType": "postgresql"}).as_object().unwrap()),
            Err("请输入初始连接数据库".into())
        );
        assert!(validate_connection(
            json!({"name":"x","host":"localhost","user":"u","port":5432})
                .as_object()
                .unwrap()
        )
        .is_ok());
    }

    #[test]
    fn theme_preference_round_trip_is_isolated() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../.local-data")
            .join(format!("tauri-theme-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        assert_eq!(read_theme_mode(&root), "system");
        write_theme_mode(&root, "dark").unwrap();
        assert_eq!(read_theme_mode(&root), "dark");
        fs::remove_dir_all(root).unwrap();
    }
}
