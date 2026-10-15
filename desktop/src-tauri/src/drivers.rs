//! The renderer may select a pinned driver id, never a URL or filesystem path.

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::{watch, Mutex};
use uuid::Uuid;

const MAX_BYTES: u64 = 20_000_000;
const CATALOGUE: &str = include_str!("../../../engine/src/main/resources/drivers.json");

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriverEntry {
    id: String,
    database_type: String,
    name: String,
    version: String,
    builtin: bool,
    files: Vec<DriverFile>,
    license: String,
    license_url: String,
}

#[derive(Clone, Deserialize)]
struct DriverFile {
    name: String,
    url: String,
    sha256: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverState {
    id: String,
    database_type: String,
    name: String,
    version: String,
    builtin: bool,
    license: String,
    license_url: String,
    status: String,
    revision: u64,
    bytes: u64,
    message: String,
}

struct Active {
    cancel: watch::Sender<bool>,
    result: watch::Sender<Option<DriverState>>,
}

struct Inner {
    root: PathBuf,
    catalogue: Vec<DriverEntry>,
    states: Mutex<HashMap<String, DriverState>>,
    active: Mutex<HashMap<String, Active>>,
    emit: Arc<dyn Fn(Value) + Send + Sync>,
    client: reqwest::Client,
}

#[derive(Clone)]
pub struct Drivers(Arc<Inner>);

impl Drivers {
    pub fn new(
        root: PathBuf,
        emit: impl Fn(Value) + Send + Sync + 'static,
    ) -> Result<Self, String> {
        let catalogue: Vec<DriverEntry> =
            serde_json::from_str(CATALOGUE).map_err(|error| error.to_string())?;
        let client = reqwest::Client::builder()
            .redirect(Policy::none())
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|error| error.to_string())?;
        Ok(Self(Arc::new(Inner {
            root,
            catalogue,
            states: Mutex::new(HashMap::new()),
            active: Mutex::new(HashMap::new()),
            emit: Arc::new(emit),
            client,
        })))
    }

    fn entry(&self, id: &str) -> Result<DriverEntry, String> {
        self.0
            .catalogue
            .iter()
            .find(|entry| entry.id == id)
            .cloned()
            .ok_or_else(|| "不支持的驱动标识".into())
    }

    async fn change(
        &self,
        entry: &DriverEntry,
        status: &str,
        bytes: u64,
        message: &str,
    ) -> DriverState {
        let mut states = self.0.states.lock().await;
        let revision = states.get(&entry.id).map_or(1, |state| state.revision + 1);
        let state = DriverState {
            id: entry.id.clone(),
            database_type: entry.database_type.clone(),
            name: entry.name.clone(),
            version: entry.version.clone(),
            builtin: entry.builtin,
            license: entry.license.clone(),
            license_url: entry.license_url.clone(),
            status: status.into(),
            revision,
            bytes,
            message: message.into(),
        };
        states.insert(entry.id.clone(), state.clone());
        drop(states);
        (self.0.emit)(json!({"event": "driver-state", "state": state}));
        state
    }

    fn directory(&self, entry: &DriverEntry) -> Result<PathBuf, String> {
        let base = self.0.root.join("drivers");
        let directory = base.join(&entry.id).join(&entry.version);
        for path in [&base, &base.join(&entry.id), &directory] {
            fs::create_dir_all(path).map_err(|error| error.to_string())?;
            if fs::symlink_metadata(path)
                .map_err(|error| error.to_string())?
                .file_type()
                .is_symlink()
            {
                return Err("驱动目录包含不安全路径".into());
            }
        }
        let canonical_base = fs::canonicalize(&base).map_err(|error| error.to_string())?;
        let canonical_directory =
            fs::canonicalize(&directory).map_err(|error| error.to_string())?;
        if !canonical_directory.starts_with(&canonical_base)
            || canonical_directory == canonical_base
        {
            return Err("驱动目录不在允许范围".into());
        }
        Ok(directory)
    }

    fn target(directory: &Path, file: &DriverFile) -> Result<PathBuf, String> {
        if Path::new(&file.name)
            .file_name()
            .and_then(|name| name.to_str())
            != Some(&file.name)
        {
            return Err("驱动文件名无效".into());
        }
        let target = directory.join(&file.name);
        if let Ok(metadata) = fs::symlink_metadata(&target) {
            if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
                return Err("驱动文件路径不安全".into());
            }
        }
        Ok(target)
    }

    pub async fn get(&self, id: &str) -> Result<DriverState, String> {
        let entry = self.entry(id)?;
        if self.0.active.lock().await.contains_key(id) {
            if let Some(state) = self.0.states.lock().await.get(id).cloned() {
                return Ok(state);
            }
        }
        let installed = if entry.builtin {
            true
        } else {
            self.installed(&entry).unwrap_or(false)
        };
        if installed {
            Ok(self
                .change(&entry, "installed", 0, "驱动已安装，可离线使用")
                .await)
        } else {
            let previous = self.0.states.lock().await.get(id).cloned();
            if let Some(state) = previous {
                if state.status == "error" || state.status == "cancelled" {
                    Ok(state)
                } else {
                    Ok(self.change(&entry, "missing", 0, "尚未安装").await)
                }
            } else {
                Ok(self.change(&entry, "missing", 0, "尚未安装").await)
            }
        }
    }

    fn installed(&self, entry: &DriverEntry) -> Result<bool, String> {
        let directory = self.directory(entry)?;
        for file in &entry.files {
            let target = Self::target(&directory, file)?;
            let metadata = fs::symlink_metadata(&target).map_err(|error| error.to_string())?;
            if !metadata.is_file() || metadata.len() > MAX_BYTES {
                return Ok(false);
            }
            let mut input = File::open(&target).map_err(|error| error.to_string())?;
            let mut digest = Sha256::new();
            let mut buffer = [0_u8; 65_536];
            loop {
                let count = input.read(&mut buffer).map_err(|error| error.to_string())?;
                if count == 0 {
                    break;
                }
                digest.update(&buffer[..count]);
            }
            if hex::encode(digest.finalize()) != file.sha256 {
                return Ok(false);
            }
        }
        Ok(true)
    }

    pub async fn list(&self) -> Result<Vec<DriverState>, String> {
        let mut states = Vec::with_capacity(self.0.catalogue.len());
        for entry in &self.0.catalogue {
            states.push(self.get(&entry.id).await?);
        }
        Ok(states)
    }

    pub async fn install(&self, id: &str) -> Result<DriverState, String> {
        let entry = self.entry(id)?;
        let (mut result_rx, mut cancel_rx, own) = {
            let mut active = self.0.active.lock().await;
            if let Some(existing) = active.get(id) {
                (
                    existing.result.subscribe(),
                    existing.cancel.subscribe(),
                    false,
                )
            } else {
                let (cancel, cancel_rx) = watch::channel(false);
                let (result, result_rx) = watch::channel(None);
                active.insert(entry.id.clone(), Active { cancel, result });
                (result_rx, cancel_rx, true)
            }
        };
        if !own {
            loop {
                if let Some(state) = result_rx.borrow().clone() {
                    return Ok(state);
                }
                result_rx
                    .changed()
                    .await
                    .map_err(|_| "驱动安装中断".to_owned())?;
            }
        }
        self.change(&entry, "downloading", 0, "正在下载驱动").await;
        let outcome = self.perform(&entry, &mut cancel_rx).await;
        let state = match outcome {
            Ok(()) => {
                self.change(&entry, "installed", 0, "驱动已安装，可测试连接")
                    .await
            }
            Err(_error) if *cancel_rx.borrow() => {
                self.change(&entry, "cancelled", 0, "安装已取消").await
            }
            Err(error) => {
                let message = if error.starts_with("驱动") {
                    error
                } else {
                    "驱动安装失败，请检查网络后重试".into()
                };
                self.change(&entry, "error", 0, &message).await
            }
        };
        if let Some(active) = self.0.active.lock().await.remove(id) {
            let _ = active.result.send(Some(state.clone()));
        }
        Ok(state)
    }

    async fn perform(
        &self,
        entry: &DriverEntry,
        cancelled: &mut watch::Receiver<bool>,
    ) -> Result<(), String> {
        if entry.builtin || self.installed(entry).unwrap_or(false) {
            return Ok(());
        }
        let directory = self.directory(entry)?;
        for file in &entry.files {
            if *cancelled.borrow() {
                return Err("安装已取消".into());
            }
            let url = reqwest::Url::parse(&file.url).map_err(|_| "驱动下载地址无效".to_owned())?;
            if url.scheme() != "https" {
                return Err("驱动下载地址无效".into());
            }
            let mut response = self
                .0
                .client
                .get(url)
                .send()
                .await
                .map_err(|_| "驱动下载失败".to_owned())?;
            if !response.status().is_success() {
                return Err("驱动下载失败".into());
            }
            let target = Self::target(&directory, file)?;
            let temporary = directory.join(format!(".{}.tmp", Uuid::new_v4()));
            let result = async {
                let mut output = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&temporary)
                    .map_err(|error| error.to_string())?;
                let mut digest = Sha256::new();
                let mut bytes = 0_u64;
                loop {
                    let next = tokio::select! {
                        _ = cancelled.changed() => return Err("安装已取消".to_owned()),
                        chunk = response.chunk() => chunk.map_err(|_| "驱动下载失败".to_owned())?,
                    };
                    let Some(chunk) = next else {
                        break;
                    };
                    if *cancelled.borrow() {
                        return Err("安装已取消".into());
                    }
                    bytes += chunk.len() as u64;
                    if bytes > MAX_BYTES {
                        return Err("驱动文件超过允许大小".into());
                    }
                    digest.update(&chunk);
                    output
                        .write_all(&chunk)
                        .map_err(|error| error.to_string())?;
                    self.change(entry, "downloading", bytes, "正在下载并校验驱动")
                        .await;
                }
                output.sync_all().map_err(|error| error.to_string())?;
                drop(output);
                if hex::encode(digest.finalize()) != file.sha256 {
                    return Err("驱动文件摘要不匹配，请重试".into());
                }
                Self::target(&directory, file)?;
                fs::rename(&temporary, &target).map_err(|error| error.to_string())?;
                Ok::<(), String>(())
            }
            .await;
            if result.is_err() {
                let _ = fs::remove_file(&temporary);
            }
            result?;
        }
        Ok(())
    }

    pub async fn cancel(&self, id: &str) -> Result<DriverState, String> {
        self.entry(id)?;
        if let Some(active) = self.0.active.lock().await.get(id) {
            let _ = active.cancel.send(true);
        }
        self.get(id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalogue_only_selects_known_ids() {
        let driver = Drivers::new(PathBuf::from("unused"), |_| {}).unwrap();
        assert!(driver.entry("postgresql").is_ok());
        assert!(driver.entry("https://example.test/file.jar").is_err());
        assert!(driver.entry("../../postgresql").is_err());
    }

    #[tokio::test]
    async fn missing_driver_status_does_not_hold_state_lock_while_emitting() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../.local-data")
            .join(format!("tauri-driver-test-{}", Uuid::new_v4()));
        let driver = Drivers::new(root.clone(), |_| {}).unwrap();
        let states = tokio::time::timeout(std::time::Duration::from_secs(3), driver.list())
            .await
            .expect("driver status lock must not deadlock")
            .unwrap();
        assert!(states
            .iter()
            .any(|state| state.id == "mariadb" && state.status == "installed"));
        assert!(states
            .iter()
            .any(|state| state.id == "postgresql" && state.status == "missing"));
        fs::remove_dir_all(root).unwrap();
    }
}
